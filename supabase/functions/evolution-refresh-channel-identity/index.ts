import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/evolution-api.ts'
import { createServiceClient, resolveIntegration } from '../_shared/integration.ts'
import { refreshChannelIdentity } from '../_shared/channel-identity.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const integrationId = String(body?.integrationId ?? '').trim() || null
    const channelId = String(body?.channelId ?? '').trim() || null

    const { user, integration } = await resolveIntegration(req, { integrationId, channelId })
    if (!user || !integration) return errorResponse('Unauthorized or integration not found', 401)
    if (!integration.instance_name) return errorResponse('Integration has no instance_name', 400)

    const db = createServiceClient()
    const identity = await refreshChannelIdentity(
      db,
      integration.channel_id,
      integration.instance_name,
    )

    return jsonResponse({
      success: Boolean(identity.phoneNumber),
      integrationId: integration.id,
      channelId: integration.channel_id,
      phoneNumber: identity.phoneNumber ?? null,
      updated: identity.updated ?? false,
      reason: identity.reason ?? null,
      error: identity.error ?? null,
    })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500)
  }
})
