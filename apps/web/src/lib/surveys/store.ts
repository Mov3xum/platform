import 'server-only';
import { randomBytes } from 'node:crypto';
import type PocketBase from 'pocketbase';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { errorStatus, isRuleDenialStatus, mapWithConcurrency } from '@/lib/read-scaling';
import {
  aggregateSurvey,
  normalizeSurveyQuestions,
  type SurveyAnswers,
  isSurveyLinkKind,
  type SurveyKind,
  type SurveyLinkKind,
  type SurveyQuestion,
  type SurveySummary
} from '@platform/shared';

// Marknadsverktyg → Utvärdering (CLAUDE.md § 39). Läs-/skrivhjälpare för
// `surveys` + `survey_responses`. Anroparna är staff-gejtade och skickar den
// inloggades tenant; användartoken körs FÖRST (RLS bevaras) och superuser är
// bara fallback vid PB v0.23.4:s tysta regel-nekande (§ 21.3) — tenant-
// filtret/-kontrollen består i fallbacken.

export interface Survey {
  id: string;
  tenant: string;
  name: string;
  kind: SurveyKind;
  description: string;
  welcome_title: string;
  welcome_body: string;
  thank_you_message: string;
  questions: SurveyQuestion[];
  is_active: boolean;
  public_slug: string;
  /** Källa enkäten följer upp (§ 47.4) — null när enkäten är fristående. */
  link_kind: SurveyLinkKind | null;
  link_id: string;
  link_label: string;
  /** Utskick till deltagare (§ 47.5) — bara aggregat, aldrig adresser. */
  send_at: string;
  sent_at: string;
  sent_count: number;
  send_base_url: string;
  created: string;
  updated: string;
}

interface SurveyRecord {
  id: string;
  tenant: string;
  name?: string;
  kind?: string;
  description?: string;
  welcome_title?: string;
  welcome_body?: string;
  thank_you_message?: string;
  questions?: unknown;
  is_active?: boolean;
  public_slug?: string;
  link_kind?: string;
  link_id?: string;
  link_label?: string;
  send_at?: string;
  sent_at?: string;
  sent_count?: number;
  send_base_url?: string;
  created?: string;
  updated?: string;
}

export function toSurvey(r: SurveyRecord): Survey {
  return {
    id: r.id,
    tenant: r.tenant,
    name: r.name || '',
    kind: (r.kind as SurveyKind) || 'custom',
    description: r.description || '',
    welcome_title: r.welcome_title || '',
    welcome_body: r.welcome_body || '',
    thank_you_message: r.thank_you_message || '',
    questions: normalizeSurveyQuestions(r.questions),
    is_active: r.is_active === true,
    public_slug: r.public_slug || '',
    link_kind: isSurveyLinkKind(r.link_kind) ? r.link_kind : null,
    link_id: r.link_id || '',
    link_label: r.link_label || '',
    send_at: r.send_at || '',
    sent_at: r.sent_at || '',
    sent_count: typeof r.sent_count === 'number' ? r.sent_count : 0,
    send_base_url: r.send_base_url || '',
    created: r.created || '',
    updated: r.updated || ''
  };
}

export function newPublicSlug(): string {
  return randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').toLowerCase();
}

async function withFallback<T>(
  pb: PocketBase,
  run: (c: PocketBase) => Promise<T>,
  isEmpty: (r: T) => boolean
): Promise<T> {
  let primary: T | null = null;
  try {
    primary = await run(pb);
    if (!isEmpty(primary)) return primary;
  } catch {
    // nekad/fel — försök superuser
  }
  const su = await getSuperuserPb();
  if (su.ok) {
    try {
      return await run(su.pb);
    } catch {
      // faller igenom
    }
  }
  if (primary !== null) return primary;
  throw new Error('survey read failed');
}

/** Max samtidiga svarsräkningar i enkätlistan (en räkning per enkät). */
const RESPONSE_COUNT_CONCURRENCY = 5;

export async function listSurveys(
  pb: PocketBase,
  tenant: string
): Promise<{ surveys: Survey[]; counts: Map<string, number> }> {
  // Vilken klient läste enkätlistan? Behövde listan superuser-fallbacken
  // (tyst regel-nekande, § 21.3) räknas svaren också som superuser — annars
  // med användartoken. Aldrig en ny superuser-omläsning per enkät.
  let listClient: PocketBase = pb;
  const rows = await withFallback(
    pb,
    async (c) => {
      const res = await c.collection('surveys').getFullList<SurveyRecord>({
        filter: c.filter('tenant = {:t}', { t: tenant }),
        sort: '-created'
      });
      listClient = c;
      return res;
    },
    (r) => r.length === 0
  ).catch(() => [] as SurveyRecord[]);

  // Begränsad samtidighet (skalbarhetsgranskning 2026-10-08): en tenant med
  // hundra enkäter ger inte hundra samtidiga PB-anrop. En räkning som 0 är
  // ett giltigt svar (enkät utan svar) och ger INGEN superuser-omläsning;
  // bara ett fel på användartoken gör det (regel-nekande → 400/403/404).
  const counts = new Map<string, number>();
  const countWith = (c: PocketBase, surveyId: string) =>
    c
      .collection('survey_responses')
      .getList(1, 1, {
        filter: c.filter('survey = {:s} && tenant = {:t}', { s: surveyId, t: tenant }),
        fields: 'id'
      })
      .then((res) => res.totalItems);
  await mapWithConcurrency(rows, RESPONSE_COUNT_CONCURRENCY, async (r) => {
    try {
      counts.set(r.id, await countWith(listClient, r.id));
    } catch (err) {
      if (listClient !== pb || !isRuleDenialStatus(errorStatus(err))) {
        counts.set(r.id, 0);
        return;
      }
      const su = await getSuperuserPb();
      try {
        counts.set(r.id, su.ok ? await countWith(su.pb, r.id) : 0);
      } catch {
        counts.set(r.id, 0);
      }
    }
  });
  return { surveys: rows.map(toSurvey), counts };
}

/** Enkäter som följer upp en given källa (visas på källans sida). Fail-soft. */
export async function listSurveysForLink(
  pb: PocketBase,
  tenant: string,
  kind: SurveyLinkKind,
  id: string
): Promise<Survey[]> {
  try {
    const rows = await withFallback(
      pb,
      (c) =>
        c.collection('surveys').getFullList<SurveyRecord>({
          filter: c.filter('tenant = {:t} && link_kind = {:k} && link_id = {:i}', {
            t: tenant,
            k: kind,
            i: id
          }),
          sort: '-created'
        }),
      (r) => r.length === 0
    );
    return rows.map(toSurvey);
  } catch {
    // Saknad migration 1700000150 (okänt fält → 400) eller läsfel: visa
    // ingenting hellre än att fälla källans sida.
    return [];
  }
}

export async function getSurvey(
  pb: PocketBase,
  tenant: string,
  id: string
): Promise<Survey | null> {
  try {
    const rec = await withFallback(
      pb,
      (c) => c.collection('surveys').getOne<SurveyRecord>(id),
      () => false
    );
    if (rec.tenant !== tenant) return null;
    return toSurvey(rec);
  } catch {
    return null;
  }
}

const MAX_RESPONSE_PAGES = 20; // 20 × 500 = 10 000 svar

export async function getSurveyResults(
  pb: PocketBase,
  survey: Survey
): Promise<{ summary: SurveySummary; total: number; incomplete: boolean }> {
  const answers: SurveyAnswers[] = [];
  let total = 0;
  let incomplete = false;
  try {
    for (let page = 1; page <= MAX_RESPONSE_PAGES; page++) {
      const res = await withFallback(
        pb,
        (c) =>
          c.collection('survey_responses').getList<{ answers?: SurveyAnswers }>(page, 500, {
            filter: c.filter('survey = {:s} && tenant = {:t}', {
              s: survey.id,
              t: survey.tenant
            }),
            sort: '-created'
          }),
        (r) => r.items.length === 0 && page === 1
      );
      total = res.totalItems;
      for (const it of res.items) {
        if (it.answers && typeof it.answers === 'object') answers.push(it.answers);
      }
      if (page >= res.totalPages) break;
      if (page === MAX_RESPONSE_PAGES) incomplete = true;
    }
  } catch {
    incomplete = true;
  }
  return { summary: aggregateSurvey(survey.questions, answers), total, incomplete };
}
