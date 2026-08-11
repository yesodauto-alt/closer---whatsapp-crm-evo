import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/evolution-api.ts'
import {
  createServiceClient,
  resolveIntegration,
  ensureInstanceExists,
  ensureWebhookConfigured,
} from '../_shared/integration.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { user, integration } = await resolveIntegration(req)
    if (!user) return errorResponse('Unauthorized', 401)

    const instanceName = integration?.instance_name || user.id

    const ensured = await ensureInstanceExists(instanceName)
    if (ensured.error) return errorResponse(ensured.error, ensured.status)

    const webhook = await ensureWebhookConfigured(instanceName)
    const db = createServiceClient()
    const { data: existing } = await db
      .from('user_integrations')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    const patch = {
      instance_name: instanceName,
      status: 'CONNECTING',
      is_setup_completed: true,
      is_webhook_enabled: webhook.configured,
      updated_at: new Date().toISOString(),
    }

    if (existing) {
      await db.from('user_integrations').update(patch).eq('id', existing.id)
    } else {
      await db.from('user_integrations').insert({ user_id: user.id, ...patch })
    }

    return jsonResponse({
      success: true,
      created: ensured.created,
      data: ensured.data,
      webhookConfigured: webhook.configured,
      webhookError: webhook.error,
    })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500)
  }
})
