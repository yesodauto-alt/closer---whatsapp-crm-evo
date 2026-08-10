import { useState, useEffect } from 'react'
import { useIntegration } from '@/hooks/use-integration'
import { useLanguage } from '@/hooks/use-language'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Loader2, MessageCircle, Plug, Unplug, CheckCircle2 } from 'lucide-react'

export default function Settings() {
  const { integration, setIntegration, loading: integrationLoading } = useIntegration()
  const { t } = useLanguage()

  const [qrCode, setQrCode] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)

  useEffect(() => {
    if (integration?.status === 'CONNECTED') {
      setQrCode(null)
    }
  }, [integration?.status])

  const handleConnect = async () => {
    if (!integration) return
    setIsConnecting(true)
    setQrCode(null)

    let retries = 0
    const fetchQr = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('evolution-get-qr')

        if (error) throw error

        if (data?.base64) {
          setQrCode(data.base64)
          if (integration.status !== 'WAITING_QR') {
            setIntegration((prev: any) => (prev ? { ...prev, status: 'WAITING_QR' } : null))
          }
          setIsConnecting(false)
        } else if (data?.connected) {
          if (integration.status !== 'CONNECTED') {
            setIntegration((prev: any) => (prev ? { ...prev, status: 'CONNECTED' } : null))
          }
          toast.success(t('already_connected'))
          setIsConnecting(false)
        } else if ((data?.error === 'qr_not_ready_yet' || data?.creating) && retries < 5) {
          if (integration.status !== 'WAITING_QR') {
            setIntegration((prev: any) => (prev ? { ...prev, status: 'WAITING_QR' } : null))
          }
          retries++
          setTimeout(fetchQr, 2000)
        } else {
          toast.error(data?.error || t('failed_init'))
          setIsConnecting(false)
        }
      } catch (e: any) {
        toast.error(e.message || t('error_connect'))
        setIsConnecting(false)
      }
    }

    fetchQr()
  }

  const handleDisconnect = async () => {
    if (!integration) return
    setIsConnecting(true)
    try {
      const { error } = await supabase.functions.invoke('evolution-disconnect')
      if (error) throw error
      toast.success(t('disconnected_success'))
      setQrCode(null)
      setIntegration((prev: any) => (prev ? { ...prev, status: 'DISCONNECTED' } : null))
    } catch (e: any) {
      toast.error(e.message || t('error_disconnect'))
    } finally {
      setIsConnecting(false)
    }
  }

  if (integrationLoading) {
    return (
      <div className="p-20 text-center">
        <Loader2 className="animate-spin h-8 w-8 mx-auto text-muted-foreground" />
      </div>
    )
  }

  const isConnected = integration?.status === 'CONNECTED'
  const isWaiting = integration?.status === 'WAITING_QR'

  return (
    <div className="max-w-3xl mx-auto space-y-8 p-4 md:p-10 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-apple min-h-full">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-foreground">{t('settings')}</h2>
        <p className="text-muted-foreground mt-1 font-medium">{t('settings_desc')}</p>
      </div>

      <div className="space-y-6">
        <Card className="shadow-subtle border border-border/40 rounded-xl bg-card overflow-hidden">
          <CardHeader className="pb-6 pt-8 px-8 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="space-y-2">
              <CardTitle className="flex items-center gap-3 text-xl tracking-tight">
                <div className="bg-green-500/10 text-green-500 p-2.5 rounded-2xl">
                  <MessageCircle className="h-5 w-5" />
                </div>
                {t('whatsapp_connection')}
              </CardTitle>
              <CardDescription className="font-medium text-sm text-muted-foreground max-w-sm">
                {t('whatsapp_connection_desc')}
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 items-end">
              <div
                className={cn(
                  'self-start sm:self-auto px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide border whitespace-nowrap',
                  isConnected
                    ? 'bg-green-500/10 text-green-600 border-green-500/20'
                    : isWaiting
                      ? 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20'
                      : 'bg-muted text-muted-foreground border-border',
                )}
              >
                {isConnected ? t('connected') : isWaiting ? t('waiting_qr') : t('disconnected')}
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-6 px-8">
            <div className="bg-muted/40 border border-border/60 rounded-2xl p-5 flex flex-col gap-3">
              <h4 className="text-sm font-semibold text-foreground tracking-tight uppercase">
                System Instance Details
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Instance Name
                  </span>
                  <span className="text-sm font-medium text-foreground bg-background px-3 py-1.5 rounded-lg border border-border/50 truncate">
                    {integration?.instance_name || 'Not created yet'}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Setup Status
                  </span>
                  <div className="text-sm font-medium text-foreground bg-background px-3 py-1.5 rounded-lg border border-border/50 flex items-center gap-2">
                    {integration?.is_setup_completed ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-green-500" /> Completed
                      </>
                    ) : (
                      'Pending'
                    )}
                  </div>
                </div>
              </div>
            </div>

            {qrCode && isWaiting && (
              <div className="flex flex-col items-center justify-center p-8 border border-border/60 rounded-3xl bg-muted/20 animate-in fade-in zoom-in-95 duration-300">
                <div className="bg-white p-4 rounded-2xl shadow-sm mb-4 relative">
                  <img
                    src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                    alt="WhatsApp QR Code"
                    className="w-56 h-56"
                  />
                  {isConnecting && (
                    <div className="absolute inset-0 bg-white/60 flex items-center justify-center rounded-2xl backdrop-blur-[1px]">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  )}
                </div>
                <h4 className="font-semibold text-foreground mb-1">{t('scan_to_connect')}</h4>
                <p className="text-sm font-medium text-muted-foreground text-center max-w-[250px]">
                  {t('scan_desc')}
                </p>
              </div>
            )}
          </CardContent>

          <CardFooter className="bg-muted/30 border-t border-border/40 py-5 px-8 flex flex-col sm:flex-row gap-4 sm:justify-between sm:items-center">
            <div className="text-sm font-medium text-muted-foreground text-center sm:text-left">
              {isConnected ? t('actively_connected') : t('configure_instance')}
            </div>
            <div className="w-full sm:w-auto">
              {isConnected ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDisconnect}
                  disabled={isConnecting}
                  className="rounded-full px-6 h-11 w-full sm:w-auto font-semibold"
                >
                  {isConnecting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Unplug className="mr-2 h-4 w-4" />
                  )}
                  {t('disconnect_instance')}
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="rounded-full px-6 h-11 w-full sm:w-auto font-semibold"
                >
                  {isConnecting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plug className="mr-2 h-4 w-4" />
                  )}
                  {isWaiting && !qrCode
                    ? t('generating')
                    : isWaiting
                      ? t('refresh_qr')
                      : t('connect_whatsapp')}
                </Button>
              )}
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
