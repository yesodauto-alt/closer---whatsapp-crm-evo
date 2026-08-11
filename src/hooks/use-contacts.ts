import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from './use-auth'
import { useOrganization } from './use-organization'
import { WhatsAppContact } from '@/lib/types'

export const useContacts = (searchQuery: string = '') => {
  const { user } = useAuth()
  const { tenantUserId, loading: organizationLoading } = useOrganization()
  const [contacts, setContacts] = useState<WhatsAppContact[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user || organizationLoading || !tenantUserId) return

    const fetchContacts = async () => {
      setLoading(true)
      let query = supabase
        .from('whatsapp_contacts')
        .select('*')
        .eq('user_id', tenantUserId)
        .order('score', { ascending: false, nullsFirst: false })
        .order('last_message_at', { ascending: false, nullsFirst: false })

      if (searchQuery) {
        query = query.or(
          `push_name.ilike.%${searchQuery}%,phone_number.ilike.%${searchQuery}%,remote_jid.ilike.%${searchQuery}%`,
        )
      }

      const { data, error } = await query
      if (error) console.error('[useContacts] Failed to load tenant contacts:', error)
      setContacts((data as WhatsAppContact[]) ?? [])
      setLoading(false)
    }

    fetchContacts()

    const channel = supabase
      .channel(`contacts_changes_${tenantUserId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'whatsapp_contacts',
          filter: `user_id=eq.${tenantUserId}`,
        },
        () => {
          fetchContacts()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, tenantUserId, organizationLoading, searchQuery])

  return { contacts, loading }
}
