/**
 * Ren urvalslogik för bottom-menyn på mobil (CLAUDE.md § 35).
 *
 * Fem platser: två till vänster, en upphöjd MITTKNAPP, en till höger och
 * "Mer" (öppnar hela sidmenyn). Mittknappen är chatten för alla som får se
 * den; en ren bolagsmedlem (som saknar chatt, § 21.5) får sin hemvy i
 * mitten i stället. Kandidatlistorna är prioritetsordnade och filtreras med
 * samma RBAC-funktion som railen — menyn är ren UI-kurering, aldrig en
 * säkerhetsgräns.
 */
import { coreModules, isPureStartupMember, type Role } from '@platform/shared';
import { MODULE_ICONS } from './module-icons';

export interface MobileNavItem {
  id: string;
  href: string;
  label: string;
  icon: string;
  count?: number;
}

export interface MobileNav {
  left: MobileNavItem[];
  center: MobileNavItem;
  right: MobileNavItem[];
}

type CanAccess = (roles: Role[], moduleId: string, disabledModules: string[] | undefined) => boolean;

/** Korta etiketter för smal skärm (railen har längre titlar). */
const MOBILE_LABELS: Record<string, string> = {
  idag: 'Chatt',
  inkorg: 'Översikt',
  min_oversikt: 'Mitt bolag',
  mina_aktiviteter: 'Aktiviteter',
  startups: 'Bolag',
  pagaende: 'Pågående',
  arshjul: 'Årshjul',
  uppdrag: 'Uppdrag',
  filer: 'Filer',
  education: 'Utbildning',
  de_minimis: 'De minimis',
  community: 'Community',
  events: 'Events'
};

const STAFF = {
  center: ['idag', 'inkorg'],
  left: ['inkorg', 'startups', 'uppdrag', 'filer', 'arshjul'],
  right: ['pagaende', 'arshjul', 'uppdrag', 'events', 'filer', 'education']
};

const MEMBER = {
  center: ['min_oversikt', 'mina_aktiviteter'],
  left: ['mina_aktiviteter', 'filer'],
  right: ['de_minimis', 'community', 'uppdrag']
};

function toItem(id: string, counts: Record<string, number>, labelOverride?: string): MobileNavItem | null {
  const mod = coreModules.find((m) => m.id === id);
  if (!mod) return null;
  return {
    id,
    href: mod.route,
    label: labelOverride ?? MOBILE_LABELS[id] ?? mod.title,
    icon: MODULE_ICONS[id] ?? 'dot',
    count: counts[id]
  };
}

export function buildMobileNav(
  roles: Role[],
  disabledModules: string[] | undefined,
  counts: Record<string, number>,
  canAccess: CanAccess
): MobileNav | null {
  const member = isPureStartupMember(roles);
  const plan = member ? MEMBER : STAFF;
  const ok = (id: string) => canAccess(roles, id, disabledModules);

  const centerId = plan.center.find(ok);
  if (!centerId) return null;
  const center = toItem(centerId, counts, member && centerId === 'min_oversikt' ? 'Översikt' : undefined);
  if (!center) return null;

  const used = new Set<string>([centerId]);
  const pick = (candidates: string[], n: number): MobileNavItem[] => {
    const out: MobileNavItem[] = [];
    for (const id of candidates) {
      if (out.length >= n) break;
      if (used.has(id) || !ok(id)) continue;
      const item = toItem(id, counts);
      if (!item) continue;
      used.add(id);
      out.push(item);
    }
    return out;
  };

  return { left: pick(plan.left, 2), center, right: pick(plan.right, 1) };
}
