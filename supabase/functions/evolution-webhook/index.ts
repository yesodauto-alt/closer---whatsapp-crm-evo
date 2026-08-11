import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { jsonResponse } from '../_shared/evolution-api.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { digitsFromJid, normalizeBrazilianPhone } from '../_shared/phone.ts'
import { handleMessageUpsert } from './ai-handler.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

function normalizeEventName(value: unknown) {
  return String(value ?? '')
    .trim()
    .replace(/[.\-\s]+/g, '_')
    .toUpperCase()
}

function extractItems(data: any, keys: string[]) {
  if (Array.isArray(data)) return data
  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key]
  }
  if (data && typeof data === 'object') return [data]
  return []
}

function isDirectJid(jid: string) {
  return Boolean(jid) && !jid.includes('@g.us') && !jid.includes('status@broadcast')
}

function messageText(msg: any) {
  return (
    msg?.message?.conversation ||
    msg?.message?.extendedTextMessage?.text ||
    msg?.message?.imageMessage?.caption ||
    msg?.message?.videoMessage?.caption ||
    msg?.message?.documentMessage?.caption ||
    ''
  )
}

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

async function upsertContact(userId: string, contact: any) {
  const remoteJid = String(
    contact?.id || contact?.jid || contact?.remoteJid || contact?.key?.remoteJid || '',
  ).trim()
  if (!remoteJid || !isDirectJid(remoteJid)) return null

  const rawNumber = String(contact?.number || '')
  const phoneNumber = normalizeBrazilianPhone(rawNumber) || digitsFromJid(remoteJid) || null
  const row: Record<string, unknown> = {
    user_id: userId,
    remote_jid: remoteJid,
    phone_number: phoneNumber,
  }

  const pushName = contact?.pushName ?? contact?.name
  const profilePictureUrl = contact?.profilePictureUrl ?? contact?.profilePicUrl
  if (pushName !== undefined) row.push_name = pushName || null
  if (profilePictureUrl !== undefined) row.profile_picture_url = profilePictureUrl || null
  if (contact?.lastMessageAt) row.last_message_at = contact.lastMessageAt

  const { data, error } = await supabase
    .from('whatsapp_contacts')
    .upsert(row, { onConflict: 'user_id,remote_jid' })
    .select()
    .single()

  if (error) {
    console.error('[evolution-webhook] contact upsert failed', { remoteJid, error: error.message })
    return null
  }
  return data
}

async function handleContacts(event: any, instance: string) {
  const userId = await findUserIdByInstance(instance)
  if (!userId) return { processed: 0, reason: 'integration_not_found' }

  const contacts = extractItems(event?.data, ['contacts', 'records'])
  let processed = 0
  for (const contact of contacts) {
    const saved = await upsertContact(userId, contact)
    if (saved) processed++
  }
  return { processed }
}

async function handleMessagesUpsert(event: any, instance: string) {
  const userId = await findUserIdByInstance(instance)
  if (!userId) return { processed: 0, reason: 'integration_not_found' }

  const messages = extractItems(event?.data, ['messages', 'records'])
  let processed = 0

  for (const msg of messages) {
    const remoteJid = String(msg?.key?.remoteJid || '').trim()
    const messageId = msg?.key?.id
    if (!remoteJid || !messageId || !isDirectJid(remoteJid)) continue

    let contact = await findContactByJid(userId, remoteJid)
    if (!contact) {
      contact = await upsertContact(userId, {
        id: remoteJid,
        pushName: msg?.pushName,
        number: digitsFromJid(remoteJid),
      })
    }
    if (!contact) continue

    const fromMe = msg?.key?.fromMe ?? false
    const timestamp = msg?.messageTimestamp
      ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
      : new Date().toISOString()

    const { error } = await supabase.from('whatsapp_messages').upsert(
      {
        user_id: userId,
        contact_id: contact.id,
        message_id: messageId,
        from_me: fromMe,
        text: messageText(msg),
        type: msg?.messageType || 'text',
        timestamp,
        raw: msg,
      },
      { onConflict: 'user_id,message_id' },
    )

    if (error) {
      console.error('[evolution-webhook] message upsert failed', {
        messageId,
        error: error.message,
      })
      continue
    }

    await supabase
      .from('whatsapp_contacts')
      .update({
        last_message_at: timestamp,
        ...(msg?.pushName && !contact.push_name ? { push_name: msg.pushName } : {}),
      })
      .eq('id', contact.id)

    processed++

    const text = messageText(msg)
    if (!fromMe && text) {
      await handleMessageUpsert(supabase, userId, contact, text, instance)
    }
  }

  return { processed }
}

async function handleConnectionUpdate(event: any, instance: string) {
  const userId = await findUserIdByInstance(instance)
  if (!userId) return { processed: 0, reason: 'integration_not_found' }

  const state = event?.data?.state ?? event?.data?.status ?? event?.data?.instance?.state
  let status = 'CONNECTING'
  if (state === 'open' || state === 'CONNECTED') status = 'CONNECTED'
  else if (state === 'close' || state === 'closed' || state === 'DISCONNECTED') status = 'DISCONNECTED'

  await supabase
    .from('user_integrations')
    .update({ status, is_webhook_enabled: true, updated_at: new Date().toISOString() })
    .eq('instance_name', instance)

  return { processed: 1, status }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const configuredSecret = (
      Deno.env.get('EVOLUTION_WEBHOOK_SECRET') ??
      Deno.env.get('EVOLUTION_API_KEY') ??
      ''
    ).trim()
    const providedSecret = (req.headers.get('x-webhook-secret') ?? '').trim()

    // Old instances may not yet send the custom header. Reject wrong explicit secrets,
    // but keep accepting missing headers until ensureWebhookConfigured repairs them.
    if (configuredSecret && providedSecret && providedSecret !== configuredSecret) {
      return jsonResponse({ error: 'Invalid webhook secret' }, 401)
    }

    const body = await req.json()
    const event = normalizeEventName(body?.event ?? body?.type)
    const instance = String(body?.instance ?? body?.instanceName ?? '').trim()

    if (!event || !instance) {
      return jsonResponse({ received: true, processed: 0, message: 'Missing event or instance' })
    }

    let result: Record<string, unknown> = { processed: 0 }

    switch (event) {
      case 'MESSAGES_SET':
      case 'MESSAGES_UPSERT':
      case 'SEND_MESSAGE':
        result = await handleMessagesUpsert(body, instance)
        break

      case 'CONTACTS_SET':
      case 'CONTACTS_UPSERT':
      case 'CONTACTS_UPDATE':
        result = await handleContacts(body, instance)
        break

      case 'CONNECTION_UPDATE':
      case 'STATUS_INSTANCE':
        result = await handleConnectionUpdate(body, instance)
        break

      default:
        result = { processed: 0, ignored: true }
        break
    }

    return jsonResponse({ received: true, event, instance, ...result })
  } catch (err) {
    console.error('[evolution-webhook] unhandled error', err)
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      500,
    )
  }
})
