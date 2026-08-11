import { useCallback, useEffect, useState } from 'react'
import { ListFilter, Loader2, Save, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { useOrganization } from '@/hooks/use-organization'
import { useAgents } from '@/hooks/use-agents'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ConversationSort, PriorityCategory } from '@/lib/types'

const DEFAULT_CATEGORIES: PriorityCategory[] = [
  { code: 'Hot', label: 'Quente', minScore: 80, color: '#ef4444' },
  { code: 'Warm', label: 'Morno', minScore: 60, color: '#f97316' },
  { code: 'Lukewarm', label: 'Em avaliação', minScore: 40, color: '#eab308' },
  { code: 'Cold', label: 'Frio', minScore: 1, color: '#3b82f6' },
  { code: 'Do Not Contact', label: 'Não contatar', minScore: 0, color: '#64748b' },
]

export default function Priorities() {
  const { organizationId, tenantUserId, canConfigure, loading: organizationLoading } = useOrganization()
  const { agents } = useAgents()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [triaging, setTriaging] = useState(false)
  const [triageProgress, setTriageProgress] = useState('')
  const [conversationSort, setConversationSort] = useState<ConversationSort>('priority')
  const [autoTriageEnabled, setAutoTriageEnabled] = useState(false)
  const [triageAgentId, setTriageAgentId] = useState<string>('none')
  const [categories, setCategories] = useState<PriorityCategory[]>(DEFAULT_CATEGORIES)

  const load = useCallback(async () => {
    if (!organizationId) return
    setLoading(true)
    const { data, error } = await (supabase as any)
      .from('organizations')
      .select('conversation_sort, priority_categories, auto_triage_enabled, triage_agent_id')
      .eq('id', organizationId)
      .single()

    if (error) toast.error('Não foi possível carregar as prioridades')
    else if (data) {
      setConversationSort((data.conversation_sort || 'priority') as ConversationSort)
      setAutoTriageEnabled(Boolean(data.auto_triage_enabled))
      setTriageAgentId(data.triage_agent_id || 'none')
      if (Array.isArray(data.priority_categories) && data.priority_categories.length) {
        setCategories(data.priority_categories as PriorityCategory[])
      }
    }
    setLoading(false)
  }, [organizationId])

  useEffect(() => {
    if (!organizationLoading) void load()
  }, [organizationLoading, load])

  const save = async () => {
    if (!organizationId || !canConfigure) return
    setSaving(true)
    const normalized = categories.map((category) => ({
      ...category,
      label: category.label.trim() || category.code,
      minScore: Math.max(0, Math.min(100, Number(category.minScore) || 0)),
    }))
    const { error } = await (supabase as any)
      .from('organizations')
      .update({
        conversation_sort: conversationSort,
        priority_categories: normalized,
        auto_triage_enabled: autoTriageEnabled,
        triage_agent_id: triageAgentId === 'none' ? null : triageAgentId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', organizationId)
    setSaving(false)
    if (error) toast.error(error.message)
    else {
      setCategories(normalized)
      toast.success('Configuração de prioridades salva')
    }
  }

  const triageHistory = async () => {
    if (!tenantUserId || !triageAgentId || triageAgentId === 'none') {
      toast.error('Selecione um agente de triagem primeiro')
      return
    }

    setTriaging(true)
    setTriageProgress('Buscando conversas...')
    const { data: contacts, error } = await (supabase as any)
      .from('whatsapp_contacts')
      .select('id')
      .eq('user_id', tenantUserId)
      .eq('has_conversation', true)
      .order('last_message_at', { ascending: false, nullsFirst: false })

    if (error) {
      setTriaging(false)
      toast.error(error.message)
      return
    }

    const ids = (contacts ?? []).map((contact: any) => contact.id as string)
    let completed = 0
    let classified = 0
    let failed = 0

    for (let i = 0; i < ids.length; i += 3) {
      const batch = ids.slice(i, i + 3)
      const results = await Promise.all(
        batch.map(async (contactId) => {
          const { data, error: invokeError } = await supabase.functions.invoke('ai-triage-contact', {
            body: { contactId },
          })
          return { data, error: invokeError }
        }),
      )
      completed += batch.length
      classified += results.filter((result) => !result.error && result.data?.success).length
      failed += results.filter((result) => result.error || (!result.data?.success && !result.data?.skipped)).length
      setTriageProgress(`${completed}/${ids.length} conversas analisadas`)
    }

    setTriaging(false)
    setTriageProgress('')
    if (failed) toast.warning(`${classified} classificadas; ${failed} falharam`)
    else toast.success(`${classified} conversas classificadas com base no histórico`)
  }

  const updateCategory = (index: number, patch: Partial<PriorityCategory>) => {
    setCategories((current) => current.map((category, i) => i === index ? { ...category, ...patch } : category))
  }

  if (loading) {
    return <div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin" /></div>
  }

  const triageAgents = agents.filter((agent) => agent.is_active && agent.triage_enabled)

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary p-2.5 text-primary-foreground"><Sparkles className="h-5 w-5" /></div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Prioridades</h1>
            <p className="text-sm text-muted-foreground mt-1">Defina como a IA organiza e classifica a fila de conversas.</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-lg">Ordem das conversas</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>Ordem padrão da fila</Label>
              <Select value={conversationSort} onValueChange={(value: ConversationSort) => setConversationSort(value)} disabled={!canConfigure}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="priority">Prioridade da IA · maior score primeiro</SelectItem>
                  <SelectItem value="recent">Mais recentes primeiro</SelectItem>
                  <SelectItem value="oldest">Mais antigas primeiro</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Em prioridade, o score da triagem vem primeiro e a atividade mais recente desempata.</p>
            </div>

            <div className="border-t pt-5 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label>Triagem automática</Label>
                  <p className="text-xs text-muted-foreground mt-1">Reclassifica em background quando chega nova mensagem do cliente.</p>
                </div>
                <Switch checked={autoTriageEnabled} onCheckedChange={setAutoTriageEnabled} disabled={!canConfigure} />
              </div>
              <div className="space-y-2">
                <Label>Agente interno responsável pela triagem</Label>
                <Select value={triageAgentId} onValueChange={setTriageAgentId} disabled={!canConfigure}>
                  <SelectTrigger><SelectValue placeholder="Selecione um agente" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {triageAgents.map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {triageAgents.length === 0 && (
                  <p className="text-xs text-muted-foreground">Habilite “Triagem e Prioridade” em pelo menos um agente de IA.</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg">Classificação do histórico</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
              A análise considera o histórico armazenado no CRM até o limite configurado no agente. Mensagens antigas não recebem resposta automática; servem apenas para contexto da triagem.
            </div>
            <Button className="w-full" variant="outline" onClick={() => void triageHistory()} disabled={triaging || triageAgentId === 'none'}>
              {triaging ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ListFilter className="mr-2 h-4 w-4" />}
              {triaging ? triageProgress || 'Analisando...' : 'Classificar histórico agora'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Categorias da fila</CardTitle>
          <p className="text-sm text-muted-foreground">Os códigos internos permanecem estáveis para não quebrar filtros; nome e faixa podem ser ajustados.</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {categories.map((category, index) => (
              <div key={category.code} className="rounded-xl border p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: category.color || '#64748b' }} />
                  <span className="text-xs font-mono text-muted-foreground">{category.code}</span>
                </div>
                <Input value={category.label} onChange={(event) => updateCategory(index, { label: event.target.value })} disabled={!canConfigure} />
                <div className="space-y-1">
                  <Label className="text-xs">Score mínimo</Label>
                  <Input type="number" min={0} max={100} value={category.minScore} onChange={(event) => updateCategory(index, { minScore: Number(event.target.value) })} disabled={!canConfigure} />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {canConfigure && (
        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar prioridades
          </Button>
        </div>
      )}
    </div>
  )
}
