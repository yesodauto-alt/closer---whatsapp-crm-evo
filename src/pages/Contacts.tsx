import { useEffect, useMemo, useState } from 'react'
import { useContacts } from '@/hooks/use-contacts'
import { useLanguage } from '@/hooks/use-language'
import { useOrganization } from '@/hooks/use-organization'
import { supabase } from '@/lib/supabase/client'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Search, Flame, ThermometerSun, Thermometer, Snowflake, Ban, UserRound, MessageSquare, Loader2, Activity, Clock, BookUser } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { ptBR, enUS } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { getBadgeColor } from './Dashboard'
import { cn } from '@/lib/utils'
import { formatContactPhone } from '@/lib/contact-phone'
import type { ConversationSort, PriorityCategory } from '@/lib/types'

const DEFAULT_CATEGORIES: PriorityCategory[] = [
  { code: 'Hot', label: 'Quente', minScore: 80 },
  { code: 'Warm', label: 'Morno', minScore: 60 },
  { code: 'Lukewarm', label: 'Em avaliação', minScore: 40 },
  { code: 'Cold', label: 'Frio', minScore: 1 },
  { code: 'Do Not Contact', label: 'Não contatar', minScore: 0 },
]

const categoryIcon = (code: string) => {
  if (code === 'Hot') return Flame
  if (code === 'Warm') return ThermometerSun
  if (code === 'Lukewarm') return Thermometer
  if (code === 'Cold') return Snowflake
  if (code === 'Do Not Contact') return Ban
  return UserRound
}

type ContactsProps = { mode?: 'contacts' | 'conversations' }

export default function Contacts({ mode = 'contacts' }: ContactsProps) {
  const { language } = useLanguage()
  const { organizationId } = useOrganization()
  const dateLocale = language === 'pt' ? ptBR : enUS
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('All')
  const [conversationSort, setConversationSort] = useState<ConversationSort>('priority')
  const [categories, setCategories] = useState<PriorityCategory[]>(DEFAULT_CATEGORIES)
  const { contacts, loading } = useContacts(search, {
    conversationsOnly: mode === 'conversations',
    sort: conversationSort,
  })
  const navigate = useNavigate()

  useEffect(() => {
    if (!organizationId) return
    void (supabase as any)
      .from('organizations')
      .select('conversation_sort, priority_categories')
      .eq('id', organizationId)
      .single()
      .then(({ data }: any) => {
        if (!data) return
        setConversationSort((data.conversation_sort || 'priority') as ConversationSort)
        if (Array.isArray(data.priority_categories) && data.priority_categories.length) {
          setCategories(data.priority_categories as PriorityCategory[])
        }
      })
  }, [organizationId])

  const filteredContacts = useMemo(() => {
    if (activeTab === 'All') return contacts
    return contacts.filter((contact) => contact.classification === activeTab)
  }, [contacts, activeTab])

  const labelFor = (classification: string | null) => {
    if (!classification) return 'Não classificado'
    return categories.find((category) => category.code === classification)?.label || classification
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            {mode === 'conversations' ? 'Conversas' : 'Contatos'}
          </h2>
          <p className="text-muted-foreground mt-2 font-medium text-base">
            {mode === 'conversations'
              ? conversationSort === 'priority'
                ? 'Fila ordenada pela prioridade da IA e atividade recente.'
                : conversationSort === 'recent'
                  ? 'Fila ordenada pelas conversas mais recentes.'
                  : 'Fila ordenada pelas conversas mais antigas.'
              : 'Agenda e contatos conhecidos dos seus canais.'}
          </p>
        </div>
        <div className="relative w-full md:w-96">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input placeholder="Buscar por nome ou telefone..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-12 h-14" />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full justify-start h-auto flex-wrap bg-transparent p-0 gap-3 mb-8">
          <TabsTrigger value="All" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground border rounded-full px-5 py-2.5 flex gap-2">
            <UserRound className="h-4 w-4" /> Todos <span className="text-xs font-bold">{contacts.length}</span>
          </TabsTrigger>
          {categories.map((category) => {
            const Icon = categoryIcon(category.code)
            const count = contacts.filter((contact) => contact.classification === category.code).length
            return (
              <TabsTrigger key={category.code} value={category.code} className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground border rounded-full px-5 py-2.5 flex gap-2">
                <Icon className="h-4 w-4" /> {category.label} <span className="text-xs font-bold">{count}</span>
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="p-24 flex justify-center bg-card rounded-xl border"><Loader2 className="h-10 w-10 animate-spin text-muted-foreground/50" /></div>
      ) : filteredContacts.length === 0 ? (
        <div className="text-center py-32 bg-card rounded-xl border">
          <div className="bg-muted w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5"><UserRound className="h-9 w-9 text-muted-foreground" /></div>
          <h3 className="text-xl font-bold">Nenhum {mode === 'conversations' ? 'atendimento' : 'contato'} encontrado</h3>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredContacts.map((contact) => (
            <div key={contact.id} className="group relative flex flex-col bg-card rounded-xl p-6 border border-border/60 shadow-subtle hover:shadow-elevation transition-all cursor-pointer" onClick={() => contact.has_conversation && navigate(`/app/chat/${contact.id}`)}>
              <div className="flex justify-between items-start mb-5">
                <Avatar className="h-14 w-14 border-2 border-background shadow-sm">
                  <AvatarImage src={contact.profile_picture_url || ''} />
                  <AvatarFallback className="bg-muted font-bold text-lg">{contact.push_name?.charAt(0) || '#'}</AvatarFallback>
                </Avatar>
                {contact.has_conversation ? (
                  <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 rounded-full" onClick={(e) => { e.stopPropagation(); navigate(`/app/chat/${contact.id}`) }}>
                    <MessageSquare className="h-5 w-5" />
                  </Button>
                ) : contact.is_address_book ? (
                  <Badge variant="outline" className="gap-1"><BookUser className="h-3 w-3" /> Agenda</Badge>
                ) : null}
              </div>

              <div className="mb-6 flex-1">
                <h3 className="font-bold text-xl tracking-tight line-clamp-1 mb-1">{contact.push_name || 'Desconhecido'}</h3>
                <p className="text-sm font-semibold text-muted-foreground truncate">{formatContactPhone(contact) || '—'}</p>
              </div>

              <div className="flex flex-col gap-4 mt-auto pt-5 border-t border-border/40">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className={cn('font-bold text-[11px] px-3 py-1 rounded-full', getBadgeColor(contact.classification))}>
                    {labelFor(contact.classification)}
                  </Badge>
                  <div className="flex items-center gap-1.5 text-sm font-bold"><Activity className="h-4 w-4 text-muted-foreground/70" /><span>{contact.score ?? '-'}</span></div>
                </div>
                <div className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground/80">
                  <Clock className="h-3.5 w-3.5" />
                  <span>{contact.last_message_at ? formatDistanceToNow(new Date(contact.last_message_at), { addSuffix: true, locale: dateLocale }) : contact.is_address_book ? 'Na agenda' : 'Sem atividade'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
