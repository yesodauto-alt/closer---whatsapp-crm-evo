import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { evolutionFetch, jsonResponse, errorResponse } from '../_shared/evolution-api.ts'
import { createServiceClient, resolveIntegration } from '../_shared/integration.ts'
import { digitsFromJid } from '../_shared/phone.ts'

function directJid(jid: string) {
  return Boolean(jid) && !jid.includes('@g.us') && !jid.includes('@lid') && !jid.includes('status@broadcast')
}

function extractMessages(data: any): any[] {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.messages)) return data.messages
  if (Array.isArray(data?.records)) return data.records
  if (Array.isArray(data?.data)) return data.data
  return []
}

function getText(msg: any) {
  return (
    msg?.message?.conversation ||
    msg?.message?.extendedTextMessage?.text ||
    msg?.message?.imageMessage?.caption ||
    msg?.message?.videoMessage?.caption ||
    msg?.message?.documentMessage?.caption ||
    ''
  )
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { user, integration, tenantUserId } = await resolveIntegration(req)
    if (!user || !integration || !tenantUserId) return errorResponse('Unauthorized', 401)
    if (!integration.instance_name) return errorResponse('Integration has no instance_name', 400)

    const instanceName = integration.instance_name
    const body = await req.json().catch(() => ({}))
    const remoteJid: string | undefined = body?.remoteJid
    const limit = Math.min(Math.max(Number(body?.limit) || 100, 1), 500)

    let targetJids: string[] = []
    if (remoteJid) {
      targetJids = [remoteJid]
    } else {
      const chats = await evolutionFetch(`/chat/findChats/${encodeURIComponent(instanceName)}`, {
        method: 'POST',
        body: { where: {}, take: 500, skip: 0, orderBy: {} },
      })
      if (chats.error) return errorResponse(chats.error, chats.status)

      const rawChats = Array.isArray(chats.data)
        ? (chats.data as any[])
        : Array.isArray((chats.data as any)?.records)
          ? (chats.data as any).records
          : Array.isArray((chats.data as any)?.chats)
            ? (chats.data as any).chats
            : []

      targetJids = rawChats
        .map((chat: any) => String(chat?.remoteJid || chat?.jid || chat?.id || '').trim())
        .filter(directJid)
        .slice(0, 500)
    }

    const db = createServiceClient()
    let synced = 0
    let conversations = 0
    const errors: Array<{ remoteJid: string; error: string }> = []

    for (const jid of targetJids) {
      let { data: contact } = await db
        .from('whatsapp_contacts')
        .select('*')
        .eq('user_id', tenantUserId)
        .eq('remote_jid', jid)
        .maybeSingle()

      if (!contact) {
        const { data: created, error: createError } = await db
          .from('whatsapp_contacts')
          .insert({
            user_id: tenantUserId,
            remote_jid: jid,
            phone_number: digitsFromJid(jid) || null,
            last_message_at: new Date().toISOString(),
          })
          .select()
          .single()

        if (createError) {
          errors.push({ remoteJid: jid, error: createError.message })
          continue
        }
        contact = created
      }
      if (!contact) continue
      conversations++

      const { data: msgData, error: msgError } = await evolutionFetch(
        `/chat/findMessages/${encodeURIComponent(instanceName)}`,
        {
          method: 'POST',
          body: {
            where: { key: { remoteJid: jid } },
            limit,
            offset: 0,
          },
        },
      )

      if (msgError) {
        errors.push({ remoteJid: jid, error: msgError })
        continue
      }

      const messages = extractMessages(msgData)
      let latestTimestamp: string | null = null

      for (const msg of messages) {
        const messageId = msg?.key?.id
        if (!messageId) continue

        const timestamp = msg?.messageTimestamp
          ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
          : new Date().toISOString()
        if (!latestTimestamp || timestamp > latestTimestamp) latestTimestamp = timestamp

        const { error: upsertError } = await db
          .from('whatsapp_messages')
          .upsert(
            {
              user_id: tenantUserId,
              contact_id: contact.id,
              message_id: messageId,
              from_me: msg?.key?.fromMe ?? false,
              text: getText(msg),
              type: msg?.messageType || 'text',
              timestamp,
              raw: msg,
            },
            { onConflict: 'user_id,message_id' },
          )

        if (upsertError) errors.push({ remoteJid: jid, error: upsertError.message })
        else synced++
      }

      if (latestTimestamp) {
        await db.from('whatsapp_contacts').update({ last_message_at: latestTimestamp }).eq('id', contact.id)
      }
    }

    return jsonResponse({
      success: errors.length === 0,
      synced,
      conversations,
      total: targetJids.length,
      errors: errors.slice(0, 20),
    })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500)
  }
})
