'use server';

import type PocketBase from 'pocketbase';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { hasRole } from '@/lib/rbac';
import { requestOrigin } from '@/lib/request-origin';
import { getSurvey, newPublicSlug } from '@/lib/surveys/store';
import { dispatchSurveyInvites } from '@/lib/surveys/dispatch';
import { describePbError, pbFieldCodes, pbStatus } from '@/lib/pb-error';
import { resolveSurveyLink, type ResolvedSurveyLink } from '@/lib/surveys/link';
import { getRecordInTenant } from '@/lib/core/write/helpers';
import { resolveSurveySeed } from '@/lib/core/write/surveys';
import type { Role } from '@platform/shared';
import {
  SURVEY_LINK_DEFAULT_KIND,
  SURVEY_STARTER_TEMPLATES,
  defaultSurveySendAt,
  isStarterTemplateRef,
  isSurveyKind,
  normalizeSurveyQuestions,
  normalizeSurveyTemplateTargets,
  parseSurveyLinkRef,
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

/**
 * Felkoder som `createSurveyAction` skickar tillbaka till `/inflode/utvardering/new`
 * via `?error=` (+ `?detail=` med PB:s fältdetaljer). Texterna bor i sidan.
 */
export type CreateSurveyErrorCode =
  | 'link_missing'
  | 'template_missing'
  | 'collection_missing'
  | 'create_failed';

/**
 * Skapar en enkät från en mall och skickar staff vidare till byggaren.
 *
 * Fel kastas ALDRIG ut ur actionen (incident 2026-09): ett kastat fel i en
 * server action blir i produktion bara "An error occurred in the Server
 * Components render" + digest — sidan `new` svarade 500 utan att någon kunde
 * se varför. Nu loggas orsaken PII-fritt (status + fältKODER, aldrig värden)
 * och användaren skickas tillbaka till formuläret med `?error=` + `?detail=`
 * (samma mönster som `createModuleAction`, § 23.7). En saknad `surveys`-
 * kollektion (PB 404 — migration 1700000149 inte körd) pekas ut uttryckligen.
 */
export async function createSurveyAction(formData: FormData) {
  const user = await requireManager();
  const pb = await getServerPb();

  // Valfri källa (§ 47.4). En referens som inte kan verifieras avvisas —
  // aldrig en tyst fristående enkät när staff trodde den var kopplad.
  // "Skapa som mall" (§ 53.3): en mall följer aldrig upp en källa.
  const asTemplate = formData.get('as_template') === '1';
  const forRaw = formData.get('for');
  const forParam = !asTemplate && typeof forRaw === 'string' && forRaw ? forRaw : '';
  let link: ResolvedSurveyLink | null = null;
  if (forParam) {
    link = await resolveSurveyLink(pb, user, forParam);
    if (!link) {
      redirect(`/inflode/utvardering/new?${new URLSearchParams({ error: 'link_missing' })}`);
    }
  }

  // Mallvalet är antingen en inbyggd typ (`kind:<typ>`) eller en egen mall
  // (`template:<id>`, tenant-verifierad i resolveSurveySeed).
  const choice = String(formData.get('template') || '');
  // `starter:<nyckel>` = Movexums standardmall (lösas i resolveSurveySeed).
  const templateId = choice.startsWith('template:')
    ? choice.slice('template:'.length)
    : isStarterTemplateRef(choice)
      ? choice
      : '';
  const kindRaw = choice.startsWith('kind:')
    ? choice.slice('kind:'.length)
    : String(formData.get('kind') || (link ? SURVEY_LINK_DEFAULT_KIND[link.kind] : 'custom'));
  const seed = await resolveSurveySeed(
    pb,
    { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Role[] },
    { templateId, kind: isSurveyKind(kindRaw) ? kindRaw : 'custom' }
  );
  if (!seed.ok) {
    const qs = new URLSearchParams({ error: 'template_missing', detail: seed.error.slice(0, 400) });
    if (forParam) qs.set('for', forParam);
    redirect(`/inflode/utvardering/new?${qs.toString()}`);
  }
  const tpl = seed.value;
  const kind = tpl.kind;
  const defaultName = asTemplate ? `Mall: ${tpl.label}` : link ? `Uppföljning: ${link.label}` : tpl.label;
  const name = cap(formData.get('name'), 160) || defaultName;
  // En mall som kopieras från en standardmall ärver dess eventtyper om inga valts.
  const chosenFor = normalizeSurveyTemplateTargets(formData.getAll('template_for'));
  const templateFor = asTemplate ? (chosenFor.length > 0 ? chosenFor : normalizeSurveyTemplateTargets(tpl.template_for)) : [];
  let created: { id: string } | null = null;
  let createError: { code: CreateSurveyErrorCode; detail: string } | null = null;
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
      link_label: link?.label ?? '',
      ...(asTemplate ? { is_template: true, template_for: templateFor } : {})
    };
    try {
      created = await writeWithFallback(pb, (c) =>
        c.collection('surveys').create<{ id: string }>(payload)
      );
    } catch (err) {
      const status = pbStatus(err);
      const fieldCodes = pbFieldCodes(err);
      // En saknad kollektion (404) blir aldrig bättre av fler försök.
      if (status === 404 || attempt === 2) {
        console.error('[surveys] create failed', { tenantId: user.tenant, status, fieldCodes });
        if (status === 404) {
          createError = {
            code: 'collection_missing',
            detail:
              'PocketBase svarade 404 för kollektionen "surveys" — migration 1700000149 (Utvärdering) har inte körts på den här instansen. Redeploya PocketBase eller kör "Sync PocketBase" (setup-via-api.mjs) och försök igen.'
          };
        } else {
          createError = {
            code: 'create_failed',
            detail: describePbError(
              err,
              Object.keys(fieldCodes).length > 0
                ? `PocketBase avvisade värdena (HTTP ${status ?? '?'}).`
                : `PocketBase nekade skrivningen (HTTP ${status ?? '?'}).`
            )
          };
        }
        break;
      }
    }
  }
  if (createError || !created) {
    // redirect() kastar — måste ligga UTANFÖR try/catch.
    const qs = new URLSearchParams({
      error: createError?.code ?? 'create_failed',
      detail: (createError?.detail ?? '').slice(0, 400)
    });
    if (forParam) qs.set('for', forParam);
    redirect(`/inflode/utvardering/new?${qs.toString()}`);
  }
  revalidatePath('/inflode/utvardering');
  if (asTemplate) {
    // Schema-drift: utan migration 1700000195 blev raden en vanlig enkät.
    const back = await getSurvey(pb, user.tenant, created.id);
    if (back && !back.is_template) {
      redirect(`/inflode/utvardering/${created.id}?varning=mall`);
    }
  }
  if (link) {
    // Schema-drift (§ 24.4-invarianten): PB släpper okända fält tyst. Läs
    // tillbaka och varna i stället för att låtsas att kopplingen finns.
    const back = await getSurvey(pb, user.tenant, created.id);
    if (back && !back.link_kind) {
      redirect(`/inflode/utvardering/${created.id}?varning=koppling`);
    }
  }
  redirect(`/inflode/utvardering/${created.id}`);
}

/**
 * Lägger till Movexums standardmallar (§ 53.3) som EGNA mallar under
 * Utvärdering, så att de kan anpassas. Idempotent: en mall med samma namn
 * hoppas över. Läsningen är strikt — ett läsfel tolkas aldrig som "inga
 * mallar" (det skulle dubblera dem). Redirectar tillbaka med antal.
 */
export async function addStarterTemplatesAction(formData: FormData) {
  const user = await requireManager();
  const pb = await getServerPb();
  const keys = new Set(formData.getAll('starter').map((v) => String(v)));
  const starters = SURVEY_STARTER_TEMPLATES.filter((t) => keys.has(t.key));
  if (starters.length === 0) redirect('/inflode/utvardering?mallar=0');

  let existing: string[];
  try {
    const rows = await writeWithFallback(pb, (c) =>
      c.collection('surveys').getFullList<{ name?: string }>({
        filter: c.filter('tenant = {:t} && is_template = true', { t: user.tenant }),
        fields: 'id,name'
      })
    );
    existing = rows.map((r) => (r.name || '').trim().toLowerCase());
  } catch (err) {
    console.error('[surveys] template read failed', { status: pbStatus(err) });
    redirect('/inflode/utvardering?mallfel=las');
  }

  let added = 0;
  let failed = 0;
  let schemaDrift = false;
  for (const t of starters) {
    if (existing.includes(t.name.toLowerCase())) continue;
    try {
      const created = await writeWithFallback(pb, (c) =>
        c.collection('surveys').create<Record<string, unknown>>({
          tenant: user.tenant,
          name: t.name,
          kind: t.kind,
          description: t.description,
          welcome_title: t.welcome_title,
          welcome_body: t.welcome_body,
          thank_you_message: t.thank_you_message,
          questions: t.questions,
          is_active: false,
          public_slug: newPublicSlug(),
          created_by: user.id,
          is_template: true,
          template_for: t.template_for
        })
      );
      // Schema-drift (§ 24.4): utan migration 1700000195 blev raden en vanlig
      // enkät — ta bort den hellre än att lämna en publicerbar kopia.
      if (created.is_template !== true) {
        await writeWithFallback(pb, (c) => c.collection('surveys').delete(String(created.id))).catch(() => undefined);
        schemaDrift = true;
        break;
      }
      added++;
    } catch (err) {
      failed++;
      console.error('[surveys] starter template create failed', { status: pbStatus(err) });
    }
  }
  revalidatePath('/inflode/utvardering');
  if (schemaDrift) redirect('/inflode/utvardering?mallfel=schema');
  redirect(`/inflode/utvardering?mallar=${added}${failed ? `&mallfel=${failed}` : ''}`);
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
  /** Bara för mallar (§ 53.3) — ignoreras för vanliga enkäter. */
  template_for?: string[];
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
  // En mall publiceras aldrig (§ 53.3) — oavsett vad klienten skickar.
  const isActive = existing.is_template ? false : input.is_active === true;
  if (isActive && questions.length === 0) {
    return { ok: false, error: 'Lägg till minst en fråga innan du publicerar.' };
  }

  const payload = {
    name,
    description: String(input.description || '').trim().slice(0, 500),
    welcome_title: String(input.welcome_title || '').trim().slice(0, 160),
    welcome_body: String(input.welcome_body || '').trim().slice(0, 2000),
    thank_you_message: String(input.thank_you_message || '').trim().slice(0, 500),
    questions,
    is_active: isActive,
    ...(existing.is_template ? { template_for: normalizeSurveyTemplateTargets(input.template_for) } : {})
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
