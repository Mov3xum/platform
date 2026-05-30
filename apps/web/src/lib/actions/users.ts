'use server';

import { revalidatePath } from 'next/cache';
import { type Role } from '@platform/shared';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { assignableRolesFor, ROLE_LABELS, validateNewUserInput } from '@/lib/users/validate';

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
  try {
    await pb.collection('users').create({
      email,
      password,
      passwordConfirm: password,
      display_name: displayName,
      tenant: user.tenant,
      roles: [role],
      verified: true,
      linked_startups: linkedStartups
    });
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

  revalidatePath('/admin/users');

  const roleLabel = ROLE_LABELS[role];
  return {
    status: 'ok',
    message: startupName
      ? `Användaren ${email} skapades som ${roleLabel} och länkades till ${startupName}.`
      : `Användaren ${email} skapades som ${roleLabel}.`,
    createdEmail: email,
    startupName
  };
}
