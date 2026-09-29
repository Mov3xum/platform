'use server';

import type PocketBase from 'pocketbase';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { hasRole } from '@/lib/rbac';
import { getSurvey, newPublicSlug } from '@/lib/surveys/store';
import { dispatchSurveyInvites } from '@/lib/surveys/dispatch';
import { getRecordInTenant } from '@/lib/core/write/helpers';
import type { Role } from '@platform/shared';
import {
  SURVEY_LINK_DEFAULT_KIND,
  SURVEY_TEMPLATES,
  defaultSurveySendAt,
  isSurveyKind,
  normalizeSurveyQuestions,
  parseSurveyLinkRef,
  type SurveyLinkKind,
  type SurveyLinkRef,
  type SurveyQuestion
} from '@platform/shared';

// Marknadsverktyg → Utvärdering (CLAUDE.md § 39). RBAC: admin/incubator_lead/
// coach (samma krets som Startupkompassens modul-admin). Tenant korsverifieras
// mot den inloggade före varje skrivning; superuser-fallback bara vid PB
// v0.23.4:s tysta regel-nekande (400/403/404, § 21.3) EFTER den kontrollen.

const MANAGE_ROLES = ['admin', 'incubator_lead', 'coach'] as const;

async function requireManager() {
  const user = await requireUser();
  if (!hasRole(user.roles, [...MANAGE_ROLES])) throw new Error('Forbidden');
  if (!user.tenant) throw new Error('Forbidden');
  return user;
}

async function writeWithFallback<T>(
  pb: PocketBase,
  run: (c: PocketBase) => Promise<T>
): Promise<T> {
  try {
    return await run(pb);
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status !== 400 && status !== 403 && status !== 404) throw err;
    const su = await getSuperuserPb();
    if (!su.ok) throw err;
    return await run(su.pb);
  }
}

function cap(v: FormDataEntryValue | null, max: number): string {
  return String(v ?? '').trim().slice(0, max);
}

// Källa → PB-kollektion + namnfält. Källan läses tenant-verifierat (§ 21) så en
// enkät aldrig kan kopplas till en annan tenants post; etiketten härleds
// server-side och tas ALDRIG från klienten.
const LINK_SOURCE: Record<SurveyLinkKind, { collection: string; nameField: string }> = {
  annual_wheel: { collection: 'annual_wheel_items', nameField: 'title' },
  event: { collection: 'incubator_events', nameField: 'name' },
  workshop: { collection: 'workshops', nameField: 'title' },
  mission: { collection: 'missions', nameField: 'title' },
  startup: { collection: 'startups', nameField: 'name' },
  compass_module: { collection: 'compass_modules', nameField: 'name' }
};

export interface ResolvedSurveyLink extends SurveyLinkRef {
  label: string;
  /** Bara kompassmoduler — för länken tillbaka. */
  slug?: string;
}

/** Slår upp källan för en `?for=<kind>:<id>`-referens i den inloggades tenant. */
export async function resolveSurveyLink(
  pb: PocketBase,
  user: { id: string; tenant: string; roles: string[] },
  raw: unknown
): Promise<ResolvedSurveyLink | null> {
  const ref = parseSurveyLinkRef(raw);
  if (!ref) return null;
  const src = LINK_SOURCE[ref.kind];
  const row = await getRecordInTenant<{ id: string; tenant?: string; slug?: string } & Record<string, unknown>>(
    pb,
    { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Role[] },
    src.collection,
    ref.id,
    `id,tenant,slug,${src.nameField}`
  );
  if (!row) return null;
  const label = String(row[src.nameField] ?? '').trim().slice(0, 200);
  return { ...ref, label: label || `${ref.kind} ${ref.id}`, slug: typeof row.slug === 'string' ? row.slug : undefined };
}

/** Skapar en enkät från en mall och skickar staff vidare till byggaren. */
export async function createSurveyAction(formData: FormData) {
  const user = await requireManager();
  const pb = await getServerPb();

  // Valfri källa (§ 47.4). En referens som inte kan verifieras avvisas —
  // aldrig en tyst fristående enkät när staff trodde den var kopplad.
  const forRaw = formData.get('for');
  let link: ResolvedSurveyLink | null = null;
  if (typeof forRaw === 'string' && forRaw) {
    link = await resolveSurveyLink(pb, user, forRaw);
    if (!link) throw new Error('Det som enkäten skulle följa upp hittades inte.');
  }

  const kindRaw = String(formData.get('kind') || (link ? SURVEY_LINK_DEFAULT_KIND[link.kind] : 'custom'));
  const kind = isSurveyKind(kindRaw) ? kindRaw : 'custom';
  const tpl = SURVEY_TEMPLATES[kind];
  const name = cap(formData.get('name'), 160) || (link ? `Uppföljning: ${link.label}` : tpl.label);
  let created: { id: string } | null = null;
  // Den slumpade sluggen kolliderar i praktiken aldrig; ett unikt-index-fel
  // (400) ger ett nytt försök i stället för ett hårt fel.
  for (let attempt = 0; attempt < 3 && !created; attempt++) {
    const payload = {
      tenant: user.tenant,
      name,
      kind,
      description: tpl.description,
      welcome_title: tpl.welcome_title,
      welcome_body: tpl.welcome_body,
      thank_you_message: tpl.thank_you_message,
      questions: tpl.questions,
      is_active: false,
      public_slug: newPublicSlug(),
      created_by: user.id,
      link_kind: link?.kind ?? '',
      link_id: link?.id ?? '',
      link_label: link?.label ?? ''
    };
    try {
      created = await writeWithFallback(pb, (c) =>
        c.collection('surveys').create<{ id: string }>(payload)
      );
    } catch (err) {
      if (attempt === 2) {
        console.error('[surveys] create failed', (err as { status?: number })?.status);
        throw new Error('Kunde inte skapa enkäten. Har migration 1700000149 körts?');
      }
    }
  }
  revalidatePath('/inflode/utvardering');
  if (link) {
    // Schema-drift (§ 24.4-invarianten): PB släpper okända fält tyst. Läs
    // tillbaka och varna i stället för att låtsas att kopplingen finns.
    const back = await getSurvey(pb, user.tenant, created!.id);
    if (back && !back.link_kind) {
      redirect(`/inflode/utvardering/${created!.id}?varning=koppling`);
    }
  }
  redirect(`/inflode/utvardering/${created!.id}`);
}

export interface SaveSurveyInput {
  id: string;
  name: string;
  description: string;
  welcome_title: string;
  welcome_body: string;
  thank_you_message: string;
  questions: SurveyQuestion[];
  is_active: boolean;
}

export type SaveSurveyResult = { ok: true; questions: SurveyQuestion[] } | { ok: false; error: string };

export async function saveSurveyAction(input: SaveSurveyInput): Promise<SaveSurveyResult> {
  const user = await requireManager();
  const pb = await getServerPb();
  const existing = await getSurvey(pb, user.tenant, String(input?.id || ''));
  if (!existing) return { ok: false, error: 'Enkäten hittades inte.' };

  const name = String(input.name || '').trim().slice(0, 160);
  if (!name) return { ok: false, error: 'Enkäten behöver ett namn.' };

  // Frågornas id:n är stabila — svaren lagras under dem. Normaliseringen
  // behåller inskickade id:n; nya frågor får härledda.
  const questions = normalizeSurveyQuestions(input.questions);
  if (input.is_active && questions.length === 0) {
    return { ok: false, error: 'Lägg till minst en fråga innan du publicerar.' };
  }

  const payload = {
    name,
    description: String(input.description || '').trim().slice(0, 500),
    welcome_title: String(input.welcome_title || '').trim().slice(0, 160),
    welcome_body: String(input.welcome_body || '').trim().slice(0, 2000),
    thank_you_message: String(input.thank_you_message || '').trim().slice(0, 500),
    questions,
    is_active: input.is_active === true
  };
  try {
    await writeWithFallback(pb, (c) => c.collection('surveys').update(existing.id, payload));
  } catch (err) {
    console.error('[surveys] update failed', (err as { status?: number })?.status);
    return { ok: false, error: 'Kunde inte spara enkäten.' };
  }
  revalidatePath('/inflode/utvardering');
  revalidatePath(`/inflode/utvardering/${existing.id}`);
  return { ok: true, questions };
}

export async function deleteSurveyAction(formData: FormData) {
  const user = await requireManager();
  const id = String(formData.get('id') || '');
  const pb = await getServerPb();
  const existing = await getSurvey(pb, user.tenant, id);
  if (existing) {
    try {
      await writeWithFallback(pb, (c) => c.collection('surveys').delete(existing.id));
    } catch (err) {
      console.error('[surveys] delete failed', (err as { status?: number })?.status);
      throw new Error('Kunde inte radera enkäten.');
    }
  }
  revalidatePath('/inflode/utvardering');
  redirect('/inflode/utvardering');
}

// ── Utskick till deltagare (§ 47.5) ──────────────────────────────────────────

/** Origin för enkätlänken — från staffs egen request (proxy-headers först). */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get('x-forwarded-proto') || 'https';
  const host = h.get('x-forwarded-host') || h.get('host') || '';
  return host ? `${proto}://${host}` : '';
}

export type SendSurveyState = { ok: true; message: string } | { ok: false; error: string };

/** "Skicka nu" — mänskligt klick; utskicket sker direkt. */
export async function sendSurveyNowAction(formData: FormData): Promise<SendSurveyState> {
  const user = await requireManager();
  const id = String(formData.get('id') || '');
  const pb = await getServerPb();
  const survey = await getSurvey(pb, user.tenant, id);
  if (!survey) return { ok: false, error: 'Enkäten hittades inte.' };
  const origin = await requestOrigin();
  const res = await dispatchSurveyInvites(survey.id, { baseUrl: origin, force: formData.get('force') === '1' });
  revalidatePath(`/inflode/utvardering/${survey.id}`);
  if (!res.ok) return res;
  return {
    ok: true,
    message:
      res.recipients === 0
        ? 'Inga deltagare med e-postadress att skicka till.'
        : `Skickat till ${res.sent} deltagare${res.failed ? ` (${res.failed} misslyckades)` : ''}.`
  };
}

/** Schemalägg automatiskt utskick (default: 09:00 dagen efter eventet). */
export async function scheduleSurveySendAction(formData: FormData): Promise<SendSurveyState> {
  const user = await requireManager();
  const id = String(formData.get('id') || '');
  const pb = await getServerPb();
  const survey = await getSurvey(pb, user.tenant, id);
  if (!survey) return { ok: false, error: 'Enkäten hittades inte.' };
  if (survey.link_kind !== 'event' || !survey.link_id) {
    return { ok: false, error: 'Bara enkäter kopplade till ett event kan schemaläggas.' };
  }
  const origin = await requestOrigin();
  if (!origin) return { ok: false, error: 'Kunde inte avgöra adressen för enkätlänken.' };

  let sendAt: Date | null = null;
  const raw = String(formData.get('send_at') || '').trim();
  if (raw) {
    const { parseDateTimeInput } = await import('@platform/shared');
    sendAt = parseDateTimeInput(raw);
    if (!sendAt) return { ok: false, error: 'Ogiltig tidpunkt.' };
  } else {
    const ev = await getRecordInTenant<{ id: string; tenant?: string; starts_at?: string; ends_at?: string }>(
      pb,
      { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Role[] },
      'incubator_events',
      survey.link_id,
      'id,tenant,starts_at,ends_at'
    );
    if (!ev) return { ok: false, error: 'Eventet hittades inte.' };
    sendAt = defaultSurveySendAt(ev);
    if (!sendAt) return { ok: false, error: 'Eventet saknar datum — ange en tidpunkt själv.' };
  }
  if (sendAt.getTime() < Date.now() - 60_000) {
    return { ok: false, error: 'Tidpunkten har redan passerat — använd "Skicka nu".' };
  }
  try {
    await writeWithFallback(pb, (c) =>
      c.collection('surveys').update(survey.id, {
        send_at: sendAt!.toISOString(),
        send_base_url: origin,
        is_active: true
      })
    );
  } catch (err) {
    console.error('[surveys] schedule failed', (err as { status?: number })?.status);
    return { ok: false, error: 'Kunde inte schemalägga utskicket. Har migration 1700000151 körts?' };
  }
  // Schema-drift: PB släpper okända fält tyst.
  const back = await getSurvey(pb, user.tenant, survey.id);
  if (!back?.send_at) {
    return { ok: false, error: 'PocketBase saknar utskicksfälten (migration 1700000151). Utskicket är inte schemalagt.' };
  }
  revalidatePath(`/inflode/utvardering/${survey.id}`);
  return { ok: true, message: 'Utskicket är schemalagt.' };
}

export async function cancelSurveySendAction(formData: FormData): Promise<SendSurveyState> {
  const user = await requireManager();
  const id = String(formData.get('id') || '');
  const pb = await getServerPb();
  const survey = await getSurvey(pb, user.tenant, id);
  if (!survey) return { ok: false, error: 'Enkäten hittades inte.' };
  try {
    await writeWithFallback(pb, (c) => c.collection('surveys').update(survey.id, { send_at: '' }));
  } catch {
    return { ok: false, error: 'Kunde inte avbryta utskicket.' };
  }
  revalidatePath(`/inflode/utvardering/${survey.id}`);
  return { ok: true, message: 'Det schemalagda utskicket är avbrutet.' };
}
