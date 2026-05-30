'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { validateNewMemberInput } from '@/lib/users/validate';

// Staff-initierad registrering av plattformsanvändare.
//
// Skapar en verifierad `startup_member`-profil och länkar den till ett bolag
// så att personen kan logga in direkt i sin miljö. Användarskapande går via
// superuser-klienten eftersom `users.createRule = null` (ingen publik
// registrering den vägen) — se migration 1700000002.
//
// Regelefterlevnad (CLAUDE.md §10.5):
// - RBAC via hasRole (admin/incubator_lead), aldrig inline-rollkoll.
// - Tenant-isolation: bolaget korsverifieras mot inloggad staffs tenant.
// - Dataminimering: bara e-post + visningsnamn (befintliga users-fält).
//   Rättslig grund = avtal (bolagsmedlem) / berättigat intresse (drift).
// - Loggar aldrig lösenord eller PII i klartext.

export type CreateStartupMemberState = {
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

export async function createStartupMemberAction(
  _prev: CreateStartupMemberState,
  formData: FormData
): Promise<CreateStartupMemberState> {
  // 1. Auth + RBAC
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    return { status: 'error', message: 'Endast inkubatorledning får registrera användare.' };
  }

  // 2. Input-validering (ren logik delas med enhetstesten)
  const validated = validateNewMemberInput({
    email: formData.get('email'),
    displayName: formData.get('display_name'),
    password: formData.get('password'),
    startupId: formData.get('startup_id')
  });
  if (!validated.ok) {
    return { status: 'error', message: validated.message };
  }
  const { email, displayName, password, startupId } = validated.value;

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

  // 4. Tenant-isolation: bolaget måste tillhöra inloggad staffs tenant.
  let startupName = '';
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
  } catch {
    return { status: 'error', message: 'Bolaget kunde inte hittas.' };
  }

  // 5. Skapa verifierad startup_member-profil länkad till bolaget.
  try {
    await pb.collection('users').create({
      email,
      password,
      passwordConfirm: password,
      display_name: displayName,
      tenant: user.tenant,
      roles: ['startup_member'],
      verified: true,
      linked_startups: [startupId]
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
    console.error('[createStartupMember] failed', { status: e.status });
    return { status: 'error', message: 'Kunde inte skapa användaren. Försök igen.' };
  }

  revalidatePath('/admin/users');

  return {
    status: 'ok',
    message: `Användaren ${email} skapades och länkades till ${startupName}.`,
    createdEmail: email,
    startupName
  };
}
