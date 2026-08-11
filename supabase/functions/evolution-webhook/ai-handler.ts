import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { triageContact } from '../_shared/triage.ts'

interface Contact {
  id: string
  user_id: string
  remote_jid: string
  push_name: string | null
  ai_agent_id: string | null
  phone_number: string | null
}

function scheduleTriage(supabase: SupabaseClient, contactId: string) {
  const task = triageContact(supabase, contactId).catch((err) => {
    console.error('[ai-handler] Background triage failed', {
      contactId,
      error: err instanceof Error ? err.message : String(err),
    })
  })

  const edgeRuntime = (globalThis as any).EdgeRuntime
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(task)
  else void task
}

export async function handleMessageUpsert(
  supabase: SupabaseClient,
  userId: string,
  contact: Contact,
  text: string,
  instanceName: string,
): Promise<void> {
  // Triage is independent from the customer-facing responder. An internal agent
  // can classify every inbound conversation even when no reply agent is assigned
  // to the contact. It runs in the background so webhook latency is unaffected.
  scheduleTriage(supabase, contact.id)

  if (!contact.ai_agent_id) return

  const { data: agent } = await supabase
    .from('ai_agents')
    .select('*')
    .eq('id', contact.ai_agent_id)
    .eq('is_active', true)
    .maybeSingle()

  if (!agent) return

  try {
    const response = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/openai-agent-response`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({
          agentId: agent.id,
          contactId: contact.id,
          input: text,
          instanceName,
          phoneNumber: contact.phone_number || contact.remote_jid.split('@')[0],
        }),
      },
    )

    if (!response.ok) {
      console.error('AI agent response failed:', response.status)
    }
  } catch (err) {
    console.error('Error invoking AI agent:', err instanceof Error ? err.message : String(err))
  }
}
