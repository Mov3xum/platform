// Inställningar — sektionsregister (ren, server-/klientfri).
//
// Källa av sanning för vilka undersidor som finns under `/installningar`.
// Delas av hub-sidan (kort), undersidornas flik-navigation och topbarens
// brödsmulor så att etiketter, ikoner och rollkrav aldrig divergerar.
// RBAC här är UI-kurering — den hårda gränsen ligger i varje sidas
// `requireUser` + `hasRole` och i server-actions.

import type { Role } from '@platform/shared';

export type SettingsGroupId = 'access' | 'ai' | 'brand';

export interface SettingsSection {
  id: string;
  /** URL-segment under /installningar. */
  slug: string;
  href: string;
  title: string;
  /** Kort beskrivning för hub-kortet. */
  description: string;
  /** Ikonnamn ur `components/proto/Icon.tsx`. */
  icon: string;
  group: SettingsGroupId;
  /** Roller som får se sektionen (server-sidan enforce:ar samma krav). */
  roles: Role[];
}

export const SETTINGS_GROUPS: { id: SettingsGroupId; label: string }[] = [
  { id: 'access', label: 'Organisation & åtkomst' },
  { id: 'ai', label: 'AI & automation' },
  { id: 'brand', label: 'Utseende' }
];

const STAFF_ADMIN: Role[] = ['admin', 'incubator_lead'];

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: 'anvandare',
    slug: 'anvandare',
    href: '/installningar/anvandare',
    title: 'Användare',
    description: 'Se och administrera alla användare — roller, bolagskoppling, åtkomst och lösenord.',
    icon: 'people',
    group: 'access',
    roles: STAFF_ADMIN
  },
  {
    id: 'moduler',
    slug: 'moduler',
    href: '/installningar/moduler',
    title: 'Moduler',
    description: 'Slå på och av vilka delar av plattformen som är aktiva för din organisation.',
    icon: 'menu',
    group: 'access',
    roles: STAFF_ADMIN
  },
  {
    id: 'organisation',
    slug: 'organisation',
    href: '/installningar/organisation',
    title: 'Organisation & drift',
    description: 'Tenants, infrastrukturstatus och dataresidens (EU).',
    icon: 'globe',
    group: 'access',
    roles: STAFF_ADMIN
  },
  {
    id: 'ai-kostnad',
    slug: 'ai-kostnad',
    href: '/installningar/ai-kostnad',
    title: 'AI-kostnadstak',
    description: 'Månadstak för AI-kostnad och förbrukning hittills.',
    icon: 'bolt',
    group: 'ai',
    roles: STAFF_ADMIN
  },
  {
    id: 'ai-minne',
    slug: 'ai-minne',
    href: '/installningar/ai-minne',
    title: 'AI-minne',
    description: 'Vad chatten har lärt sig av din personal — redigera, ta bort eller lägg till regler.',
    icon: 'bot',
    group: 'ai',
    roles: STAFF_ADMIN
  },
  {
    id: 'utseende',
    slug: 'utseende',
    href: '/installningar/utseende',
    title: 'Logotyp & varumärke',
    description: 'Din organisations logotyp för light och dark mode.',
    icon: 'image',
    group: 'brand',
    roles: STAFF_ADMIN
  }
];

export function settingsSectionsFor(roles: readonly string[] | undefined): SettingsSection[] {
  const set = new Set(roles ?? []);
  return SETTINGS_SECTIONS.filter((s) => s.roles.some((r) => set.has(r)));
}

export function findSettingsSection(slug: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((s) => s.slug === slug);
}

/** Brödsmule-etiketter per fullständig sökväg (används av topbaren). */
export const SETTINGS_ROUTE_LABELS: Record<string, string> = Object.fromEntries(
  SETTINGS_SECTIONS.map((s) => [s.href, s.title])
);
