import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from './use-auth'
import { useOrganization } from './use-organization'
import { WhatsAppMessage } from '@/lib/types'

export const useMessages = (contactId: string | undefined) => {
  const { user } = useAuth()
  const { tenantUserId, loading: organizationLoading } = useOrganization()
  const [messages, setMessages] = useState<WhatsAppMessage[]>([])
  const [loading, setLoading] = useState(true)

  const fetchMessages = useCallback(async () => {
    if (!user || organizationLoading || !tenantUserId || !contactId) return

    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .eq('user_id', tenantUserId)
      .eq('contact_id', contactId)
      .order('timestamp', { ascending: false })
      .limit(100)

    if (error) console.error('[useMessages] Error fetching tenant messages:', error)
    setMessages((data as WhatsAppMessage[]) ?? [])
    setLoading(false)
  }, [user, tenantUserId, organizationLoading, contactId])

  useEffect(() => {
    if (!user || organizationLoading || !tenantUserId || !contactId) return

    setLoading(true)
    fetchMessages()

    const channel = supabase
      .channel(`messages_${tenantUserId}_${contactId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'whatsapp_messages',
          filter: `contact_id=eq.${contactId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setMessages((prev) => {
              const newMsg = payload.new as WhatsAppMessage
              if (newMsg.user_id !== tenantUserId) return prev
              if (prev.some((m) => m.id === newMsg.id || m.message_id === newMsg.message_id)) {
                return prev
              }
              return [newMsg, ...prev].sort(
                (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
              )
            })
          } else if (payload.eventType === 'UPDATE') {
            const updatedMsg = payload.new as WhatsAppMessage
            if (updatedMsg.user_id !== tenantUserId) return
            setMessages((prev) =>
              prev.map((m) => (m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m)),
            )
          } else if (payload.eventType === 'DELETE') {
            setMessages((prev) => prev.filter((m) => m.id !== payload.old.id))
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, tenantUserId, organizationLoading, contactId, fetchMessages])

  return { messages, loading }
}
