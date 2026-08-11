import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { jsonResponse, errorResponse } from '../_shared/evolution-api.ts'
import { createServiceClient, getAuthUser, resolveTenant } from '../_shared/integration.ts'
import { triageContact } from '../_shared/triage.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const user = await getAuthUser(req)
    if (!user) return errorResponse('Unauthorized', 401)

    const body = await req.json().catch(() => ({}))
    const contactId = String(body?.contactId ?? '').trim()
    if (!contactId) return errorResponse('contactId is required', 400)

    const { tenantUserId } = await resolveTenant(user.id)
    const db = createServiceClient()
    const { data: contact } = await db
      .from('whatsapp_contacts')
      .select('id, user_id')
      .eq('id', contactId)
      .maybeSingle()

    if (!contact || contact.user_id !== tenantUserId) {
      return errorResponse('Contact not found or not authorized', 404)
    }

    const result = await triageContact(db, contactId, { force: true })
    return jsonResponse(result)
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500)
  }
})
