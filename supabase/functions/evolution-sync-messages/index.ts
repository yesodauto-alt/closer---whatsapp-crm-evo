import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { evolutionFetch, jsonResponse, errorResponse } from '../_shared/evolution-api.ts'
import { createServiceClient, resolveIntegration } from '../_shared/integration.ts'
import {
  isLidJid,
  isPhoneJid,
  resolveWhatsAppIdentity,
  type WhatsAppIdentity,
} from '../_shared/phone.ts'

function isSupportedDirectJid(jid: string) {
  const value = String(jid ?? '').trim()
  return isPhoneJid(value) || (/^\d{6,20}@lid$/.test(value) && isLidJid(value))
}

function firstWhatsAppJid(chat: any): string {
  const candidates = [
    chat?.remoteJid,
    chat?.jid,
    chat?.lastMessage?.key?.remoteJid,
    chat?.id,
  ]
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim()
    if (isSupportedDirectJid(value)) return value
  }
  return ''
}

function alternateWhatsAppJid(chat: any): string {
  const candidates = [
    chat?.remoteJidAlt,
    chat?.jidAlt,
    chat?.lastMessage?.key?.remoteJidAlt,
  ]
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim()
    if (isSupportedDirectJid(value)) return value
  }
  return ''
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

function extractMessages(data: any): any[] {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.messages?.records)) return data.messages.records
  if (Array.isArray(data?.messages)) return data.messages
  if (Array.isArray(data?.records)) return data.records
  if (Array.isArray(data?.data?.messages?.records)) return data.data.messages.records
  if (Array.isArray(data?.data)) return data.data
  return []
}

function getText(msg: any) {
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

type TargetChat = {
  queryJid: string
  identity: WhatsAppIdentity
  pushName?: string | null
  profilePictureUrl?: string | null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const startedAt = performance.now()
    const body = await req.json().catch(() => ({}))
    const integrationId = String(body?.integrationId ?? '').trim() || null
    const channelId = String(body?.channelId ?? '').trim() || null

    const { user, integration, tenantUserId } = await resolveIntegration(req, {
      integrationId,
      channelId,
    })
    if (!user || !integration || !tenantUserId) return errorResponse('Unauthorized', 401)
    if (!integration.instance_name) return errorResponse('Integration has no instance_name', 400)

    const instanceName = integration.instance_name
    const requestedJid = String(body?.remoteJid ?? '').trim()
    const limit = Math.min(Math.max(Number(body?.limit) || 100, 1), 100)

    const targets: TargetChat[] = []
    let rejectedInternalIds = 0

    if (requestedJid) {
      if (!isSupportedDirectJid(requestedJid)) {
        return errorResponse('remoteJid is not a valid direct WhatsApp JID', 400)
      }
      const requestedAlt = String(body?.remoteJidAlt ?? '').trim()
      targets.push({
        queryJid: requestedJid,
        identity: resolveWhatsAppIdentity(
          requestedJid,
          isSupportedDirectJid(requestedAlt) ? requestedAlt : '',
        ),
      })
    } else {
      const chats = await evolutionFetch(`/chat/findChats/${encodeURIComponent(instanceName)}`, {
        method: 'POST',
        body: { where: {}, take: 500, skip: 0, orderBy: {} },
      })
      if (chats.error) return errorResponse(chats.error, chats.status)

      const rawChats = Array.isArray(chats.data)
        ? (chats.data as any[])
        : Array.isArray((chats.data as any)?.records)
          ? (chats.data as any).records
          : Array.isArray((chats.data as any)?.chats)
            ? (chats.data as any).chats
            : []

      const seen = new Set<string>()
      for (const chat of rawChats) {
        const primaryJid = firstWhatsAppJid(chat)
        if (!primaryJid) {
          rejectedInternalIds++
          continue
        }
        const alternateJid = alternateWhatsAppJid(chat)
        const identity = resolveWhatsAppIdentity(
          primaryJid,
          alternateJid,
          chat?.number ?? chat?.phoneNumber ?? chat?.phone,
        )
        if (!identity.remoteJid || !isSupportedDirectJid(identity.remoteJid)) continue

        const key = identity.phoneNumber || identity.lidJid || identity.remoteJid
        if (seen.has(key)) continue
        seen.add(key)
        targets.push({
          queryJid: primaryJid,
          identity,
          pushName: cleanPushName(chat?.pushName ?? chat?.name, identity),
          profilePictureUrl:
            chat?.profilePictureUrl ?? chat?.profilePicUrl ?? chat?.profilePicture ?? undefined,
        })
      }
    }

    const db = createServiceClient()
    const { data: existingRows, error: existingError } = await db
      .from('whatsapp_contacts')
      .select('*')
      .eq('integration_id', integration.id)
    if (existingError) return errorResponse(existingError.message, 500)

    const byRemote = new Map<string, any>()
    const byLid = new Map<string, any>()
    const byPhone = new Map<string, any>()
    for (const row of existingRows ?? []) {
      if (row.remote_jid) byRemote.set(row.remote_jid, row)
      if (row.lid_jid) byLid.set(row.lid_jid, row)
      if (row.phone_number) byPhone.set(row.phone_number, row)
    }

    let synced = 0
    let conversations = 0
    let createdContacts = 0
    let resolvedPhones = 0
    const errors: Array<{ remoteJid: string; error: string }> = []

    for (const target of targets) {
      let identity = target.identity
      let contact =
        byRemote.get(identity.remoteJid) ||
        (identity.lidJid ? byLid.get(identity.lidJid) || byRemote.get(identity.lidJid) : null) ||
        (identity.phoneNumber ? byPhone.get(identity.phoneNumber) : null)

      const basePatch: Record<string, unknown> = {
        user_id: tenantUserId,
        integration_id: integration.id,
        remote_jid: identity.remoteJid,
        lid_jid: identity.lidJid,
        phone_number: identity.phoneNumber,
      }
      if (target.pushName !== undefined) basePatch.push_name = target.pushName
      if (target.profilePictureUrl !== undefined) {
        basePatch.profile_picture_url = target.profilePictureUrl || null
      }

      if (contact) {
        const { error: updateError } = await db
          .from('whatsapp_contacts')
          .update(basePatch)
          .eq('id', contact.id)
        if (updateError) {
          errors.push({ remoteJid: target.queryJid, error: updateError.message })
          continue
        }
        contact = { ...contact, ...basePatch }
      } else {
        const { data: created, error: createError } = await db
          .from('whatsapp_contacts')
          .insert(basePatch)
          .select()
          .single()
        if (createError) {
          errors.push({ remoteJid: target.queryJid, error: createError.message })
          continue
        }
        contact = created
        createdContacts++
      }
      if (!contact) continue

      byRemote.set(identity.remoteJid, contact)
      if (identity.lidJid) byLid.set(identity.lidJid, contact)
      if (identity.phoneNumber) byPhone.set(identity.phoneNumber, contact)
      conversations++

      const { data: msgData, error: msgError } = await evolutionFetch(
        `/chat/findMessages/${encodeURIComponent(instanceName)}`,
        {
          method: 'POST',
          body: {
            where: { key: { remoteJid: target.queryJid } },
            offset: limit,
            page: 1,
          },
        },
      )
      if (msgError) {
        errors.push({ remoteJid: target.queryJid, error: msgError })
        continue
      }

      const messages = extractMessages(msgData)

      if (!identity.phoneNumber) {
        for (const msg of messages) {
          const messageIdentity = resolveWhatsAppIdentity(
            String(msg?.key?.remoteJid ?? ''),
            String(msg?.key?.remoteJidAlt ?? ''),
          )
          if (!messageIdentity.phoneNumber) continue

          const canonical = byPhone.get(messageIdentity.phoneNumber)
          if (canonical && canonical.id !== contact.id) {
            contact = canonical
          } else {
            const identityPatch = {
              remote_jid: messageIdentity.remoteJid,
              lid_jid: messageIdentity.lidJid || identity.lidJid,
              phone_number: messageIdentity.phoneNumber,
            }
            const { data: updated, error: identityError } = await db
              .from('whatsapp_contacts')
              .update(identityPatch)
              .eq('id', contact.id)
              .select()
              .single()
            if (!identityError && updated) contact = updated
          }

          identity = messageIdentity
          byRemote.set(identity.remoteJid, contact)
          if (identity.lidJid) byLid.set(identity.lidJid, contact)
          if (identity.phoneNumber) byPhone.set(identity.phoneNumber, contact)
          resolvedPhones++
          break
        }
      }

      let latestTimestamp: string | null = null
      const rows = messages.flatMap((msg: any) => {
        const messageId = msg?.key?.id
        if (!messageId) return []
        const timestamp = messageTimestamp(msg)
        if (!latestTimestamp || timestamp > latestTimestamp) latestTimestamp = timestamp
        return [{
          user_id: tenantUserId,
          integration_id: integration.id,
          contact_id: contact.id,
          message_id: messageId,
          from_me: msg?.key?.fromMe ?? false,
          text: getText(msg),
          type: msg?.messageType || 'text',
          timestamp,
          raw: msg,
        }]
      })

      if (rows.length) {
        const { error: upsertError } = await db
          .from('whatsapp_messages')
          .upsert(rows, { onConflict: 'integration_id,message_id' })
        if (upsertError) {
          errors.push({ remoteJid: target.queryJid, error: upsertError.message })
        } else {
          synced += rows.length
        }
      }

      if (latestTimestamp) {
        await db
          .from('whatsapp_contacts')
          .update({ last_message_at: latestTimestamp })
          .eq('id', contact.id)
      }
    }

    const now = new Date().toISOString()
    if (integration.channel_id) {
      await db
        .from('channels')
        .update({ last_sync_at: now, updated_at: now })
        .eq('id', integration.channel_id)
    }

    const totalMs = Math.round(performance.now() - startedAt)
    console.log('[sync-messages] completed', {
      integrationId: integration.id,
      channelId: integration.channel_id,
      conversations,
      synced,
      resolvedPhones,
      errors: errors.length,
      totalMs,
    })

    return jsonResponse({
      success: errors.length === 0,
      source: 'chats',
      integrationId: integration.id,
      channelId: integration.channel_id,
      synced,
      conversations,
      createdContacts,
      resolvedPhones,
      totalChats: targets.length,
      rejectedInternalIds,
      totalMs,
      errors: errors.slice(0, 20),
    })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500)
  }
})
