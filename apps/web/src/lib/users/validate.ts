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
