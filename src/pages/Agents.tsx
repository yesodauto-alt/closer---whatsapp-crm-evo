import { useState } from 'react'
import { useAgents } from '@/hooks/use-agents'
import { useLanguage } from '@/hooks/use-language'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Plus, Trash2, Edit2, Loader2, ListFilter } from 'lucide-react'
import { AIAgent } from '@/lib/types'

const emptyForm = (prompt = '') => ({
  name: '',
  description: '',
  system_prompt: prompt,
  provider: 'openai' as const,
  model: 'gpt-4.1-mini' as AIAgent['model'],
  agent_type: 'custom' as AIAgent['agent_type'],
  color: '#6366f1',
  tone: '',
  objectives: '',
  restrictions: '',
  knowledge_base_enabled: false,
  team_id: null as string | null,
  triage_enabled: false,
  triage_instructions: '',
  triage_history_limit: 40,
  is_active: true,
})

export default function Agents() {
  const {
    agents,
    loading,
    createAgent,
    updateAgent,
    deleteAgent,
    toggleAgentStatus,
    canConfigure,
  } = useAgents()
  const { t } = useLanguage()

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<AIAgent | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState(emptyForm())

  const handleOpenDialog = (agent?: AIAgent) => {
    if (agent) {
      setEditingAgent(agent)
      setFormData({
        name: agent.name,
        description: agent.description || '',
        system_prompt: agent.system_prompt,
        provider: 'openai',
        model: agent.model,
        agent_type: agent.agent_type,
        color: agent.color,
        tone: agent.tone || '',
        objectives: agent.objectives || '',
        restrictions: agent.restrictions || '',
        knowledge_base_enabled: agent.knowledge_base_enabled,
        team_id: agent.team_id,
        triage_enabled: Boolean(agent.triage_enabled),
        triage_instructions: agent.triage_instructions || '',
        triage_history_limit: agent.triage_history_limit || 40,
        is_active: agent.is_active,
      })
    } else {
      setEditingAgent(null)
      setFormData(emptyForm(t('default_system_prompt')))
    }
    setIsDialogOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      if (editingAgent) await updateAgent(editingAgent.id, formData)
      else await createAgent(formData)
      setIsDialogOpen(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">{t('agents_title')}</h2>
          <p className="text-muted-foreground mt-2 font-medium text-base">{t('agents_desc')}</p>
        </div>
        {canConfigure && (
          <Button onClick={() => handleOpenDialog()} className="rounded-full px-6 h-12 font-semibold">
            <Plus className="mr-2 h-5 w-5" /> {t('create_agent')}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center p-24">
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground/50" />
        </div>
      ) : agents.length === 0 ? (
        <Card className="border-dashed bg-transparent shadow-none">
          <CardContent className="flex flex-col items-center justify-center p-20 text-center">
            <h3 className="text-xl font-bold mb-2">{t('no_agents_title')}</h3>
            <p className="text-muted-foreground max-w-sm mb-6">{t('no_agents_desc')}</p>
            {canConfigure && <Button onClick={() => handleOpenDialog()}>{t('create_agent')}</Button>}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {agents.map((agent) => (
            <Card key={agent.id} className="rounded-xl overflow-hidden flex flex-col">
              <CardHeader className="pb-4">
                <div className="flex justify-between items-start gap-3">
                  <div>
                    <CardTitle className="text-lg">{agent.name}</CardTitle>
                    <CardDescription className="mt-1">
                      {agent.is_active ? t('active') : t('inactive')}
                    </CardDescription>
                  </div>
                  {canConfigure && (
                    <Switch
                      checked={agent.is_active}
                      onCheckedChange={() => toggleAgentStatus(agent.id, agent.is_active)}
                    />
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex-1 space-y-4">
                <p className="text-sm text-muted-foreground line-clamp-3">
                  {agent.description || t('no_description')}
                </p>
                {agent.triage_enabled && (
                  <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs font-semibold">
                    <ListFilter className="h-4 w-4" /> Triagem interna habilitada · últimas {agent.triage_history_limit || 40} mensagens
                  </div>
                )}
              </CardContent>
              {canConfigure && (
                <div className="border-t p-4 flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => handleOpenDialog(agent)}>
                    <Edit2 className="h-4 w-4 mr-2" /> {t('edit')}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteAgent(agent.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[680px] p-0 overflow-hidden">
          <form onSubmit={handleSubmit} className="flex flex-col max-h-[90vh]">
            <DialogHeader className="p-6 pb-4 border-b bg-muted/20">
              <DialogTitle className="text-2xl">
                {editingAgent ? t('edit_agent') : t('create_agent')}
              </DialogTitle>
              <DialogDescription>{t('agent_dialog_desc')}</DialogDescription>
            </DialogHeader>

            <div className="p-6 space-y-6 overflow-y-auto">
              <div className="space-y-2">
                <Label htmlFor="name">{t('agent_name')}</Label>
                <Input id="name" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">{t('description')}</Label>
                <Input id="description" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Função</Label>
                  <Select value={formData.agent_type} onValueChange={(value: AIAgent['agent_type']) => setFormData({ ...formData, agent_type: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="marketing">Marketing</SelectItem>
                      <SelectItem value="sales">Vendas</SelectItem>
                      <SelectItem value="sdr">SDR / Prospecção</SelectItem>
                      <SelectItem value="support">Suporte</SelectItem>
                      <SelectItem value="administrative">Administrativo</SelectItem>
                      <SelectItem value="custom">Personalizado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Modelo OpenAI</Label>
                  <Select value={formData.model} onValueChange={(value: AIAgent['model']) => setFormData({ ...formData, model: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gpt-4.1-mini">GPT-4.1 mini</SelectItem>
                      <SelectItem value="gpt-4o-mini">GPT-4o mini</SelectItem>
                      <SelectItem value="gpt-4.1">GPT-4.1</SelectItem>
                      <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="tone">Tom de voz</Label>
                  <Input id="tone" value={formData.tone} onChange={(e) => setFormData({ ...formData, tone: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="color">Cor</Label>
                  <Input id="color" type="color" value={formData.color} onChange={(e) => setFormData({ ...formData, color: e.target.value })} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="objectives">Objetivos</Label>
                <Textarea id="objectives" value={formData.objectives} onChange={(e) => setFormData({ ...formData, objectives: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="restrictions">Restrições</Label>
                <Textarea id="restrictions" value={formData.restrictions} onChange={(e) => setFormData({ ...formData, restrictions: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prompt">{t('system_prompt')}</Label>
                <Textarea id="prompt" required value={formData.system_prompt} onChange={(e) => setFormData({ ...formData, system_prompt: e.target.value })} className="min-h-[140px] font-mono text-sm" />
              </div>

              <div className="rounded-xl border p-5 space-y-5 bg-muted/20">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 font-bold"><ListFilter className="h-4 w-4" /> Triagem e Prioridade</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Permite que este agente analise o histórico e classifique contatos para a fila comercial. Pode ser o mesmo agente que atende no WhatsApp.
                    </p>
                  </div>
                  <Switch checked={formData.triage_enabled} onCheckedChange={(checked) => setFormData({ ...formData, triage_enabled: checked })} />
                </div>

                {formData.triage_enabled && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="triage-instructions">Regras específicas de triagem</Label>
                      <Textarea
                        id="triage-instructions"
                        value={formData.triage_instructions}
                        onChange={(e) => setFormData({ ...formData, triage_instructions: e.target.value })}
                        placeholder="Ex.: considerar pedido de orçamento, prazo declarado, recorrência, objeções e urgência..."
                        className="min-h-[110px]"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="triage-history">Mensagens do histórico analisadas por triagem</Label>
                      <Input
                        id="triage-history"
                        type="number"
                        min={5}
                        max={200}
                        value={formData.triage_history_limit}
                        onChange={(e) => setFormData({ ...formData, triage_history_limit: Math.max(5, Math.min(200, Number(e.target.value) || 40)) })}
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center justify-between p-4 bg-muted/40 rounded-xl border">
                <div><Label>Base de conhecimento</Label><p className="text-xs text-muted-foreground">Permitir consulta a documentos autorizados.</p></div>
                <Switch checked={formData.knowledge_base_enabled} onCheckedChange={(checked) => setFormData({ ...formData, knowledge_base_enabled: checked })} />
              </div>
              <div className="flex items-center justify-between p-4 bg-muted/40 rounded-xl border">
                <div><Label>{t('agent_status')}</Label><p className="text-xs text-muted-foreground">{t('agent_status_help')}</p></div>
                <Switch checked={formData.is_active} onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })} />
              </div>
            </div>

            <DialogFooter className="p-6 pt-4 border-t bg-muted/20">
              <Button type="button" variant="ghost" onClick={() => setIsDialogOpen(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingAgent ? t('save_changes') : t('create_agent')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
