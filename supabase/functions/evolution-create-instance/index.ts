import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/evolution-api.ts'
import {
  createServiceClient,
  resolveIntegration,
  ensureInstanceExists,
  ensureFullHistoryConfigured,
  ensureWebhookConfigured,
} from '../_shared/integration.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { user, integration, tenantUserId } = await resolveIntegration(req)
    if (!user || !tenantUserId) return errorResponse('Unauthorized', 401)

    const instanceName = integration?.instance_name || tenantUserId
    const ensured = await ensureInstanceExists(instanceName)
    if (ensured.error) return errorResponse(ensured.error, ensured.status)

    // Do not let a tenant scan the QR unless Evolution is explicitly configured
    // to request WhatsApp's historical chats, contacts and messages.
    const history = await ensureFullHistoryConfigured(instanceName)
    if (!history.configured) {
      return errorResponse(history.error || 'Full history sync could not be enabled', history.status || 502)
    }

    const webhook = await ensureWebhookConfigured(instanceName)
    if (!webhook.configured) {
      return errorResponse(webhook.error || 'Evolution webhook could not be configured', webhook.status || 502)
    }

    const db = createServiceClient()
    const { data: existing } = await db
      .from('user_integrations')
      .select('id')
      .eq('user_id', tenantUserId)
      .maybeSingle()

    const patch = {
      instance_name: instanceName,
      status: 'CONNECTING',
      is_setup_completed: true,
      is_webhook_enabled: true,
      updated_at: new Date().toISOString(),
    }

    if (existing) {
      await db.from('user_integrations').update(patch).eq('id', existing.id)
    } else {
      await db.from('user_integrations').insert({ user_id: tenantUserId, ...patch })
    }

    return jsonResponse({
      success: true,
      created: ensured.created,
      data: ensured.data,
      fullHistoryConfigured: history.configured,
      fullHistoryChanged: history.changed,
      webhookConfigured: true,
    })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500)
  }
})
