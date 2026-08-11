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

  const client = createClient(url, anonKey, {
    global: { headers: { authorization: req.headers.get('Authorization') ?? '' } },
  })
  const {
    data: { user },
    error,
  } = await client.auth.getUser()
  if (error || !user) return null
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

export async function getIntegrationByUserId(userId: string) {
  const db = createServiceClient()
  const { data, error } = await db
    .from('user_integrations')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function resolveIntegration(req: Request) {
  const user = await getAuthUser(req)
  if (!user) {
    return { user: null, integration: null, tenantUserId: null, organizationId: null }
  }

  const { tenantUserId, organizationId } = await resolveTenant(user.id)
  const integration = await getIntegrationByUserId(tenantUserId)
  return { user, integration, tenantUserId, organizationId }
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
    body: { instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' },
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
