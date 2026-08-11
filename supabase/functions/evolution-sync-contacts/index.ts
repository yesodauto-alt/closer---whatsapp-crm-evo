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
  ) {
    return null
  }
  return name
}

function chatTimestamp(chat: any): string | null {
  const raw =
    chat?.updatedAt ||
    chat?.lastMessage?.messageTimestamp ||
    chat?.lastMessage?.timestamp ||
    null
  if (!raw) return null
  const numeric = Number(raw)
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { user, integration, tenantUserId } = await resolveIntegration(req)
    if (!user || !integration || !tenantUserId) return errorResponse('Unauthorized', 401)
    if (!integration.instance_name) return errorResponse('Integration has no instance_name', 400)

    const instanceName = integration.instance_name
    const { data, error, status } = await evolutionFetch(
      `/chat/findChats/${encodeURIComponent(instanceName)}`,
      {
        method: 'POST',
        body: { where: {}, take: 500, skip: 0, orderBy: {} },
      },
    )
    if (error) return errorResponse(error, status)

    const chats: any[] = Array.isArray(data)
      ? data
      : Array.isArray((data as any)?.chats)
        ? (data as any).chats
        : Array.isArray((data as any)?.records)
          ? (data as any).records
          : []

    const db = createServiceClient()
    const { data: existingRows, error: existingError } = await db
      .from('whatsapp_contacts')
      .select('id, remote_jid, lid_jid, phone_number, push_name')
      .eq('user_id', tenantUserId)
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
    let created = 0
    let updated = 0
    let skipped = 0
    let rejectedInternalIds = 0
    const errors: Array<{ remoteJid: string; error: string }> = []
    const seen = new Set<string>()

    for (const chat of chats) {
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
      if (!identity.remoteJid || !isSupportedDirectJid(identity.remoteJid)) {
        skipped++
        continue
      }

      const identityKey = identity.phoneNumber || identity.lidJid || identity.remoteJid
      if (seen.has(identityKey)) continue
      seen.add(identityKey)

      const existing =
        byRemote.get(identity.remoteJid) ||
        (identity.lidJid ? byLid.get(identity.lidJid) || byRemote.get(identity.lidJid) : null) ||
        (identity.phoneNumber ? byPhone.get(identity.phoneNumber) : null)

      const row: Record<string, unknown> = {
        user_id: tenantUserId,
        remote_jid: identity.remoteJid,
        lid_jid: identity.lidJid,
        phone_number: identity.phoneNumber,
      }
      const pushName = cleanPushName(chat?.pushName ?? chat?.name, identity)
      const profilePictureUrl =
        chat?.profilePictureUrl ?? chat?.profilePicUrl ?? chat?.profilePicture
      const lastMessageAt = chatTimestamp(chat)
      if (pushName !== undefined) row.push_name = pushName
      if (profilePictureUrl !== undefined) row.profile_picture_url = profilePictureUrl || null
      if (lastMessageAt) row.last_message_at = lastMessageAt

      if (existing) {
        const { error: writeError } = await db
          .from('whatsapp_contacts')
          .update(row)
          .eq('id', existing.id)
        if (writeError) {
          errors.push({ remoteJid: identity.remoteJid, error: writeError.message })
          continue
        }
        updated++
      } else {
        const { data: written, error: writeError } = await db
          .from('whatsapp_contacts')
          .insert(row)
          .select('id, remote_jid, lid_jid, phone_number, push_name')
          .single()
        if (writeError) {
          errors.push({ remoteJid: identity.remoteJid, error: writeError.message })
          continue
        }
        if (written) {
          byRemote.set(identity.remoteJid, written)
          if (identity.lidJid) byLid.set(identity.lidJid, written)
          if (identity.phoneNumber) byPhone.set(identity.phoneNumber, written)
        }
        created++
      }
      synced++
    }

    return jsonResponse({
      success: errors.length === 0,
      source: 'chats',
      totalChats: chats.length,
      synced,
      created,
      updated,
      skipped,
      rejectedInternalIds,
      errors: errors.slice(0, 20),
    })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500)
  }
})
