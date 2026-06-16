// Inflöde / Startupkompassen — typer
// Hjälper de andra modul-filerna att hålla sig till PocketBase-schemat
// från migration 1700000039 + 1700000049 + 1700000108.

import type { ResultBucket } from '@platform/shared';

export type { ResultBucket };

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

/**
 * Lead-källa för INTERNA förhandsgranskningar (admin-preview på /inflode/m/…
 * och staff-test-chatten /inflode/chat). Leads med den här källan skapas så
 * att staff kan verifiera hela pipelinen, men EXKLUDERAS från all statistik
 * (dashboard, analys, CSV-export) — de är test, inte inflöde.
 */
export const PREVIEW_SOURCE_KEY = 'preview';
export const PREVIEW_SOURCE_LABEL = 'Förhandsgranskning';

export type FlowType = 'chat' | 'wizard' | 'quiz';

export const FLOW_TYPE_LABEL: Record<FlowType, string> = {
  chat: 'AI-chatt',
  wizard: 'Formulär',
  quiz: 'Quiz'
};

/** Besökarens eget val i intag-flödet (migration 1700000125). */
export type ContactPreference = 'contact_me' | 'self_reach';

export const CONTACT_PREFERENCE_LABEL: Record<ContactPreference, string> = {
  contact_me: 'Vill bli kontaktad av Movexum',
  self_reach: 'Hör av sig själv när hen är redo'
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
  /** AI-genererad sammanställning av det inskickade (migration 1700000125). */
  ai_summary?: string;
  /** Besökarens kontaktpreferens (migration 1700000125). */
  contact_preference?: ContactPreference;
  // Quiz-resultat (Startupkompassen)
  quiz_result_bucket?: string;
  quiz_score?: number;
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
  /** Globalt unik slug för den publika URL:en /m/<public_slug> (migration 1700000108). */
  public_slug?: string;
  target_audience?: string;
  success_message?: string;
  redirect_url?: string;
  theme_color?: string;
  intro_message?: string;
  // Startupkompassen — branded publik sida + quiz (migration 1700000108)
  hero_eyebrow?: string;
  welcome_title?: string;
  welcome_body?: string;
  /** Omslagsbild (filnamn på compass_modules.hero_image, migration 1700000122). */
  hero_image?: string;
  chat_persona?: string;
  /** Max antal AI-utbyten i chat-flödet (0 = obegränsat). */
  max_exchanges?: number;
  require_email?: boolean;
  require_phone?: boolean;
  require_organization?: boolean;
  /**
   * Mottagaradresser (komma-/radseparerade) dit nya inflöden mejlas via Resend.
   * Tom → fallback på env MOVEXUM_INFLOW_EMAIL (migration 1700000110).
   */
  notify_emails?: string;
  /** Quiz-resultatprofiler (flow_type === 'quiz'). */
  result_buckets?: ResultBucket[];
  /**
   * Nästa modul i kedjan (relation→compass_modules, migration 1700000124).
   * När satt erbjuds besökaren att fortsätta till den modulen efter att den
   * här slutförts. Pekar alltid på en modul i samma tenant (verifieras i
   * server-actionen).
   */
  next_module?: string;
  /**
   * Kopplat event/aktivitet (relation→incubator_events, migration 1700000138).
   * Ren referens — staff ser vilket event/aktivitet i CRM:t ("Aktiviteter",
   * § 15.2) modulen hör till. Pekar alltid på ett event i samma tenant
   * (verifieras i server-actionen).
   */
  linked_event?: string;
  /**
   * Steg 4-valet "Skapa lead i Startupkompassen när modulen slutförs"
   * (migration 1700000125). SAKNAT fält (oapplicerad migration) tolkas som
   * true — bara ett uttryckligt false stänger av lead-skapandet.
   */
  create_lead?: boolean;
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
  // `score`/`bucket`/`buckets` driver quiz-poängsättningen (packages/shared/compass-quiz.ts).
  // `buckets` = multi-hink (ett val fördelar poäng över flera profiler).
  choices?: {
    value: string;
    label: string;
    score?: number;
    bucket?: string;
    buckets?: Record<string, number>;
    next_key?: string;
  }[];
  required?: boolean;
  sort_order?: number;
}

/** Kedjad nästa-modul-länk (migration 1700000124) — visas efter slutfört flöde. */
export interface NextModuleLink {
  /** Publik slug — länkmål blir /m/<slug>. */
  slug: string;
  /** Visningsnamn på "fortsätt"-knappen. */
  label: string;
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
