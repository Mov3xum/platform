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
  | 'idea'
  | 'pre_revenue'
  | 'early_revenue'
  | 'growth'
  | 'scale'
  | 'exit';

export const ALL_PHASES: StartupPhase[] = [
  'idea',
  'pre_revenue',
  'early_revenue',
  'growth',
  'scale',
  'exit'
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
  | 'mistral-small-latest';

export type ToolOutputFormat = 'markdown' | 'json' | 'text';

export type ToolRunStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface Tool {
  id: string;
  tenant: string;
  key: string;
  name: string;
  description?: string;
  category: ToolCategory;
  icon?: string;
  prompt_template?: string;
  model?: ToolModel;
  requires_startup: boolean;
  roles_allowed: Role[];
  output_format?: ToolOutputFormat;
  active: boolean;
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
  created: string;
  updated: string;
  expand?: {
    tool?: Tool;
    startup?: { id: string; name: string };
    triggered_by?: { id: string; display_name?: string; email: string };
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

export type WorkshopBlockType = 'exercise' | 'video' | 'question' | 'ai_chat' | 'summary';

export interface WorkshopBlock {
  id: string;
  type: WorkshopBlockType;
  title: string;
  instructions?: string;
  video_url?: string;
  required?: boolean;
}

export interface Workshop {
  id: string;
  tenant: string;
  key: string;
  title: string;
  goal?: string;
  instructions?: string;
  status: WorkshopStatus;
  version: string;
  audience_roles: WorkshopAudience[];
  ai_system_prompt?: string;
  output_requirements?: string;
  content_blocks: WorkshopBlock[];
  source_tool?: string;
  created_by?: string;
  active: boolean;
  created: string;
  updated: string;
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

export const coreModules: ModuleDefinition[] = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    description: 'Rollanpassad översikt med aktiviteter och status.',
    rolesAllowed: ALL_ROLES,
    route: '/dashboard'
  },
  {
    id: 'startups',
    title: 'Startups',
    description: 'Bolagöversikt: profil, fas, team, milstolpar, avtal.',
    rolesAllowed: ['admin', 'incubator_lead', 'coach', 'mentor', 'observer', 'startup_member'],
    route: '/startups'
  },
  {
    id: 'partners',
    title: 'Partners',
    description: 'Partner-organisationer och deras engagemang i bolag.',
    rolesAllowed: ['admin', 'incubator_lead', 'coach', 'partner'],
    route: '/partners'
  },
  {
    id: 'onboarding',
    title: 'Onboarding',
    description: 'Digital onboarding för nya bolag i inkubatorn.',
    rolesAllowed: ['admin', 'incubator_lead', 'startup_member'],
    route: '/onboarding'
  },
  {
    id: 'education',
    title: 'Utbildning',
    description: 'Kurser och resurser för finansiering, hållbarhet, internationalisering.',
    rolesAllowed: ['admin', 'incubator_lead', 'coach', 'mentor', 'startup_member'],
    route: '/education'
  },
  {
    id: 'toolbox',
    title: 'Verktygslåda',
    description: 'AI-agenter och verktyg för rapportering, dokumentation och analys.',
    rolesAllowed: ['admin', 'incubator_lead', 'coach', 'mentor', 'startup_member'],
    route: '/toolbox'
  },
  {
    id: 'activity_feed',
    title: 'Aktivitetsfeed',
    description: 'Global feed med alla aktiviteter och verktygskörningar.',
    rolesAllowed: ALL_ROLES,
    route: '/aktivitet'
  },
  {
    id: 'integrationer',
    title: 'Integrationer',
    description: 'Anslut externa tjänster och bygg din organisations unika digitala miljö.',
    rolesAllowed: ['admin', 'incubator_lead', 'coach', 'startup_member'],
    route: '/integrationer'
  }
];
