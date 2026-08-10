import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { evolutionFetch, jsonResponse, errorResponse } from '../_shared/evolution-api.ts'
import { createServiceClient, resolveIntegration } from '../_shared/integration.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { user, integration } = await resolveIntegration(req)
    if (!user || !integration) return errorResponse('Unauthorized', 401)
    if (!integration.instance_name) return errorResponse('Integration has no instance_name', 400)

    const instanceName = integration.instance_name

    const { data, error, status } = await evolutionFetch(`/instance/logout/${instanceName}`, {
      method: 'DELETE',
    })

    const db = createServiceClient()
    await db
      .from('user_integrations')
      .update({
        status: 'DISCONNECTED',
        is_setup_completed: false,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)

    if (error) {
      return errorResponse(error, status)
    }

    return jsonResponse({ success: true, data })
  } catch (err) {
    return errorResponse(err.message || 'Internal server error', 500)
  }
})