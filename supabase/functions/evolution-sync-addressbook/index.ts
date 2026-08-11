import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { evolutionFetch, jsonResponse, errorResponse } from '../_shared/evolution-api.ts'
import { createServiceClient, resolveIntegration } from '../_shared/integration.ts'
import { refreshChannelIdentity } from '../_shared/channel-identity.ts'
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

function firstValidJid(contact: any) {
  const candidates = [
    contact?.remoteJid,
    contact?.jid,
    contact?.phoneJid,
    contact?.key?.remoteJid,
    contact?.id,
  ]
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim()
    if (isSupportedDirectJid(value)) return value
  }
  return ''
}

function alternateJid(contact: any) {
  const candidates = [
    contact?.remoteJidAlt,
    contact?.jidAlt,
    contact?.key?.remoteJidAlt,
  ]
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim()
    if (isSupportedDirectJid(value)) return value
  }
  return ''
}

function cleanName(value: unknown, identity: WhatsAppIdentity) {
  const name = String(value ?? '').trim()
  if (!name) return null
  const lidDigits = identity.lidJid?.split('@')[0] ?? ''
  if (
    name === lidDigits ||
    name === identity.phoneNumber ||
    name === '0' ||
    name.toLowerCase() === 'você'
  ) return null
  return name
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
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
    const { data, error, status } = await evolutionFetch(
      `/chat/findContacts/${encodeURIComponent(instanceName)}`,
      {
        method: 'POST',
        body: { where: {}, take: 5000, skip: 0, orderBy: {} },
      },
    )
    if (error) return errorResponse(error, status)

    const contacts: any[] = Array.isArray(data)
      ? data
      : Array.isArray((data as any)?.contacts)
        ? (data as any).contacts
        : Array.isArray((data as any)?.records)
          ? (data as any).records
          : Array.isArray((data as any)?.data)
            ? (data as any).data
            : []

    const db = createServiceClient()
    const { data: existingRows, error: existingError } = await db
      .from('whatsapp_contacts')
      .select('id, remote_jid, lid_jid, phone_number, push_name, has_conversation')
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
    let created = 0
    let updated = 0
    let rejectedInternalIds = 0
    const errors: Array<{ identity: string; error: string }> = []
    const seen = new Set<string>()

    for (const raw of contacts) {
      const primaryJid = firstValidJid(raw)
      if (!primaryJid) {
        rejectedInternalIds++
        continue
      }

      const identity = resolveWhatsAppIdentity(
        primaryJid,
        alternateJid(raw),
        raw?.number ?? raw?.phoneNumber ?? raw?.phone,
      )
      if (!identity.remoteJid || !isSupportedDirectJid(identity.remoteJid)) continue

      const identityKey = identity.phoneNumber || identity.lidJid || identity.remoteJid
      if (seen.has(identityKey)) continue
      seen.add(identityKey)

      const existing =
        byRemote.get(identity.remoteJid) ||
        (identity.lidJid ? byLid.get(identity.lidJid) || byRemote.get(identity.lidJid) : null) ||
        (identity.phoneNumber ? byPhone.get(identity.phoneNumber) : null)

      const pushName = cleanName(
        raw?.pushName ?? raw?.name ?? raw?.notify ?? raw?.verifiedName,
        identity,
      )
      const profilePictureUrl = raw?.profilePictureUrl ?? raw?.profilePicUrl ?? raw?.profilePicture
      const patch: Record<string, unknown> = {
        user_id: tenantUserId,
        integration_id: integration.id,
        remote_jid: identity.remoteJid,
        lid_jid: identity.lidJid,
        phone_number: identity.phoneNumber,
        is_address_book: true,
      }
      if (pushName) patch.push_name = pushName
      if (profilePictureUrl !== undefined) patch.profile_picture_url = profilePictureUrl || null

      if (existing) {
        const { data: written, error: writeError } = await db
          .from('whatsapp_contacts')
          .update(patch)
          .eq('id', existing.id)
          .select('id, remote_jid, lid_jid, phone_number, push_name, has_conversation')
          .single()
        if (writeError) {
          errors.push({ identity: identityKey, error: writeError.message })
          continue
        }
        if (written) {
          if (written.remote_jid) byRemote.set(written.remote_jid, written)
          if (written.lid_jid) byLid.set(written.lid_jid, written)
          if (written.phone_number) byPhone.set(written.phone_number, written)
        }
        updated++
      } else {
        const { data: written, error: writeError } = await db
          .from('whatsapp_contacts')
          .insert({ ...patch, has_conversation: false })
          .select('id, remote_jid, lid_jid, phone_number, push_name, has_conversation')
          .single()
        if (writeError) {
          errors.push({ identity: identityKey, error: writeError.message })
          continue
        }
        if (written) {
          if (written.remote_jid) byRemote.set(written.remote_jid, written)
          if (written.lid_jid) byLid.set(written.lid_jid, written)
          if (written.phone_number) byPhone.set(written.phone_number, written)
        }
        created++
      }
      synced++
    }

    const identity = await refreshChannelIdentity(
      db,
      integration.channel_id,
      instanceName,
    )

    return jsonResponse({
      success: errors.length === 0,
      source: 'addressbook',
      integrationId: integration.id,
      channelId: integration.channel_id,
      total: contacts.length,
      synced,
      created,
      updated,
      rejectedInternalIds,
      channelPhoneNumber: identity.phoneNumber ?? null,
      errors: errors.slice(0, 20),
    })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500)
  }
})
