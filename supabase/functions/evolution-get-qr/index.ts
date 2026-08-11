import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { evolutionFetch, jsonResponse, errorResponse } from '../_shared/evolution-api.ts'
import {
  createServiceClient,
  resolveIntegration,
  ensureInstanceExists,
  ensureFullHistoryConfigured,
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
    const body = await req.json().catch(() => ({}))
    const integrationId = String(body?.integrationId ?? '').trim() || null
    const channelId = String(body?.channelId ?? '').trim() || null

    const { user, integration } = await resolveIntegration(req, {
      integrationId,
      channelId,
    })
    if (!user || !integration) return errorResponse('Unauthorized or integration not found', 401)
    if (!integration.instance_name) return errorResponse('Integration has no instance_name', 400)

    const instanceName = integration.instance_name
    const ensured = await ensureInstanceExists(instanceName)
    if (ensured.error) {
      return jsonResponse({ success: true, connected: false, creating: true, error: ensured.error })
    }

    const history = await ensureFullHistoryConfigured(instanceName)
    if (!history.configured) {
      return errorResponse(history.error || 'Full history sync could not be enabled', history.status || 502)
    }

    const webhook = await ensureWebhookConfigured(instanceName)
    if (!webhook.configured) {
      return errorResponse(webhook.error || 'Evolution webhook could not be configured', webhook.status || 502)
    }

    const db = createServiceClient()
    const now = new Date().toISOString()
    await db
      .from('user_integrations')
      .update({ is_webhook_enabled: true, updated_at: now })
      .eq('id', integration.id)

    const { data, error, status } = await evolutionFetch(
      `/instance/connect/${encodeURIComponent(instanceName)}`,
      { method: 'GET' },
    )

    if (error) {
      if (ensured.created) {
        return jsonResponse({
          success: true,
          integrationId: integration.id,
          channelId: integration.channel_id,
          connected: false,
          creating: true,
          error: 'qr_not_ready_yet',
          fullHistoryConfigured: true,
          webhookConfigured: true,
        })
      }
      return errorResponse(error, status)
    }

    const qr = normalizeQR(data)

    if (qr.connected) {
      await db
        .from('user_integrations')
        .update({ status: 'CONNECTED', updated_at: now })
        .eq('id', integration.id)

      if (integration.channel_id) {
        await db
          .from('channels')
          .update({ status: 'CONNECTED', updated_at: now })
          .eq('id', integration.channel_id)
      }

      return jsonResponse({
        success: true,
        integrationId: integration.id,
        channelId: integration.channel_id,
        connected: true,
        base64: null,
        fullHistoryConfigured: true,
        webhookConfigured: true,
      })
    }

    if (qr.base64) {
      await db
        .from('user_integrations')
        .update({ status: 'WAITING_QR', updated_at: now })
        .eq('id', integration.id)

      if (integration.channel_id) {
        await db
          .from('channels')
          .update({ status: 'WAITING_QR', updated_at: now })
          .eq('id', integration.channel_id)
      }

      return jsonResponse({
        success: true,
        integrationId: integration.id,
        channelId: integration.channel_id,
        connected: false,
        creating: false,
        base64: qr.base64,
        fullHistoryConfigured: true,
        webhookConfigured: true,
      })
    }

    return jsonResponse({
      success: true,
      integrationId: integration.id,
      channelId: integration.channel_id,
      connected: false,
      creating: true,
      error: 'qr_not_ready_yet',
      fullHistoryConfigured: true,
      webhookConfigured: true,
    })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500)
  }
})
