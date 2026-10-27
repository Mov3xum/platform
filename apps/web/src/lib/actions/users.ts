'use server';

import { revalidatePath } from 'next/cache';
import type PocketBase from 'pocketbase';
import { type Role } from '@platform/shared';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { loadAgentLogEntries } from '@/lib/feed/agent-log';
import {
  assignableRolesFor,
  canManageUser,
  ROLE_LABELS,
  enabledModulesAfterRoleChange,
  validateDeleteConfirmation,
  validateDisplayName,
  validateEnabledModules,
  validateNewPassword,
  validateNewUserInput,
  validateRolesUpdate
} from '@/lib/users/validate';

// Staff-initierad registrering av plattformsanvändare.
//
// Skapar en verifierad användare med vald roll så att personen kan logga in
// direkt i sin miljö. För `startup_member` länkas dessutom ett bolag.
// Användarskapande går via superuser-klienten eftersom `users.createRule =
// null` (ingen publik registrering den vägen) — se migration 1700000002.
//
// Regelefterlevnad (CLAUDE.md §10.5):
// - RBAC via hasRole (admin/incubator_lead) + `assignableRolesFor` så en
//   incubator_lead aldrig kan skapa en admin (ingen privilegieeskalering).
//   Aldrig inline-rollkoll.
// - Tenant-isolation: bolaget korsverifieras mot inloggad staffs tenant.
// - Dataminimering: bara e-post + visningsnamn (befintliga users-fält).
//   Rättslig grund = avtal (bolagsmedlem) / berättigat intresse (drift).
// - Loggar aldrig lösenord eller PII i klartext.

export type CreateUserState = {
  status: 'idle' | 'ok' | 'error';
  message?: string;
  createdEmail?: string;
  startupName?: string;
};

type PbError = {
  status?: number;
  message?: string;
  data?: { data?: Record<string, { message?: string }>; message?: string };
};

export async function createUserAction(
  _prev: CreateUserState,
  formData: FormData
): Promise<CreateUserState> {
  // 1. Auth + RBAC
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    return { status: 'error', message: 'Endast inkubatorledning får registrera användare.' };
  }
  const assignableRoles = assignableRolesFor(user.roles as Role[]);

  // 2. Input-validering (ren logik delas med enhetstesten). Rollbehörigheten
  //    valideras både här (defense-in-depth) och implicit via listan ovan.
  const validated = validateNewUserInput(
    {
      email: formData.get('email'),
      displayName: formData.get('display_name'),
      password: formData.get('password'),
      role: formData.get('role'),
      startupId: formData.get('startup_id')
    },
    { assignableRoles }
  );
  if (!validated.ok) {
    return { status: 'error', message: validated.message };
  }
  const { email, displayName, password, role, startupId } = validated.value;

  // 2b. Moduler i sidofältet (§ 36.3): rollens standard är förbockad i
  //     formuläret; staff kan lägga till/ta bort innan kontot skapas. Saknas
  //     fältet helt används rollens standard. Bara moduler rollen tillåter.
  const modulesRaw = formData.get('enabled_modules');
  const modules = validateEnabledModules(modulesRaw === null ? undefined : modulesRaw, [role]);
  if (!modules.ok) {
    return { status: 'error', message: modules.message };
  }

  // 3. Superuser-klient (createRule = null kräver superuser)
  const suResult = await getSuperuserPb();
  if (!suResult.ok) {
    return {
      status: 'error',
      message:
        suResult.reason === 'missing_credentials'
          ? 'Serverfel: superuser-credentials saknas. Kontakta administratören.'
          : 'Serverfel: kunde inte autentisera superuser.'
    };
  }
  const pb = suResult.pb;

  // 4. Tenant-isolation: ett ev. bolag måste tillhöra inloggad staffs tenant.
  //    Bara `startup_member` länkas till ett bolag.
  let startupName = '';
  const linkedStartups: string[] = [];
  if (role === 'startup_member') {
    try {
      const startup = await pb
        .collection('startups')
        .getOne<{ id: string; name: string; tenant: string }>(startupId, {
          fields: 'id,name,tenant'
        });
      if (startup.tenant !== user.tenant) {
        return { status: 'error', message: 'Bolaget tillhör inte din organisation.' };
      }
      startupName = startup.name;
      linkedStartups.push(startupId);
    } catch {
      return { status: 'error', message: 'Bolaget kunde inte hittas.' };
    }
  }

  // 5. Skapa verifierad användare med vald roll.
  let createdId = '';
  try {
    const created = await pb.collection('users').create<{ id: string }>({
      email,
      password,
      passwordConfirm: password,
      display_name: displayName,
      tenant: user.tenant,
      roles: [role],
      verified: true,
      linked_startups: linkedStartups,
      enabled_modules: modules.value
    });
    createdId = created.id;
  } catch (err: unknown) {
    const e = err as PbError;
    if (e.status === 400) {
      const fieldErrors = e.data?.data;
      if (fieldErrors?.email?.message) {
        // PB ger generiskt meddelande; vanligaste orsaken är dubblett.
        return {
          status: 'error',
          message: 'E-postadressen används redan eller är ogiltig.'
        };
      }
      if (fieldErrors) {
        const first = Object.values(fieldErrors)[0];
        if (first?.message) return { status: 'error', message: first.message };
      }
      return { status: 'error', message: e.data?.message || 'Ogiltig data. Kontrollera fälten.' };
    }
    console.error('[createUser] failed', { status: e.status });
    return { status: 'error', message: 'Kunde inte skapa användaren. Försök igen.' };
  }

  revalidatePath('/installningar/anvandare');
  revalidatePath('/installningar');

  // Schema-drift (§ 36.3): kontot finns, men modulvalet kan ha släppts tyst.
  let modulesNote = '';
  if (createdId && !(await enabledModulesFieldPresent(pb, createdId))) {
    console.error('[createUser] enabled_modules missing in schema — migration 1700000144 not applied');
    modulesNote = ` OBS: ${MODULES_SCHEMA_HINT}`;
  }

  const roleLabel = ROLE_LABELS[role];
  return {
    status: 'ok',
    message:
      (startupName
        ? `Användaren ${email} skapades som ${roleLabel} och länkades till ${startupName}.`
        : `Användaren ${email} skapades som ${roleLabel}.`) + modulesNote,
    createdEmail: email,
    startupName
  };
}

/**
 * PocketBase släpper okända fält TYST vid create/update. Saknar instansen
 * migration 1700000144 (`users.enabled_modules`) skulle en sparning annars
 * rapportera "sparat" utan att något lagrats (CLAUDE.md § 24.4/§ 30.4-
 * invarianten: aldrig tyst lyckad no-op). Läser tillbaka posten och svarar
 * `false` om fältet inte finns i schemat.
 */
async function enabledModulesFieldPresent(pb: PocketBase, userId: string): Promise<boolean> {
  try {
    const rec = await pb
      .collection('users')
      .getOne<Record<string, unknown>>(userId, { fields: 'id,enabled_modules' });
    return Object.prototype.hasOwnProperty.call(rec, 'enabled_modules');
  } catch {
    return false;
  }
}

const MODULES_SCHEMA_HINT =
  'Modulvalet kunde inte sparas: fältet users.enabled_modules saknas i PocketBase-schemat. Kör migration 1700000144 (eller setup-via-api.mjs) och försök igen.';

// Koppla en BEFINTLIG användare till ett bolag (eller ta bort kopplingen).
//
// `linked_startups` styr hela bolagsmedlemmens vy + RLS (CLAUDE.md §21) men
// sattes tidigare bara vid kontoskapande (`createUserAction`). En medlem som
// skapades utan bolag — eller bara lades till i teamlistan
// (`startup_team_members`, en separat roster) — fick därför aldrig se sina
// tilldelade workshops/dokument. Den här actionen stänger luckan.
//
// Regelefterlevnad (CLAUDE.md §10.5):
// - RBAC via hasRole (admin/incubator_lead) — aldrig inline-rollkoll.
// - Tenant-isolation: både målanvändaren och bolaget korsverifieras mot
//   inloggad staffs tenant.
// - Dataminimering: rör bara `linked_startups`-relationen, ingen ny PII.
//   Rättslig grund = avtal (bolagsmedlem) / berättigat intresse (drift).
// - Skrivning via superuser (users.updateRule är restriktiv); ingen
//   privilegieeskalering (rollen ändras inte här).

export type UpdateUserState = {
  status: 'idle' | 'ok' | 'error';
  message?: string;
};

export async function updateUserStartupLinkAction(
  _prev: UpdateUserState,
  formData: FormData
): Promise<UpdateUserState> {
  // 1. Auth + RBAC
  const actor = await requireUser();
  if (!hasRole(actor.roles, ['admin', 'incubator_lead'])) {
    return { status: 'error', message: 'Endast inkubatorledning får ändra bolagskoppling.' };
  }

  // 2. Input
  const userId = String(formData.get('user_id') ?? '').trim();
  const startupId = String(formData.get('startup_id') ?? '').trim();
  if (!userId) {
    return { status: 'error', message: 'Användare saknas.' };
  }

  // 3. Superuser-klient (users-skrivning kräver superuser)
  const suResult = await getSuperuserPb();
  if (!suResult.ok) {
    return {
      status: 'error',
      message:
        suResult.reason === 'missing_credentials'
          ? 'Serverfel: superuser-credentials saknas. Kontakta administratören.'
          : 'Serverfel: kunde inte autentisera superuser.'
    };
  }
  const pb = suResult.pb;

  // 4. Tenant-isolation: målanvändaren måste tillhöra inloggad staffs tenant.
  let targetEmail = '';
  try {
    const target = await pb
      .collection('users')
      .getOne<{ id: string; tenant: string; email?: string; roles?: unknown }>(userId, {
        fields: 'id,tenant,email,roles'
      });
    if (String(target.tenant) !== actor.tenant) {
      return { status: 'error', message: 'Användaren tillhör inte din organisation.' };
    }
    const targetRoles = Array.isArray(target.roles)
      ? target.roles.filter((r): r is string => typeof r === 'string')
      : [];
    if (!canManageUser(actor.roles, targetRoles)) {
      return { status: 'error', message: 'Bara en administratör kan administrera ett admin-konto.' };
    }
    targetEmail = target.email ?? '';
  } catch {
    return { status: 'error', message: 'Användaren kunde inte hittas.' };
  }

  // 5. Bolaget (om satt) måste finnas och tillhöra samma tenant. Tomt = koppla bort.
  let startupName = '';
  const linkedStartups: string[] = [];
  if (startupId) {
    try {
      const startup = await pb
        .collection('startups')
        .getOne<{ id: string; name: string; tenant: string }>(startupId, {
          fields: 'id,name,tenant'
        });
      if (startup.tenant !== actor.tenant) {
        return { status: 'error', message: 'Bolaget tillhör inte din organisation.' };
      }
      startupName = startup.name;
      linkedStartups.push(startupId);
    } catch {
      return { status: 'error', message: 'Bolaget kunde inte hittas.' };
    }
  }

  // 6. Skriv kopplingen.
  try {
    await pb.collection('users').update(userId, { linked_startups: linkedStartups });
  } catch (err: unknown) {
    const e = err as PbError;
    console.error('[updateUserStartupLink] failed', { status: e.status });
    return { status: 'error', message: 'Kunde inte uppdatera bolagskopplingen. Försök igen.' };
  }

  revalidatePath('/installningar/anvandare');
  revalidatePath('/installningar');

  const who = targetEmail || 'användaren';
  return {
    status: 'ok',
    message: startupName
      ? `Kopplade ${who} till ${startupName}. Personen ser sina aktiviteter vid nästa sidladdning.`
      : `Tog bort bolagskopplingen för ${who}.`
  };
}

// ── Administration av befintliga användare (Inställningar → Användare) ─────
//
// Tre actions som låter admin/incubator_lead sköta hela livscykeln för ett
// konto i den egna tenanten: roller, nytt initialt lösenord och radering.
// Gemensamt mönster:
// - RBAC via hasRole + `canManageUser` (incubator_lead rör aldrig admin-konton)
//   + `assignableRolesFor` (ingen privilegieeskalering). Aldrig inline-rollkoll.
// - Tenant-isolation: målanvändaren läses via superuser och korsverifieras
//   mot inloggad staffs tenant INNAN någon skrivning.
// - Självskydd: egna administrationsroller kan inte tas bort, eget lösenord
//   byts på /konto, eget konto kan inte raderas här.
// - Loggar aldrig lösenord eller PII i klartext (bara status/id).

/**
 * Kontoövertagande (nytt lösenord, radering) av ett ANNAT ledningskonto
 * (`incubator_lead`) kräver admin — en incubator_lead ska inte kunna ta över
 * ett jämbördigt konto.
 */
function canTakeOverPeer(actorRoles: readonly string[] | undefined, targetRoles: readonly string[]): boolean {
  if (actorRoles?.includes('admin')) return true;
  return !targetRoles.includes('incubator_lead');
}

async function loadManagedTarget(
  actor: { id: string; tenant: string; roles?: Role[] },
  userId: string
): Promise<
  | { ok: true; pb: PocketBase; target: { id: string; email: string; roles: string[] } }
  | { ok: false; message: string }
> {
  if (!hasRole(actor.roles, ['admin', 'incubator_lead'])) {
    return { ok: false, message: 'Endast inkubatorledning får administrera användare.' };
  }
  if (!userId) return { ok: false, message: 'Användare saknas.' };

  const suResult = await getSuperuserPb();
  if (!suResult.ok) {
    return {
      ok: false,
      message:
        suResult.reason === 'missing_credentials'
          ? 'Serverfel: superuser-credentials saknas. Kontakta administratören.'
          : 'Serverfel: kunde inte autentisera superuser.'
    };
  }
  const pb = suResult.pb;

  try {
    const target = await pb
      .collection('users')
      .getOne<{ id: string; tenant: string; email?: string; roles?: unknown }>(userId, {
        fields: 'id,tenant,email,roles'
      });
    if (String(target.tenant) !== actor.tenant) {
      return { ok: false, message: 'Användaren tillhör inte din organisation.' };
    }
    const roles = Array.isArray(target.roles)
      ? target.roles.filter((r): r is string => typeof r === 'string')
      : [];
    if (!canManageUser(actor.roles, roles)) {
      return { ok: false, message: 'Bara en administratör kan administrera ett admin-konto.' };
    }
    return { ok: true, pb, target: { id: target.id, email: target.email ?? '', roles } };
  } catch {
    return { ok: false, message: 'Användaren kunde inte hittas.' };
  }
}

/** Sätter en befintlig användares rolluppsättning. */
export async function updateUserRolesAction(
  _prev: UpdateUserState,
  formData: FormData
): Promise<UpdateUserState> {
  const actor = await requireUser();
  const userId = String(formData.get('user_id') ?? '').trim();
  const loaded = await loadManagedTarget(actor, userId);
  if (!loaded.ok) return { status: 'error', message: loaded.message };

  const validated = validateRolesUpdate(formData.get('roles'), {
    assignableRoles: assignableRolesFor(actor.roles as Role[]),
    isSelf: userId === actor.id
  });
  if (!validated.ok) return { status: 'error', message: validated.message };

  // Moduler i sidofältet följer med rollbytet (§ 36.3): personens val behålls,
  // den nya rolluppsättningens standard läggs till och moduler de nya rollerna
  // inte tillåter släpps — en befordran ger aldrig en krympt meny. En aldrig
  // justerad lista (null) lämnas orörd (den följer rollen automatiskt).
  let storedModules: unknown = null;
  try {
    const cur = await loaded.pb
      .collection('users')
      .getOne<{ enabled_modules?: unknown }>(userId, { fields: 'id,enabled_modules' });
    storedModules = cur.enabled_modules ?? null;
  } catch {
    storedModules = null;
  }
  const nextModules = enabledModulesAfterRoleChange(storedModules, validated.value);

  try {
    await loaded.pb.collection('users').update(userId, {
      roles: validated.value,
      ...(nextModules ? { enabled_modules: nextModules } : {})
    });
  } catch (err: unknown) {
    const e = err as PbError;
    console.error('[updateUserRoles] failed', { status: e.status });
    return { status: 'error', message: 'Kunde inte spara rollerna. Försök igen.' };
  }

  revalidatePath('/installningar/anvandare');
  revalidatePath('/', 'layout');
  const labels = validated.value.map((r) => ROLE_LABELS[r]).join(', ');
  return { status: 'ok', message: `Roller sparade: ${labels}.` };
}

/**
 * Sätter vilka moduler som visas i sidofältet för en användare (§ 36.3).
 * Allow-listan valideras mot MÅLANVÄNDARENS roller — den kan aldrig ge mer
 * än rollen tillåter. Skrivs via superuser (users.updateRule är
 * "@request.auth.id = id"); RBAC + tenant-check i `loadManagedTarget` är
 * säkerhetsgränsen. Ingen personuppgift — bara modul-id:n.
 */
export async function updateUserModulesAction(
  _prev: UpdateUserState,
  formData: FormData
): Promise<UpdateUserState> {
  const actor = await requireUser();
  const userId = String(formData.get('user_id') ?? '').trim();
  const loaded = await loadManagedTarget(actor, userId);
  if (!loaded.ok) return { status: 'error', message: loaded.message };

  const validated = validateEnabledModules(
    formData.get('enabled_modules') ?? '[]',
    loaded.target.roles as Role[]
  );
  if (!validated.ok) return { status: 'error', message: validated.message };

  try {
    await loaded.pb.collection('users').update(userId, { enabled_modules: validated.value });
  } catch (err: unknown) {
    const e = err as PbError;
    console.error('[updateUserModules] failed', { status: e.status });
    return { status: 'error', message: 'Kunde inte spara modulerna. Försök igen.' };
  }
  if (!(await enabledModulesFieldPresent(loaded.pb, userId))) {
    console.error('[updateUserModules] enabled_modules missing in schema — migration 1700000144 not applied');
    return { status: 'error', message: MODULES_SCHEMA_HINT };
  }

  revalidatePath('/installningar/anvandare');
  revalidatePath('/', 'layout');
  const n = validated.value.length;
  return {
    status: 'ok',
    message: `${n} modul${n === 1 ? '' : 'er'} visas i sidofältet. Ändringen syns vid nästa sidladdning.`
  };
}

/**
 * Byter visningsnamn på ett konto i den egna tenanten (pennan i
 * Inställningar → Användare). Samma RBAC/tenant-gate som övrig
 * användaradministration (`loadManagedTarget`); det egna kontot får också
 * döpas om här. Bara `display_name` skrivs — aldrig e-post eller roller.
 */
export async function updateUserDisplayNameAction(
  _prev: UpdateUserState,
  formData: FormData
): Promise<UpdateUserState> {
  const actor = await requireUser();
  const userId = String(formData.get('user_id') ?? '').trim();
  const loaded = await loadManagedTarget(actor, userId);
  if (!loaded.ok) return { status: 'error', message: loaded.message };

  const validated = validateDisplayName(formData.get('display_name'));
  if (!validated.ok) return { status: 'error', message: validated.message };

  try {
    await loaded.pb.collection('users').update(userId, { display_name: validated.value });
  } catch (err: unknown) {
    const e = err as PbError;
    console.error('[updateUserDisplayName] failed', { status: e.status });
    return { status: 'error', message: 'Kunde inte spara namnet. Försök igen.' };
  }

  revalidatePath('/installningar/anvandare');
  revalidatePath('/', 'layout');
  return { status: 'ok', message: 'Namnet är sparat.' };
}

/** Sätter ett nytt initialt lösenord åt en annan användare. */
export async function resetUserPasswordAction(
  _prev: UpdateUserState,
  formData: FormData
): Promise<UpdateUserState> {
  const actor = await requireUser();
  const userId = String(formData.get('user_id') ?? '').trim();
  if (userId && userId === actor.id) {
    return { status: 'error', message: 'Byt ditt eget lösenord under Mitt konto.' };
  }
  const loaded = await loadManagedTarget(actor, userId);
  if (!loaded.ok) return { status: 'error', message: loaded.message };
  if (!canTakeOverPeer(actor.roles, loaded.target.roles)) {
    return { status: 'error', message: 'Bara en administratör kan återställa lösenordet för ett annat ledningskonto.' };
  }

  const validated = validateNewPassword(formData.get('password'));
  if (!validated.ok) return { status: 'error', message: validated.message };

  try {
    await loaded.pb.collection('users').update(userId, {
      password: validated.value,
      passwordConfirm: validated.value
    });
  } catch (err: unknown) {
    const e = err as PbError;
    console.error('[resetUserPassword] failed', { status: e.status });
    return { status: 'error', message: 'Kunde inte sätta nytt lösenord. Försök igen.' };
  }

  return {
    status: 'ok',
    message: 'Nytt lösenord satt. Dela det säkert — personens tidigare sessioner loggas ut.'
  };
}

/**
 * Raderar ett konto i den egna tenanten (GDPR art. 17). Kräver att aktören
 * skriver in målanvändarens e-post. PocketBase vägrar radera om kontot
 * refereras av en obligatorisk relation — då visas ett tydligt fel i stället
 * för en tyst halvradering.
 */
export async function deleteUserAction(
  _prev: UpdateUserState,
  formData: FormData
): Promise<UpdateUserState> {
  const actor = await requireUser();
  const userId = String(formData.get('user_id') ?? '').trim();
  if (userId && userId === actor.id) {
    return { status: 'error', message: 'Du kan inte radera ditt eget konto här.' };
  }
  const loaded = await loadManagedTarget(actor, userId);
  if (!loaded.ok) return { status: 'error', message: loaded.message };
  if (!canTakeOverPeer(actor.roles, loaded.target.roles)) {
    return { status: 'error', message: 'Bara en administratör kan radera ett annat ledningskonto.' };
  }

  const confirmed = validateDeleteConfirmation(formData.get('confirm_email'), loaded.target.email);
  if (!confirmed.ok) return { status: 'error', message: confirmed.message };

  try {
    await loaded.pb.collection('users').delete(userId);
  } catch (err: unknown) {
    const e = err as PbError;
    console.error('[deleteUser] failed', { status: e.status });
    if (e.status === 400) {
      return {
        status: 'error',
        message:
          'Kontot kunde inte raderas eftersom det refereras av annan data (t.ex. körningar eller uppgifter). Ta bort rollerna och bolagskopplingen i stället, eller kontakta administratören för fullständig radering.'
      };
    }
    return { status: 'error', message: 'Kunde inte radera användaren. Försök igen.' };
  }

  revalidatePath('/installningar/anvandare');
  revalidatePath('/installningar');
  return { status: 'ok', message: `Kontot ${loaded.target.email || ''} är raderat.` };
}

/* ── Användarlogg (CLAUDE.md § 36.4) ───────────────────────────────── */

export type UserActivityEntry = {
  id: string;
  title: string;
  detail?: string;
  created: string;
  href?: string;
  icon: string;
  viaAgent: boolean;
};

export type UserActivityLog = {
  status: 'ok' | 'error';
  message?: string;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  loginCount: number;
  /** Inloggningar, nyast först (ISO-tidsstämplar), högst 25. */
  logins: string[];
  loginsTotal: number;
  /** false när `user_login_events` saknas (migration 1700000206 ej körd). */
  historyAvailable: boolean;
  /** Det personen gjort via skrivlagret (`agent_actions`, actor = personen). */
  entries: UserActivityEntry[];
};

const EMPTY_ACTIVITY: Omit<UserActivityLog, 'status' | 'message'> = {
  lastLoginAt: null,
  lastActiveAt: null,
  loginCount: 0,
  logins: [],
  loginsTotal: 0,
  historyAvailable: true,
  entries: []
};

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = new Date(value.includes('T') ? value : value.replace(' ', 'T')).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Aktivitetsloggen för ett konto i Inställningar → Användare: senaste
 * inloggning/aktivitet, inloggningshistorik (`user_login_events`) och det
 * personen själv gjort i plattformen (skrivlagrets logg, § 32). Samma RBAC +
 * tenant-korsverifiering som övrig användaradministration
 * (`loadManagedTarget`). Historiken läses med den inloggades egen token
 * (lead-only RLS) och faller bara tillbaka på superusern vid PB v0.23.4:s
 * tysta regel-nekande (§ 21.3) — alltid tenant-filtrerat. Ingen PII i
 * svaret utöver det listan redan visar; loggar bär status, aldrig id.
 */
export async function loadUserActivityAction(userId: string): Promise<UserActivityLog> {
  const actor = await requireUser();
  const managed = await loadManagedTarget(actor, String(userId ?? ''));
  if (!managed.ok) return { status: 'error', message: managed.message, ...EMPTY_ACTIVITY };
  const su = managed.pb;
  const target = managed.target;

  let lastLoginAt: string | null = null;
  let lastActiveAt: string | null = null;
  let loginCount = 0;
  try {
    const row = await su
      .collection('users')
      .getOne<{ last_login_at?: unknown; last_active_at?: unknown; login_count?: unknown }>(target.id, {
        fields: 'id,last_login_at,last_active_at,login_count'
      });
    lastLoginAt = isoOrNull(row.last_login_at);
    lastActiveAt = isoOrNull(row.last_active_at);
    loginCount = typeof row.login_count === 'number' ? row.login_count : 0;
  } catch (error) {
    console.error('[users] activity: failed to read user stamps', {
      status: (error as { status?: number }).status
    });
  }

  const userPb = await getServerPb();
  const loginFilter = (pb: PocketBase) =>
    pb.filter('tenant = {:tenant} && user = {:user}', { tenant: actor.tenant, user: target.id });
  let logins: string[] = [];
  let loginsTotal = 0;
  let historyAvailable = true;
  const readLogins = async (pb: PocketBase) => {
    const res = await pb.collection('user_login_events').getList<{ created: string }>(1, 25, {
      filter: loginFilter(pb),
      sort: '-created',
      fields: 'id,created'
    });
    return res;
  };
  try {
    let res = await readLogins(userPb);
    // PB v0.23.4 kan tyst neka en behörig token (200 med 0 rader, § 21.8):
    // en tom lista dubbelkollas via superusern innan den tas som sanning.
    if (res.totalItems === 0) res = await readLogins(su);
    logins = res.items.map((r) => isoOrNull(r.created)).filter((v): v is string => v !== null);
    loginsTotal = res.totalItems;
  } catch (error) {
    const status = (error as { status?: number }).status ?? 0;
    if (status === 404) {
      historyAvailable = false;
    } else {
      try {
        const res = await readLogins(su);
        logins = res.items.map((r) => isoOrNull(r.created)).filter((v): v is string => v !== null);
        loginsTotal = res.totalItems;
      } catch (inner) {
        const innerStatus = (inner as { status?: number }).status ?? 0;
        if (innerStatus === 404) historyAvailable = false;
        else console.error('[users] activity: failed to read login events', { status: innerStatus });
      }
    }
  }

  // Skrivlagrets logg med personen som actor — admin/incubator_lead läser
  // tenantens logg (RLS); fail-soft inne i loadAgentLogEntries.
  let entriesRaw = await loadAgentLogEntries(userPb, actor.tenant, 40, { actorId: target.id });
  if (entriesRaw.length === 0) {
    entriesRaw = await loadAgentLogEntries(su, actor.tenant, 40, { actorId: target.id });
  }
  const entries: UserActivityEntry[] = entriesRaw.map((e) => ({
    id: e.id,
    title: e.title,
    detail: e.detail,
    created: isoOrNull(e.created) ?? e.created,
    href: e.href,
    icon: e.icon,
    viaAgent: e.viaAgent
  }));

  return {
    status: 'ok',
    lastLoginAt,
    lastActiveAt,
    loginCount,
    logins,
    loginsTotal,
    historyAvailable,
    entries
  };
}
