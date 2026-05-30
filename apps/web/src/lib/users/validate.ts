// Ren, server-fri validering av staff-registrerade bolagsmedlemmar.
// Bryts ut ur server-actionen (`lib/actions/users.ts`) så logiken kan
// enhetstestas utan PocketBase/Next-kontext (samma mönster som
// packages/shared/src/workshop.ts).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface NewMemberInput {
  email: string;
  displayName: string;
  password: string;
  startupId: string;
}

export type ValidationResult =
  | { ok: true; value: NewMemberInput }
  | { ok: false; message: string };

/**
 * Normaliserar (trim + gemener på e-post) och validerar inputen för en ny
 * startup_member. Returnerar antingen ett rensat värde eller ett svenskt
 * felmeddelande lämpligt att visa i UI:t.
 */
export function validateNewMemberInput(raw: {
  email?: unknown;
  displayName?: unknown;
  password?: unknown;
  startupId?: unknown;
}): ValidationResult {
  const email = String(raw.email ?? '').trim().toLowerCase();
  const displayName = String(raw.displayName ?? '').trim();
  const password = String(raw.password ?? '');
  const startupId = String(raw.startupId ?? '').trim();

  if (!email || !displayName || !password || !startupId) {
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

  return { ok: true, value: { email, displayName, password, startupId } };
}
