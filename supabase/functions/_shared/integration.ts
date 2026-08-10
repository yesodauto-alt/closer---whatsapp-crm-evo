import { createClient } from 'npm:@supabase/supabase-js@2'
import { evolutionFetch } from './evolution-api.ts'

export function createServiceClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  return createClient(url, key)
}

// Resolve the caller's Supabase user from the JWT in the Authorization header.
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

// Resolve the authenticated user and their integration in one call.
export async function resolveIntegration(req: Request) {
  const user = await getAuthUser(req)
  if (!user) return { user: null, integration: null }
  const integration = await getIntegrationByUserId(user.id)
  return { user, integration }
}

// Ensure the Evolution instance exists on the server, reusing it when present and
// creating it otherwise. Never creates a duplicate.
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
    : Array.isArray(list.data?.instances)
      ? (list.data.instances as any[])
      : []
  const exists = instances.some((i: any) => (i?.instanceName ?? i?.name) === instanceName)

  if (exists) {
    return { created: false, data: { exists: true }, status: 200, error: null }
  }

  const create = await evolutionFetch('/instance/create', {
    method: 'POST',
    body: { instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' },
  })
  return { created: true, data: create.data, status: create.status, error: create.error }
}