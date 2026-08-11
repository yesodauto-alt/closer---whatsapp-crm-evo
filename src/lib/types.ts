export interface UserIntegration {
  id: string
  user_id: string
  channel_id?: string | null
  provider?: string
  is_primary?: boolean
  evolution_api_url: string | null
  evolution_api_key: string | null
  instance_name: string | null
  status: 'DISCONNECTED' | 'WAITING_QR' | 'CONNECTING' | 'CONNECTED'
  is_setup_completed?: boolean
  is_webhook_enabled?: boolean
  created_at: string
}

export interface Channel {
  id: string
  organization_id: string
  name: string
  type: 'whatsapp' | 'email' | 'telegram'
  provider: 'evolution' | 'meta_cloud' | 'email' | 'telegram'
  status: string
  phone_number: string | null
  is_active: boolean
  metadata: Record<string, any>
  created_by: string | null
  last_sync_at: string | null
  created_at: string
  updated_at: string
}

export interface PriorityCategory {
  code: string
  label: string
  minScore: number
  color?: string
}

export type ConversationSort = 'priority' | 'recent' | 'oldest'

export interface AIAgent {
  id: string
  user_id: string
  organization_id: string | null
  name: string
  description: string | null
  system_prompt: string
  provider: 'openai'
  model: 'gpt-4.1-mini' | 'gpt-4o-mini' | 'gpt-4.1' | 'gpt-4o'
  agent_type: 'marketing' | 'sales' | 'sdr' | 'support' | 'administrative' | 'custom'
  color: string
  tone: string | null
  objectives: string | null
  restrictions: string | null
  knowledge_base_enabled: boolean
  team_id: string | null
  triage_enabled: boolean
  triage_instructions: string | null
  triage_history_limit: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type AppRole = 'super_admin' | 'admin' | 'team_lead' | 'agent'

export interface OrganizationMembership {
  organization_id: string
  role: AppRole
  organization: {
    id: string
    name: string
    slug: string
    owner_user_id: string
  }
}

export interface Product {
  id: string
  organization_id: string
  item_type: 'product' | 'service'
  sku: string | null
  name: string
  description: string | null
  category: string | null
  unit: string
  cost: number
  price: number
  currency: string
  image_url: string | null
  is_active: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export interface WhatsAppContact {
  id: string
  user_id: string
  integration_id?: string | null
  remote_jid: string
  lid_jid?: string | null
  phone_number: string | null
  push_name: string | null
  profile_picture_url: string | null
  last_message_at: string | null
  classification: string | null
  score: number | null
  ai_analysis_summary: string | null
  ai_agent_id: string | null
  pipeline_stage?: string | null
  is_address_book?: boolean
  has_conversation?: boolean
  classification_updated_at?: string | null
  created_at: string
}

export interface WhatsAppMessage {
  id: string
  user_id: string
  integration_id?: string | null
  contact_id: string
  message_id: string
  from_me: boolean
  text: string | null
  type: string | null
  timestamp: string
  raw: any
}
