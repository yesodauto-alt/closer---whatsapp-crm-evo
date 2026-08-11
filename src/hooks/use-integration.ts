import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from './use-auth'
import { useOrganization } from './use-organization'
import { UserIntegration } from '@/lib/types'

interface IntegrationContextType {
  integration: UserIntegration | null
  loading: boolean
  setIntegration: React.Dispatch<React.SetStateAction<UserIntegration | null>>
}

const IntegrationContext = createContext<IntegrationContextType | undefined>(undefined)

export const useIntegration = () => {
  const context = useContext(IntegrationContext)
  if (!context) throw new Error('useIntegration must be used within an IntegrationProvider')
  return context
}

export const IntegrationProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth()
  const {
    tenantUserId,
    organizationId,
    loading: organizationLoading,
  } = useOrganization()
  const [integration, setIntegration] = useState<UserIntegration | null>(null)
  const [loading, setLoading] = useState(true)
  const contactSyncAttemptedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!user) {
      setIntegration(null)
      setLoading(false)
      contactSyncAttemptedRef.current = null
      return
    }

    if (organizationLoading || !tenantUserId) {
      setLoading(true)
      return
    }

    const fetchIntegration = async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('user_integrations')
        .select('*')
        .eq('user_id', tenantUserId)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (error) {
        console.error('[useIntegration] Failed to load primary tenant integration:', error)
        setIntegration(null)
        setLoading(false)
        return
      }

      if (!data && organizationId) {
        const { data: channel, error: channelError } = await supabase
          .from('channels')
          .insert({
            organization_id: organizationId,
            name: 'WhatsApp principal',
            type: 'whatsapp',
            provider: 'evolution',
            status: 'DISCONNECTED',
            is_active: true,
            created_by: user.id,
          } as any)
          .select()
          .single()

        if (channelError || !channel) {
          console.error('[useIntegration] Failed to create primary channel:', channelError)
          setIntegration(null)
          setLoading(false)
          return
        }

        const newIntegration = {
          user_id: tenantUserId,
          channel_id: channel.id,
          provider: 'evolution',
          instance_name: tenantUserId,
          status: 'DISCONNECTED',
          is_primary: true,
          is_setup_completed: false,
          is_webhook_enabled: false,
        }

        const { data: inserted, error: insertError } = await supabase
          .from('user_integrations')
          .insert(newIntegration as any)
          .select()
          .single()

        if (insertError) {
          console.error('[useIntegration] Failed to create primary tenant integration:', insertError)
          setIntegration(null)
        } else if (inserted) {
          setIntegration(inserted as UserIntegration)
        }
      } else if (data && !data.instance_name) {
        const { data: updated, error: updateError } = await supabase
          .from('user_integrations')
          .update({ instance_name: tenantUserId } as any)
          .eq('id', data.id)
          .select()
          .single()

        if (updateError) {
          console.error('[useIntegration] Failed to repair primary instance name:', updateError)
          setIntegration(data as UserIntegration)
        } else if (updated) {
          setIntegration(updated as UserIntegration)
        }
      } else {
        setIntegration((data as UserIntegration) ?? null)
      }

      setLoading(false)
    }

    fetchIntegration()

    const channel = supabase
      .channel(`integration_changes_${tenantUserId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_integrations',
          filter: `user_id=eq.${tenantUserId}`,
        },
        () => {
          // Multiple channels can now change independently. Always reselect the
          // tenant's primary integration instead of merging an arbitrary row.
          fetchIntegration()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, tenantUserId, organizationId, organizationLoading])

  useEffect(() => {
    if (!integration?.id || integration.status !== 'CONNECTED') return
    if (contactSyncAttemptedRef.current === integration.id) return

    contactSyncAttemptedRef.current = integration.id

    void supabase.functions.invoke('evolution-sync-contacts', {
      body: { integrationId: integration.id },
    }).then(({ data, error }) => {
      if (error || data?.error) {
        console.error(
          '[useIntegration] Automatic Evolution contact sync failed:',
          error?.message || data?.error,
        )
        return
      }

      console.info('[useIntegration] Evolution contacts synchronized:', {
        synced: data?.synced ?? 0,
        total: data?.total ?? 0,
      })
    })
  }, [integration?.id, integration?.status])

  return React.createElement(
    IntegrationContext.Provider,
    { value: { integration, loading, setIntegration } },
    children,
  )
}
