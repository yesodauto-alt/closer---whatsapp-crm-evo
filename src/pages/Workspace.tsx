import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Construction,
  Loader2,
  Mail,
  MessageCircle,
  Plus,
  QrCode,
  Radio,
  RefreshCw,
  Send,
  Sparkles,
  Unplug,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { useOrganization } from '@/hooks/use-organization'
import type { Channel, UserIntegration } from '@/lib/types'
import { toast } from 'sonner'

type WorkspaceProps = {
  title: string
  description: string
  icon?: ReactNode
  children?: ReactNode
}

export function Workspace({ title, description, icon, children }: WorkspaceProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        {icon && <div className="rounded-xl bg-primary p-2.5 text-primary-foreground">{icon}</div>}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

export function Priorities() {
  const navigate = useNavigate()
  return (
    <Workspace
      title="Prioridades"
      description="Atendimentos e oportunidades que precisam de ação agora."
      icon={<Sparkles className="h-5 w-5" />}
    >
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Sparkles className="mb-4 h-9 w-9 text-muted-foreground" />
          <h2 className="font-semibold">Sua fila está organizada</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            As prioridades serão preenchidas a partir da classificação e da atividade real dos
            contatos.
          </p>
          <Button className="mt-5" onClick={() => navigate('/app/conversations')}>
            Ver conversas <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    </Workspace>
  )
}

const channelStatusLabel = (status: string) => {
  switch (status) {
    case 'CONNECTED':
      return 'Conectado'
    case 'WAITING_QR':
      return 'Aguardando QR'
    case 'CONNECTING':
      return 'Conectando'
    case 'ERROR':
      return 'Erro'
    default:
      return 'Desconectado'
  }
}

export function Channels() {
  const { user } = useAuth()
  const { organizationId, tenantUserId, canConfigure, loading: organizationLoading } = useOrganization()
  const [channels, setChannels] = useState<Channel[]>([])
  const [integrations, setIntegrations] = useState<UserIntegration[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [qrChannelId, setQrChannelId] = useState<string | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [busyChannelId, setBusyChannelId] = useState<string | null>(null)

  const integrationByChannel = useMemo(() => {
    const map = new Map<string, UserIntegration>()
    for (const integration of integrations) {
      if (integration.channel_id) map.set(integration.channel_id, integration)
    }
    return map
  }, [integrations])

  const loadChannels = useCallback(async () => {
    if (!organizationId || !tenantUserId) return
    setLoading(true)
    const [channelResult, integrationResult] = await Promise.all([
      supabase
        .from('channels')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: true }),
      supabase
        .from('user_integrations')
        .select('*')
        .eq('user_id', tenantUserId)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true }),
    ])

    if (channelResult.error) console.error('[Channels] Failed to load channels:', channelResult.error)
    if (integrationResult.error) console.error('[Channels] Failed to load integrations:', integrationResult.error)
    setChannels((channelResult.data as Channel[]) ?? [])
    setIntegrations((integrationResult.data as UserIntegration[]) ?? [])
    setLoading(false)
  }, [organizationId, tenantUserId])

  useEffect(() => {
    if (!organizationLoading) void loadChannels()
  }, [organizationLoading, loadChannels])

  useEffect(() => {
    if (!tenantUserId) return
    const realtime = supabase
      .channel(`channels_workspace_${tenantUserId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_integrations', filter: `user_id=eq.${tenantUserId}` }, () => void loadChannels())
      .subscribe()
    return () => {
      supabase.removeChannel(realtime)
    }
  }, [tenantUserId, loadChannels])

  const requestQr = useCallback(async (channelId: string, silent = false) => {
    if (!silent) setQrLoading(true)
    const integration = integrationByChannel.get(channelId)
    const { data, error } = await supabase.functions.invoke('evolution-get-qr', {
      body: {
        channelId,
        integrationId: integration?.id ?? undefined,
      },
    })

    if (error || data?.error && data.error !== 'qr_not_ready_yet') {
      if (!silent) toast.error(data?.error || error?.message || 'Não foi possível gerar o QR Code')
      setQrLoading(false)
      return false
    }

    if (data?.connected) {
      setQrCode(null)
      setQrChannelId(null)
      setQrLoading(false)
      if (!silent) toast.success('WhatsApp conectado')
      await loadChannels()
      return true
    }

    if (data?.base64) {
      setQrCode(data.base64)
      setQrLoading(false)
    }
    return false
  }, [integrationByChannel, loadChannels])

  useEffect(() => {
    if (!qrChannelId) return
    const timer = window.setInterval(() => {
      void requestQr(qrChannelId, true)
    }, 4000)
    return () => window.clearInterval(timer)
  }, [qrChannelId, requestQr])

  const connectChannel = async (channelId: string) => {
    setBusyChannelId(channelId)
    setQrChannelId(channelId)
    setQrCode(null)
    setQrLoading(true)

    let integration = integrationByChannel.get(channelId)
    if (!integration) {
      const { data, error } = await supabase.functions.invoke('evolution-create-instance', {
        body: { channelId },
      })
      if (error || data?.error) {
        toast.error(data?.error || error?.message || 'Não foi possível criar a instância do canal')
        setQrChannelId(null)
        setQrLoading(false)
        setBusyChannelId(null)
        return
      }
      await loadChannels()
      integration = integrations.find((item) => item.id === data?.integrationId)
    }

    await requestQr(channelId)
    setBusyChannelId(null)
  }

  const createWhatsAppChannel = async () => {
    if (!organizationId || !user || !canConfigure) return
    const name = newName.trim() || `WhatsApp ${channels.filter((c) => c.type === 'whatsapp').length + 1}`
    setCreating(true)

    const { data: channel, error } = await supabase
      .from('channels')
      .insert({
        organization_id: organizationId,
        name,
        type: 'whatsapp',
        provider: 'evolution',
        status: 'DISCONNECTED',
        is_active: true,
        created_by: user.id,
      } as any)
      .select()
      .single()

    if (error || !channel) {
      toast.error(error?.message || 'Não foi possível criar o canal')
      setCreating(false)
      return
    }

    setShowNewDialog(false)
    setNewName('')
    await loadChannels()
    setCreating(false)
    await connectChannel(channel.id)
  }

  const disconnectChannel = async (channelId: string) => {
    const integration = integrationByChannel.get(channelId)
    if (!integration) return
    setBusyChannelId(channelId)
    const { data, error } = await supabase.functions.invoke('evolution-disconnect', {
      body: { channelId, integrationId: integration.id },
    })
    setBusyChannelId(null)
    if (error || data?.error) {
      toast.error(data?.error || error?.message || 'Falha ao desconectar canal')
      return
    }
    toast.success('Canal desconectado')
    await loadChannels()
  }

  const syncChannel = async (channelId: string) => {
    const integration = integrationByChannel.get(channelId)
    if (!integration) return
    setBusyChannelId(channelId)
    const { data, error } = await supabase.functions.invoke('evolution-sync-messages', {
      body: { channelId, integrationId: integration.id },
    })
    setBusyChannelId(null)
    if (error || data?.error) {
      toast.error(data?.error || error?.message || 'Falha ao sincronizar este canal')
      return
    }
    toast.success(`Canal sincronizado: ${data?.synced ?? 0} mensagens`)
    await loadChannels()
  }

  return (
    <Workspace
      title="Canais"
      description="Gerencie os canais de atendimento e conecte múltiplos números de WhatsApp."
      icon={<Radio className="h-5 w-5" />}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          Cada WhatsApp possui sua própria instância, QR Code, contatos e histórico.
        </div>
        {canConfigure && (
          <Button onClick={() => setShowNewDialog(true)}>
            <Plus className="mr-2 h-4 w-4" /> Adicionar WhatsApp
          </Button>
        )}
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin" />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {channels.filter((channel) => channel.type === 'whatsapp').map((channel) => {
            const integration = integrationByChannel.get(channel.id)
            const status = integration?.status || channel.status || 'DISCONNECTED'
            const isBusy = busyChannelId === channel.id
            return (
              <Card key={channel.id}>
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-muted p-2"><MessageCircle className="h-5 w-5" /></div>
                    <div>
                      <CardTitle className="text-base">{channel.name}</CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {integration?.instance_name || 'Instância ainda não criada'}
                      </p>
                    </div>
                  </div>
                  <Badge variant={status === 'CONNECTED' ? 'default' : 'outline'}>
                    {channelStatusLabel(status)}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    {integration?.is_primary ? 'Canal principal' : 'Canal adicional'}
                    {channel.last_sync_at ? ` · Última sincronização ${new Date(channel.last_sync_at).toLocaleString('pt-BR')}` : ''}
                  </div>
                  {canConfigure && (
                    <div className="flex flex-wrap gap-2">
                      {status === 'CONNECTED' ? (
                        <>
                          <Button variant="outline" size="sm" disabled={isBusy} onClick={() => void syncChannel(channel.id)}>
                            {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                            Sincronizar
                          </Button>
                          <Button variant="outline" size="sm" disabled={isBusy} onClick={() => void disconnectChannel(channel.id)}>
                            <Unplug className="mr-2 h-4 w-4" /> Desconectar
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" disabled={isBusy} onClick={() => void connectChannel(channel.id)}>
                          {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCode className="mr-2 h-4 w-4" />}
                          Gerar QR Code
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="opacity-75">
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <div className="rounded-lg bg-muted p-2"><Mail className="h-5 w-5" /></div>
            <div>
              <CardTitle className="text-base">E-mail</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Conector não recuperado da migração atual.</p>
            </div>
          </CardHeader>
        </Card>
        <Card className="opacity-75">
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <div className="rounded-lg bg-muted p-2"><Send className="h-5 w-5" /></div>
            <div>
              <CardTitle className="text-base">Telegram</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Conector não recuperado da migração atual.</p>
            </div>
          </CardHeader>
        </Card>
      </div>

      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar WhatsApp</DialogTitle>
            <DialogDescription>
              Será criada uma instância Evolution independente e o QR Code aparecerá em seguida.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Ex.: WhatsApp Comercial"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !creating) void createWhatsAppChannel()
              }}
            />
            <Button className="w-full" disabled={creating} onClick={() => void createWhatsAppChannel()}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Criar e gerar QR Code
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(qrChannelId)} onOpenChange={(open) => {
        if (!open) {
          setQrChannelId(null)
          setQrCode(null)
          setQrLoading(false)
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conectar WhatsApp</DialogTitle>
            <DialogDescription>
              No WhatsApp do telefone, abra Aparelhos conectados e escaneie este QR Code.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-72 items-center justify-center">
            {qrCode ? (
              <img
                src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                alt="WhatsApp QR Code"
                className="h-64 w-64 rounded-xl bg-white p-3"
              />
            ) : (
              <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
                {qrLoading ? 'Gerando QR Code...' : 'Aguardando QR Code...'}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Workspace>
  )
}

export function ModulePage({ title }: { title: string }) {
  return (
    <Workspace
      title={title}
      description={`Área de ${title.toLowerCase()} do Yesod CRM.`}
      icon={<Construction className="h-5 w-5" />}
    >
      <Card>
        <CardContent className="py-14 text-center text-sm text-muted-foreground">
          O módulo está integrado à navegação e será ativado sem interferir na conexão Evolution.
        </CardContent>
      </Card>
    </Workspace>
  )
}
