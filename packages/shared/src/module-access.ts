// Modulåtkomst per användare (CLAUDE.md § 36.3).
//
// Vilka moduler som syns i sidofältet styrs av en ALLOW-LISTA per användare
// (`users.enabled_modules`), inte av en global tenant-inställning. När ett
// konto skapas förbockas rollens standardmoduler; admin/incubator_lead kan
// därefter lägga till och ta bort per person under Inställningar → Användare.
//
// Detta är UI-kurering — den hårda behörighetsgränsen är fortsatt rollen
// (`rolesAllowed` på modulen, RBAC i lib/rbac.ts) + PB-RLS (§ 21). En modul
// som rollen inte tillåter kan aldrig bockas i, och en ibockad modul ger
// aldrig mer än rollen redan får.
//
// Ren, server-/React-fri logik (enhetstestad i module-access.test.ts). Tar
// aldrig in `coreModules` direkt (cirkulärt beroende mot index.ts) — rollens
// behörighet prövas av anroparen.

import type { Role } from './index';

/**
 * Standardmoduler per roll — det som är ibockat när ett konto skapas.
 * Flera roller ⇒ unionen av rollernas standard.
 */
export const DEFAULT_MODULES_BY_ROLE: Record<Role, readonly string[]> = {
  admin: [
    'idag', 'inkorg', 'pagaende', 'arshjul', 'filer', 'uppdrag', 'inflode',
    'startups', 'de_minimis', 'investerare', 'events', 'community',
    'education', 'rapporter', 'agenter', 'kunskapsbas', 'insights',
    'integrationer', 'min_profil'
  ],
  incubator_lead: [
    'idag', 'inkorg', 'pagaende', 'arshjul', 'filer', 'uppdrag', 'inflode',
    'startups', 'de_minimis', 'investerare', 'events', 'community',
    'education', 'rapporter', 'agenter', 'kunskapsbas', 'insights',
    'integrationer', 'min_profil'
  ],
  coach: [
    'idag', 'inkorg', 'pagaende', 'arshjul', 'filer', 'uppdrag', 'inflode',
    'startups', 'events', 'education', 'agenter', 'kunskapsbas', 'min_profil'
  ],
  mentor: [
    'idag', 'inkorg', 'pagaende', 'filer', 'uppdrag', 'startups', 'education',
    'agenter', 'min_profil'
  ],
  partner: ['idag', 'inkorg', 'filer', 'uppdrag', 'community', 'min_profil'],
  observer: [
    'idag', 'inkorg', 'pagaende', 'arshjul', 'filer', 'startups', 'events',
    'community'
  ],
  startup_member: ['min_oversikt', 'mina_aktiviteter', 'filer', 'de_minimis', 'community']
};

/**
 * Moduler som ALDRIG kan bockas ur — de styrs helt av rollen.
 * `installningar`/`anvandare`: annars kan en admin låsa sig själv ute.
 * Övriga är legacy-/dolda modul-id:n som bara används i sidornas
 * `canAccessModule`-anrop och inte visas i railen.
 */
export const ALWAYS_ON_MODULE_IDS: readonly string[] = [
  'installningar',
  'anvandare',
  'onboarding',
  'activity_feed',
  'partners'
];

/** Legacy-id → det id som faktiskt bockas i/ur (följer målets status). */
export const MODULE_ID_ALIASES: Record<string, string> = {
  toolbox: 'agenter',
  dashboard: 'idag'
};

/** Kan modulen bockas i/ur per användare? (Alltid-på och alias-id:n kan inte.) */
export function isToggleableModule(moduleId: string): boolean {
  return !ALWAYS_ON_MODULE_IDS.includes(moduleId) && !(moduleId in MODULE_ID_ALIASES);
}

function uniq(ids: Iterable<string>): string[] {
  return Array.from(new Set(ids));
}

/** Rollernas standardmoduler (union över alla roller, stabil ordning). */
export function defaultModulesForRoles(roles: readonly Role[] | undefined): string[] {
  const out: string[] = [];
  for (const role of roles ?? []) {
    const defaults = DEFAULT_MODULES_BY_ROLE[role];
    if (!defaults) continue;
    for (const id of defaults) if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Räknar fram användarens effektiva allow-lista.
 *
 * - `stored` (users.enabled_modules) är en array ⇒ används som den är
 *   (okända/otogglebara id:n filtreras bort). Tom array är ett giltigt val
 *   ("inga extra moduler").
 * - `stored` saknas (konto skapat före migration 1700000144, eller aldrig
 *   justerat) ⇒ rollens standard MINUS ev. legacy `disabled_modules` på
 *   användaren, så en tidigare per-person-avstängning respekteras.
 */
export function resolveEnabledModules(input: {
  roles: readonly Role[] | undefined;
  stored?: unknown;
  legacyDisabled?: unknown;
}): string[] {
  if (Array.isArray(input.stored)) {
    return uniq(
      input.stored
        .filter((v): v is string => typeof v === 'string')
        .filter((id) => isToggleableModule(id))
    );
  }
  const disabled = new Set(
    Array.isArray(input.legacyDisabled)
      ? input.legacyDisabled.filter((v): v is string => typeof v === 'string')
      : []
  );
  return defaultModulesForRoles(input.roles).filter((id) => !disabled.has(id));
}

/**
 * Är modulen ibockad för användaren? Rollens behörighet prövas INTE här —
 * anroparen (lib/rbac.ts) kombinerar med `canAccessModule`.
 * `enabledModules === undefined` betyder "ingen per-användar-lista känd"
 * (t.ex. legacy-komponenter) och begränsar då inte.
 */
export function isModuleEnabled(
  enabledModules: readonly string[] | undefined,
  moduleId: string
): boolean {
  if (ALWAYS_ON_MODULE_IDS.includes(moduleId)) return true;
  if (enabledModules === undefined) return true;
  const target = MODULE_ID_ALIASES[moduleId] ?? moduleId;
  return enabledModules.includes(target);
}

/**
 * Sanerar en inskickad allow-lista: bara strängar, bara togglebara id:n och
 * bara sådana som finns i `allowedIds` (= vad målanvändarens roller får).
 * Ren funktion — server-actions använder den som säkerhetsgräns.
 */
export function sanitizeEnabledModules(
  raw: unknown,
  allowedIds: readonly string[]
): { ok: true; value: string[] } | { ok: false; message: string } {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = raw.trim() === '' ? [] : JSON.parse(raw);
    } catch {
      return { ok: false, message: 'Ogiltigt format på moduldata.' };
    }
  }
  if (parsed === null || parsed === undefined) parsed = [];
  if (!Array.isArray(parsed)) {
    return { ok: false, message: 'Ogiltigt format på moduldata.' };
  }
  const allowed = new Set(allowedIds);
  const value = uniq(
    parsed
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter((id) => isToggleableModule(id) && allowed.has(id))
  );
  return { ok: true, value };
}
