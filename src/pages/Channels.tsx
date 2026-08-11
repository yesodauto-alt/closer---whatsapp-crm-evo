import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Mail, MessageCircle, Plus, QrCode, Radio, RefreshCw, Send, Unplug, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { useOrganization } from '@/hooks/use-organization'
import type { Channel, UserIntegration } from '@/lib/types'
import { formatPhoneNumber } from '@/lib/contact-phone'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

const channelStatusLabel = (status: string) => {
  switch (status) {
    case 'CONNECTED': return 'Conectado'
    case 'WAITING_QR': return 'Aguardando QR'
    case 'CONNECTING': return 'Conectando'
    case 'ERROR': return 'Erro'
    default: return 'Desconectado'
  }
}

export default function Channels() {
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
  const identityRequested = useRef(new Set<string>())

  const integrationByChannel = useMemo(() => {
    const map = new Map<string, UserIntegration>()
    for (const integration of integrations) {
      if (integration.channel_id) map.set(integration.channel_id, integration)
    }
    return map
  }, [integrations])

  const channelById = useMemo(() => {
    const map = new Map<string, Channel>()
    channels.forEach((channel) => map.set(channel.id, channel))
    return map
  }, [channels])

  const loadChannels = useCallback(async () => {
    if (!organizationId || !tenantUserId) return
    setLoading(true)
    const [channelResult, integrationResult] = await Promise.all([
      (supabase as any)
        .from('channels')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: true }),
      (supabase as any)
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, () => void loadChannels())
      .subscribe()
    return () => { supabase.removeChannel(realtime) }
  }, [tenantUserId, loadChannels])

  // Existing connected channels from before this feature are backfilled without
  // requiring a reconnect. The Evolution instance itself is the source of truth.
  useEffect(() => {
    const missing = integrations.filter((integration) => {
      if (integration.status !== 'CONNECTED' || !integration.channel_id) return false
      const channel = channelById.get(integration.channel_id)
      return channel && !channel.phone_number && !identityRequested.current.has(integration.id)
    })
    if (!missing.length) return

    missing.forEach((integration) => identityRequested.current.add(integration.id))
    void Promise.all(
      missing.map((integration) =>
        supabase.functions.invoke('evolution-refresh-channel-identity', {
          body: { integrationId: integration.id, channelId: integration.channel_id },
        }),
      ),
    ).then(() => loadChannels())
  }, [integrations, channelById, loadChannels])

  const requestQr = useCallback(async (channelId: string, silent = false) => {
    if (!silent) setQrLoading(true)
    const integration = integrationByChannel.get(channelId)
    const { data, error } = await supabase.functions.invoke('evolution-get-qr', {
      body: { channelId, integrationId: integration?.id ?? undefined },
    })

    if (error || (data?.error && data.error !== 'qr_not_ready_yet')) {
      if (!silent) toast.error(data?.evolutionError || data?.error || error?.message || 'Não foi possível gerar o QR Code')
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
    const timer = window.setInterval(() => { void requestQr(qrChannelId, true) }, 4000)
    return () => window.clearInterval(timer)
  }, [qrChannelId, requestQr])

  const connectChannel = async (channelId: string) => {
    setBusyChannelId(channelId)
    setQrChannelId(channelId)
    setQrCode(null)
    setQrLoading(true)

    const integration = integrationByChannel.get(channelId)
    if (!integration) {
      const { data, error } = await supabase.functions.invoke('evolution-create-instance', { body: { channelId } })
      if (error || data?.error) {
        toast.error(data?.error || error?.message || 'Não foi possível criar a instância do canal')
        setQrChannelId(null)
        setQrLoading(false)
        setBusyChannelId(null)
        return
      }
      await loadChannels()
    }

    await requestQr(channelId)
    setBusyChannelId(null)
  }

  const createWhatsAppChannel = async () => {
    if (!organizationId || !user || !canConfigure) return
    const name = newName.trim() || `WhatsApp ${channels.filter((c) => c.type === 'whatsapp').length + 1}`
    setCreating(true)
    const { data: channel, error } = await (supabase as any)
      .from('channels')
      .insert({ organization_id: organizationId, name, type: 'whatsapp', provider: 'evolution', status: 'DISCONNECTED', is_active: true, created_by: user.id })
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
    const { data, error } = await supabase.functions.invoke('evolution-disconnect', { body: { channelId, integrationId: integration.id } })
    setBusyChannelId(null)
    if (error || data?.error) toast.error(data?.error || error?.message || 'Falha ao desconectar canal')
    else { toast.success('Canal desconectado'); await loadChannels() }
  }

  const syncConversations = async (channelId: string) => {
    const integration = integrationByChannel.get(channelId)
    if (!integration) return
    setBusyChannelId(channelId)
    const { data, error } = await supabase.functions.invoke('evolution-sync-messages', { body: { channelId, integrationId: integration.id } })
    setBusyChannelId(null)
    if (error || data?.error) toast.error(data?.error || error?.message || 'Falha ao sincronizar conversas')
    else { toast.success(`Histórico sincronizado: ${data?.synced ?? 0} mensagens`); await loadChannels() }
  }

  const syncAddressBook = async (channelId: string) => {
    const integration = integrationByChannel.get(channelId)
    if (!integration) return
    setBusyChannelId(channelId)
    const { data, error } = await supabase.functions.invoke('evolution-sync-addressbook', { body: { channelId, integrationId: integration.id } })
    setBusyChannelId(null)
    if (error || data?.error) toast.error(data?.error || error?.message || 'Falha ao sincronizar a agenda')
    else {
      toast.success(`Agenda sincronizada: ${data?.synced ?? 0} contatos`)
      identityRequested.current.delete(integration.id)
      await loadChannels()
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="rounded-xl bg-primary p-2.5 text-primary-foreground"><Radio className="h-5 w-5" /></div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Canais</h1>
          <p className="mt-1 text-sm text-muted-foreground">Gerencie múltiplos WhatsApps, cada um com número, agenda, contatos e histórico próprios.</p>
        </div>
      </div>

      <div className="flex justify-end">
        {canConfigure && <Button onClick={() => setShowNewDialog(true)}><Plus className="mr-2 h-4 w-4" /> Adicionar WhatsApp</Button>}
      </div>

      {loading ? (
        <Card><CardContent className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></CardContent></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {channels.filter((channel) => channel.type === 'whatsapp').map((channel) => {
            const integration = integrationByChannel.get(channel.id)
            const status = integration?.status || channel.status || 'DISCONNECTED'
            const isBusy = busyChannelId === channel.id
            const phone = formatPhoneNumber(channel.phone_number)
            return (
              <Card key={channel.id}>
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="rounded-lg bg-muted p-2"><MessageCircle className="h-5 w-5" /></div>
                    <div className="min-w-0">
                      <CardTitle className="text-base">{channel.name}</CardTitle>
                      <p className="mt-1 text-sm font-semibold">{phone || (status === 'CONNECTED' ? 'Identificando número...' : 'Número ainda não conectado')}</p>
                      {integration?.instance_name && <p className="mt-1 text-[10px] text-muted-foreground truncate">{integration.instance_name}</p>}
                    </div>
                  </div>
                  <Badge variant={status === 'CONNECTED' ? 'default' : 'outline'}>{channelStatusLabel(status)}</Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-xs text-muted-foreground">
                    {integration?.is_primary ? 'Canal principal' : 'Canal adicional'}
                    {channel.last_sync_at ? ` · Última sincronização ${new Date(channel.last_sync_at).toLocaleString('pt-BR')}` : ''}
                  </div>
                  {canConfigure && (
                    <div className="flex flex-wrap gap-2">
                      {status === 'CONNECTED' ? (
                        <>
                          <Button variant="outline" size="sm" disabled={isBusy} onClick={() => void syncConversations(channel.id)}>
                            {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Histórico
                          </Button>
                          <Button variant="outline" size="sm" disabled={isBusy} onClick={() => void syncAddressBook(channel.id)}>
                            <UsersRound className="mr-2 h-4 w-4" /> Agenda
                          </Button>
                          <Button variant="outline" size="sm" disabled={isBusy} onClick={() => void disconnectChannel(channel.id)}>
                            <Unplug className="mr-2 h-4 w-4" /> Desconectar
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" disabled={isBusy} onClick={() => void connectChannel(channel.id)}>
                          {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCode className="mr-2 h-4 w-4" />} Gerar QR Code
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
        <Card className="opacity-75"><CardHeader className="flex-row items-center gap-3 space-y-0"><div className="rounded-lg bg-muted p-2"><Mail className="h-5 w-5" /></div><div><CardTitle className="text-base">E-mail</CardTitle><p className="mt-1 text-xs text-muted-foreground">Conector ainda não recuperado da migração.</p></div></CardHeader></Card>
        <Card className="opacity-75"><CardHeader className="flex-row items-center gap-3 space-y-0"><div className="rounded-lg bg-muted p-2"><Send className="h-5 w-5" /></div><div><CardTitle className="text-base">Telegram</CardTitle><p className="mt-1 text-xs text-muted-foreground">Conector ainda não recuperado da migração.</p></div></CardHeader></Card>
      </div>

      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Adicionar WhatsApp</DialogTitle><DialogDescription>Será criada uma instância Evolution independente e o QR Code aparecerá em seguida.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Ex.: WhatsApp Comercial" onKeyDown={(event) => { if (event.key === 'Enter' && !creating) void createWhatsAppChannel() }} />
            <Button className="w-full" disabled={creating} onClick={() => void createWhatsAppChannel()}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />} Criar e gerar QR Code
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(qrChannelId)} onOpenChange={(open) => { if (!open) { setQrChannelId(null); setQrCode(null); setQrLoading(false) } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Conectar WhatsApp</DialogTitle><DialogDescription>No WhatsApp do telefone, abra Aparelhos conectados e escaneie este QR Code.</DialogDescription></DialogHeader>
          <div className="flex min-h-[300px] items-center justify-center rounded-xl bg-muted/30 p-6">
            {qrCode ? <img src={qrCode} alt="QR Code WhatsApp" className="h-72 w-72 rounded-lg bg-white p-3" /> : <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground"><Loader2 className="h-7 w-7 animate-spin" />{qrLoading ? 'Gerando QR Code...' : 'Aguardando a Evolution...'}</div>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
