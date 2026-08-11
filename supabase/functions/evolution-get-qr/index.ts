import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { evolutionFetch, jsonResponse, errorResponse } from '../_shared/evolution-api.ts'
import {
  createServiceClient,
  resolveIntegration,
  ensureInstanceExists,
  ensureWebhookConfigured,
} from '../_shared/integration.ts'

function normalizeQR(data: any): { base64: string | null; connected: boolean; creating: boolean } {
  const instance = data?.instance ?? data ?? {}
  const state = instance?.state ?? instance?.connectionStatus ?? data?.state ?? null
  const base64 = instance?.qrcode?.base64 ?? data?.base64 ?? null
  const connected = state === 'open' || state === 'CONNECTED'
  const creating = state === 'creating' || instance?.qrcode?.count === 0
  return { base64, connected, creating }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { user, integration } = await resolveIntegration(req)
    if (!user || !integration) return errorResponse('Unauthorized', 401)
    if (!integration.instance_name) return errorResponse('Integration has no instance_name', 400)

    const instanceName = integration.instance_name
    const ensured = await ensureInstanceExists(instanceName)
    if (ensured.error) {
      return jsonResponse({ success: true, connected: false, creating: true, error: ensured.error })
    }

    // Repairs webhook configuration for existing instances created by older builds.
    const webhook = await ensureWebhookConfigured(instanceName)
    const db = createServiceClient()
    await db
      .from('user_integrations')
      .update({ is_webhook_enabled: webhook.configured, updated_at: new Date().toISOString() })
      .eq('id', integration.id)

    const { data, error, status } = await evolutionFetch(
      `/instance/connect/${encodeURIComponent(instanceName)}`,
      { method: 'GET' },
    )

    if (error) {
      if (ensured.created) {
        return jsonResponse({
          success: true,
          connected: false,
          creating: true,
          error: 'qr_not_ready_yet',
          webhookConfigured: webhook.configured,
          webhookError: webhook.error,
        })
      }
      return errorResponse(error, status)
    }

    const qr = normalizeQR(data)

    if (qr.connected) {
      await db
        .from('user_integrations')
        .update({ status: 'CONNECTED', updated_at: new Date().toISOString() })
        .eq('id', integration.id)

      return jsonResponse({
        success: true,
        connected: true,
        base64: null,
        webhookConfigured: webhook.configured,
        webhookError: webhook.error,
      })
    }

    if (qr.base64) {
      return jsonResponse({
        success: true,
        connected: false,
        creating: false,
        base64: qr.base64,
        webhookConfigured: webhook.configured,
        webhookError: webhook.error,
      })
    }

    return jsonResponse({
      success: true,
      connected: false,
      creating: true,
      error: 'qr_not_ready_yet',
      webhookConfigured: webhook.configured,
      webhookError: webhook.error,
    })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500)
  }
})
