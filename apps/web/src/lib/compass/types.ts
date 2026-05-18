// Inflöde — typer
// Hjälper de andra modul-filerna att hålla sig till PocketBase-schemat
// från migration 1700000039 + 1700000049.

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'meeting-booked'
  | 'evaluating'
  | 'accepted'
  | 'declined';

export const LEAD_STATUS_ORDER: LeadStatus[] = [
  'new',
  'contacted',
  'meeting-booked',
  'evaluating',
  'accepted',
  'declined'
];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'Nytt',
  contacted: 'Kontaktad',
  'meeting-booked': 'Möte bokat',
  evaluating: 'Utvärderas',
  accepted: 'Accepterad',
  declined: 'Avböjd'
};

export type FlowType = 'chat' | 'wizard' | 'quiz';

export const FLOW_TYPE_LABEL: Record<FlowType, string> = {
  chat: 'AI-chatt',
  wizard: 'Formulär',
  quiz: 'Quiz'
};

export type SecurityEventKind =
  | 'login'
  | 'logout'
  | 'invite_sent'
  | 'invite_accepted'
  | 'role_change'
  | 'lead_delete'
  | 'lead_export'
  | 'lead_erase'
  | 'module_publish'
  | 'module_unpublish'
  | 'brand_update'
  | 'failed_login'
  | 'rate_limit';

export interface LeadSource {
  id: string;
  key: string;
  label: string;
  icon?: string;
  color?: string;
  sort_order?: number;
}

export interface AiReview {
  strengths: string[];
  risks: string[];
  recommendation: 'pass' | 'maybe' | 'no';
  recommendation_reason: string;
  next_steps: string[];
  generated_at: string;
  model: string;
}

export interface MarketScan {
  market_size: string;
  trend: string;
  competitors: string[];
  differentiators: string[];
  regulation_notes: string;
  fit_for_movexum: string;
  generated_at: string;
  model: string;
}

export interface Lead {
  id: string;
  tenant: string;
  name: string;
  email?: string;
  phone?: string;
  organization?: string;
  idea_summary?: string;
  idea_category?: string;
  source_key: string;
  source_detail?: string;
  status: LeadStatus;
  score?: number;
  score_reasoning?: string;
  assigned_to?: string;
  notes?: string;
  tags?: string[];
  consent_at?: string;
  last_contact_at?: string;
  // Attribution
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  referrer_url?: string;
  landing_module?: string;
  // AI-analyser
  ai_review?: AiReview;
  market_scan?: MarketScan;
  // Konvertering till startup
  converted_startup?: string;
  converted_at?: string;
  created: string;
  updated: string;
}

export interface Conversation {
  id: string;
  tenant: string;
  lead?: string;
  module_slug?: string;
  session_token?: string;
  extracted_data?: Record<string, unknown>;
  status?: 'active' | 'completed' | 'abandoned';
  created: string;
  updated: string;
}

export interface ChatMessage {
  id: string;
  conversation: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokens_in?: number;
  tokens_out?: number;
  model?: string;
  created: string;
}

export interface CompassModule {
  id: string;
  tenant: string;
  slug: string;
  name: string;
  description?: string;
  flow_type: FlowType;
  system_prompt?: string;
  consent_note?: string;
  is_active?: boolean;
  model?: string;
  sort_order?: number;
  // Publik publicering
  public_url_enabled?: boolean;
  target_audience?: string;
  success_message?: string;
  redirect_url?: string;
  theme_color?: string;
  intro_message?: string;
  created: string;
  updated: string;
}

export interface CompassQuestion {
  id: string;
  module: string;
  key: string;
  prompt: string;
  help_text?: string;
  input_type: 'short_text' | 'long_text' | 'choice' | 'multi_choice' | 'scale' | 'email' | 'phone';
  choices?: { value: string; label: string }[];
  required?: boolean;
  sort_order?: number;
}

export interface Attribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  referrer_url?: string;
  landing_module?: string;
}
