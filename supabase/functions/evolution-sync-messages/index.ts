import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { evolutionFetch, jsonResponse, errorResponse } from '../_shared/evolution-api.ts'
import { createServiceClient, resolveIntegration } from '../_shared/integration.ts'
import { digitsFromJid } from '../_shared/phone.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { user, integration } = await resolveIntegration(req)
    if (!user || !integration) return errorResponse('Unauthorized', 401)
    if (!integration.instance_name) return errorResponse('Integration has no instance_name', 400)

    const instanceName = integration.instance_name
    const body = await req.json().catch(() => ({}))
    const remoteJid: string | undefined = body?.remoteJid

    // Determine which conversations to sync.
    let targetJids: string[] = []
    if (remoteJid) {
      targetJids = [remoteJid]
    } else {
      // Global sync: list all chats (direct ones only).
      const chats = await evolutionFetch(`/chat/findChats/${instanceName}`, {
        method: 'POST',
        body: { where: {}, sort: 'desc', page: 1, offset: 0 },
      })
      if (chats.error) return errorResponse(chats.error, chats.status)

      const raw = Array.isArray(chats.data)
        ? (chats.data as any[])
        : (chats.data?.records ?? chats.data?.data ?? chats.data?.chats ?? [])
      targetJids = (raw as any[])
        .map((c: any) => c.remoteJid || c.jid || c.id)
        .filter(
          (jid: string) =>
            jid &&
            !jid.includes('@g.us') &&
            !jid.includes('@lid') &&
            !jid.includes('status@broadcast'),
        )
        .slice(0, 200)
    }

    const db = createServiceClient()
    let synced = 0
    let conversations = 0

    for (const jid of targetJids) {
      // Ensure the contact exists before attaching messages.
      let { data: contact } = await db
        .from('whatsapp_contacts')
        .select('*')
        .eq('user_id', user.id)
        .eq('remote_jid', jid)
        .maybeSingle()

      if (!contact) {
        const { data: created } = await db
          .from('whatsapp_contacts')
          .insert({
            user_id: user.id,
            remote_jid: jid,
            phone_number: digitsFromJid(jid) || null,
            last_message_at: new Date().toISOString(),
          })
          .select()
          .single()
        contact = created
      }
      if (!contact) continue
      conversations++

      const queryParams = new URLSearchParams({ page: '1', limit: '50' })
      const { data: msgData, error: msgError } = await evolutionFetch(
        `/message/getMessages/${instanceName}?${queryParams.toString()}`,
        {
          method: 'POST',
          body: { where: { key: { remoteJid: jid } } },
        },
      )
      if (msgError) continue // skip failed conversations, keep the rest

      const messages: any[] = Array.isArray(msgData) ? msgData : (msgData?.messages ?? [])
      for (const msg of messages) {
        const messageId = msg?.key?.id
        if (!messageId) continue

        const text = msg?.message?.conversation || msg?.message?.extendedTextMessage?.text || ''
        const { error: upsertError } = await db
          .from('whatsapp_messages')
          .upsert(
            {
              user_id: user.id,
              contact_id: contact.id,
              message_id: messageId,
              from_me: msg?.key?.fromMe ?? false,
              text,
              type: 'text',
              timestamp: msg?.messageTimestamp
                ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
                : new Date().toISOString(),
              raw: msg,
            },
            { onConflict: 'user_id,message_id' },
          )

        if (!upsertError) synced++
      }
    }

    return jsonResponse({ success: true, synced, conversations, total: targetJids.length })
  } catch (err) {
    return errorResponse(err.message || 'Internal server error', 500)
  }
})