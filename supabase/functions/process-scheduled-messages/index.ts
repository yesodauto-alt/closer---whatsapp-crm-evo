import { createClient } from '@supabase/supabase-js'
import { resolveEvolutionNumber } from '../_shared/phone.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const expectedSecret = Deno.env.get('SCHEDULED_MESSAGES_SECRET')
  const receivedSecret = request.headers.get('x-scheduler-secret')
  if (!expectedSecret || receivedSecret !== expectedSecret) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Supabase not configured' }, 500)

  const db = createClient(supabaseUrl, serviceRoleKey)
  const { data: jobs, error: claimError } = await db.rpc('claim_scheduled_messages', {
    batch_size: 25,
  })
  if (claimError) return json({ error: claimError.message }, 500)

  const results: Array<{ id: string; status: string; error?: string }> = []
  for (const job of jobs ?? []) {
    try {
      const { data: contact, error: contactError } = await db
        .from('whatsapp_contacts')
        .select('id, user_id, remote_jid, phone_number')
        .eq('id', job.contact_id)
        .single()
      if (contactError || !contact) throw new Error('Contato não encontrado')

      const { data: integration, error: integrationError } = await db
        .from('user_integrations')
        .select('evolution_api_url, evolution_api_key, instance_name')
        .eq('user_id', contact.user_id)
        .single()
      if (integrationError || !integration) throw new Error('Integração Evolution não encontrada')

      const evolutionUrl = (
        integration.evolution_api_url ||
        Deno.env.get('EVOLUTION_API_URL') ||
        ''
      ).replace(/\/$/, '')
      const evolutionKey = integration.evolution_api_key || Deno.env.get('EVOLUTION_API_KEY')
      if (!evolutionUrl || !evolutionKey || !integration.instance_name) {
        throw new Error('Evolution não configurada')
      }

      const number = resolveEvolutionNumber(contact.remote_jid, contact.phone_number)
      const response = await fetch(
        `${evolutionUrl}/message/sendText/${encodeURIComponent(integration.instance_name)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: evolutionKey },
          body: JSON.stringify({ number, text: job.text }),
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || `Evolution HTTP ${response.status}`)
      }

      const messageId =
        payload?.key?.id || payload?.message?.key?.id || `scheduled:${job.idempotency_key}`
      await db.from('whatsapp_messages').upsert(
        {
          user_id: contact.user_id,
          contact_id: contact.id,
          message_id: messageId,
          from_me: true,
          text: job.text,
          type: 'conversation',
          timestamp: new Date().toISOString(),
          raw: payload,
        },
        { onConflict: 'user_id,message_id' },
      )

      await db
        .from('scheduled_messages')
        .update({
          status: 'sent',
          sent_message_id: messageId,
          processed_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      results.push({ id: job.id, status: 'sent' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const finalFailure = Number(job.attempts) >= Number(job.max_attempts)
      await db
        .from('scheduled_messages')
        .update({
          status: finalFailure ? 'failed' : 'pending',
          last_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      results.push({ id: job.id, status: finalFailure ? 'failed' : 'pending', error: message })
    }
  }

  return json({ processed: results.length, results })
})
