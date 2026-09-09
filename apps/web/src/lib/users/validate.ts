// Ren, server-fri validering av staff-registrerade plattformsanvändare.
// Bryts ut ur server-actionen (`lib/actions/users.ts`) så logiken kan
// enhetstestas utan PocketBase/Next-kontext (samma mönster som
// packages/shared/src/workshop.ts).

import { ALL_ROLES, type Role } from '@platform/shared';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface NewUserInput {
  email: string;
  displayName: string;
  password: string;
  role: Role;
  /** Bara satt (icke-tom) för `startup_member`; tomt för staff-/portföljroller. */
  startupId: string;
}

export type ValidationResult =
  | { ok: true; value: NewUserInput }
  | { ok: false; message: string };

/** Svenska etiketter per roll — delas av formulär, action och listvy. */
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administratör',
  incubator_lead: 'Inkubatorledning',
  coach: 'Coach',
  mentor: 'Mentor',
  partner: 'Partner',
  startup_member: 'Bolagsmedlem',
  observer: 'Observatör'
};

/**
 * RBAC: vilka roller en skapare får tilldela.
 *
 * - `admin` får tilldela alla roller.
 * - `incubator_lead` får tilldela alla roller UTOM `admin` (ingen
 *   privilegieeskalering — bara en admin kan skapa en ny admin).
 *
 * Skaparen måste själv vara admin/incubator_lead (kontrolleras i
 * server-actionen innan denna anropas).
 */
export function assignableRolesFor(creatorRoles: Role[] | undefined): Role[] {
  if (creatorRoles?.includes('admin')) return [...ALL_ROLES];
  return ALL_ROLES.filter((r) => r !== 'admin');
}

/**
 * Normaliserar (trim + gemener på e-post) och validerar inputen för en ny
 * användare. Returnerar antingen ett rensat värde eller ett svenskt
 * felmeddelande lämpligt att visa i UI:t.
 *
 * Bolag (`startupId`) krävs endast för `startup_member`; för övriga roller
 * ignoreras det. Rollen måste finnas i `assignableRoles` (RBAC,
 * defense-in-depth ovanpå kontrollen i server-actionen).
 */
export function validateNewUserInput(
  raw: {
    email?: unknown;
    displayName?: unknown;
    password?: unknown;
    role?: unknown;
    startupId?: unknown;
  },
  opts: { assignableRoles: Role[] }
): ValidationResult {
  const email = String(raw.email ?? '').trim().toLowerCase();
  const displayName = String(raw.displayName ?? '').trim();
  const password = String(raw.password ?? '');
  const roleRaw = String(raw.role ?? '').trim();
  const startupId = String(raw.startupId ?? '').trim();

  if (!email || !displayName || !password || !roleRaw) {
    return { ok: false, message: 'Alla fält är obligatoriska.' };
  }
  if (!EMAIL_RE.test(email)) {
    return { ok: false, message: 'Ogiltig e-postadress.' };
  }
  if (displayName.length > 200) {
    return { ok: false, message: 'Namnet är för långt (max 200 tecken).' };
  }
  if (password.length < 8) {
    return { ok: false, message: 'Lösenordet måste vara minst 8 tecken.' };
  }
  if (!(ALL_ROLES as string[]).includes(roleRaw)) {
    return { ok: false, message: 'Ogiltig roll.' };
  }
  const role = roleRaw as Role;
  if (!opts.assignableRoles.includes(role)) {
    return { ok: false, message: 'Du har inte behörighet att tilldela den rollen.' };
  }
  // Bolag krävs bara för bolagsmedlemmar — övriga roller är staff/portfölj-breda.
  if (role === 'startup_member' && !startupId) {
    return { ok: false, message: 'Välj ett bolag för bolagsmedlemmen.' };
  }

  return {
    ok: true,
    value: {
      email,
      displayName,
      password,
      role,
      startupId: role === 'startup_member' ? startupId : ''
    }
  };
}

// ── Administration av BEFINTLIGA användare (roller, lösenord, radering) ─────
//
// Ren logik som delas av server-actions i `lib/actions/users.ts` och
// enhetstesterna. Principer (CLAUDE.md § 10.3 A.5.15–A.5.18):
// - Ingen privilegieeskalering: bara admin får röra admin-konton eller
//   tilldela admin-rollen.
// - Ingen självutlåsning: den inloggade kan inte ta bort sina egna
//   administrationsroller eller radera sig själv här.

/** Får aktören administrera (ändra roller/lösenord, radera) målanvändaren? */
export function canManageUser(
  actorRoles: readonly string[] | undefined,
  targetRoles: readonly string[] | undefined
): boolean {
  if (actorRoles?.includes('admin')) return true;
  // incubator_lead får hantera alla utom admin-konton.
  return !(targetRoles ?? []).includes('admin');
}

export type RolesUpdateResult = { ok: true; value: Role[] } | { ok: false; message: string };

/**
 * Validerar en ny rolluppsättning för en befintlig användare.
 * `raw` kan vara en JSON-sträng (formulär) eller en array.
 */
export function validateRolesUpdate(
  raw: unknown,
  opts: { assignableRoles: Role[]; isSelf: boolean }
): RolesUpdateResult {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, message: 'Ogiltigt format på rolldata.' };
    }
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, message: 'Ogiltigt format på rolldata.' };
  }
  const roles = Array.from(
    new Set(parsed.filter((r): r is string => typeof r === 'string').map((r) => r.trim()))
  );
  if (roles.length === 0) {
    return { ok: false, message: 'Användaren måste ha minst en roll.' };
  }
  for (const r of roles) {
    if (!(ALL_ROLES as string[]).includes(r)) {
      return { ok: false, message: `Ogiltig roll: ${r}.` };
    }
    if (!opts.assignableRoles.includes(r as Role)) {
      return { ok: false, message: 'Du har inte behörighet att tilldela den rollen.' };
    }
  }
  const value = roles as Role[];
  if (opts.isSelf && !value.includes('admin') && !value.includes('incubator_lead')) {
    return {
      ok: false,
      message: 'Du kan inte ta bort dina egna administrationsroller — be en annan administratör.'
    };
  }
  return { ok: true, value };
}

export type PasswordResult = { ok: true; value: string } | { ok: false; message: string };

export function validateNewPassword(raw: unknown): PasswordResult {
  const password = String(raw ?? '');
  if (password.length < 8) {
    return { ok: false, message: 'Lösenordet måste vara minst 8 tecken.' };
  }
  if (password.length > 72) {
    return { ok: false, message: 'Lösenordet är för långt (max 72 tecken).' };
  }
  return { ok: true, value: password };
}

/** Radering kräver att aktören skriver in målanvändarens e-post (skydd mot felklick). */
export function validateDeleteConfirmation(
  rawConfirm: unknown,
  targetEmail: string
): { ok: true } | { ok: false; message: string } {
  const confirm = String(rawConfirm ?? '').trim().toLowerCase();
  if (!confirm || confirm !== targetEmail.trim().toLowerCase()) {
    return { ok: false, message: 'Skriv användarens e-postadress exakt för att bekräfta raderingen.' };
  }
  return { ok: true };
}
