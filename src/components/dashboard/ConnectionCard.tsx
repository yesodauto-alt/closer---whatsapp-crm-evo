import { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Smartphone,
  Loader2,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  PowerOff,
  ShieldCheck,
} from 'lucide-react'
import { useIntegration } from '@/hooks/use-integration'
import { supabase } from '@/lib/supabase/client'
import { toast } from 'sonner'

export function ConnectionCard() {
  const { integration, setIntegration, loading: integrationLoading } = useIntegration()
  const [loading, setLoading] = useState(false)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const qrAttempted = useRef(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const fetchQR = useCallback(async () => {
    if (!integration?.id) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('evolution-get-qr')

      if (invokeError) {
        throw new Error(invokeError.message || 'Unknown error calling Edge Function')
      }

      if (data?.connected) {
        setIntegration({ ...integration, status: 'CONNECTED' })
        setQrCode(null)
        return
      }

      if (data?.error === 'qr_not_ready_yet' || data?.creating) {
        if (integration.status !== 'WAITING_QR') {
          setIntegration({ ...integration, status: 'WAITING_QR' })
        }
        return
      }

      if (data?.error) {
        throw new Error(data.error)
      }

      if (data?.base64) {
        setQrCode(data.base64)
        if (integration.status !== 'WAITING_QR') {
          setIntegration({ ...integration, status: 'WAITING_QR' })
        }
      }
    } catch (err: any) {
      console.error(err)
      setError(err.message || 'Service temporarily unavailable. Please contact support.')
    } finally {
      setLoading(false)
    }
  }, [integration, setIntegration])

  useEffect(() => {
    if (!integration || integrationLoading || error) return

    if (integration.status === 'DISCONNECTED' || integration.status === 'WAITING_QR') {
      if (!qrAttempted.current && !qrCode) {
        qrAttempted.current = true
        fetchQR()
      }

      timerRef.current = setInterval(() => {
        fetchQR()
      }, 10000)

      return () => {
        if (timerRef.current) clearInterval(timerRef.current)
      }
    }
  }, [integration, qrCode, fetchQR, integrationLoading, error])

  useEffect(() => {
    if (integration?.status === 'CONNECTED') {
      setQrCode(null)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [integration?.status])

  const handleDisconnect = async () => {
    if (!integration?.id) return
    setLoading(true)
    setError(null)
    try {
      const { error: invokeError } = await supabase.functions.invoke('evolution-disconnect', {})
      if (invokeError) throw new Error(invokeError.message || 'Failed to disconnect')
      setIntegration({ ...integration, status: 'DISCONNECTED' })
      setQrCode(null)
      toast.success('Disconnected from WhatsApp')
    } catch (err: any) {
      console.error(err)
      setError(err.message || 'Failed to disconnect')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = async () => {
    if (!integration?.id) return
    setLoading(true)
    setError(null)
    await supabase
      .from('user_integrations')
      .update({ status: 'DISCONNECTED' })
      .eq('id', integration.id)
    setIntegration({ ...integration, status: 'DISCONNECTED' })
    qrAttempted.current = false
    setQrCode(null)
    setLoading(false)
  }

  const handleRetry = () => {
    setError(null)
    qrAttempted.current = false
    fetchQR()
  }

  if (integrationLoading) {
    return (
      <Card className="shadow-subtle border-border/40 rounded-3xl">
        <CardHeader className="pb-4">
          <Skeleton className="h-6 w-48 mb-2 rounded-md" />
          <Skeleton className="h-4 w-64 rounded-md" />
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center p-6 min-h-[250px]">
            <Skeleton className="w-48 h-48 rounded-2xl" />
          </div>
        </CardContent>
      </Card>
    )
  }

  const status = integration?.status || 'DISCONNECTED'

  return (
    <Card className="shadow-subtle border-border/40 rounded-3xl overflow-hidden relative bg-white">
      {status === 'CONNECTED' && <div className="absolute top-0 left-0 w-full h-1 bg-zinc-900" />}
      <CardHeader className="pb-4 px-8 pt-8">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg font-semibold">
              <Smartphone className="h-5 w-5 text-zinc-400" /> WhatsApp Connection
            </CardTitle>
            <CardDescription className="mt-1 font-medium">
              Link your account to sync data
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className={
              status === 'CONNECTED'
                ? 'bg-zinc-100 text-zinc-900 border-zinc-200'
                : status === 'WAITING_QR'
                  ? 'bg-zinc-50 text-zinc-500 border-zinc-200'
                  : 'bg-white text-zinc-400 border-zinc-200'
            }
          >
            {status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-8 pb-8">
        {error ? (
          <div className="flex flex-col items-center justify-center p-6 bg-zinc-50 border border-zinc-200 rounded-2xl text-center min-h-[250px]">
            <AlertCircle className="h-8 w-8 text-zinc-400 mb-3 shrink-0" />
            <div className="w-full overflow-hidden">
              <p className="text-sm font-medium text-zinc-700 break-words whitespace-pre-wrap px-2">
                {error}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              className="mt-4 bg-white shrink-0 rounded-full"
            >
              Try Again
            </Button>
          </div>
        ) : (
          <>
            {status === 'DISCONNECTED' && (
              <div className="flex flex-col items-center justify-center p-6 border border-dashed border-zinc-300 rounded-2xl bg-zinc-50 min-h-[250px]">
                <Loader2 className="h-8 w-8 animate-spin text-zinc-400 mb-4" />
                <p className="text-sm font-medium text-zinc-700">Preparing connection...</p>
                <p className="text-xs text-zinc-500 mt-1 text-center max-w-xs font-medium">
                  Setting up your dedicated WhatsApp instance
                </p>
                <div className="flex gap-2 mt-5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRetry}
                    disabled={loading}
                    className="text-xs rounded-full bg-white"
                  >
                    <RefreshCw className={`mr-2 h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Force
                    Retry
                  </Button>
                </div>
              </div>
            )}

            {status === 'WAITING_QR' && (
              <div className="flex flex-col items-center justify-center p-4 min-h-[250px]">
                {qrCode ? (
                  <div className="p-4 bg-white rounded-2xl shadow-subtle border border-zinc-100 animate-in fade-in zoom-in-95 duration-500 relative group">
                    <img src={qrCode} alt="WhatsApp QR Code" className="w-48 h-48 rounded-xl" />
                    {loading && (
                      <div className="absolute inset-0 bg-white/60 flex items-center justify-center rounded-2xl backdrop-blur-[1px]">
                        <Loader2 className="h-8 w-8 animate-spin text-zinc-800" />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center w-48 h-48 bg-zinc-50 rounded-2xl border border-dashed border-zinc-200">
                    <Loader2 className="h-8 w-8 text-zinc-300 animate-spin mb-3" />
                    <p className="text-xs text-zinc-500 font-medium">Generating QR Code...</p>
                  </div>
                )}
                <div className="flex gap-2 mt-6">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchQR}
                    disabled={loading}
                    className="rounded-full"
                  >
                    <RefreshCw className={`mr-2 h-3 w-3 ${loading ? 'animate-spin' : ''}`} />{' '}
                    Refresh QR
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReset}
                    disabled={loading}
                    className="rounded-full"
                  >
                    <PowerOff className="mr-2 h-3 w-3" /> Restart
                  </Button>
                </div>
                <p className="text-xs text-zinc-500 mt-4 text-center max-w-xs font-medium">
                  Open WhatsApp on your phone, go to Settings &gt; Linked Devices, and scan this
                  code.
                </p>
              </div>
            )}

            {status === 'CONNECTED' && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-6 bg-zinc-50 text-zinc-900 rounded-2xl border border-zinc-100 animate-in fade-in slide-in-from-bottom-2 min-h-[150px]">
                <div className="flex items-center gap-4">
                  <div className="relative p-2 bg-white rounded-full shadow-sm">
                    <CheckCircle2 className="h-6 w-6 text-zinc-900 shrink-0" />
                    {integration.is_webhook_enabled && (
                      <div
                        className="absolute -bottom-1 -right-1 bg-green-500 rounded-full border-2 border-white p-0.5"
                        title="Webhook Enabled"
                      >
                        <ShieldCheck className="h-3 w-3 text-white" />
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="font-semibold text-base">Successfully Connected</p>
                    <p className="text-sm text-zinc-500 font-medium mt-0.5">
                      Your WhatsApp is linked. Ready to sync.
                    </p>
                    {!integration.is_webhook_enabled && (
                      <p className="text-xs text-amber-600 font-medium mt-1 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Webhook not enabled. Messages may not sync automatically.
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={loading}
                  className="shrink-0 bg-white hover:bg-zinc-100 border-zinc-200 text-zinc-600 rounded-full"
                >
                  <PowerOff className="mr-2 h-3 w-3" /> Disconnect
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
