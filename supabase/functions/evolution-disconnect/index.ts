import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { evolutionFetch, jsonResponse, errorResponse } from '../_shared/evolution-api.ts'
import { createServiceClient, resolveIntegration } from '../_shared/integration.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const integrationId = String(body?.integrationId ?? '').trim() || null
    const channelId = String(body?.channelId ?? '').trim() || null

    const { user, integration } = await resolveIntegration(req, { integrationId, channelId })
    if (!user || !integration) return errorResponse('Unauthorized or integration not found', 401)
    if (!integration.instance_name) return errorResponse('Integration has no instance_name', 400)

    const instanceName = integration.instance_name
    const { data, error, status } = await evolutionFetch(
      `/instance/logout/${encodeURIComponent(instanceName)}`,
      { method: 'DELETE' },
    )

    if (error) return errorResponse(error, status)

    const db = createServiceClient()
    const now = new Date().toISOString()
    await db
      .from('user_integrations')
      .update({
        status: 'DISCONNECTED',
        is_setup_completed: false,
        updated_at: now,
      })
      .eq('id', integration.id)

    if (integration.channel_id) {
      await db
        .from('channels')
        .update({ status: 'DISCONNECTED', updated_at: now })
        .eq('id', integration.channel_id)
    }

    return jsonResponse({
      success: true,
      integrationId: integration.id,
      channelId: integration.channel_id,
      data,
    })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500)
  }
})
