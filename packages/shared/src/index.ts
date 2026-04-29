export type Role = 'admin' | 'incubator_lead' | 'mentor' | 'startup' | 'observer';

export const Roles: Role[] = ['admin', 'incubator_lead', 'mentor', 'startup', 'observer'];

export type TenantCategory = 'startup' | 'incubator' | 'mentor' | 'external';

export interface StartupProfile {
  id: string;
  name: string;
  description: string;
  innovationReadinessLevel: number;
  nextStep?: string;
  activePrograms?: string[];
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: Role;
  tenant: TenantCategory;
}

export interface AgreementDocument {
  id: string;
  startupId: string;
  title: string;
  signedAt?: string;
  fileUrl?: string;
}

export interface ModuleDefinition {
  id: string;
  title: string;
  description: string;
  rolesAllowed: Role[];
  route: string;
}

export const coreModules: ModuleDefinition[] = [
  {
    id: 'startups',
    title: 'Startup-översikt',
    description: 'Samla all startupdata, IRL-faser, avtal och kontakter.',
    rolesAllowed: ['admin', 'incubator_lead', 'mentor', 'observer', 'startup'],
    route: '/startups'
  },
  {
    id: 'onboarding',
    title: 'Digital onboarding',
    description: 'Onboarding för bolag med registrering, avtal och NDA.',
    rolesAllowed: ['admin', 'incubator_lead', 'startup'],
    route: '/onboarding'
  },
  {
    id: 'dashboard',
    title: 'Inkubatorn Dashboard',
    description: 'Rollspecifik vy med aktiviteter, nästa steg och status.',
    rolesAllowed: ['admin', 'incubator_lead', 'mentor', 'observer', 'startup'],
    route: '/dashboard'
  },
  {
    id: 'education',
    title: 'Utbildningsmoduler',
    description: 'Finansiering, hållbarhet och internationalisering för bolag.',
    rolesAllowed: ['admin', 'incubator_lead', 'mentor', 'startup'],
    route: '/education'
  }
];
