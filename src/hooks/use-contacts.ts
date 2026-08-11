import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from './use-auth'
import { useOrganization } from './use-organization'
import { ConversationSort, WhatsAppContact } from '@/lib/types'

type ContactQueryOptions = {
  conversationsOnly?: boolean
  sort?: ConversationSort
}

export const useContacts = (searchQuery: string = '', options: ContactQueryOptions = {}) => {
  const { user } = useAuth()
  const { tenantUserId, loading: organizationLoading } = useOrganization()
  const [contacts, setContacts] = useState<WhatsAppContact[]>([])
  const [loading, setLoading] = useState(true)
  const conversationsOnly = Boolean(options.conversationsOnly)
  const sort = options.sort || 'priority'

  useEffect(() => {
    if (!user || organizationLoading || !tenantUserId) return

    let active = true
    let refreshTimer: number | null = null

    const fetchContacts = async (showLoader = false) => {
      if (showLoader && active) setLoading(true)

      let query = (supabase as any)
        .from('whatsapp_contacts')
        .select('*')
        .eq('user_id', tenantUserId)

      if (conversationsOnly) {
        query = query.eq('has_conversation', true)

        if (sort === 'recent') {
          query = query.order('last_message_at', { ascending: false, nullsFirst: false })
        } else if (sort === 'oldest') {
          query = query.order('last_message_at', { ascending: true, nullsFirst: false })
        } else {
          query = query
            .order('score', { ascending: false, nullsFirst: false })
            .order('last_message_at', { ascending: false, nullsFirst: false })
        }
      } else {
        // Contacts is an address book, not a conversation queue.
        query = query
          .order('push_name', { ascending: true, nullsFirst: false })
          .order('phone_number', { ascending: true, nullsFirst: false })
      }

      if (searchQuery) {
        const safeSearch = searchQuery.replace(/[%_,]/g, '')
        query = query.or(
          `push_name.ilike.%${safeSearch}%,phone_number.ilike.%${safeSearch}%,remote_jid.ilike.%${safeSearch}%`,
        )
      }

      const { data, error } = await query
      if (!active) return

      if (error) {
        console.error('[useContacts] Failed to load tenant contacts:', error)
      } else {
        setContacts((data as WhatsAppContact[]) ?? [])
      }
      if (showLoader) setLoading(false)
    }

    void fetchContacts(true)

    const scheduleRefresh = () => {
      // A full address-book sync can emit hundreds of INSERT/UPDATE events.
      // Collapse that event storm into one quiet refresh instead of flashing
      // the loading state for every row written by the sync function.
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null
        void fetchContacts(false)
      }, 700)
    }

    const channel = supabase
      .channel(`contacts_changes_${tenantUserId}_${conversationsOnly ? 'conversations' : 'addressbook'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'whatsapp_contacts',
          filter: `user_id=eq.${tenantUserId}`,
        },
        scheduleRefresh,
      )
      .subscribe()

    return () => {
      active = false
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      void supabase.removeChannel(channel)
    }
  }, [user, tenantUserId, organizationLoading, searchQuery, conversationsOnly, sort])

  return { contacts, loading }
}
