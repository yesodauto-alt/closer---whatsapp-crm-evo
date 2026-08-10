import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { jsonResponse } from '../_shared/evolution-api.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { digitsFromJid } from '../_shared/phone.ts'
import { handleMessageUpsert } from './ai-handler.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

async function findContactByJid(userId: string, remoteJid: string) {
  const { data } = await supabase
    .from('whatsapp_contacts')
    .select('*')
    .eq('user_id', userId)
    .eq('remote_jid', remoteJid)
    .maybeSingle()
  return data
}

async function findUserIdByInstance(instanceName: string): Promise<string | null> {
  const { data } = await supabase
    .from('user_integrations')
    .select('user_id')
    .eq('instance_name', instanceName)
    .maybeSingle()
  return data?.user_id ?? null
}

async function handleMessagesUpsert(event: any, instance: string) {
  const userId = await findUserIdByInstance(instance)
  if (!userId) return

  const messages = event?.data?.messages ?? []
  if (!Array.isArray(messages)) return

  for (const msg of messages) {
    const remoteJid = msg?.key?.remoteJid
    const messageId = msg?.key?.id
    if (!remoteJid || !messageId) continue

    const text = msg?.message?.conversation || msg?.message?.extendedTextMessage?.text || ''

    let contact = await findContactByJid(userId, remoteJid)
    if (!contact) {
      const { data: newContact } = await supabase
        .from('whatsapp_contacts')
        .insert({
          user_id: userId,
          remote_jid: remoteJid,
          push_name: msg?.pushName || null,
          phone_number: digitsFromJid(remoteJid) || null,
          last_message_at: new Date().toISOString(),
        })
        .select()
        .single()
      contact = newContact
    } else {
      await supabase
        .from('whatsapp_contacts')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', contact.id)
    }

    const fromMe = msg?.key?.fromMe ?? false
    const timestamp = msg?.messageTimestamp
      ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
      : new Date().toISOString()

    await supabase.from('whatsapp_messages').upsert(
      {
        user_id: userId,
        contact_id: contact?.id,
        message_id: messageId,
        from_me: fromMe,
        text,
        type: 'text',
        timestamp,
        raw: msg,
      },
      { onConflict: 'user_id,message_id' },
    )

    if (!fromMe && contact && text) {
      await handleMessageUpsert(supabase, userId, contact, text, instance)
    }
  }
}

async function handleConnectionUpdate(event: any, instance: string) {
  const userId = await findUserIdByInstance(instance)
  if (!userId) return

  const state = event?.data?.state ?? event?.data?.status
  let status = 'CONNECTING'
  if (state === 'open' || state === 'CONNECTED') status = 'CONNECTED'
  else if (state === 'close' || state === 'DISCONNECTED') status = 'DISCONNECTED'

  await supabase
    .from('user_integrations')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('instance_name', instance)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const event = body?.event
    const instance = body?.instance

    if (!event || !instance) {
      return jsonResponse({ received: true, message: 'Missing event or instance' })
    }

    switch (event) {
      case 'MESSAGES_UPSERT':
        await handleMessagesUpsert(body, instance)
        break
      case 'CONNECTION_UPDATE':
      case 'status.instance':
        await handleConnectionUpdate(body, instance)
        break
      default:
        break
    }

    return jsonResponse({ received: true, event })
  } catch (err) {
    return jsonResponse({ error: err.message || 'Internal server error' }, 500)
  }
})
