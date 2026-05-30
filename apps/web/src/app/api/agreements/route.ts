import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import PocketBase from 'pocketbase';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { getServerPbUrl } from '@/lib/pb-url';
import { hasRole } from '@/lib/rbac';
import { recordActivity } from '@/lib/actions/record-activity';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { validateAgreementFile, type AgreementKind } from '@platform/shared';
import type { Role } from '@platform/shared';

// Route handler (inte server action) → inte bunden av next.config:s
// serverActions.bodySizeLimit, så avtals-PDF:er kan strömma upp. Auth-cookien
// är SameSite=Lax → cross-site POST saknar cookie (CSRF-skydd, samma resonemang
// som /api/education/documents, CLAUDE.md § 18.2/§18.3).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

// Superuser-fallback: agreements.createRule (migration 1700000010) tillåter bara
// admin/incubator_lead, men routen behandlar alla staff (inkl. coach/mentor) som
// behöriga. Efter att vi verifierat staff-roll + tenant i koden skriver vi via
// superuser om app-användarens egen skrivning avvisas (samma mönster som
// education_documents §18.3 / PB v0.23 rule-eval).
async function getSuperuserPb(): Promise<PocketBase | null> {
  const email = process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_SU_EMAIL;
  const password = process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_SU_PASSWORD;
  if (!email || !password) {
    console.error('[agreements] superuser credentials missing');
    return null;
  }
  const pb = new PocketBase(getServerPbUrl());
  pb.autoCancellation(false);
  try {
    await pb.collection('_superusers').authWithPassword(email, password);
    return pb;
  } catch {
    console.error('[agreements] superuser auth failed');
    return null;
  }
}

function statusOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    return (err as { status?: number }).status;
  }
  return undefined;
}

const VALID_KINDS: AgreementKind[] = [
  'nda',
  'incubator_agreement',
  'ip_assignment',
  'addendum',
  'other'
];

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Ej inloggad.' }, { status: 401 });
  if (!hasRole(user.roles, STAFF_ROLES)) {
    return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Ogiltig förfrågan.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Ingen fil bifogad.' }, { status: 400 });
  }

  const title = String(form.get('title') || '').trim();
  if (!title) return NextResponse.json({ error: 'Titel krävs.' }, { status: 400 });

  const startupId = String(form.get('startup') || '').trim();
  if (!startupId) return NextResponse.json({ error: 'Bolag krävs.' }, { status: 400 });

  const kindRaw = String(form.get('kind') || 'other').trim() as AgreementKind;
  const kind: AgreementKind = VALID_KINDS.includes(kindRaw) ? kindRaw : 'other';
  const kindLabel = String(form.get('kind_label') || '').trim();
  const assignedTo = String(form.get('assigned_to') || '').trim();
  const expiresAt = String(form.get('expires_at') || '').trim();
  // Default: båda parter signerar (bolaget + Movexum). Kan stängas av per part.
  const requiresCompany = String(form.get('requires_company_signature') || 'true') !== 'false';
  const requiresMovexum = String(form.get('requires_movexum_signature') || 'true') !== 'false';

  const validation = validateAgreementFile({
    type: file.type,
    size: file.size,
    name: file.name
  });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const pb = await getServerPb();

  // Verifiera att bolaget tillhör tenanten.
  let startupName = 'bolaget';
  try {
    const s = await pb.collection('startups').getOne<{ tenant: string; name?: string }>(startupId);
    if (String(s.tenant) !== user.tenant) {
      return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });
    }
    startupName = s.name || startupName;
  } catch {
    return NextResponse.json({ error: 'Bolaget hittades inte.' }, { status: 404 });
  }

  // Om en utpekad signatär anges: verifiera att den tillhör tenanten innan vi
  // skriver relationen (PB enforce:ar inte tenant på relation-targets).
  let validatedAssignedTo = '';
  if (assignedTo) {
    try {
      const u = await pb.collection('users').getOne<{ tenant?: string }>(assignedTo);
      if (String(u.tenant) === user.tenant) validatedAssignedTo = assignedTo;
    } catch {
      /* okänd user → droppa fältet (icke-fatalt, metadata) */
    }
  }

  // Node/undici-gotcha: materialisera bytes innan vidareskick. Samtidigt
  // beräknar vi den KANONISKA SHA-256-hashen av exakt de bytes som lagras —
  // den hash varje signatur sedan attesterar (eIDAS art. 26 d, tamper-evidens).
  const buffer = Buffer.from(await file.arrayBuffer());
  const documentHash = createHash('sha256').update(buffer).digest('hex');

  const now = new Date().toISOString();
  const fd = new FormData();
  fd.append('tenant', user.tenant);
  fd.append('startup', startupId);
  fd.append('title', title.slice(0, 200));
  fd.append('kind', kind);
  if (kindLabel) fd.append('kind_label', kindLabel.slice(0, 100));
  fd.append('status', 'sent');
  fd.append('assigned_by', user.id);
  if (validatedAssignedTo) fd.append('assigned_to', validatedAssignedTo);
  fd.append('sent_at', now);
  if (expiresAt) fd.append('expires_at', expiresAt);
  fd.append('document_hash', documentHash);
  fd.append('requires_company_signature', requiresCompany ? 'true' : 'false');
  fd.append('requires_movexum_signature', requiresMovexum ? 'true' : 'false');
  fd.append('file', new Blob([buffer], { type: 'application/pdf' }), file.name || 'avtal.pdf');

  let agreementId: string;
  try {
    try {
      const rec = await pb.collection(PB_COLLECTIONS.agreements).create(fd);
      agreementId = String(rec.id);
    } catch (err) {
      const code = statusOf(err);
      if (code === 400 || code === 403) {
        const su = await getSuperuserPb();
        if (!su) throw err;
        const rec = await su.collection(PB_COLLECTIONS.agreements).create(fd);
        agreementId = String(rec.id);
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.error('[agreements] upload failed', {
      tenant: user.tenant,
      userId: user.id,
      error: err instanceof Error ? err.message : err
    });
    return NextResponse.json({ error: 'Uppladdningen misslyckades.' }, { status: 500 });
  }

  // Audit i aktivitetsfeeden (PII-fri: bara bolags- + avtalsnamn).
  try {
    await recordActivity(pb, {
      tenant: user.tenant,
      startup: startupId,
      kind: 'agreement',
      actor: user.id,
      title: `Tilldelade avtal: ${title} – ${startupName}`
    });
  } catch {
    /* fail-soft: audit får inte fälla uppladdningen */
  }

  return NextResponse.json({ id: agreementId });
}
