import { corsHeaders } from '../_shared/cors.ts'

export interface EvolutionApiConfig {
  baseUrl: string
  apiKey: string
}

const CANONICAL_EVOLUTION_URL = 'https://evolution.yesodautomation.com.br'

export function getEvolutionConfig(): EvolutionApiConfig {
  const baseUrl = CANONICAL_EVOLUTION_URL
  const apiKey = (Deno.env.get('EVOLUTION_API_KEY') ?? '').trim()

  if (!apiKey) {
    throw new Error(
      'EVOLUTION_API_KEY environment variable is not set or is empty. Please configure the Evolution API key in your edge function secrets.',
    )
  }

  return { baseUrl, apiKey }
}

export async function evolutionFetch<T = any>(
  path: string,
  options: {
    method?: string
    body?: unknown
    headers?: Record<string, string>
  } = {},
): Promise<{ data: T | null; error: string | null; status: number }> {
  const config = getEvolutionConfig()
  const url = `${config.baseUrl}${path}`

  let response: Response
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.apiKey,
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(20000),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown connection error'
    return {
      data: null,
      error: `Failed to connect to Evolution API at ${url}: ${message}`,
      status: 502,
    }
  }

  const contentType = response.headers.get('content-type') || ''
  const text = await response.text()

  if (!contentType.includes('application/json')) {
    const preview = text.substring(0, 300).replace(/\n/g, ' ')
    return {
      data: null,
      error: `Evolution API returned a non-JSON response (status ${response.status}, content-type: "${contentType}") from URL: ${url}. Response preview: ${preview}`,
      status: response.status >= 400 ? response.status : 502,
    }
  }

  let data: T
  try {
    data = JSON.parse(text)
  } catch {
    const preview = text.substring(0, 300)
    return {
      data: null,
      error: `Failed to parse JSON from Evolution API response (status ${response.status}) from URL: ${url}. Response preview: ${preview}`,
      status: response.status,
    }
  }

  if (!response.ok) {
    const errorMsg =
      typeof data === 'string'
        ? data
        : ((data as any)?.message ??
          (data as any)?.error ??
          (data as any)?.response?.message ??
          `Evolution API error: ${response.status}`)
    return { data: null, error: errorMsg, status: response.status }
  }

  return { data, error: null, status: response.status }
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      Connection: 'keep-alive',
      ...corsHeaders,
    },
  })
}

export function errorResponse(error: string, status = 500): Response {
  return jsonResponse({ error }, status)
}

export function createSupabaseClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require('npm:@supabase/supabase-js@2')
  return createClient(url, key)
}
