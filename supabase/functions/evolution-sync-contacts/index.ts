import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { evolutionFetch, jsonResponse, errorResponse } from '../_shared/evolution-api.ts'
import { createServiceClient, resolveIntegration, ensureWebhookConfigured } from '../_shared/integration.ts'
import { normalizeBrazilianPhone, digitsFromJid } from '../_shared/phone.ts'

function isDirectJid(jid: string) {
  return Boolean(jid) && !jid.includes('@g.us') && !jid.includes('status@broadcast')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { user, integration } = await resolveIntegration(req)
    if (!user || !integration) return errorResponse('Unauthorized', 401)
    if (!integration.instance_name) return errorResponse('Integration has no instance_name', 400)

    const instanceName = integration.instance_name

    // Keep the instance webhook aligned even for integrations created by older builds.
    const webhook = await ensureWebhookConfigured(instanceName)

    const { data, error, status } = await evolutionFetch(`/chat/findContacts/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      body: {
        where: {},
        take: 5000,
        skip: 0,
        orderBy: {},
      },
    })

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
      const remoteJid = String(contact?.id || contact?.jid || contact?.remoteJid || '').trim()
      if (!remoteJid || !isDirectJid(remoteJid)) {
        skipped++
        continue
      }

      const rawNumber = String(contact?.number || '')
      const canonicalPhone = normalizeBrazilianPhone(rawNumber) || digitsFromJid(remoteJid)

      const row: Record<string, unknown> = {
        user_id: user.id,
        remote_jid: remoteJid,
        phone_number: canonicalPhone || null,
      }

      const pushName = contact?.pushName ?? contact?.name
      const profilePictureUrl = contact?.profilePictureUrl ?? contact?.profilePicUrl
      if (pushName !== undefined) row.push_name = pushName || null
      if (profilePictureUrl !== undefined) row.profile_picture_url = profilePictureUrl || null

      const { error: upsertError } = await db
        .from('whatsapp_contacts')
        .upsert(row, { onConflict: 'user_id,remote_jid' })

      if (upsertError) {
        errors.push({ remoteJid, error: upsertError.message })
      } else {
        synced++
      }
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
