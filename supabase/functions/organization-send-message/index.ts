import { createClient } from '@supabase/supabase-js'
import { resolveEvolutionNumber } from '../_shared/phone.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, x-supabase-client-platform, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('Authorization') || ''
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || ''

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !token) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const userDb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const {
    data: { user },
    error: userError,
  } = await userDb.auth.getUser(token)
  if (userError || !user) return json({ error: 'Unauthorized' }, 401)

  const body = await request.json().catch(() => ({}))
  const contactId = String(body.contactId || '')
  const text = String(body.text || '').trim()
  if (!contactId || !text) return json({ error: 'contactId e text são obrigatórios' }, 400)

  // RLS validates that the authenticated user may access this contact.
  const { data: allowedContact, error: accessError } = await userDb
    .from('whatsapp_contacts')
    .select('id')
    .eq('id', contactId)
    .single()
  if (accessError || !allowedContact) return json({ error: 'Contato não autorizado' }, 403)

  const adminDb = createClient(supabaseUrl, serviceRoleKey)
  const { data: contact, error: contactError } = await adminDb
    .from('whatsapp_contacts')
    .select('id, user_id, remote_jid, phone_number')
    .eq('id', contactId)
    .single()
  if (contactError || !contact) return json({ error: 'Contato não encontrado' }, 404)

  const { data: integration, error: integrationError } = await adminDb
    .from('user_integrations')
    .select('evolution_api_url, evolution_api_key, instance_name')
    .eq('user_id', contact.user_id)
    .single()
  if (integrationError || !integration) return json({ error: 'Integração não encontrada' }, 404)

  const evolutionUrl = (
    integration.evolution_api_url ||
    Deno.env.get('EVOLUTION_API_URL') ||
    ''
  ).replace(/\/$/, '')
  const evolutionKey = integration.evolution_api_key || Deno.env.get('EVOLUTION_API_KEY')
  const number = resolveEvolutionNumber(contact.remote_jid, contact.phone_number)

  if (!evolutionUrl || !evolutionKey || !integration.instance_name) {
    return json({ error: 'Evolution não configurada' }, 503)
  }
  if (!number) return json({ error: 'Contato sem número válido para envio' }, 400)

  const response = await fetch(
    `${evolutionUrl}/message/sendText/${encodeURIComponent(integration.instance_name)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: evolutionKey },
      body: JSON.stringify({
        number,
        textMessage: { text },
      }),
    },
  )

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
    return json({ error: evolutionError, evolutionStatus: response.status }, 502)
  }

  const messageId = payload?.key?.id || payload?.message?.key?.id || payload?.id || crypto.randomUUID()
  const timestamp = new Date().toISOString()
  const { error: messageError } = await adminDb.from('whatsapp_messages').upsert(
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
  )
  if (messageError) return json({ error: messageError.message }, 500)

  await adminDb
    .from('whatsapp_contacts')
    .update({ last_message_at: timestamp })
    .eq('id', contact.id)

  return json({ success: true, messageId })
})
