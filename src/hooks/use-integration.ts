import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react'
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
  const { tenantUserId, loading: organizationLoading } = useOrganization()
  const [integration, setIntegration] = useState<UserIntegration | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      setIntegration(null)
      setLoading(false)
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
        .maybeSingle()

      if (error) {
        console.error('[useIntegration] Failed to load tenant integration:', error)
        setIntegration(null)
        setLoading(false)
        return
      }

      if (!data) {
        const newIntegration = {
          user_id: tenantUserId,
          instance_name: tenantUserId,
          status: 'DISCONNECTED',
          is_setup_completed: false,
          is_webhook_enabled: false,
        }

        const { data: inserted, error: insertError } = await supabase
          .from('user_integrations')
          .insert(newIntegration as any)
          .select()
          .single()

        if (insertError) {
          console.error('[useIntegration] Failed to create tenant integration:', insertError)
          setIntegration(null)
        } else if (inserted) {
          setIntegration(inserted as UserIntegration)
        }
      } else if (!data.instance_name) {
        const { data: updated, error: updateError } = await supabase
          .from('user_integrations')
          .update({ instance_name: tenantUserId } as any)
          .eq('id', data.id)
          .select()
          .single()

        if (updateError) {
          console.error('[useIntegration] Failed to repair tenant instance name:', updateError)
          setIntegration(data as UserIntegration)
        } else if (updated) {
          setIntegration(updated as UserIntegration)
        }
      } else {
        setIntegration(data as UserIntegration)
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
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setIntegration(null)
            return
          }
          setIntegration((prev) => ({
            ...(prev || {}),
            ...(payload.new as UserIntegration),
          }))
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, tenantUserId, organizationLoading])

  return React.createElement(
    IntegrationContext.Provider,
    { value: { integration, loading, setIntegration } },
    children,
  )
}
