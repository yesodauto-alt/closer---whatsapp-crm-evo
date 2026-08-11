import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

type PriorityCategory = {
  code: string
  label: string
  minScore: number
  color?: string
}

const DEFAULT_CATEGORIES: PriorityCategory[] = [
  { code: 'Hot', label: 'Quente', minScore: 80 },
  { code: 'Warm', label: 'Morno', minScore: 60 },
  { code: 'Lukewarm', label: 'Em avaliação', minScore: 40 },
  { code: 'Cold', label: 'Frio', minScore: 1 },
  { code: 'Do Not Contact', label: 'Não contatar', minScore: 0 },
]

function categoriesFrom(value: unknown): PriorityCategory[] {
  if (!Array.isArray(value)) return DEFAULT_CATEGORIES
  const categories = value
    .map((item: any) => ({
      code: String(item?.code ?? '').trim(),
      label: String(item?.label ?? item?.code ?? '').trim(),
      minScore: Math.max(0, Math.min(100, Number(item?.minScore) || 0)),
      color: item?.color ? String(item.color) : undefined,
    }))
    .filter((item) => item.code && item.label)
  return categories.length ? categories : DEFAULT_CATEGORIES
}

function outputText(payload: any) {
  if (typeof payload?.output_text === 'string') return payload.output_text
  return (payload?.output ?? [])
    .flatMap((item: any) => item?.content ?? [])
    .filter((content: any) => content?.type === 'output_text')
    .map((content: any) => content?.text ?? '')
    .join('\n')
    .trim()
}

function fallbackCategory(categories: PriorityCategory[], score: number) {
  const sorted = [...categories].sort((a, b) => b.minScore - a.minScore)
  return sorted.find((category) => score >= category.minScore)?.code ?? sorted.at(-1)?.code ?? 'Cold'
}

export async function triageContact(
  db: SupabaseClient,
  contactId: string,
  options: { force?: boolean } = {},
) {
  const openaiKey = (Deno.env.get('OPENAI_API_KEY') ?? '').trim()
  if (!openaiKey) return { success: false, skipped: true, reason: 'openai_not_configured' }

  const { data: contact, error: contactError } = await db
    .from('whatsapp_contacts')
    .select('id, user_id, ai_agent_id, has_conversation')
    .eq('id', contactId)
    .maybeSingle()
  if (contactError || !contact) {
    return { success: false, skipped: true, reason: 'contact_not_found' }
  }
  if (!contact.has_conversation) {
    return { success: false, skipped: true, reason: 'contact_has_no_conversation' }
  }

  const { data: organization } = await db
    .from('organizations')
    .select('id, auto_triage_enabled, triage_agent_id, priority_categories')
    .eq('owner_user_id', contact.user_id)
    .maybeSingle()
  if (!organization) return { success: false, skipped: true, reason: 'organization_not_found' }
  if (!options.force && !organization.auto_triage_enabled) {
    return { success: false, skipped: true, reason: 'auto_triage_disabled' }
  }

  let agent: any = null
  const preferredAgentId = organization.triage_agent_id || contact.ai_agent_id
  if (preferredAgentId) {
    const { data } = await db
      .from('ai_agents')
      .select('id, name, model, objectives, triage_enabled, triage_instructions, triage_history_limit, is_active')
      .eq('id', preferredAgentId)
      .eq('organization_id', organization.id)
      .eq('is_active', true)
      .maybeSingle()
    agent = data
  }

  if (!agent) {
    const { data } = await db
      .from('ai_agents')
      .select('id, name, model, objectives, triage_enabled, triage_instructions, triage_history_limit, is_active')
      .eq('organization_id', organization.id)
      .eq('is_active', true)
      .eq('triage_enabled', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    agent = data
  }

  if (!agent) return { success: false, skipped: true, reason: 'triage_agent_not_configured' }

  const historyLimit = Math.max(5, Math.min(200, Number(agent.triage_history_limit) || 40))
  const { data: messages, error: messageError } = await db
    .from('whatsapp_messages')
    .select('from_me, text, timestamp')
    .eq('contact_id', contact.id)
    .order('timestamp', { ascending: false })
    .limit(historyLimit)
  if (messageError) return { success: false, skipped: true, reason: messageError.message }

  const transcript = (messages ?? [])
    .filter((message: any) => String(message?.text ?? '').trim())
    .reverse()
    .map((message: any) => `${message.from_me ? 'EMPRESA' : 'CLIENTE'}: ${String(message.text).trim()}`)
    .join('\n')
  if (!transcript) return { success: false, skipped: true, reason: 'no_text_history' }

  const categories = categoriesFrom(organization.priority_categories)
  const codes = categories.map((category) => category.code)
  const categoryGuide = categories
    .map((category) => `${category.code} (${category.label})`)
    .join(', ')

  const instructions = [
    'Você é um agente interno de triagem comercial de CRM.',
    'Analise o histórico completo fornecido e classifique a prioridade atual do contato.',
    'Considere intenção de compra, urgência, objeções, engajamento, estágio da negociação e pedidos explícitos para não ser contatado.',
    `Categorias permitidas: ${categoryGuide}.`,
    'O score deve ir de 0 a 100, onde 100 exige ação comercial imediata.',
    agent.objectives ? `Objetivos comerciais: ${agent.objectives}` : '',
    agent.triage_instructions ? `Regras específicas de triagem: ${agent.triage_instructions}` : '',
    'Não invente fatos que não estejam no histórico.',
  ].filter(Boolean).join('\n\n')

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: agent.model || 'gpt-4.1-mini',
      store: false,
      instructions,
      input: transcript,
      max_output_tokens: 300,
      text: {
        format: {
          type: 'json_schema',
          name: 'crm_lead_triage',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              category: { type: 'string', enum: codes },
              score: { type: 'integer', minimum: 0, maximum: 100 },
              summary: { type: 'string' },
            },
            required: ['category', 'score', 'summary'],
          },
        },
      },
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    console.error('[triage] OpenAI failed', {
      contactId,
      status: response.status,
      error: payload?.error?.message ?? 'unknown',
    })
    return { success: false, skipped: false, reason: payload?.error?.message || `OpenAI HTTP ${response.status}` }
  }

  let parsed: any = null
  try {
    parsed = JSON.parse(outputText(payload))
  } catch {
    return { success: false, skipped: false, reason: 'invalid_structured_output' }
  }

  const score = Math.max(0, Math.min(100, Math.round(Number(parsed?.score) || 0)))
  const category = codes.includes(String(parsed?.category))
    ? String(parsed.category)
    : fallbackCategory(categories, score)
  const summary = String(parsed?.summary ?? '').trim().slice(0, 4000)
  const now = new Date().toISOString()

  const { error: updateError } = await db
    .from('whatsapp_contacts')
    .update({
      classification: category,
      score,
      ai_analysis_summary: summary || null,
      classification_updated_at: now,
    })
    .eq('id', contact.id)

  if (updateError) return { success: false, skipped: false, reason: updateError.message }

  return {
    success: true,
    skipped: false,
    contactId: contact.id,
    agentId: agent.id,
    category,
    score,
    summary,
  }
}
