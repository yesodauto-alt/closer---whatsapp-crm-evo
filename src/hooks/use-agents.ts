import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from './use-auth'
import { useOrganization } from './use-organization'
import { AIAgent } from '@/lib/types'
import { toast } from 'sonner'

export const useAgents = () => {
  const { user } = useAuth()
  const { organizationId, canConfigure, loading: organizationLoading } = useOrganization()
  const [agents, setAgents] = useState<AIAgent[]>([])
  const [loading, setLoading] = useState(true)

  const fetchAgents = useCallback(async () => {
    if (!user || !organizationId) {
      if (!organizationLoading) setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await (supabase as any)
      .from('ai_agents')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching agents:', error)
      toast.error('Failed to load AI agents')
    } else if (data) {
      setAgents(data as AIAgent[])
    }
    setLoading(false)
  }, [user, organizationId, organizationLoading])

  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  const createAgent = async (agent: Partial<AIAgent>) => {
    if (!user || !organizationId || !canConfigure) return
    const { data, error } = await (supabase as any)
      .from('ai_agents')
      .insert({
        user_id: user.id,
        organization_id: organizationId,
        name: agent.name!,
        description: agent.description,
        system_prompt: agent.system_prompt!,
        provider: 'openai',
        model: agent.model || 'gpt-4.1-mini',
        agent_type: agent.agent_type || 'custom',
        color: agent.color || '#6366f1',
        tone: agent.tone,
        objectives: agent.objectives,
        restrictions: agent.restrictions,
        knowledge_base_enabled: agent.knowledge_base_enabled || false,
        team_id: agent.team_id,
        triage_enabled: agent.triage_enabled || false,
        triage_instructions: agent.triage_instructions,
        triage_history_limit: agent.triage_history_limit || 40,
        is_active: agent.is_active,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating agent:', error)
      toast.error('Failed to create agent')
      throw error
    }

    toast.success('Agent created successfully')
    setAgents((prev) => [data as AIAgent, ...prev])
    return data
  }

  const updateAgent = async (id: string, agent: Partial<AIAgent>) => {
    if (!user || !canConfigure) return
    const { data, error } = await (supabase as any)
      .from('ai_agents')
      .update({
        name: agent.name,
        description: agent.description,
        system_prompt: agent.system_prompt,
        provider: 'openai',
        model: agent.model,
        agent_type: agent.agent_type,
        color: agent.color,
        tone: agent.tone,
        objectives: agent.objectives,
        restrictions: agent.restrictions,
        knowledge_base_enabled: agent.knowledge_base_enabled,
        team_id: agent.team_id,
        triage_enabled: agent.triage_enabled,
        triage_instructions: agent.triage_instructions,
        triage_history_limit: agent.triage_history_limit,
        is_active: agent.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select()
      .single()

    if (error) {
      console.error('Error updating agent:', error)
      toast.error('Failed to update agent')
      throw error
    }

    toast.success('Agent updated successfully')
    setAgents((prev) => prev.map((a) => (a.id === id ? (data as AIAgent) : a)))
    return data
  }

  const deleteAgent = async (id: string) => {
    if (!user || !canConfigure) return
    const { error } = await (supabase as any)
      .from('ai_agents')
      .delete()
      .eq('id', id)
      .eq('organization_id', organizationId)

    if (error) {
      console.error('Error deleting agent:', error)
      toast.error('Failed to delete agent')
      throw error
    }

    toast.success('Agent deleted successfully')
    setAgents((prev) => prev.filter((a) => a.id !== id))
  }

  const toggleAgentStatus = async (id: string, currentStatus: boolean) => {
    if (!user || !canConfigure) return
    const newStatus = !currentStatus
    const { error } = await (supabase as any)
      .from('ai_agents')
      .update({ is_active: newStatus, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('organization_id', organizationId)

    if (error) {
      console.error('Error toggling agent status:', error)
      toast.error('Failed to update status')
      throw error
    }

    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, is_active: newStatus } : a)))
  }

  return {
    agents,
    loading,
    refetch: fetchAgents,
    createAgent,
    updateAgent,
    deleteAgent,
    toggleAgentStatus,
    canConfigure,
  }
}
