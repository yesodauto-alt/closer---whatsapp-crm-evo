import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from './use-auth'
import type { AppRole, OrganizationMembership } from '@/lib/types'

export function useOrganization() {
  const { user } = useAuth()
  const [membership, setMembership] = useState<OrganizationMembership | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      setMembership(null)
      setLoading(false)
      return
    }

    const load = async () => {
      setLoading(true)
      const { data, error } = await (supabase as any)
        .from('organization_members')
        .select(
          'organization_id, role, organization:organizations(id, name, slug, owner_user_id)',
        )
        .eq('user_id', user.id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()

      if (error) {
        console.error('Error loading organization membership:', error)
        setMembership(null)
      } else {
        setMembership(data as OrganizationMembership | null)
      }
      setLoading(false)
    }

    load()
  }, [user])

  const role = membership?.role as AppRole | undefined
  const canConfigure = role === 'super_admin' || role === 'admin'
  const isSuperAdmin = role === 'super_admin'

  return {
    organization: membership?.organization ?? null,
    organizationId: membership?.organization_id ?? null,
    tenantUserId: membership?.organization?.owner_user_id ?? user?.id ?? null,
    role,
    canConfigure,
    isSuperAdmin,
    loading,
  }
}
