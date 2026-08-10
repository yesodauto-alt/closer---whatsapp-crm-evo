import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { evolutionFetch, jsonResponse, errorResponse } from '../_shared/evolution-api.ts'
import {
  createServiceClient,
  resolveIntegration,
  ensureInstanceExists,
} from '../_shared/integration.ts'

// Normalize the Evolution connection response into the shape the frontend already consumes:
// { base64, connected, creating, error }.
function normalizeQR(data: any): { base64: string | null; connected: boolean; creating: boolean } {
  const instance = data?.instance ?? data ?? {}
  const state = instance?.state ?? instance?.connectionStatus ?? data?.state ?? null
  const base64 = instance?.qrcode?.base64 ?? data?.base64 ?? null
  const connected = state === 'open' || state === 'CONNECTED'
  const creating = state === 'creating' || instance?.qrcode?.count === 0
  return { base64, connected, creating }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { user, integration } = await resolveIntegration(req)
    if (!user || !integration) return errorResponse('Unauthorized', 401)
    if (!integration.instance_name) return errorResponse('Integration has no instance_name', 400)

    const instanceName = integration.instance_name

    // 1. Ensure the instance actually exists on the Evolution server before asking for a QR.
    const ensured = await ensureInstanceExists(instanceName)
    if (ensured.error) {
      return jsonResponse({
        success: true,
        connected: false,
        creating: true,
        error: ensured.error,
      })
    }

    // 2. Request connection state / QR. If not connected, Evolution returns the QR base64.
    const { data, error, status } = await evolutionFetch(`/instance/connect/${instanceName}`, {
      method: 'GET',
    })
    if (error) {
      // Right after creation the instance may still be initializing.
      if (ensured.created) {
        return jsonResponse({
          success: true,
          connected: false,
          creating: true,
          error: 'qr_not_ready_yet',
        })
      }
      return errorResponse(error, status)
    }

    const qr = normalizeQR(data)

    if (qr.connected) {
      const db = createServiceClient()
      await db
        .from('user_integrations')
        .update({ status: 'CONNECTED', updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
      return jsonResponse({ success: true, connected: true, base64: null })
    }

    if (qr.base64) {
      return jsonResponse({ success: true, connected: false, creating: false, base64: qr.base64 })
    }

    return jsonResponse({
      success: true,
      connected: false,
      creating: true,
      error: 'qr_not_ready_yet',
    })
  } catch (err) {
    return errorResponse(err.message || 'Internal server error', 500)
  }
})