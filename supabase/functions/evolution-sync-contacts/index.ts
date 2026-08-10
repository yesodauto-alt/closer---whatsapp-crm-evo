import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { evolutionFetch, jsonResponse, errorResponse } from '../_shared/evolution-api.ts'
import { createServiceClient, resolveIntegration } from '../_shared/integration.ts'
import { normalizeBrazilianPhone, digitsFromJid } from '../_shared/phone.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { user, integration } = await resolveIntegration(req)
    if (!user || !integration) return errorResponse('Unauthorized', 401)
    if (!integration.instance_name) return errorResponse('Integration has no instance_name', 400)

    const instanceName = integration.instance_name

    const { data, error, status } = await evolutionFetch(`/chat/whatsappNumbers/${instanceName}`, {
      method: 'GET',
    })

    if (error) {
      return errorResponse(error, status)
    }

    const contacts: any[] = Array.isArray(data) ? data : (data?.contacts ?? [])
    const db = createServiceClient()
    let synced = 0

    for (const contact of contacts) {
      const remoteJid = contact.jid || contact.id || ''
      if (!remoteJid) continue

      // Derive canonical phone_number from the raw number or the JID.
      const rawNumber = contact.number || ''
      const canonicalPhone = normalizeBrazilianPhone(rawNumber) || digitsFromJid(remoteJid)

      const { error: upsertError } = await db
        .from('whatsapp_contacts')
        .upsert(
          {
            user_id: user.id,
            remote_jid: remoteJid,
            push_name: contact.pushName || contact.name || null,
            profile_picture_url: contact.profilePictureUrl || null,
            phone_number: canonicalPhone || null,
          },
          { onConflict: 'user_id,remote_jid' },
        )

      if (!upsertError) synced++
    }

    return jsonResponse({ success: true, synced, total: contacts.length })
  } catch (err) {
    return errorResponse(err.message || 'Internal server error', 500)
  }
})