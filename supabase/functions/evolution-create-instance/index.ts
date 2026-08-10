import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/evolution-api.ts'
import { createServiceClient, resolveIntegration, ensureInstanceExists } from '../_shared/integration.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { user, integration } = await resolveIntegration(req)
    if (!user) return errorResponse('Unauthorized', 401)

    // Resolve the instance name exclusively on the server: reuse the existing
    // integration's instance when present, otherwise fall back to the user id.
    // The client can never choose an arbitrary instance name.
    const instanceName = integration?.instance_name || user.id

    // Reuse the instance if it already exists; otherwise create it. Never duplicates.
    const ensured = await ensureInstanceExists(instanceName)
    if (ensured.error) {
      return errorResponse(ensured.error, ensured.status)
    }

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
      updated_at: new Date().toISOString(),
    }

    if (existing) {
      await db.from('user_integrations').update(patch).eq('id', existing.id)
    } else {
      await db.from('user_integrations').insert({ user_id: user.id, ...patch })
    }

    return jsonResponse({ success: true, created: ensured.created, data: ensured.data })
  } catch (err) {
    return errorResponse(err.message || 'Internal server error', 500)
  }
})