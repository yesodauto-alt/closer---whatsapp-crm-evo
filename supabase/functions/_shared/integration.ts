import { createClient } from 'npm:@supabase/supabase-js@2'
import { evolutionFetch } from './evolution-api.ts'

export const EVOLUTION_WEBHOOK_EVENTS = [
  'QRCODE_UPDATED',
  'CONNECTION_UPDATE',
  'MESSAGES_SET',
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'MESSAGES_DELETE',
  'SEND_MESSAGE',
  'CONTACTS_SET',
  'CONTACTS_UPSERT',
  'CONTACTS_UPDATE',
  'CHATS_SET',
  'CHATS_UPSERT',
  'CHATS_UPDATE',
] as const

export function createServiceClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  return createClient(url, key)
}

export async function getAuthUser(req: Request) {
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anonKey) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set')

  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization') ?? ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  const token = match?.[1]?.trim() ?? ''

  if (!token || token.startsWith('sb_')) {
    console.error('[auth] Missing user access token in Authorization header')
    return null
  }

  const client = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  const {
    data: { user },
    error,
  } = await client.auth.getUser(token)

  if (error || !user) {
    console.error('[auth] Failed to resolve user from access token', {
      error: error?.message ?? 'No user returned',
    })
    return null
  }

  return user
}

export async function resolveTenant(userId: string) {
  const db = createServiceClient()
  const { data: membership, error: membershipError } = await db
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (membershipError) throw new Error(membershipError.message)
  if (!membership?.organization_id) {
    return { organizationId: null, tenantUserId: userId }
  }

  const { data: organization, error: organizationError } = await db
    .from('organizations')
    .select('owner_user_id')
    .eq('id', membership.organization_id)
    .maybeSingle()

  if (organizationError) throw new Error(organizationError.message)

  return {
    organizationId: membership.organization_id as string,
    tenantUserId: (organization?.owner_user_id as string | undefined) ?? userId,
  }
}

type IntegrationSelector = {
  integrationId?: string | null
  channelId?: string | null
}

export async function getIntegrationForTenant(userId: string, selector: IntegrationSelector = {}) {
  const db = createServiceClient()
  let query = db.from('user_integrations').select('*').eq('user_id', userId)

  if (selector.integrationId) {
    query = query.eq('id', selector.integrationId)
  } else if (selector.channelId) {
    query = query.eq('channel_id', selector.channelId)
  } else {
    query = query
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })
  }

  const { data, error } = await query.limit(1).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function getIntegrationByUserId(userId: string) {
  return getIntegrationForTenant(userId)
}

export async function getChannelForOrganization(organizationId: string, channelId: string) {
  const db = createServiceClient()
  const { data, error } = await db
    .from('channels')
    .select('*')
    .eq('id', channelId)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function resolveIntegration(req: Request, selector: IntegrationSelector = {}) {
  const user = await getAuthUser(req)
  if (!user) {
    return { user: null, integration: null, tenantUserId: null, organizationId: null }
  }

  const { tenantUserId, organizationId } = await resolveTenant(user.id)
  const integration = await getIntegrationForTenant(tenantUserId, selector)
  return { user, integration, tenantUserId, organizationId }
}

export function buildChannelInstanceName(channelId: string) {
  return `yesod-${channelId}`
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function ensureFullHistoryConfigured(instanceName: string) {
  const encoded = encodeURIComponent(instanceName)
  let current: Awaited<ReturnType<typeof evolutionFetch>> | null = null

  // A freshly-created Baileys instance can exist in fetchInstances before its
  // settings row is readable. Treat 400/404 during this short window as
  // eventual consistency, not as a fatal QR failure.
  for (let attempt = 0; attempt < 5; attempt++) {
    current = await evolutionFetch(`/settings/find/${encoded}`, { method: 'GET' })
    if (!current.error) break
    if (![400, 404].includes(current.status)) break
    await sleep(700 + attempt * 300)
  }

  if (!current || current.error) {
    return {
      configured: false,
      changed: false,
      status: current?.status ?? 502,
      error: `Failed to read Evolution settings: ${current?.error ?? 'unknown error'}`,
    }
  }

  const currentSettings = (current.data as any)?.settings ?? current.data ?? {}
  if ((currentSettings as any)?.syncFullHistory === true) {
    return { configured: true, changed: false, status: 200, error: null }
  }

  // Some Evolution releases validate the full settings DTO and reject a
  // partial body such as { syncFullHistory: true } with HTTP 400. Preserve the
  // instance's current settings and only flip the history flag.
  const updateBody = {
    rejectCall: Boolean((currentSettings as any)?.rejectCall),
    msgCall: String((currentSettings as any)?.msgCall ?? ''),
    groupsIgnore: Boolean((currentSettings as any)?.groupsIgnore),
    alwaysOnline: Boolean((currentSettings as any)?.alwaysOnline),
    readMessages: Boolean((currentSettings as any)?.readMessages),
    readStatus: Boolean((currentSettings as any)?.readStatus),
    syncFullHistory: true,
    wavoipToken: String((currentSettings as any)?.wavoipToken ?? ''),
  }

  const update = await evolutionFetch(`/settings/set/${encoded}`, {
    method: 'POST',
    body: updateBody,
  })

  if (update.error) {
    return {
      configured: false,
      changed: false,
      status: update.status,
      error: `Failed to enable full history sync: ${update.error}`,
    }
  }

  // Verify persistence so the user never scans a QR with history sync silently
  // disabled.
  const verified = await evolutionFetch(`/settings/find/${encoded}`, { method: 'GET' })
  const verifiedSettings = (verified.data as any)?.settings ?? verified.data ?? {}
  const configured = !verified.error && (verifiedSettings as any)?.syncFullHistory === true

  return {
    configured,
    changed: configured,
    status: configured ? 200 : verified.status,
    error: configured
      ? null
      : `Evolution did not persist syncFullHistory=true${verified.error ? `: ${verified.error}` : ''}`,
  }
}

export async function ensureInstanceExists(
  instanceName: string,
): Promise<{ created: boolean; data: unknown; status: number; error: string | null }> {
  const list = await evolutionFetch('/instance/fetchInstances', { method: 'GET' })
  if (list.error) {
    return {
      created: false,
      data: null,
      status: list.status,
      error: `Failed to list instances: ${list.error}`,
    }
  }

  const instances = Array.isArray(list.data)
    ? (list.data as any[])
    : Array.isArray((list.data as any)?.instances)
      ? ((list.data as any).instances as any[])
      : []
  const exists = instances.some((i: any) => (i?.instanceName ?? i?.name) === instanceName)

  if (exists) return { created: false, data: { exists: true }, status: 200, error: null }

  const create = await evolutionFetch('/instance/create', {
    method: 'POST',
    body: {
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      syncFullHistory: true,
    },
  })
  return { created: true, data: create.data, status: create.status, error: create.error }
}

export async function ensureWebhookConfigured(instanceName: string) {
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').trim().replace(/\/+$/, '')
  if (!supabaseUrl) {
    return { configured: false, status: 500, error: 'SUPABASE_URL is not configured' }
  }

  const webhookSecret = (
    Deno.env.get('EVOLUTION_WEBHOOK_SECRET') ??
    Deno.env.get('EVOLUTION_API_KEY') ??
    ''
  ).trim()

  const result = await evolutionFetch(`/webhook/set/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: {
      enabled: true,
      url: `${supabaseUrl}/functions/v1/evolution-webhook`,
      events: [...EVOLUTION_WEBHOOK_EVENTS],
      headers: webhookSecret ? { 'x-webhook-secret': webhookSecret } : {},
      base64: false,
    },
  })

  return {
    configured: !result.error,
    status: result.status,
    error: result.error,
  }
}
