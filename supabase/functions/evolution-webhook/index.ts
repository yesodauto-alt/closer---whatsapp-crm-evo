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
    const value = data?.[key]
    if (Array.isArray(value)) return value
    if (Array.isArray(value?.records)) return value.records
    if (Array.isArray(value?.data)) return value.data
  }
  if (Array.isArray(data?.records)) return data.records
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

function messageTimestamp(msg: any): string {
  const raw = msg?.messageTimestamp ?? msg?.timestamp
  if (!raw) return new Date().toISOString()
  const numeric = Number(raw)
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(raw)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function cleanPushName(value: unknown, identity: WhatsAppIdentity): string | null | undefined {
  if (value === undefined) return undefined
  const name = String(value ?? '').trim()
  if (!name) return null

  const lidDigits = identity.lidJid?.split('@')[0] || ''
  if (
    name === lidDigits ||
    name === identity.phoneNumber ||
    name === '0' ||
    name.toLowerCase() === 'você'
  ) return null
  return name
}

function identityKeys(identity: WhatsAppIdentity) {
  return [identity.remoteJid, identity.lidJid, identity.phoneNumber]
    .filter(Boolean)
    .map((value) => String(value))
}

function rememberContact(cache: Map<string, any>, contact: any) {
  if (!contact) return
  if (contact.remote_jid) cache.set(String(contact.remote_jid), contact)
  if (contact.lid_jid) cache.set(String(contact.lid_jid), contact)
  if (contact.phone_number) cache.set(String(contact.phone_number), contact)
}

function cachedContact(cache: Map<string, any>, identity: WhatsAppIdentity) {
  for (const key of identityKeys(identity)) {
    const contact = cache.get(key)
    if (contact) return contact
  }
  return null
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
    contact?.id ||
      contact?.jid ||
      contact?.remoteJid ||
      contact?.key?.remoteJid ||
      contact?.lastMessage?.key?.remoteJid ||
      '',
  ).trim()
  const alternateJid = String(
    contact?.remoteJidAlt ||
      contact?.jidAlt ||
      contact?.phoneJid ||
      contact?.key?.remoteJidAlt ||
      contact?.lastMessage?.key?.remoteJidAlt ||
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

  const pushName = cleanPushName(
    contact?.pushName ?? contact?.name ?? contact?.contact?.pushName ?? contact?.contact?.name,
    identity,
  )
  const profilePictureUrl =
    contact?.profilePictureUrl ??
    contact?.profilePicUrl ??
    contact?.profilePicture ??
    contact?.contact?.profilePictureUrl
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

async function handleContactLikeSet(event: any, instance: string, keys: string[]) {
  const userId = await findUserIdByInstance(instance)
  if (!userId) return { processed: 0, reason: 'integration_not_found' }

  const items = extractItems(event?.data, keys)
  let processed = 0

  // Full-history contact/chat sets can be large. Use bounded concurrency instead
  // of serial network round-trips, but keep it low enough to protect Postgres.
  for (let i = 0; i < items.length; i += 10) {
    const results = await Promise.all(
      items.slice(i, i + 10).map((item: any) => upsertContact(userId, item)),
    )
    processed += results.filter(Boolean).length
  }

  return { processed }
}

async function upsertMessageRows(rows: any[]) {
  let processed = 0
  const errors: string[] = []

  for (let i = 0; i < rows.length; i += 250) {
    const chunk = rows.slice(i, i + 250)
    const { error } = await supabase
      .from('whatsapp_messages')
      .upsert(chunk, { onConflict: 'user_id,message_id' })

    if (!error) {
      processed += chunk.length
      continue
    }

    console.error('[evolution-webhook] message batch upsert failed; falling back to rows', {
      size: chunk.length,
      error: error.message,
    })

    // A single malformed historical record must not discard the rest of the batch.
    for (const row of chunk) {
      const { error: rowError } = await supabase
        .from('whatsapp_messages')
        .upsert(row, { onConflict: 'user_id,message_id' })
      if (rowError) errors.push(`${row.message_id}: ${rowError.message}`)
      else processed++
    }
  }

  return { processed, errors }
}

async function handleMessages(event: any, instance: string, triggerAi: boolean) {
  const userId = await findUserIdByInstance(instance)
  if (!userId) return { processed: 0, reason: 'integration_not_found' }

  const messages = extractItems(event?.data, ['messages', 'records'])
  const contactCache = new Map<string, any>()
  const rows: any[] = []
  const latestByContact = new Map<string, { timestamp: string; pushName?: string }>()
  const aiCandidates: Array<{ contact: any; text: string }> = []

  let skipped = 0

  for (const msg of messages) {
    const primaryJid = String(msg?.key?.remoteJid || '').trim()
    const alternateJid = String(msg?.key?.remoteJidAlt || '').trim()
    const messageId = msg?.key?.id
    if (!primaryJid || !messageId || !isDirectJid(primaryJid)) {
      skipped++
      continue
    }

    const identity = resolveWhatsAppIdentity(primaryJid, alternateJid)
    let contact = cachedContact(contactCache, identity)
    if (!contact) {
      contact = await findContactByIdentity(userId, identity)
    }

    if (!contact) {
      contact = await upsertContact(userId, {
        id: primaryJid,
        remoteJidAlt: alternateJid,
        pushName: msg?.pushName,
      })
    } else {
      // Promote a LID-only historical record as soon as Baileys supplies the
      // alternate phone JID. This preserves one CRM contact across both IDs.
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
    if (!contact) {
      skipped++
      continue
    }

    rememberContact(contactCache, contact)

    const fromMe = msg?.key?.fromMe ?? false
    const timestamp = messageTimestamp(msg)
    const text = messageText(msg)

    rows.push({
      user_id: userId,
      contact_id: contact.id,
      message_id: messageId,
      from_me: fromMe,
      text,
      type: msg?.messageType || 'text',
      timestamp,
      raw: msg,
    })

    const pushName = cleanPushName(msg?.pushName, identity)
    const previous = latestByContact.get(contact.id)
    if (!previous || timestamp > previous.timestamp) {
      latestByContact.set(contact.id, {
        timestamp,
        ...(pushName && !contact.push_name ? { pushName } : {}),
      })
    }

    // Historical MESSAGES_SET data must never trigger bots/AI. It represents old
    // traffic being restored into the CRM, not a new inbound customer message.
    if (triggerAi && !fromMe && text) {
      aiCandidates.push({ contact, text })
    }
  }

  const saved = await upsertMessageRows(rows)

  for (const [contactId, latest] of latestByContact) {
    await supabase
      .from('whatsapp_contacts')
      .update({
        last_message_at: latest.timestamp,
        ...(latest.pushName ? { push_name: latest.pushName } : {}),
      })
      .eq('id', contactId)
  }

  if (triggerAi) {
    for (const candidate of aiCandidates) {
      await handleMessageUpsert(supabase, userId, candidate.contact, candidate.text, instance)
    }
  }

  return {
    processed: saved.processed,
    skipped,
    errors: saved.errors.slice(0, 20),
  }
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
        result = await handleMessages(body, instance, false)
        console.log('[evolution-webhook] history messages batch', {
          instance,
          processed: result.processed,
          progress: body?.progress ?? null,
          isLatest: body?.isLatest ?? null,
        })
        break

      case 'MESSAGES_UPSERT':
      case 'SEND_MESSAGE':
        result = await handleMessages(body, instance, true)
        break

      case 'CONTACTS_SET':
      case 'CONTACTS_UPSERT':
      case 'CONTACTS_UPDATE':
        result = await handleContactLikeSet(body, instance, ['contacts', 'records'])
        break

      case 'CHATS_SET':
      case 'CHATS_UPSERT':
      case 'CHATS_UPDATE':
        result = await handleContactLikeSet(body, instance, ['chats', 'records'])
        break

      case 'CONNECTION_UPDATE':
      case 'STATUS_INSTANCE':
        result = await handleConnectionUpdate(body, instance)
        break

      default:
        result = { processed: 0, ignored: true }
        break
    }

    return jsonResponse({
      received: true,
      event,
      instance,
      ...(event === 'MESSAGES_SET'
        ? { progress: body?.progress ?? null, isLatest: body?.isLatest ?? null }
        : {}),
      ...result,
    })
  } catch (err) {
    console.error('[evolution-webhook] unhandled error', err)
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      500,
    )
  }
})
