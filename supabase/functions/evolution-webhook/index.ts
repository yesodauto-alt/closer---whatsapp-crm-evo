import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { jsonResponse } from '../_shared/evolution-api.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  resolveWhatsAppIdentity,
  type WhatsAppIdentity,
} from '../_shared/phone.ts'
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

function cleanPushName(value: unknown, identity: WhatsAppIdentity): string | null | undefined {
  if (value === undefined) return undefined
  const name = String(value ?? '').trim()
  if (!name) return null

  const lidDigits = identity.lidJid?.split('@')[0] || ''
  if (name === lidDigits || name === identity.phoneNumber || name === '0') return null
  return name
}

async function findContactByIdentity(userId: string, identity: WhatsAppIdentity) {
  if (identity.remoteJid) {
    const { data } = await supabase
      .from('whatsapp_contacts')
      .select('*')
      .eq('user_id', userId)
      .eq('remote_jid', identity.remoteJid)
      .maybeSingle()
    if (data) return data
  }

  if (identity.lidJid) {
    const { data: byLid } = await supabase
      .from('whatsapp_contacts')
      .select('*')
      .eq('user_id', userId)
      .eq('lid_jid', identity.lidJid)
      .maybeSingle()
    if (byLid) return byLid

    // Compatibility with records created before lid_jid existed.
    const { data: legacyLid } = await supabase
      .from('whatsapp_contacts')
      .select('*')
      .eq('user_id', userId)
      .eq('remote_jid', identity.lidJid)
      .maybeSingle()
    if (legacyLid) return legacyLid
  }

  if (identity.phoneNumber) {
    const { data } = await supabase
      .from('whatsapp_contacts')
      .select('*')
      .eq('user_id', userId)
      .eq('phone_number', identity.phoneNumber)
      .maybeSingle()
    if (data) return data
  }

  return null
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
  const primaryJid = String(
    contact?.id || contact?.jid || contact?.remoteJid || contact?.key?.remoteJid || '',
  ).trim()
  const alternateJid = String(
    contact?.remoteJidAlt ||
      contact?.jidAlt ||
      contact?.phoneJid ||
      contact?.key?.remoteJidAlt ||
      '',
  ).trim()

  const identity = resolveWhatsAppIdentity(
    primaryJid,
    alternateJid,
    contact?.number ?? contact?.phoneNumber ?? contact?.phone,
  )

  if (!identity.remoteJid || !isDirectJid(identity.remoteJid)) return null

  const existing = await findContactByIdentity(userId, identity)
  const row: Record<string, unknown> = {
    user_id: userId,
    remote_jid: identity.remoteJid,
    lid_jid: identity.lidJid,
    phone_number: identity.phoneNumber,
  }

  const pushName = cleanPushName(contact?.pushName ?? contact?.name, identity)
  const profilePictureUrl = contact?.profilePictureUrl ?? contact?.profilePicUrl
  if (pushName !== undefined) row.push_name = pushName
  if (profilePictureUrl !== undefined) row.profile_picture_url = profilePictureUrl || null
  if (contact?.lastMessageAt) row.last_message_at = contact.lastMessageAt

  let query
  if (existing) {
    query = supabase.from('whatsapp_contacts').update(row).eq('id', existing.id)
  } else {
    query = supabase.from('whatsapp_contacts').insert(row)
  }

  const { data, error } = await query.select().single()
  if (error) {
    console.error('[evolution-webhook] contact upsert failed', {
      primaryJid,
      alternateJid,
      canonicalJid: identity.remoteJid,
      error: error.message,
    })
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
    const primaryJid = String(msg?.key?.remoteJid || '').trim()
    const alternateJid = String(msg?.key?.remoteJidAlt || '').trim()
    const messageId = msg?.key?.id
    if (!primaryJid || !messageId || !isDirectJid(primaryJid)) continue

    const identity = resolveWhatsAppIdentity(primaryJid, alternateJid)
    let contact = await findContactByIdentity(userId, identity)
    if (!contact) {
      contact = await upsertContact(userId, {
        id: primaryJid,
        remoteJidAlt: alternateJid,
        pushName: msg?.pushName,
      })
    } else {
      // Enrich legacy LID records as soon as an alternate phone JID becomes available.
      const updates: Record<string, unknown> = {}
      if (identity.phoneNumber && !contact.phone_number) updates.phone_number = identity.phoneNumber
      if (identity.lidJid && !contact.lid_jid) updates.lid_jid = identity.lidJid
      if (identity.remoteJid && contact.remote_jid !== identity.remoteJid) {
        const { data: collision } = await supabase
          .from('whatsapp_contacts')
          .select('id')
          .eq('user_id', userId)
          .eq('remote_jid', identity.remoteJid)
          .neq('id', contact.id)
          .maybeSingle()
        if (!collision) updates.remote_jid = identity.remoteJid
      }
      if (Object.keys(updates).length) {
        const { data: updated } = await supabase
          .from('whatsapp_contacts')
          .update(updates)
          .eq('id', contact.id)
          .select()
          .single()
        if (updated) contact = updated
      }
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

    const pushName = cleanPushName(msg?.pushName, identity)
    await supabase
      .from('whatsapp_contacts')
      .update({
        last_message_at: timestamp,
        ...(pushName && !contact.push_name ? { push_name: pushName } : {}),
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
