import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { evolutionFetch, jsonResponse, errorResponse } from '../_shared/evolution-api.ts'
import { createServiceClient, resolveIntegration, ensureWebhookConfigured } from '../_shared/integration.ts'
import { resolveWhatsAppIdentity, type WhatsAppIdentity } from '../_shared/phone.ts'

function isDirectJid(jid: string) {
  return Boolean(jid) && !jid.includes('@g.us') && !jid.includes('status@broadcast')
}

function cleanPushName(value: unknown, identity: WhatsAppIdentity): string | null | undefined {
  if (value === undefined) return undefined
  const name = String(value ?? '').trim()
  if (!name) return null
  const lidDigits = identity.lidJid?.split('@')[0] || ''
  if (name === lidDigits || name === identity.phoneNumber || name === '0') return null
  return name
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { user, integration, tenantUserId } = await resolveIntegration(req)
    if (!user || !integration || !tenantUserId) return errorResponse('Unauthorized', 401)
    if (!integration.instance_name) return errorResponse('Integration has no instance_name', 400)

    const instanceName = integration.instance_name
    const webhook = await ensureWebhookConfigured(instanceName)

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
    let synced = 0
    let skipped = 0
    const errors: Array<{ remoteJid: string; error: string }> = []

    for (const contact of contacts) {
      const primaryJid = String(contact?.id || contact?.jid || contact?.remoteJid || '').trim()
      const alternateJid = String(
        contact?.remoteJidAlt || contact?.jidAlt || contact?.phoneJid || '',
      ).trim()
      const identity = resolveWhatsAppIdentity(
        primaryJid,
        alternateJid,
        contact?.number ?? contact?.phoneNumber ?? contact?.phone,
      )

      if (!identity.remoteJid || !isDirectJid(identity.remoteJid)) {
        skipped++
        continue
      }

      let existing: any = null
      const { data: byCanonical } = await db
        .from('whatsapp_contacts')
        .select('id')
        .eq('user_id', tenantUserId)
        .eq('remote_jid', identity.remoteJid)
        .maybeSingle()
      existing = byCanonical

      if (!existing && identity.lidJid) {
        const { data: byLid } = await db
          .from('whatsapp_contacts')
          .select('id')
          .eq('user_id', tenantUserId)
          .or(`lid_jid.eq.${identity.lidJid},remote_jid.eq.${identity.lidJid}`)
          .limit(1)
          .maybeSingle()
        existing = byLid
      }

      if (!existing && identity.phoneNumber) {
        const { data: byPhone } = await db
          .from('whatsapp_contacts')
          .select('id')
          .eq('user_id', tenantUserId)
          .eq('phone_number', identity.phoneNumber)
          .maybeSingle()
        existing = byPhone
      }

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
        : db.from('whatsapp_contacts').insert(row)
      const { error: writeError } = await write

      if (writeError) errors.push({ remoteJid: identity.remoteJid, error: writeError.message })
      else synced++
    }

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
      total: contacts.length,
      webhookConfigured: webhook.configured,
      webhookError: webhook.error,
      errors: errors.slice(0, 20),
    })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500)
  }
})
