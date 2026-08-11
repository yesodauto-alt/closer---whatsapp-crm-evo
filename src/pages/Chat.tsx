import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { useAgents } from '@/hooks/use-agents'
import { useLanguage, TranslationKey } from '@/hooks/use-language'
import { WhatsAppContact, WhatsAppMessage } from '@/lib/types'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ArrowLeft, CalendarClock, Send, Sparkles, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { format, isToday, isYesterday } from 'date-fns'
import { ptBR, enUS } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { formatContactPhone } from '@/lib/contact-phone'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useScheduledMessages } from '@/hooks/use-scheduled-messages'
import { useConversationAssignment } from '@/hooks/use-conversation-assignment'

export default function Chat() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { agents } = useAgents()
  const { t, language } = useLanguage()
  const dateLocale = language === 'pt' ? ptBR : enUS

  const [contact, setContact] = useState<WhatsAppContact | null>(null)
  const [messages, setMessages] = useState<WhatsAppMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [newMessage, setNewMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleText, setScheduleText] = useState('')
  const [isScheduling, setIsScheduling] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { scheduledMessages, schedule, cancel } = useScheduledMessages(id)
  const { teams, assignment, canAssign, assignTeam } = useConversationAssignment(id)

  useEffect(() => {
    if (!user || !id) return

    const fetchChat = async () => {
      const { data: contactData } = await supabase
        .from('whatsapp_contacts')
        .select('*')
        .eq('id', id)
        .single()

      if (contactData) setContact(contactData)

      const { data: messagesData } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('contact_id', id)
        .order('timestamp', { ascending: true })

      if (messagesData) setMessages(messagesData)
      setLoading(false)
      scrollToBottom()
    }

    fetchChat()

    const channel = supabase
      .channel(`chat_${id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'whatsapp_messages',
          filter: `contact_id=eq.${id}`,
        },
        (payload) => {
          setMessages((prev) => {
            if (prev.find((m) => m.id === payload.new.id)) return prev
            return [...prev, payload.new as WhatsAppMessage]
          })
          scrollToBottom()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, id])

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 100)
  }

  const handleAgentChange = async (value: string) => {
    // Treat 'none_disable' as a proxy for no agent assigned (null in database)
    const newAgentId = value === 'none_disable' ? null : value
    const { error } = await supabase
      .from('whatsapp_contacts')
      .update({ ai_agent_id: newAgentId })
      .eq('id', id)

    if (error) {
      toast.error(t('error_save' as TranslationKey) || 'Failed to save changes')
    } else {
      setContact((prev) => (prev ? { ...prev, ai_agent_id: newAgentId } : null))
      toast.success(
        newAgentId
          ? t('agent_assigned' as TranslationKey) || 'Agent assigned'
          : t('agent_removed' as TranslationKey) || 'Agent removed',
      )
    }
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || !contact) return

    const text = newMessage.trim()
    setNewMessage('')
    setIsSending(true)

    try {
      const { data, error } = await supabase.functions.invoke('organization-send-message', {
        body: { contactId: contact.id, text },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
    } catch (err: any) {
      toast.error(err.message || 'Failed to send message')
    } finally {
      setIsSending(false)
    }
  }

  const handleSchedule = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!scheduleText.trim() || !scheduleDate) return
    setIsScheduling(true)
    try {
      await schedule(scheduleText, new Date(scheduleDate))
      setScheduleText('')
      setScheduleDate('')
      setScheduleOpen(false)
    } catch (error: any) {
      toast.error(error?.message || 'Não foi possível agendar')
    } finally {
      setIsScheduling(false)
    }
  }

  const formatMessageTime = (dateStr: string) => {
    const date = new Date(dateStr)
    return format(date, 'HH:mm')
  }

  const formatMessageDate = (dateStr: string) => {
    const date = new Date(dateStr)
    if (isToday(date)) return language === 'pt' ? 'Hoje' : 'Today'
    if (isYesterday(date)) return language === 'pt' ? 'Ontem' : 'Yesterday'
    return format(date, 'dd/MM/yyyy', { locale: dateLocale })
  }

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/50" />
      </div>
    )
  }

  if (!contact) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-12">
        <p className="text-muted-foreground font-medium">{t('no_contacts_found')}</p>
        <Button
          variant="outline"
          onClick={() => navigate('/app/contacts')}
          className="rounded-full"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('return_home')}
        </Button>
      </div>
    )
  }

  const groupedMessages: { [key: string]: WhatsAppMessage[] } = {}
  messages.forEach((msg) => {
    const dateStr = formatMessageDate(msg.timestamp || msg.created_at || new Date().toISOString())
    if (!groupedMessages[dateStr]) groupedMessages[dateStr] = []
    groupedMessages[dateStr].push(msg)
  })

  return (
    <div className="max-w-5xl mx-auto h-[calc(100vh-theme(spacing.20))] sm:h-[calc(100vh-theme(spacing.24))] p-4 sm:p-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-apple">
      <div className="w-full h-full flex flex-col bg-card border border-border/60 shadow-elevation rounded-xl sm:rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-5 bg-background/50 backdrop-blur-xl border-b border-border/40 z-10 shrink-0">
          <div className="flex items-center gap-3 sm:gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full shrink-0 -ml-2 hover:bg-muted"
              onClick={() => navigate('/app/contacts')}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Avatar className="h-10 w-10 sm:h-12 sm:w-12 border border-border shadow-sm">
              <AvatarImage src={contact.profile_picture_url || ''} />
              <AvatarFallback className="bg-muted text-foreground font-bold text-lg">
                {contact.push_name?.charAt(0) || '#'}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col max-w-[140px] sm:max-w-[260px]">
              <span className="font-bold text-[15px] sm:text-[17px] tracking-tight truncate text-foreground leading-tight">
                {contact.push_name || t('unknown')}
              </span>
              <span className="text-[12px] sm:text-[13px] font-semibold text-muted-foreground truncate">
                {formatContactPhone(contact) || '—'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {canAssign && teams.length > 0 && (
              <Select
                value={assignment?.team_id}
                onValueChange={(teamId) =>
                  assignTeam(teamId).catch((error) =>
                    toast.error(error?.message || 'Não foi possível atribuir a conversa'),
                  )
                }
              >
                <SelectTrigger className="hidden h-10 w-[150px] rounded-full sm:flex">
                  <SelectValue placeholder="Atribuir equipe" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex items-center gap-2 bg-muted/30 p-1 sm:p-1.5 rounded-full border border-border/40">
              <div className="hidden sm:flex items-center justify-center h-8 w-8 rounded-full bg-primary/10 text-primary shrink-0 ml-1">
                <Sparkles className="h-4 w-4" />
              </div>
              <Select
                value={contact.ai_agent_id || 'none_disable'}
                onValueChange={handleAgentChange}
              >
                <SelectTrigger className="w-[120px] sm:w-[160px] h-8 sm:h-9 rounded-full bg-transparent border-transparent shadow-none font-bold text-[11px] sm:text-[13px] hover:bg-muted/60 transition-colors focus:ring-0 focus:ring-offset-0 px-3">
                  <SelectValue placeholder={t('no_agent' as TranslationKey) || 'No Agent'} />
                </SelectTrigger>
                <SelectContent className="rounded-2xl border-border/60 shadow-elevation">
                  <SelectItem
                    value="none_disable"
                    className="font-bold text-muted-foreground text-xs sm:text-sm cursor-pointer hover:bg-accent focus:bg-accent rounded-xl py-2.5"
                  >
                    {t('no_agent' as TranslationKey) || 'No Agent'}
                  </SelectItem>
                  {agents.map((agent) => (
                    <SelectItem
                      key={agent.id}
                      value={agent.id}
                      className="font-bold text-foreground text-xs sm:text-sm cursor-pointer hover:bg-accent focus:bg-accent rounded-xl py-2.5"
                    >
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-zinc-50/30 dark:bg-background/30 scrollbar-thin">
          {Object.entries(groupedMessages).map(([date, msgs]) => (
            <div key={date} className="space-y-6">
              <div className="flex justify-center my-4">
                <span className="bg-card border border-border/40 text-muted-foreground text-[11px] font-bold px-3 py-1 rounded-full shadow-sm tracking-tight">
                  {date}
                </span>
              </div>
              {msgs.map((msg, i) => {
                const isMe = msg.from_me
                const showAvatar = !isMe && (i === 0 || msgs[i - 1].from_me !== isMe)
                return (
                  <div
                    key={msg.id}
                    className={cn('flex w-full', isMe ? 'justify-end' : 'justify-start')}
                  >
                    <div
                      className={cn(
                        'flex max-w-[85%] sm:max-w-[70%] gap-2.5',
                        isMe ? 'flex-row-reverse' : 'flex-row',
                      )}
                    >
                      {!isMe && (
                        <div className="shrink-0 w-8 sm:w-10 flex flex-col justify-end">
                          {showAvatar && (
                            <Avatar className="h-8 w-8 border border-border/40 shadow-sm mb-1">
                              <AvatarImage src={contact.profile_picture_url || ''} />
                              <AvatarFallback className="bg-muted text-[10px] text-foreground font-bold">
                                {contact.push_name?.charAt(0) || '#'}
                              </AvatarFallback>
                            </Avatar>
                          )}
                        </div>
                      )}
                      <div
                        className={cn(
                          'relative px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl sm:rounded-xl flex flex-col shadow-sm text-[14px] sm:text-[15px] leading-relaxed font-medium',
                          isMe
                            ? 'bg-primary text-primary-foreground rounded-br-sm'
                            : 'bg-card border border-border/60 text-foreground rounded-bl-sm',
                        )}
                      >
                        <span className="whitespace-pre-wrap break-words">{msg.text}</span>
                        <span
                          className={cn(
                            'text-[10px] sm:text-[11px] mt-1.5 self-end font-bold opacity-70 tracking-tight',
                            isMe ? 'text-primary-foreground' : 'text-muted-foreground',
                          )}
                        >
                          {formatMessageTime(
                            msg.timestamp || msg.created_at || new Date().toISOString(),
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-3 sm:p-5 bg-background/50 backdrop-blur-xl border-t border-border/40 shrink-0 z-10">
          {scheduledMessages.length > 0 && (
            <div className="mb-3 space-y-2">
              {scheduledMessages.map((scheduled) => (
                <div
                  key={scheduled.id}
                  className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{scheduled.text}</p>
                    <p>
                      {new Date(scheduled.scheduled_for).toLocaleString('pt-BR')} ·{' '}
                      {scheduled.status}
                    </p>
                  </div>
                  {scheduled.status === 'pending' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        cancel(scheduled.id).catch(() =>
                          toast.error('Não foi possível cancelar o agendamento'),
                        )
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          <form onSubmit={handleSendMessage} className="flex gap-2.5 sm:gap-3 items-end">
            <div className="relative flex-1">
              <Input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder={t('type_message' as TranslationKey) || 'Type a message...'}
                className="w-full bg-card border-border shadow-sm rounded-2xl sm:rounded-full h-12 sm:h-14 px-5 sm:px-6 text-[14px] sm:text-[15px] font-medium pr-12 focus-visible:ring-primary/20 transition-all"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-12 w-12 sm:h-14 sm:w-14 rounded-2xl sm:rounded-full shrink-0"
              onClick={() => {
                setScheduleText(newMessage)
                setScheduleOpen(true)
              }}
            >
              <CalendarClock className="h-5 w-5" />
            </Button>
            <Button
              type="submit"
              disabled={isSending || !newMessage.trim()}
              size="icon"
              className="h-12 w-12 sm:h-14 sm:w-14 rounded-2xl sm:rounded-full shrink-0 shadow-subtle hover:scale-105 transition-all duration-300"
            >
              {isSending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5 ml-0.5" />
              )}
            </Button>
          </form>
        </div>
      </div>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="rounded-3xl">
          <form onSubmit={handleSchedule}>
            <DialogHeader>
              <DialogTitle>Agendar mensagem</DialogTitle>
              <DialogDescription>
                A mensagem será colocada na fila e enviada pela integração Evolution.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-5 py-6">
              <div className="space-y-2">
                <Label>Mensagem</Label>
                <Input
                  required
                  value={scheduleText}
                  onChange={(event) => setScheduleText(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Data e hora</Label>
                <Input
                  required
                  type="datetime-local"
                  value={scheduleDate}
                  onChange={(event) => setScheduleDate(event.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setScheduleOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isScheduling}>
                {isScheduling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Agendar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
