import { createClient } from '@supabase/supabase-js'
import { resolveEvolutionNumber } from '../_shared/phone.ts'

const CANONICAL_EVOLUTION_URL = 'https://evolution.yesodautomation.com.br'

function corsHeaders(request?: Request) {
  const requestedHeaders = request?.headers.get('Access-Control-Request-Headers')
  return {
    'Access-Control-Allow-Origin': request?.headers.get('Origin') || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers':
      requestedHeaders ||
      'authorization, x-client-info, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin, Access-Control-Request-Headers',
  }
}

const json = (request: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
  })

const elapsed = (start: number) => Math.round(performance.now() - start)

Deno.serve(async (request) => {
  const startedAt = performance.now()
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) })
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('Authorization') || ''
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || ''

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !token) {
    return json(request, { error: 'Unauthorized' }, 401)
  }

  const userDb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const adminDb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const authStart = performance.now()
  const {
    data: { user },
    error: userError,
  } = await userDb.auth.getUser(token)
  const authMs = elapsed(authStart)
  if (userError || !user) return json(request, { error: 'Unauthorized' }, 401)

  const body = await request.json().catch(() => ({}))
  const contactId = String(body.contactId || '')
  const text = String(body.text || '').trim()
  if (!contactId || !text) return json(request, { error: 'contactId e text são obrigatórios' }, 400)

  // This RLS-scoped read both authorizes the current user and returns the contact data,
  // avoiding a second round-trip for the same record.
  const contactStart = performance.now()
  const { data: contact, error: contactError } = await userDb
    .from('whatsapp_contacts')
    .select('id, user_id, remote_jid, phone_number')
    .eq('id', contactId)
    .single()
  const contactMs = elapsed(contactStart)
  if (contactError || !contact) return json(request, { error: 'Contato não autorizado' }, 403)

  const integrationStart = performance.now()
  const { data: integration, error: integrationError } = await adminDb
    .from('user_integrations')
    .select('evolution_api_url, evolution_api_key, instance_name')
    .eq('user_id', contact.user_id)
    .single()
  const integrationMs = elapsed(integrationStart)
  if (integrationError || !integration) return json(request, { error: 'Integração não encontrada' }, 404)

  const evolutionUrl = (integration.evolution_api_url || CANONICAL_EVOLUTION_URL).replace(/\/$/, '')
  const evolutionKey = integration.evolution_api_key || Deno.env.get('EVOLUTION_API_KEY')
  const number = resolveEvolutionNumber(contact.remote_jid, contact.phone_number)

  if (!evolutionKey || !integration.instance_name) {
    return json(request, { error: 'Evolution não configurada' }, 503)
  }
  if (!number) return json(request, { error: 'Contato sem número válido para envio' }, 400)

  let response: Response
  const evolutionStart = performance.now()
  try {
    response = await fetch(
      `${evolutionUrl}/message/sendText/${encodeURIComponent(integration.instance_name)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: evolutionKey },
        body: JSON.stringify({ number, text }),
        signal: AbortSignal.timeout(20000),
      },
    )
  } catch (error) {
    const evolutionMs = elapsed(evolutionStart)
    const message = error instanceof Error ? error.message : 'Falha de conexão com Evolution API'
    console.error('[send-message] Evolution connection failed', {
      authMs,
      contactMs,
      integrationMs,
      evolutionMs,
      totalMs: elapsed(startedAt),
    })
    return json(request, { error: `Evolution indisponível: ${message}` }, 502)
  }
  const evolutionMs = elapsed(evolutionStart)

  const responseText = await response.text()
  let payload: any = {}
  try {
    payload = responseText ? JSON.parse(responseText) : {}
  } catch {
    payload = { raw: responseText }
  }

  if (!response.ok) {
    const evolutionError =
      payload?.message || payload?.error || payload?.response?.message || `Evolution HTTP ${response.status}`
    console.error('[send-message] Evolution rejected message', {
      status: response.status,
      authMs,
      contactMs,
      integrationMs,
      evolutionMs,
      totalMs: elapsed(startedAt),
    })
    return json(request, { error: evolutionError, evolutionStatus: response.status }, 502)
  }

  const messageId = payload?.key?.id || payload?.message?.key?.id || payload?.id || crypto.randomUUID()
  const timestamp = new Date().toISOString()
  const persistStart = performance.now()

  const [messageResult, contactResult] = await Promise.all([
    adminDb.from('whatsapp_messages').upsert(
      {
        user_id: contact.user_id,
        contact_id: contact.id,
        message_id: messageId,
        from_me: true,
        text,
        type: 'conversation',
        timestamp,
        raw: payload,
      },
      { onConflict: 'user_id,message_id' },
    ),
    adminDb.from('whatsapp_contacts').update({ last_message_at: timestamp }).eq('id', contact.id),
  ])
  const persistMs = elapsed(persistStart)

  if (messageResult.error) return json(request, { error: messageResult.error.message }, 500)
  if (contactResult.error) {
    console.warn('[send-message] Message sent but contact timestamp update failed', {
      error: contactResult.error.message,
    })
  }

  const totalMs = elapsed(startedAt)
  console.log('[send-message] timing', {
    authMs,
    contactMs,
    integrationMs,
    evolutionMs,
    persistMs,
    totalMs,
  })

  return json(request, {
    success: true,
    messageId,
    timing: { authMs, contactMs, integrationMs, evolutionMs, persistMs, totalMs },
  })
})
