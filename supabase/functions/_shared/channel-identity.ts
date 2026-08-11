import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { evolutionFetch } from './evolution-api.ts'
import { normalizeBrazilianPhone } from './phone.ts'

function phoneFromCandidate(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw || raw.endsWith('@lid') || raw.includes('@g.us')) return ''
  const local = raw.includes('@') ? raw.split('@')[0] : raw
  return normalizeBrazilianPhone(local)
}

function instanceNameOf(row: any) {
  return String(
    row?.instanceName ??
      row?.name ??
      row?.instance?.instanceName ??
      row?.instance?.name ??
      '',
  ).trim()
}

function identityFromObject(data: any) {
  const candidates = [
    data?.ownerJid,
    data?.owner,
    data?.number,
    data?.phoneNumber,
    data?.phone,
    data?.sender,
    data?.instance?.ownerJid,
    data?.instance?.owner,
    data?.instance?.number,
    data?.instance?.phoneNumber,
    data?.instance?.phone,
    data?.instance?.sender,
  ]

  const phoneNumber = candidates.map(phoneFromCandidate).find(Boolean) || null
  const profileName = String(
    data?.profileName ?? data?.name ?? data?.instance?.profileName ?? '',
  ).trim() || null
  const profilePictureUrl = String(
    data?.profilePicUrl ??
      data?.profilePictureUrl ??
      data?.instance?.profilePicUrl ??
      data?.instance?.profilePictureUrl ??
      '',
  ).trim() || null

  return { phoneNumber, profileName, profilePictureUrl }
}

export async function resolveConnectedChannelIdentity(instanceName: string, eventData?: any) {
  const direct = identityFromObject(eventData)
  if (direct.phoneNumber) return direct

  const result = await evolutionFetch('/instance/fetchInstances', { method: 'GET' })
  if (result.error) {
    return {
      ...direct,
      error: result.error,
      status: result.status,
    }
  }

  const rows: any[] = Array.isArray(result.data)
    ? result.data
    : Array.isArray((result.data as any)?.instances)
      ? (result.data as any).instances
      : []

  const match = rows.find((row) => instanceNameOf(row) === instanceName)
  const resolved = identityFromObject(match)
  return {
    phoneNumber: resolved.phoneNumber || direct.phoneNumber,
    profileName: resolved.profileName || direct.profileName,
    profilePictureUrl: resolved.profilePictureUrl || direct.profilePictureUrl,
    error: null,
    status: result.status,
  }
}

export async function refreshChannelIdentity(
  db: SupabaseClient,
  channelId: string | null | undefined,
  instanceName: string,
  eventData?: any,
) {
  if (!channelId) return { phoneNumber: null, updated: false, reason: 'channel_missing' }

  const identity = await resolveConnectedChannelIdentity(instanceName, eventData)
  if (!identity.phoneNumber) {
    return {
      ...identity,
      updated: false,
      reason: 'phone_not_available',
    }
  }

  const { data: channel } = await db
    .from('channels')
    .select('metadata')
    .eq('id', channelId)
    .maybeSingle()

  const metadata = {
    ...(channel?.metadata && typeof channel.metadata === 'object' ? channel.metadata : {}),
    ...(identity.profileName ? { whatsappProfileName: identity.profileName } : {}),
    ...(identity.profilePictureUrl ? { whatsappProfilePictureUrl: identity.profilePictureUrl } : {}),
  }

  const { error } = await db
    .from('channels')
    .update({
      phone_number: identity.phoneNumber,
      metadata,
      updated_at: new Date().toISOString(),
    })
    .eq('id', channelId)

  return {
    ...identity,
    updated: !error,
    error: error?.message ?? identity.error ?? null,
  }
}
