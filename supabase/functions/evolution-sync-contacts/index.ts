import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { evolutionFetch, jsonResponse, errorResponse } from '../_shared/evolution-api.ts'
import {
  createServiceClient,
  resolveIntegration,
  ensureWebhookConfigured,
} from '../_shared/integration.ts'
import { resolveWhatsAppIdentity, type WhatsAppIdentity } from '../_shared/phone.ts'

function isSupportedDirectJid(jid: string) {
  return /^\d+@(s\.whatsapp\.net|lid)$/.test(String(jid ?? '').trim())
}

function firstWhatsAppJid(contact: any): string {
  const candidates = [contact?.remoteJid, contact?.jid, contact?.phoneJid, contact?.id]
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
  if (name === lidDigits || name === identity.phoneNumber || name === '0' || name === 'Você') return null
  return name
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { user, integration, tenantUserId } = await resolveIntegration(req)
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
          : []

    const db = createServiceClient()
    const { data: existingRows, error: existingError } = await db
      .from('whatsapp_contacts')
      .select('id, remote_jid, lid_jid, phone_number')
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
    let skipped = 0
    let rejectedInternalIds = 0
    const errors: Array<{ remoteJid: string; error: string }> = []

    for (const contact of contacts) {
      const primaryJid = firstWhatsAppJid(contact)
      if (!primaryJid) {
        rejectedInternalIds++
        continue
      }

      const alternateRaw = String(contact?.remoteJidAlt || contact?.jidAlt || '').trim()
      const alternateJid = isSupportedDirectJid(alternateRaw) ? alternateRaw : ''
      const identity = resolveWhatsAppIdentity(
        primaryJid,
        alternateJid,
        contact?.number ?? contact?.phoneNumber ?? contact?.phone,
      )

      if (!identity.remoteJid || !isSupportedDirectJid(identity.remoteJid)) {
        skipped++
        continue
      }

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

      const pushName = cleanPushName(contact?.pushName ?? contact?.name, identity)
      const profilePictureUrl = contact?.profilePictureUrl ?? contact?.profilePicUrl
      if (pushName !== undefined) row.push_name = pushName
      if (profilePictureUrl !== undefined) row.profile_picture_url = profilePictureUrl || null

      const write = existing
        ? db.from('whatsapp_contacts').update(row).eq('id', existing.id)
        : db.from('whatsapp_contacts').insert(row).select('id, remote_jid, lid_jid, phone_number').single()
      const { data: written, error: writeError } = await write

      if (writeError) {
        errors.push({ remoteJid: identity.remoteJid, error: writeError.message })
        continue
      }

      const saved = existing || written
      if (saved) {
        byRemote.set(identity.remoteJid, saved)
        if (identity.lidJid) byLid.set(identity.lidJid, saved)
        if (identity.phoneNumber) byPhone.set(identity.phoneNumber, saved)
      }
      synced++
    }

    // Webhook repair is intentionally performed after contact persistence so a slow
    // Evolution webhook configuration call cannot leave the contact loop half-finished.
    const webhook = await ensureWebhookConfigured(instanceName)
    await db
      .from('user_integrations')
      .update({
        is_webhook_enabled: webhook.configured,
        updated_at: new Date().toISOString(),
      })
      .eq('id', integration.id)

    return jsonResponse({
      success: errors.length === 0,
      synced,
      skipped,
      rejectedInternalIds,
      total: contacts.length,
      webhookConfigured: webhook.configured,
      webhookError: webhook.error,
      errors: errors.slice(0, 20),
    })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500)
  }
})
