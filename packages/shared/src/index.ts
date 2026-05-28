export type Role =
  | 'admin'
  | 'incubator_lead'
  | 'coach'
  | 'mentor'
  | 'partner'
  | 'startup_member'
  | 'observer';

export const ALL_ROLES: Role[] = [
  'admin',
  'incubator_lead',
  'coach',
  'mentor',
  'partner',
  'startup_member',
  'observer'
];

export type StartupPhase =
  | 'paus'
  | 'inflode'
  | 'lead'
  | 'boost_chamber'
  | 'incubation'
  | 'prescale'
  | 'acceleration'
  | 'alumni';

export const ALL_PHASES: StartupPhase[] = [
  'paus',
  'inflode',
  'lead',
  'boost_chamber',
  'incubation',
  'prescale',
  'acceleration',
  'alumni'
];

export type TenantType = 'incubator' | 'partner_org';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  type: TenantType;
}

export interface UserProfile {
  id: string;
  tenant: string;
  name: string;
  email: string;
  roles: Role[];
  linked_startups: string[];
}

export type FounderGender = 'kvinna' | 'man' | 'icke_binar' | 'uppger_ej';

export interface Startup {
  id: string;
  tenant: string;
  name: string;
  description: string;
  phase: StartupPhase;
  irl_level: number;
  next_step?: string;
  owner?: string;
  coaches: string[];
  status: 'active' | 'alumni' | 'paused' | 'rejected';
  // Befintliga PB-fält (saknades tidigare i TS-typen)
  tags?: string;
  sprint_x_json?: SprintXScore;
  sector?: string;
  pitch?: string;
  team_size?: number;
  next_milestone?: string;
  accent?: string;
  org_nr?: string;
  kommun?: string;
  bolagsform?: string;
  industri?: string;
  intagsdatum?: string;
  avslutsdatum?: string;
  bolag_status?: string;
  // Movexum Bolagslista-fält (migration 1700000061)
  idea_name?: string;
  case_type?: string;
  status_completion_pct?: number;
  company_registered_at?: string;
  contacted_at?: string;
  /** PII — får aldrig finnas med i AI-prompts (CLAUDE.md § 9.3). */
  phone?: string;
  signed_incubator_agreement?: boolean;
  signed_incubator_agreement_at?: string;
  signed_nda?: boolean;
  signed_nda_at?: string;
  /** GDPR art. 9 särskild kategori — ej i AI-prompts. */
  founder_gender?: FounderGender;
  potential_bc_case?: boolean;
  /** GDPR art. 9 särskild kategori — ej i AI-prompts. */
  founder_identifies_as?: string;
  signed_bc_agreement?: boolean;
  signed_bc_agreement_at?: string;
  preliminary_exit?: string;
  is_deeptech?: boolean;
  meets_excellence_criteria?: boolean;
  inflow_source?: string;
  approved_state_aid_art22?: boolean;
  area?: string;
  signed_vinnova_incubation_approval?: boolean;
  signed_vinnova_incubation_approval_at?: string;
  approved_de_minimis?: boolean;
  sent_to?: string;
  register_notes?: string;
  is_regional?: boolean;
  signed_partner_agreement?: boolean;
  signed_partner_agreement_at?: string;
}

export interface StartupPhaseHistory {
  id: string;
  tenant: string;
  startup: string;
  phase: StartupPhase;
  entered_at: string;
  exited_at?: string;
  note?: string;
  created_by?: string;
  created: string;
  updated: string;
  expand?: {
    startup?: { id: string; name: string };
    created_by?: { id: string; display_name?: string; email: string };
  };
}

export interface Partner {
  id: string;
  tenant: string;
  name: string;
  type: 'investor' | 'corporate' | 'public' | 'academic' | 'other';
  contact_user?: string;
  notes?: string;
}

export interface ModuleDefinition {
  id: string;
  title: string;
  description: string;
  rolesAllowed: Role[];
  route: string;
}

export type ToolCategory =
  | 'ai_per_startup'
  | 'ai_system_wide'
  | 'education'
  | 'template'
  | 'checklist';

export type ToolModel =
  | 'mistral-large-latest'
  | 'mistral-medium-latest'
  | 'mistral-small-latest'
  | 'pixtral-large-latest';

export type ToolOutputFormat = 'markdown' | 'json' | 'text';

// EU-baserade källor som AI-agenter kan hämta live-data från.
// Whitelisten upprätthålls i `apps/web/src/lib/ai/web.ts`.
export type WebSourceKey =
  | 'breakit'
  | 'sifted'
  | 'di_digital'
  | 'vinnova'
  | 'eic'
  | 'almi';

export type ToolRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'assigned'
  | 'in_progress'
  | 'ready_for_review'
  | 'approved'
  | 'rejected';

export interface ToolRunThreadEntry {
  user: string;
  role: 'coach' | 'founder' | 'system';
  at: string;
  text: string;
}

// Chat-mode (1700000057): en tool_run = en chatt-session.
// `messages` lagrar hela samtalet; `output_md` behålls bakåtkompatibelt
// och speglar senaste assistant-content.
export interface ToolRunAttachmentRef {
  pb_file: string; // PocketBase-filnamn (för signerad URL)
  mime: string;
  filename: string; // originalnamn för visning
  size_bytes: number;
  extracted_text_bytes?: number; // PDF/text — hur mycket text vi matade in i prompten
}

// Referens till en agent-genererad fil (PPTX/XLSX/DOCX/PDF) som sparats i
// ägarens privata `user_files` och bifogats ett assistant-svar. UI:t renderar
// en nedladdnings-chip; nedladdning sker via en kortlivad fil-token.
export interface GeneratedFileRef {
  user_file_id: string;
  filename: string;
  mime: string;
  doc_kind: UserFileDocKind;
  size_bytes: number;
}

// Ett verktygssteg agenten utförde under en turn. Live-streamas till UI:t
// medan turen körs och persisteras på assistant-meddelandet så återöppnade
// trådar visar vad agenten gjorde. Etiketter är PII-fria (kollektionsnivå /
// dokumenttyp) — de innehåller aldrig användarvärden, filter eller fältdata.
export interface AgentActivityStep {
  tool: string; // funktionsnamn, t.ex. 'query_collection'
  label: string; // svensk etikett, t.ex. 'Läser bolagsdata'
  ok?: boolean; // utfall (sätts när steget är klart)
}

export interface ToolRunMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  attachments?: ToolRunAttachmentRef[];
  // Agent-genererade dokument knutna till detta (assistant-)turn.
  generated_files?: GeneratedFileRef[];
  // Verktygssteg agenten utförde för detta (assistant-)turn.
  steps?: AgentActivityStep[];
  model?: string; // modell som producerade detta turn (assistant)
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  at: string; // ISO
  error?: string;
}

export type KnowledgeSourceKind = 'note' | 'file' | 'compass' | 'irl' | 'milestone';

export interface KnowledgeSourceRef {
  kind: KnowledgeSourceKind;
  id: string;
}

// Per-agent kunskapsbas (referensmaterial). En rad = en uppladdad fil knuten
// till en `tools`-agent. Texten extraheras/sanering/cachas vid uppladdning
// (`extracted_text`) och injiceras i prompten vid varje körning. Migration
// 1700000080.
export interface ToolKnowledge {
  id: string;
  tenant: string;
  tool: string;
  title?: string;
  filename: string;
  mime?: string;
  size_bytes?: number;
  file?: string; // PB-filnamn
  extracted_text?: string;
  char_count?: number;
  redacted?: boolean;
  sort_order?: number;
  created_by?: string;
  created: string;
  updated: string;
}

// Loggas i tool_runs.input.knowledge_used per körning (EU AI Act art. 13 —
// transparens om vilket referensmaterial som matade svaret).
export interface KnowledgeSourceUsed {
  id: string;
  title: string;
  char_count: number;
}

export interface Tool {
  id: string;
  tenant: string;
  key: string;
  name: string;
  description?: string;
  category: ToolCategory;
  icon?: string;
  // Agentens roll/scope — går i Mistral SYSTEM-rollen, alltid bakom den
  // immutabla säkerhetspreamblen. Skilt från prompt_template (datamall i
  // USER-meddelandet). Bara admin/incubator_lead får sätta det.
  system_prompt?: string;
  prompt_template?: string;
  model?: ToolModel;
  // Valfri kvalitetsrubrik (Fas 3). När satt grader-poängsätts svaret mot
  // rubriken och agenten reviderar vid underkänt (människa-i-loopen kvar).
  verify_rubric?: string;
  requires_startup: boolean;
  roles_allowed: Role[];
  output_format?: ToolOutputFormat;
  active: boolean;
  // Live-källor som hämtas in i prompten via {{web.<key>}}-tokens.
  // Tom array eller saknas = ingen web-fetch (default).
  web_sources?: WebSourceKey[];
  created_by?: string;
  created: string;
  updated: string;
}

export interface ToolRun {
  id: string;
  tenant: string;
  tool: string;
  startup?: string;
  activity?: string;
  triggered_by: string;
  status: ToolRunStatus;
  input?: Record<string, unknown>;
  output_md?: string;
  output_json?: Record<string, unknown>;
  model?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_estimate_usd?: number;
  error?: string;
  started_at?: string;
  completed_at?: string;
  // Assignment-fält (1700000049)
  assigned_to?: string;
  assigned_by?: string;
  deadline?: string;
  instruction?: string;
  knowledge_sources?: KnowledgeSourceRef[];
  thread?: ToolRunThreadEntry[];
  // Versionering
  parent_run?: string;
  version?: number;
  // Chat-mode (1700000057)
  messages?: ToolRunMessage[];
  attachments?: string[]; // PB-filnamn
  created: string;
  updated: string;
  expand?: {
    tool?: Tool;
    startup?: { id: string; name: string };
    triggered_by?: { id: string; display_name?: string; email: string };
    assigned_to?: { id: string; display_name?: string; email: string };
    assigned_by?: { id: string; display_name?: string; email: string };
    parent_run?: ToolRun;
  };
}

// ── Persistenta dashboard-chatt-trådar (migration 1700000083) ─────────
// Strikt ägaren-bara konversationer på /chatt med CRUD (fäst/arkivera/
// radera). `messages` återanvänder ToolRunMessage[]. `summary` är ett
// trådscopat minne som injiceras vid återöppning.
export type ChatThreadStatus = 'active' | 'archived';

export interface ChatThread {
  id: string;
  tenant: string;
  owner: string;
  title?: string;
  status?: ChatThreadStatus;
  pinned?: boolean;
  agent?: string;
  messages?: ToolRunMessage[];
  summary?: string;
  last_message_at?: string;
  model?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_estimate_usd?: number;
  deleted_at?: string;
  created: string;
  updated: string;
}

// ── Personliga filer (migration 1700000085) ──────────────────────────
// Strikt ägaren-bara filarkiv (/filer). Genererade dokument
// (agent_generated) och egna uppladdningar. Bara ägaren ser raderna.
export type UserFileSource = 'agent_generated' | 'upload';
export type UserFileDocKind = 'pptx' | 'xlsx' | 'docx' | 'pdf' | 'other';

export interface UserFile {
  id: string;
  tenant: string;
  owner: string;
  file?: string; // PB-filnamn
  filename: string;
  mime?: string;
  size_bytes?: number;
  source: UserFileSource;
  doc_kind?: UserFileDocKind;
  chat_thread?: string;
  tool_run?: string;
  created: string;
  updated: string;
}

// ── Djupa jobb / subagent-orkestrering (migration 1700000084) ─────────
// Bakgrundskörningar som planerar och fan-out:ar read-only sub-körningar
// (mirror av §16.7) och syntetiserar ett UTKAST i en chatt-tråd. Aldrig
// auto-publicering — människa-i-loopen (EU AI Act art. 14).
export type DeepJobStatus =
  | 'queued'
  | 'planning'
  | 'running'
  | 'aggregating'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface DeepJobSubtask {
  id: string;
  goal: string;
  kind: 'research' | 'compile' | 'document';
}

export interface DeepJob {
  id: string;
  tenant: string;
  owner: string;
  thread: string;
  instruction: string;
  status: DeepJobStatus;
  plan?: DeepJobSubtask[];
  progress?: number;
  subtask_runs?: string[];
  tokens_in?: number;
  tokens_out?: number;
  cost_estimate_usd?: number;
  error?: string;
  started_at?: string;
  completed_at?: string;
  created: string;
  updated: string;
}

// ── AI usage telemetry (migration 1700000058) ────────────────────────
// Logg-rad per Mistral-anrop. Aggregeras på /insights för totalt
// kostnads-/tokenutfall över alla ytor (toolbox, dashboard-chatt,
// startup-chatt, i18n-pipeline, workshops).
export type AiUsageSurface =
  | 'toolbox'
  | 'tool_chat'
  | 'dashboard_chat'
  | 'startup_chat'
  | 'intl'
  | 'suggestions'
  | 'workshop_run'
  | 'connector_chat'
  | 'deep_chat';

export interface AiUsageEvent {
  id: string;
  tenant: string;
  user: string;
  surface: AiUsageSurface;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_estimate_usd: number;
  tool_run?: string;
  error?: string;
  created: string;
  updated: string;
  expand?: {
    user?: { id: string; display_name?: string; email?: string; roles?: string[] };
    tool_run?: ToolRun;
  };
}

// ── Explicit kvalitetsfeedback (migration 1700000070) ────────────────
// 👍/👎 + valfri orsak per assistant-turn i en tool_run. Driver
// förbättrings-loopen (CLAUDE.md §9.10): /insights aggregerar 👎-rate
// per verktyg och listar senaste 👎 med orsak som review-kö.
export type ToolRunFeedbackRating = 'up' | 'down';

export interface ToolRunFeedback {
  id: string;
  tenant: string;
  tool_run: string;
  tool?: string;
  user: string;
  message_index: number;
  rating: ToolRunFeedbackRating;
  reason?: string;
  created: string;
  updated: string;
  expand?: {
    tool?: Tool;
    user?: { id: string; display_name?: string; email?: string };
    tool_run?: ToolRun;
  };
}

export type WorkshopStatus = 'draft' | 'active' | 'archived';

export type WorkshopAudience =
  | 'admin'
  | 'incubator_lead'
  | 'coach'
  | 'mentor'
  | 'startup_member'
  | 'observer';

export type WorkshopBlockType =
  | 'exercise'
  | 'video'
  | 'question'
  | 'ai_chat'
  | 'ai_pipeline'
  | 'coach_review'
  | 'commit_document'
  | 'summary'
  | 'image'
  | 'test'
  | 'instruction';

export interface WorkshopBlockOption {
  id: string;
  text: string;
  isCorrect?: boolean;
}

export interface WorkshopBlock {
  id: string;
  type: WorkshopBlockType;
  title: string;
  instructions?: string;
  video_url?: string;
  image_url?: string;
  desired_result?: string;
  question_type?: 'single' | 'multiple';
  options?: WorkshopBlockOption[];
  required?: boolean;
  // ai_pipeline-specific fields — set by coach in WorkshopBlockBuilder
  pipeline_system_prompt?: string;
  pipeline_model?: string;
  pipeline_output_key?: string;
  pipeline_requires_key?: string;
}

export interface WorkshopModule {
  id: string;
  title: string;
  description?: string;
  blocks: WorkshopBlock[];
}

export interface WorkshopArea {
  id: string;
  tenant: string;
  name: string;
  created: string;
  updated: string;
}

export interface Workshop {
  id: string;
  tenant: string;
  area?: string;
  key: string;
  title: string;
  goal?: string;
  instructions?: string;
  status: WorkshopStatus;
  version: string;
  audience_roles: WorkshopAudience[];
  ai_system_prompt?: string;
  output_requirements?: string;
  modules?: WorkshopModule[];
  content_blocks: WorkshopBlock[];
  source_tool?: string;
  created_by?: string;
  active: boolean;
  created: string;
  updated: string;
  expand?: {
    area?: WorkshopArea;
  };
}

export type WorkshopAssignmentStatus = 'planned' | 'in_progress' | 'done';

export interface WorkshopAssignment {
  id: string;
  tenant: string;
  workshop: string;
  startup: string;
  assigned_by: string;
  owner?: string;
  status: WorkshopAssignmentStatus;
  due_date?: string;
  activity?: string;
  progress_json?: Record<string, unknown>;
  answers_json?: Record<string, unknown>;
  takeaway_json?: Record<string, unknown>;
  artifacts_json?: Record<string, unknown>;
  ai_thread_json?: Array<Record<string, unknown>>;
  started_at?: string;
  completed_at?: string;
  last_saved_at?: string;
  created: string;
  updated: string;
  expand?: {
    workshop?: Workshop;
    startup?: { id: string; name: string };
    assigned_by?: { id: string; display_name?: string; email: string };
    owner?: { id: string; display_name?: string; email: string };
  };
}

export type WorkshopRunStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface WorkshopRun {
  id: string;
  tenant: string;
  assignment: string;
  workshop: string;
  startup: string;
  triggered_by: string;
  status: WorkshopRunStatus;
  input?: Record<string, unknown>;
  output_md?: string;
  model?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_estimate_usd?: number;
  error?: string;
  started_at?: string;
  completed_at?: string;
  created: string;
  updated: string;
  expand?: {
    assignment?: WorkshopAssignment;
    workshop?: Workshop;
    startup?: { id: string; name: string };
    triggered_by?: { id: string; display_name?: string; email: string };
  };
}

export type StrategyBand = 'wait' | 'discovery' | 'execution';

export type StrategyStatus = 'draft' | 'coach_review' | 'committed' | 'archived';

export interface Strategy {
  id: string;
  tenant: string;
  startup: string;
  workshop_assignment: string;
  status: StrategyStatus;
  recommended_band: StrategyBand;
  position_assessment: string;
  recommendation: string;
  reasoning: string;
  quarterly_milestones: string;
  kill_criteria: string;
  scenarios_json: Record<string, unknown>;
  coach_notes?: string;
  coach_approved_by?: string;
  coach_approved_at?: string;
  committed_at?: string;
  next_recalibration_at?: string;
  gdpr_legal_basis: string;
  deleted_at?: string;
  created: string;
  updated: string;
  expand?: {
    startup?: { id: string; name: string };
    workshop_assignment?: WorkshopAssignment;
    coach_approved_by?: { id: string; display_name?: string; email: string };
  };
}

export type StrategyRevisionType = 'initial' | 'quarterly' | 'coach_override' | 'manual';

export interface StrategyRevision {
  id: string;
  tenant: string;
  strategy: string;
  startup: string;
  revision_type: StrategyRevisionType;
  snapshot_json: Record<string, unknown>;
  change_summary: string;
  ai_output?: string;
  triggered_by: string;
  quarter_number?: number;
  created: string;
  updated: string;
  expand?: {
    strategy?: Strategy;
    startup?: { id: string; name: string };
    triggered_by?: { id: string; display_name?: string; email: string };
  };
}

// ─── Sprint X — bolagsmätning på 4 axlar ─────────────────────────────────────

export type SprintXAxis = 'funding' | 'intl' | 'sustain' | 'team';

export const SPRINT_X_AXES: { id: SprintXAxis; label: string; short: string; accent: string }[] = [
  { id: 'funding', label: 'Finansiering', short: 'Fin', accent: 'yellow' },
  { id: 'intl', label: 'Internationalisering', short: 'Intl', accent: 'cyan' },
  { id: 'sustain', label: 'Hållbarhet', short: 'Håll', accent: 'green' },
  { id: 'team', label: 'Team', short: 'Team', accent: 'purple' }
];

export interface SprintXScore {
  funding: number; // 0-100
  intl: number;
  sustain: number;
  team: number;
}

export interface SprintXCheckin {
  id: string;
  tenant: string;
  startup: string;
  axis: SprintXAxis;
  value_from: number;
  value_to: number;
  note?: string;
  logged_by: string;
  created: string;
  updated: string;
  expand?: {
    startup?: { id: string; name: string };
    logged_by?: { id: string; display_name?: string; email: string };
  };
}

// ─── Missions — uppdrag och flöden ───────────────────────────────────────────

export type MissionStatus =
  | 'draft'
  | 'preparation'
  | 'in_progress'
  | 'review'
  | 'done'
  | 'archived';

export type MissionType =
  | 'workshop'
  | 'sprint_x'
  | 'community'
  | 'report'
  | 'onboarding'
  | 'custom'
  | 'project';

export type MissionParticipantRole = 'lead' | 'contributor' | 'observer';

export interface MissionParticipant {
  user_id: string;
  role: MissionParticipantRole;
  added_at: string;
  added_by: string;
}

export type MissionVisibility = 'tenant' | 'participants';

export interface MissionStage {
  id: string;
  label: string;
  actor?: string; // user id
  time?: string;
  note?: string;
  done: boolean;
}

export interface MissionArtifact {
  id: string;
  name: string;
  size?: string;
  url?: string;
  uploaded_by?: string;
  created?: string;
}

export interface Mission {
  id: string;
  tenant: string;
  title: string;
  type: MissionType;
  status: MissionStatus;
  issuer: string; // user id
  recipients: string[]; // user ids
  mentor?: string;
  startup?: string;
  startups?: string[];
  participants_json?: MissionParticipant[];
  visibility?: MissionVisibility;
  due_date?: string;
  description?: string;
  stages_json: MissionStage[];
  artifacts_json: MissionArtifact[];
  accent?: string;
  created: string;
  updated: string;
  expand?: {
    issuer?: { id: string; display_name?: string; email: string };
    recipients?: Array<{ id: string; display_name?: string; email: string }>;
    mentor?: { id: string; display_name?: string; email: string };
    startup?: { id: string; name: string };
    startups?: Array<{ id: string; name: string }>;
  };
}

// ─── Kommentarer & notiser för samarbete ─────────────────────────────────────

export interface MissionComment {
  id: string;
  tenant: string;
  mission: string;
  author: string;
  body: string;
  mentions: string[];
  parent?: string;
  edited_at?: string;
  deleted?: boolean;
  created: string;
  updated: string;
  expand?: {
    author?: { id: string; display_name?: string; email: string };
    mentions?: Array<{ id: string; display_name?: string; email: string }>;
  };
}

export type NotificationKind =
  | 'comment'
  | 'mention'
  | 'assigned'
  | 'status_change'
  | 'stage_advance'
  | 'due_soon';

export interface NotificationPayload {
  title: string;
  snippet?: string;
  href: string;
}

export interface Notification {
  id: string;
  tenant: string;
  user: string;
  kind: NotificationKind;
  mission?: string;
  actor?: string;
  comment?: string;
  payload_json: NotificationPayload;
  read_at?: string;
  created: string;
  updated: string;
  expand?: {
    actor?: { id: string; display_name?: string; email: string };
    mission?: { id: string; title: string; type: MissionType };
  };
}

// ─── Investerarrelationer ────────────────────────────────────────────────────

export type InvestorWarmth = 'hot' | 'active' | 'tracking' | 'later';

export type InvestorStage = 'pre_seed' | 'seed' | 'series_a' | 'series_b' | 'growth';

export interface Investor {
  id: string;
  tenant: string;
  name: string;
  focus: string[]; // tags: cleantech, impact etc
  ticket_min?: number; // i kr
  ticket_max?: number;
  warmth: InvestorWarmth;
  stage_focus: InvestorStage[];
  contact_user?: string;
  website?: string;
  notes?: string;
  created: string;
  updated: string;
}

export type DealStage = 'intro' | 'meeting' | 'dd' | 'term_sheet' | 'close';

export const DEAL_STAGES: { id: DealStage; label: string }[] = [
  { id: 'intro', label: 'Intro' },
  { id: 'meeting', label: 'Möte' },
  { id: 'dd', label: 'DD' },
  { id: 'term_sheet', label: 'Term sheet' },
  { id: 'close', label: 'Close' }
];

export interface Deal {
  id: string;
  tenant: string;
  startup: string;
  investor: string;
  stage: DealStage;
  amount?: number; // kr
  notes?: string;
  last_activity?: string;
  created: string;
  updated: string;
  expand?: {
    startup?: { id: string; name: string };
    investor?: { id: string; name: string; warmth?: InvestorWarmth };
  };
}

// ─── Events ──────────────────────────────────────────────────────────────────

export type EventType = 'pitch' | 'conference' | 'matching' | 'hack' | 'mingle' | 'workshop' | 'other';

export type EventStatus = 'planned' | 'live' | 'completed' | 'cancelled';

export interface IncubatorEvent {
  id: string;
  tenant: string;
  name: string;
  type: EventType;
  status: EventStatus;
  starts_at: string;
  ends_at?: string;
  location?: string;
  description?: string;
  accent?: string;
  signups_count?: number;
  attended_count?: number;
  leads_count?: number;
  admitted_count?: number;
  created: string;
  updated: string;
}

export type EventSignupStage = 'signup' | 'attended' | 'meeting' | 'application' | 'admitted';

export interface EventSignup {
  id: string;
  tenant: string;
  event: string;
  name: string;
  email?: string;
  organization?: string;
  stage: EventSignupStage;
  startup?: string;
  notes?: string;
  created: string;
  updated: string;
  expand?: {
    event?: IncubatorEvent;
    startup?: { id: string; name: string };
  };
}

// ─── Rapportering ────────────────────────────────────────────────────────────

export type ReportStatus = 'draft_ai' | 'review' | 'sent' | 'archived';

export type ReportRecipient = 'vinnova' | 'tillvaxtverket' | 'region' | 'kommun' | 'other';

export interface ReportSection {
  id: string;
  name: string;
  state: 'pending' | 'auto' | 'review' | 'done';
  auto: boolean;
  content_md?: string;
}

export interface IncubatorReport {
  id: string;
  tenant: string;
  title: string;
  recipient: ReportRecipient;
  recipient_label: string;
  status: ReportStatus;
  period_label: string;
  period_start: string;
  period_end: string;
  due_date?: string;
  completion: number; // 0-100
  sections_json: ReportSection[];
  preview_md?: string;
  accent?: string;
  created_by?: string;
  created: string;
  updated: string;
}

// ─── Community & alumni ──────────────────────────────────────────────────────

export type AlumniTag = 'exit' | 'scale' | 'active' | 'mentor' | 'paused';

export interface Alumni {
  id: string;
  tenant: string;
  name: string;
  company?: string;
  exit_year?: number;
  tag: AlumniTag;
  bio?: string;
  contact_email?: string;
  contact_user?: string;
  active_mentor: boolean;
  accent?: string;
  created: string;
  updated: string;
}

// ─── Module groups for rail ──────────────────────────────────────────────────

export interface ModuleGroup {
  label: string;
  modules: string[];
}

export const RAIL_GROUPS: ModuleGroup[] = [
  { label: 'Översikt', modules: ['idag', 'inkorg', 'filer', 'inflode', 'uppdrag'] },
  { label: 'Portfölj', modules: ['kompassen', 'startups', 'investerare', 'events', 'community'] },
  { label: 'Innehåll', modules: ['education', 'rapporter'] },
  { label: 'System', modules: ['agenter', 'insights', 'integrationer', 'installningar'] }
];

export const coreModules: ModuleDefinition[] = [
  {
    id: 'idag',
    title: 'Chatt',
    description: 'AI-dashboardchatt — fråga, sammanställ och delegera till agenter och connectors.',
    rolesAllowed: ALL_ROLES,
    route: '/chatt'
  },
  {
    id: 'inkorg',
    title: 'Min översikt',
    description: 'Allt som är ditt på ett ställe — uppgifter, aktiviteter, möten och events att planera och följa upp.',
    rolesAllowed: ALL_ROLES,
    route: '/inkorg'
  },
  {
    id: 'filer',
    title: 'Filer',
    description: 'Dina genererade och uppladdade filer — bara du ser dem.',
    rolesAllowed: ALL_ROLES,
    route: '/filer'
  },
  {
    id: 'uppdrag',
    title: 'Projekt & uppdrag',
    description: 'Skapa och samarbeta på projekt och uppdrag — bjud in roller, kommentera och följ flöden.',
    rolesAllowed: ['admin', 'incubator_lead', 'coach', 'mentor', 'partner', 'startup_member', 'observer'],
    route: '/uppdrag'
  },
  {
    id: 'inflode',
    title: 'Inflöde',
    description: 'Hjärtat i inkubatorn — fånga, kvalificera och konvertera leads. Deploya formulär, quiz och AI-chattar på egna URL:er och spåra var inflödet kommer ifrån.',
    rolesAllowed: ['admin', 'incubator_lead', 'coach', 'mentor', 'observer', 'startup_member'],
    route: '/inflode'
  },
  {
    id: 'startups',
    title: 'Startups',
    description: 'Bolagöversikt: profil, fas, team, milstolpar, avtal.',
    rolesAllowed: ['admin', 'incubator_lead', 'coach', 'mentor', 'observer', 'startup_member'],
    route: '/startups'
  },
  {
    id: 'investerare',
    title: 'Investerarrelationer',
    description: 'Deal flow + investerarkort med fokus, ticket size och historik.',
    rolesAllowed: ['admin', 'incubator_lead', 'coach', 'partner'],
    route: '/investerare'
  },
  {
    id: 'events',
    title: 'Events',
    description: 'Eventflöde, trattanalys och ROI per event.',
    rolesAllowed: ['admin', 'incubator_lead', 'coach', 'observer'],
    route: '/events'
  },
  {
    id: 'community',
    title: 'Community',
    description: 'Alumni, mentorer och nätverk runt portföljen.',
    rolesAllowed: ALL_ROLES,
    route: '/community'
  },
  {
    id: 'education',
    title: 'Utbildning',
    description: 'Spår per Sprint X-axel: finansiering, hållbarhet, internationalisering, team.',
    rolesAllowed: ['admin', 'incubator_lead', 'coach', 'mentor', 'startup_member'],
    route: '/education'
  },
  {
    id: 'rapporter',
    title: 'Rapportering',
    description: 'Auto-rapporter till Vinnova, Tillväxtverket och region — granska och skicka.',
    rolesAllowed: ['admin', 'incubator_lead'],
    route: '/rapporter'
  },
  {
    id: 'agenter',
    title: 'AI-agenter',
    description: 'AI-agenter, mallar och checklistor för startupstöd. Tilldela bolag för att synliggöra rätt agent i rätt kontext.',
    rolesAllowed: ['admin', 'incubator_lead', 'coach', 'mentor', 'startup_member'],
    route: '/toolbox'
  },
  {
    id: 'insights',
    title: 'Usage insights',
    description:
      'Spåra hur AI och plattformen används i din organisation — identifiera värdedrivare och adoption per modul.',
    rolesAllowed: ['admin', 'incubator_lead'],
    route: '/insights'
  },
  {
    id: 'integrationer',
    title: 'Integrationer',
    description: 'Anslut externa tjänster och bygg din organisations unika digitala miljö.',
    rolesAllowed: ['admin', 'incubator_lead', 'coach', 'startup_member'],
    route: '/integrationer'
  },
  {
    id: 'installningar',
    title: 'Inställningar',
    description: 'Moduler, tenants, integrationer och infrastruktur.',
    rolesAllowed: ['admin', 'incubator_lead'],
    route: '/installningar'
  },
  // ── Legacy-alias för bakåtkompatibilitet — visas EJ i rail. ──────────────
  // Existerande sidor använder dessa IDs i `canAccessModule(roles, 'toolbox')`,
  // så vi behåller dem som dolda entries.
  {
    id: 'dashboard',
    title: 'Dashboard',
    description: 'Legacy redirect till /chatt.',
    rolesAllowed: ALL_ROLES,
    route: '/chatt'
  },
  {
    id: 'toolbox',
    title: 'AI-agenter',
    description: 'Legacy alias för AI-agenter.',
    rolesAllowed: ['admin', 'incubator_lead', 'coach', 'mentor', 'startup_member'],
    route: '/toolbox'
  },
  {
    id: 'onboarding',
    title: 'Onboarding',
    description: 'Digital onboarding för nya bolag i inkubatorn.',
    rolesAllowed: ['admin', 'incubator_lead', 'startup_member'],
    route: '/onboarding'
  },
  {
    id: 'activity_feed',
    title: 'Aktivitetsfeed',
    description: 'Global feed med alla aktiviteter och agentkörningar.',
    rolesAllowed: ALL_ROLES,
    route: '/aktivitet'
  },
  {
    id: 'partners',
    title: 'Partners',
    description: 'Partner-organisationer och deras engagemang.',
    rolesAllowed: ['admin', 'incubator_lead', 'coach', 'partner'],
    route: '/partners'
  }
];

// ─── Re-export av brand-tokens (TS-spegel av tokens.css) ─────────────────────
// Låter server-side dokumentgenerering (lib/documents/brand.ts) hämta
// brand-färgerna från källan-av-sanning istället för att hårdkoda hex.
export { movexumPalette, typography as brandTypography } from './design/tokens';

// ─── Workshop/utbildning-hjälpare (ren logik, enhetstestad) ──────────────────
export * from './workshop';
