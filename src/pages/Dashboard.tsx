import { useState, useMemo } from 'react'
import { useContacts } from '@/hooks/use-contacts'
import { useLanguage, TranslationKey } from '@/hooks/use-language'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  RefreshCw,
  Loader2,
  Users,
  Flame,
  Activity,
  ArrowRight,
  MessageSquare,
  DollarSign,
  Package,
  TrendingUp,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { ptBR, enUS } from 'date-fns/locale'
import { supabase } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartConfig,
} from '@/components/ui/chart'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Cell } from 'recharts'
import { useFinancialDashboard } from '@/hooks/use-financial-dashboard'

export const getBadgeColor = (classification: string | null) => {
  switch (classification) {
    case 'Hot':
      return 'bg-class-hot text-primary-foreground border-class-hot'
    case 'Warm':
      return 'bg-class-warm text-white border-class-warm'
    case 'Lukewarm':
      return 'bg-class-lukewarm text-white border-class-lukewarm'
    case 'Cold':
      return 'bg-class-cold text-class-hot border-class-cold'
    case 'Do Not Contact':
      return 'bg-transparent text-class-dnc border-class-dnc line-through'
    default:
      return 'bg-transparent text-muted-foreground border-border'
  }
}

export default function Dashboard() {
  const { t, language } = useLanguage()
  const dateLocale = language === 'pt' ? ptBR : enUS
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<{
    type: string
    total: number
    processed: number
    status: string
  } | null>(null)

  const { contacts, loading } = useContacts('')
  const financial = useFinancialDashboard()
  const navigate = useNavigate()

  const pollJob = async (jobId: string, stepName: string) => {
    return new Promise<void>((resolve, reject) => {
      const interval = setInterval(async () => {
        const { data, error } = await supabase
          .from('import_jobs')
          .select('*')
          .eq('id', jobId)
          .single()

        if (error) {
          clearInterval(interval)
          reject(error)
          return
        }

        setSyncProgress({
          type: stepName,
          total: data.total_items || 0,
          processed: data.processed_items || 0,
          status: data.status || 'running',
        })

        if (data.status === 'completed') {
          clearInterval(interval)
          resolve()
        } else if (data.status === 'failed') {
          clearInterval(interval)
          reject(new Error(`${stepName} sync failed on server.`))
        }
      }, 2000)
    })
  }

  const handleSync = async () => {
    if (isSyncing) return

    setIsSyncing(true)
    setSyncProgress({ type: 'contacts', total: 0, processed: 0, status: 'running' })

    try {
      const { data: contactsData, error: contactsError } =
        await supabase.functions.invoke('evolution-sync-contacts')
      if (contactsError) throw contactsError
      if (contactsData?.error) throw new Error(contactsData.error)
      if (contactsData?.job_id) await pollJob(contactsData.job_id, 'contacts')

      setSyncProgress({ type: 'messages', total: 0, processed: 0, status: 'running' })
      const { data: messagesData, error: messagesError } =
        await supabase.functions.invoke('evolution-sync-messages')
      if (messagesError) throw messagesError
      if (messagesData?.error) throw new Error(messagesData.error)
      if (messagesData?.job_id) await pollJob(messagesData.job_id, 'messages')

      toast.success(t('sync_completed'))
    } catch (error: any) {
      console.error('Sync failed:', error)
      toast.error(`${t('sync_failed')} ${error.message || t('unknown_error')}`)
    } finally {
      setIsSyncing(false)
      setSyncProgress(null)
    }
  }

  const totalContacts = contacts.length
  const hotLeads = contacts.filter((c) => c.classification === 'Hot').length
  const avgScore = contacts.length
    ? Math.round(contacts.reduce((acc, c) => acc + (c.score || 0), 0) / contacts.length)
    : 0
  const activeRecently = contacts.filter((c) => c.last_message_at).length

  const chartData = useMemo(() => {
    const counts = { Hot: 0, Warm: 0, Lukewarm: 0, Cold: 0, 'Do Not Contact': 0 }
    contacts.forEach((c) => {
      if (c.classification && counts[c.classification as keyof typeof counts] !== undefined) {
        counts[c.classification as keyof typeof counts]++
      }
    })
    return [
      { name: t('hot'), count: counts.Hot, fill: 'hsl(var(--class-hot))' },
      { name: t('warm'), count: counts.Warm, fill: 'hsl(var(--class-warm))' },
      { name: t('lukewarm'), count: counts.Lukewarm, fill: 'hsl(var(--class-lukewarm))' },
      { name: t('cold'), count: counts.Cold, fill: 'hsl(var(--class-cold))' },
      { name: t('dnc'), count: counts['Do Not Contact'], fill: 'hsl(var(--class-dnc))' },
    ]
  }, [contacts, t])

  const chartConfig = {
    count: { label: t('contacts') },
  } satisfies ChartConfig

  const money = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">{t('overview')}</h2>
          <p className="text-muted-foreground mt-2 font-medium text-base">{t('crm_health')}</p>
        </div>
        <Button
          onClick={handleSync}
          disabled={isSyncing}
          variant="outline"
          className="w-full sm:w-auto"
        >
          {isSyncing ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          )}
          {isSyncing ? t('syncing_data') : t('sync_data')}
        </Button>
      </div>

      {isSyncing && syncProgress && (
        <Card className="animate-in fade-in slide-in-from-top-4">
          <CardContent className="p-8 flex flex-col gap-5">
            <div className="flex justify-between items-center text-sm font-semibold text-foreground">
              <span className="flex items-center gap-3">
                <div className="p-2.5 bg-muted rounded-full">
                  <Loader2 className="h-4 w-4 animate-spin text-foreground" />
                </div>
                {syncProgress.type === 'contacts'
                  ? t('syncing_contacts')
                  : t('syncing_messages')}
              </span>
              <span className="text-muted-foreground font-semibold">
                {syncProgress.total > 0
                  ? `${syncProgress.processed} / ${syncProgress.total}`
                  : t('starting')}
              </span>
            </div>
            <Progress
              value={
                syncProgress.total > 0 ? (syncProgress.processed / syncProgress.total) * 100 : 0
              }
            />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
        <Card>
          <CardContent className="p-6 md:p-8 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between mb-6">
              <span className="text-sm font-semibold text-muted-foreground tracking-tight uppercase">
                {t('total_contacts')}
              </span>
              <div className="bg-muted p-3 rounded-full text-foreground">
                <Users className="h-5 w-5" />
              </div>
            </div>
            <div className="text-3xl font-bold tracking-tight text-foreground">
              {loading ? '-' : totalContacts}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 md:p-8 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between mb-6">
              <span className="text-sm font-semibold text-muted-foreground tracking-tight uppercase">
                {t('hot_leads')}
              </span>
              <div className="bg-muted p-3 rounded-full text-foreground">
                <Flame className="h-5 w-5" />
              </div>
            </div>
            <div className="text-3xl font-bold tracking-tight text-foreground">
              {loading ? '-' : hotLeads}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 md:p-8 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between mb-6">
              <span className="text-sm font-semibold text-muted-foreground tracking-tight uppercase">
                {t('avg_score')}
              </span>
              <div className="bg-muted p-3 rounded-full text-foreground">
                <Activity className="h-5 w-5" />
              </div>
            </div>
            <div className="text-3xl font-bold tracking-tight text-foreground">
              {loading && contacts.length === 0 ? '-' : avgScore}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 md:p-8 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between mb-6">
              <span className="text-sm font-semibold text-muted-foreground tracking-tight uppercase">
                {t('active_recently')}
              </span>
              <div className="bg-muted p-3 rounded-full text-foreground">
                <MessageSquare className="h-5 w-5" />
              </div>
            </div>
            <div className="text-3xl font-bold tracking-tight text-foreground">
              {loading ? '-' : activeRecently}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold tracking-tight">Visão financeira</h3>
            <p className="text-sm text-muted-foreground">
              Valores calculados a partir das oportunidades e produtos cadastrados.
            </p>
          </div>
          <Button variant="ghost" onClick={() => navigate('/app/products')}>
            Ver produtos <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: 'Valor do pipeline',
              value: money(financial.pipelineValue),
              icon: TrendingUp,
            },
            { label: 'Receita ganha', value: money(financial.wonValue), icon: DollarSign },
            { label: 'Ticket médio', value: money(financial.ticketAverage), icon: Activity },
            {
              label: 'Produtos ativos',
              value: String(financial.productCount),
              icon: Package,
            },
          ].map((metric) => (
            <Card key={metric.label}>
              <CardContent className="p-6">
                <div className="mb-5 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {metric.label}
                  </span>
                  <div className="rounded-full bg-muted p-3">
                    <metric.icon className="h-5 w-5" />
                  </div>
                </div>
                <p className="text-2xl font-bold tracking-tight">
                  {financial.loading ? '-' : metric.value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6 pb-8">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-2xl font-bold tracking-tight">
              {t('lead_pipeline')}
            </CardTitle>
            <CardDescription className="font-semibold text-base text-muted-foreground mt-1">
              {t('lead_pipeline_desc')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[320px] w-full mt-4">
              {loading ? (
                <div className="w-full h-full flex items-center justify-center bg-muted/50 rounded-3xl">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/30" />
                </div>
              ) : (
                <ChartContainer config={chartConfig}>
                  <BarChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" strokeOpacity={0.2} />
                    <XAxis
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      tickMargin={12}
                      fontSize={13}
                      fontWeight={600}
                      stroke="hsl(var(--muted-foreground))"
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      fontSize={13}
                      fontWeight={600}
                      stroke="hsl(var(--muted-foreground))"
                    />
                    <ChartTooltip
                      cursor={{ fill: 'rgba(0, 0, 0, 0.03)' }}
                      content={<ChartTooltipContent hideLabel />}
                    />
                    <Bar dataKey="count" radius={[8, 8, 0, 0]} barSize={48}>
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="flex flex-row items-start justify-between pb-4">
            <div className="space-y-1">
              <CardTitle className="text-2xl font-bold tracking-tight">{t('top_leads')}</CardTitle>
              <CardDescription className="font-semibold text-base text-muted-foreground mt-1">
                {t('top_leads_desc')}
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground"
              onClick={() => navigate('/app/contacts')}
            >
              <ArrowRight className="h-5 w-5" />
            </Button>
          </CardHeader>
          <CardContent className="flex-1">
            <div className="space-y-2 mt-2">
              {loading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="h-16 bg-muted animate-pulse rounded-2xl" />
                  ))}
                </div>
              ) : (
                contacts
                  .sort((a, b) => (b.score || 0) - (a.score || 0))
                  .slice(0, 5)
                  .map((contact) => (
                    <div
                      key={contact.id}
                      className="flex items-center justify-between py-3.5 px-3 -mx-3 rounded-2xl hover:bg-muted transition-all duration-300 cursor-pointer group"
                      onClick={() => navigate(`/app/chat/${contact.id}`)}
                    >
                      <div className="flex items-center gap-4">
                        <Avatar className="h-11 w-11 border-2 border-border shadow-sm">
                          <AvatarImage src={contact.profile_picture_url || ''} />
                          <AvatarFallback className="bg-muted text-foreground font-semibold text-sm">
                            {contact.push_name?.charAt(0) || '#'}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-bold text-[15px] tracking-tight text-foreground group-hover:text-primary transition-colors">
                            {contact.push_name || t('unknown')}
                          </p>
                          <p className="text-[13px] text-muted-foreground font-semibold">
                            {contact.last_message_at
                              ? formatDistanceToNow(new Date(contact.last_message_at), {
                                  addSuffix: true,
                                  locale: dateLocale,
                                })
                              : t('no_messages')}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        {contact.score !== null && contact.score > 0 && (
                          <span className="text-[11px] font-bold tabular-nums text-muted-foreground">
                            {contact.score} {t('pts')}
                          </span>
                        )}
                        {contact.classification && (
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-2 py-0.5 font-bold shadow-sm rounded-md ${getBadgeColor(contact.classification)}`}
                          >
                            {t(
                              contact.classification
                                .toLowerCase()
                                .replace(/ /g, '_') as TranslationKey,
                            ) || contact.classification}
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))
              )}
              {!loading && contacts.length === 0 && (
                <div className="text-sm text-muted-foreground text-center font-semibold py-12">
                  {t('no_contacts')}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
