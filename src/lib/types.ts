export interface UserIntegration {
  id: string
  user_id: string
  evolution_api_url: string | null
  evolution_api_key: string | null
  instance_name: string | null
  status: 'DISCONNECTED' | 'WAITING_QR' | 'CONNECTED'
  is_setup_completed?: boolean
  is_webhook_enabled?: boolean
  created_at: string
}

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
  created_at: string
}

export interface WhatsAppMessage {
  id: string
  user_id: string
  contact_id: string
  message_id: string
  from_me: boolean
  text: string | null
  type: string | null
  timestamp: string
  raw: any
}
