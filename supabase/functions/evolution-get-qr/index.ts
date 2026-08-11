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
  const base64 = instance?.qrcode?.base64 ?? data?.qrcode?.base64 ?? data?.base64 ?? null
  const connected = state === 'open' || state === 'CONNECTED'
  const creating =
    state === 'creating' ||
    state === 'connecting' ||
    instance?.qrcode?.count === 0 ||
    data?.count === 0
  return { base64, connected, creating }
}

async function connectionState(instanceName: string) {
  return evolutionFetch(`/instance/connectionState/${encodeURIComponent(instanceName)}`, {
    method: 'GET',
  })
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

    // Secondary instances created by this CRM are always created with
    // syncFullHistory:true. A second settings probe is not required to obtain
    // the QR and is incompatible with some Evolution builds, which return 400
    // from /settings even while the instance itself is healthy and connecting.
    let fullHistoryConfigured = ensured.created || instanceName.startsWith('yesod-')
    let fullHistoryWarning: string | null = null

    if (!fullHistoryConfigured) {
      const history = await ensureFullHistoryConfigured(instanceName)
      fullHistoryConfigured = history.configured
      fullHistoryWarning = history.configured ? null : history.error
      if (fullHistoryWarning) {
        console.warn('[evolution-get-qr] Full-history settings probe failed; continuing QR flow', {
          instanceName,
          status: history.status,
          error: fullHistoryWarning,
        })
      }
    }

    const webhook = await ensureWebhookConfigured(instanceName)
    if (!webhook.configured) {
      return errorResponse(webhook.error || 'Evolution webhook could not be configured', webhook.status || 502)
    }

    const db = createServiceClient()
    const now = new Date().toISOString()
    await db
      .from('user_integrations')
      .update({ is_webhook_enabled: true, is_setup_completed: true, updated_at: now })
      .eq('id', integration.id)

    const { data, error, status } = await evolutionFetch(
      `/instance/connect/${encodeURIComponent(instanceName)}`,
      { method: 'GET' },
    )

    if (error) {
      const stateResult = await connectionState(instanceName)
      const state = (stateResult.data as any)?.instance?.state ?? (stateResult.data as any)?.state ?? null
      const normalizedState = String(state ?? '').toLowerCase()

      console.warn('[evolution-get-qr] Evolution connect returned an error', {
        instanceName,
        connectStatus: status,
        connectError: error,
        connectionState: normalizedState || null,
        stateLookupError: stateResult.error,
      })

      if (!stateResult.error && ['connecting', 'creating', 'close'].includes(normalizedState)) {
        await db
          .from('user_integrations')
          .update({ status: 'CONNECTING', updated_at: now })
          .eq('id', integration.id)

        if (integration.channel_id) {
          await db
            .from('channels')
            .update({ status: 'CONNECTING', updated_at: now })
            .eq('id', integration.channel_id)
        }

        return jsonResponse({
          success: true,
          integrationId: integration.id,
          channelId: integration.channel_id,
          connected: false,
          creating: true,
          error: 'qr_not_ready_yet',
          evolutionStatus: status,
          evolutionError: error,
          connectionState: normalizedState || null,
          fullHistoryConfigured,
          fullHistoryWarning,
          webhookConfigured: true,
        })
      }

      return errorResponse(
        `Evolution connect failed (${status}): ${error}${normalizedState ? ` [state=${normalizedState}]` : ''}`,
        status || 502,
      )
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
        fullHistoryConfigured,
        fullHistoryWarning,
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
        fullHistoryConfigured,
        fullHistoryWarning,
        webhookConfigured: true,
      })
    }

    const stateResult = await connectionState(instanceName)
    const state = (stateResult.data as any)?.instance?.state ?? (stateResult.data as any)?.state ?? null

    return jsonResponse({
      success: true,
      integrationId: integration.id,
      channelId: integration.channel_id,
      connected: false,
      creating: true,
      error: 'qr_not_ready_yet',
      connectionState: state ?? null,
      qrCount: (data as any)?.count ?? (data as any)?.qrcode?.count ?? null,
      fullHistoryConfigured,
      fullHistoryWarning,
      webhookConfigured: true,
    })
  } catch (err) {
    console.error('[evolution-get-qr] Unhandled error', err)
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500)
  }
})
