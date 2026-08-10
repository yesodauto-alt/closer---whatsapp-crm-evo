import { useState, useEffect, useRef } from 'react'
import { useIntegration } from '@/hooks/use-integration'
import { useLanguage } from '@/hooks/use-language'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Loader2, Smartphone, BrainCircuit, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'

export default function Onboarding() {
  const { integration, setIntegration } = useIntegration()
  const { t } = useLanguage()
  const navigate = useNavigate()

  const [step, setStep] = useState(1)
  const [qrCode, setQrCode] = useState<string | null>(null)

  const [syncStatus, setSyncStatus] = useState<string>('')
  const [progress, setProgress] = useState(0)

  const syncStarted = useRef(false)

  // Fast-fail redirect if setup is already completed to prevent loop
  useEffect(() => {
    if (integration?.is_setup_completed) {
      navigate('/app', { replace: true })
    }
  }, [integration?.is_setup_completed, navigate])

  useEffect(() => {
    let interval: NodeJS.Timeout
    if (step === 1 && integration?.status !== 'CONNECTED') {
      const fetchQR = async () => {
        if (!integration?.id) return
        try {
          const { data } = await supabase.functions.invoke('evolution-get-qr')
          if (data?.base64) {
            setQrCode(data.base64)
            if (integration.status !== 'WAITING_QR') {
              setIntegration((prev: any) => (prev ? { ...prev, status: 'WAITING_QR' } : null))
            }
          }
          if (data?.connected) {
            setIntegration((prev: any) => (prev ? { ...prev, status: 'CONNECTED' } : null))
            setStep(2)
          }
        } catch (e) {
          // Silent catch to prevent console spam
        }
      }
      fetchQR()
      interval = setInterval(fetchQR, 5000)
    } else if (step === 1 && integration?.status === 'CONNECTED') {
      setStep(2)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [step, integration?.id, integration?.status, setIntegration])

  useEffect(() => {
    if (step === 2 && !syncStarted.current) {
      syncStarted.current = true
      handleSync()
    }
  }, [step])

  // Improved polling to prevent indefinite loops
  const pollJob = async (jobId: string, maxSeconds: number = 10) => {
    return new Promise<void>((resolve) => {
      let attempts = 0
      const maxAttempts = Math.ceil(maxSeconds / 2)

      const interval = setInterval(async () => {
        attempts++
        const { data, error } = await supabase
          .from('import_jobs')
          .select('status')
          .eq('id', jobId)
          .single()

        if (
          error ||
          data?.status === 'failed' ||
          data?.status === 'completed' ||
          attempts >= maxAttempts
        ) {
          clearInterval(interval)
          resolve() // Resolve rather than reject to avoid blocking the user flow
        }
      }, 2000)
    })
  }

  const handleSync = async () => {
    const currentIntegrationId = integration?.id

    const completeSetup = async () => {
      try {
        if (currentIntegrationId) {
          const { error } = await supabase
            .from('user_integrations')
            .update({ is_setup_completed: true })
            .eq('id', currentIntegrationId)

          if (!error) {
            // Verify persistence state matches
            const { data } = await supabase
              .from('user_integrations')
              .select('is_setup_completed')
              .eq('id', currentIntegrationId)
              .single()

            if (data?.is_setup_completed) {
              setIntegration((prev: any) => (prev ? { ...prev, is_setup_completed: true } : null))
            }
          }
        }
      } catch (err) {
        // Fallback optimistic update to ensure we don't trap the user
        setIntegration((prev: any) => (prev ? { ...prev, is_setup_completed: true } : null))
      } finally {
        navigate('/app', { replace: true })
      }
    }

    try {
      setSyncStatus(t('downloading_contacts'))
      setProgress(20)
      const { data: cData } = await supabase.functions.invoke('evolution-sync-contacts')
      if (cData?.job_id) await pollJob(cData.job_id, 10)

      setSyncStatus(t('downloading_messages'))
      setProgress(50)
      const { data: mData } = await supabase.functions.invoke('evolution-sync-messages')
      if (mData?.job_id) await pollJob(mData.job_id, 10)

      setSyncStatus(t('ai_classifying'))
      setProgress(75)

      const { data: aData } = await supabase.functions.invoke('ai-classify-contacts')
      if (aData?.job_id) await pollJob(aData.job_id, 10)

      setProgress(100)
      setSyncStatus(t('setup_complete') || 'Integração concluída! Redirecionando para o CRM...')
      toast.success(t('onboarding_complete'))

      setTimeout(completeSetup, 1000)
    } catch (err: any) {
      toast.error(err.message || t('sync_failed_onboarding'))
      setSyncStatus(t('error_setup'))

      setTimeout(completeSetup, 1500)
    }
  }

  return (
    <div className="w-full max-w-lg mx-auto p-4">
      <Card className="shadow-elevation border border-border/40 rounded-[2.5rem] bg-card">
        <CardHeader className="text-center space-y-6 pb-6 pt-12">
          <div className="flex justify-center mb-2">
            <div className="flex items-center gap-3">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${step >= 1 ? 'bg-primary text-primary-foreground shadow-md' : 'bg-muted text-muted-foreground'}`}
              >
                <Smartphone size={20} />
              </div>
              <div
                className={`w-10 h-0.5 transition-colors ${step >= 2 ? 'bg-primary' : 'bg-border'}`}
              ></div>
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${step >= 2 ? 'bg-primary text-primary-foreground shadow-md' : 'bg-muted text-muted-foreground'}`}
              >
                <BrainCircuit size={20} />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <CardTitle className="text-3xl font-semibold tracking-tight">
              {step === 1 && t('link_whatsapp')}
              {step === 2 && t('setting_up_crm')}
            </CardTitle>
            <CardDescription className="text-[15px] font-medium px-4 text-muted-foreground">
              {step === 1 && t('scan_qr_desc')}
              {step === 2 && t('please_wait_sync')}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="px-10 pb-12">
          {step === 1 && (
            <div className="flex flex-col items-center py-4 space-y-8">
              {qrCode ? (
                <div className="p-4 bg-white rounded-3xl shadow-elevation border border-border/40 animate-in fade-in zoom-in-95 duration-500">
                  <img
                    src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                    alt="WhatsApp QR"
                    className="w-56 h-56 rounded-xl"
                  />
                </div>
              ) : (
                <div className="w-64 h-64 bg-muted/50 flex items-center justify-center rounded-3xl border border-dashed border-border">
                  <Loader2 className="animate-spin h-10 w-10 text-muted-foreground" />
                </div>
              )}
              <p className="text-[13px] text-muted-foreground font-medium text-center max-w-xs leading-relaxed">
                {t('open_whatsapp_scan')}
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="py-10 space-y-8 text-center animate-in fade-in duration-500">
              <Progress value={progress} className="h-2" />
              <div className="flex items-center justify-center gap-3 text-lg font-semibold text-foreground">
                {progress >= 100 ? (
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                )}
                {syncStatus}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
