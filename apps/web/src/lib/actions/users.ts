'use server';

import { revalidatePath } from 'next/cache';
import { type Role } from '@platform/shared';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { escFilter } from '@/lib/pb-filter';
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
      .getOne<{ id: string; tenant: string; email?: string }>(userId, {
        fields: 'id,tenant,email'
      });
    if (String(target.tenant) !== actor.tenant) {
      return { status: 'error', message: 'Användaren tillhör inte din organisation.' };
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

  revalidatePath('/admin/users');

  const who = targetEmail || 'användaren';
  return {
    status: 'ok',
    message: startupName
      ? `Kopplade ${who} till ${startupName}. Personen ser sina aktiviteter vid nästa sidladdning.`
      : `Tog bort bolagskopplingen för ${who}.`
  };
}

// =============================================================================
// Diagnostik: varför ser en bolagsmedlem inte sina tilldelade aktiviteter?
//
// Read-only. Läser via superuser (för att se sanningen oberoende av RLS) men
// scopar HÅRT till inloggad staffs tenant — admin ser aldrig in i en annan
// tenant. Avslöjar de vanliga felorsakerna: fel/tom linked_startups, bolag i
// annan tenant, eller att tilldelningen landade på en annan bolagspost.
// =============================================================================

export type MemberAccessReport = {
  userFound: boolean;
  userId?: string;
  email?: string;
  roles?: string[];
  userTenant?: string;
  actorTenant: string;
  tenantMatch?: boolean;
  isPureMember?: boolean;
  linked: { id: string; name?: string; tenant?: string; tenantMatch: boolean; exists: boolean }[];
  assignmentsForLinked: { id: string; workshopTitle?: string; startupId: string; tenant: string }[];
  recentAssignments: {
    id: string;
    workshopTitle?: string;
    startupId: string;
    startupName?: string;
    tenant: string;
    created?: string;
  }[];
};

export type DiagnoseState = {
  status: 'idle' | 'ok' | 'error';
  message?: string;
  report?: MemberAccessReport;
};

export async function diagnoseMemberAccessAction(
  _prev: DiagnoseState,
  formData: FormData
): Promise<DiagnoseState> {
  const actor = await requireUser();
  if (!hasRole(actor.roles, ['admin', 'incubator_lead'])) {
    return { status: 'error', message: 'Endast inkubatorledning får köra diagnostiken.' };
  }
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!email) return { status: 'error', message: 'Ange en e-postadress.' };

  const suResult = await getSuperuserPb();
  if (!suResult.ok) {
    return {
      status: 'error',
      message:
        suResult.reason === 'missing_credentials'
          ? 'Serverfel: superuser-credentials saknas.'
          : 'Serverfel: kunde inte autentisera superuser.'
    };
  }
  const pb = suResult.pb;

  const report: MemberAccessReport = {
    userFound: false,
    actorTenant: actor.tenant,
    linked: [],
    assignmentsForLinked: [],
    recentAssignments: []
  };

  // 1. Slå upp användaren (scopad till actorns tenant).
  type UserRec = {
    id: string;
    email?: string;
    roles?: string[];
    tenant?: string;
    linked_startups?: string[];
  };
  let userRec: UserRec | null = null;
  try {
    userRec = await pb
      .collection('users')
      .getFirstListItem<UserRec>(
        `email = "${escFilter(email)}" && tenant = "${escFilter(actor.tenant)}"`,
        { fields: 'id,email,roles,tenant,linked_startups' }
      );
  } catch {
    userRec = null;
  }

  if (!userRec) {
    // Finns kontot alls (i annan tenant)? Hjälper diagnosen utan att läcka data.
    let existsElsewhere = false;
    try {
      await pb
        .collection('users')
        .getFirstListItem(`email = "${escFilter(email)}"`, { fields: 'id' });
      existsElsewhere = true;
    } catch {
      existsElsewhere = false;
    }
    return {
      status: 'ok',
      message: existsElsewhere
        ? 'Kontot finns men i en ANNAN organisation (tenant) än din — det kan inte kopplas till dina bolag.'
        : 'Hittade ingen användare med den e-posten.',
      report
    };
  }

  report.userFound = true;
  report.userId = userRec.id;
  report.email = userRec.email;
  report.roles = userRec.roles ?? [];
  report.userTenant = userRec.tenant;
  report.tenantMatch = String(userRec.tenant) === actor.tenant;
  const staffOrObserver = ['admin', 'incubator_lead', 'coach', 'mentor', 'observer'];
  report.isPureMember =
    (report.roles ?? []).includes('startup_member') &&
    !(report.roles ?? []).some((r) => staffOrObserver.includes(r));

  const linkedIds = (userRec.linked_startups ?? []).filter(Boolean);

  // 2. Lös upp varje länkat bolag.
  for (const id of linkedIds) {
    try {
      const s = await pb
        .collection('startups')
        .getOne<{ id: string; name?: string; tenant?: string }>(id, {
          fields: 'id,name,tenant'
        });
      report.linked.push({
        id,
        name: s.name,
        tenant: s.tenant,
        tenantMatch: String(s.tenant) === actor.tenant,
        exists: true
      });
    } catch {
      report.linked.push({ id, tenantMatch: false, exists: false });
    }
  }

  // 3. Tilldelningar för de länkade bolagen (samma tenant-scope som vyn).
  if (linkedIds.length > 0) {
    const ors = linkedIds.map((id) => `startup = "${escFilter(id)}"`).join(' || ');
    try {
      const res = await pb.collection('workshop_assignments').getList(1, 100, {
        filter: `tenant = "${escFilter(actor.tenant)}" && (${ors})`,
        sort: '-created',
        expand: 'workshop'
      });
      report.assignmentsForLinked = res.items.map((it) => {
        const rec = it as unknown as {
          id: string;
          startup: string;
          tenant: string;
          expand?: { workshop?: { title?: string } };
        };
        return {
          id: rec.id,
          workshopTitle: rec.expand?.workshop?.title,
          startupId: rec.startup,
          tenant: rec.tenant
        };
      });
    } catch {
      /* lämna tomt */
    }
  }

  // 4. Senaste tilldelningar i tenanten — visar VAR tilldelningar faktiskt
  //    landade (t.ex. på en dubblett-post av bolaget).
  try {
    const res = await pb.collection('workshop_assignments').getList(1, 20, {
      filter: `tenant = "${escFilter(actor.tenant)}"`,
      sort: '-created',
      expand: 'workshop,startup'
    });
    report.recentAssignments = res.items.map((it) => {
      const rec = it as unknown as {
        id: string;
        startup: string;
        tenant: string;
        created?: string;
        expand?: { workshop?: { title?: string }; startup?: { name?: string } };
      };
      return {
        id: rec.id,
        workshopTitle: rec.expand?.workshop?.title,
        startupId: rec.startup,
        startupName: rec.expand?.startup?.name,
        tenant: rec.tenant,
        created: rec.created
      };
    });
  } catch {
    /* lämna tomt */
  }

  return { status: 'ok', report };
}
