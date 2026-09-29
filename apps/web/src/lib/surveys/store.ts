import 'server-only';
import { randomBytes } from 'node:crypto';
import type PocketBase from 'pocketbase';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import {
  aggregateSurvey,
  normalizeSurveyQuestions,
  type SurveyAnswers,
  type SurveyKind,
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

export async function listSurveys(
  pb: PocketBase,
  tenant: string
): Promise<{ surveys: Survey[]; counts: Map<string, number> }> {
  const rows = await withFallback(
    pb,
    (c) =>
      c.collection('surveys').getFullList<SurveyRecord>({
        filter: c.filter('tenant = {:t}', { t: tenant }),
        sort: '-created'
      }),
    (r) => r.length === 0
  ).catch(() => [] as SurveyRecord[]);

  const counts = new Map<string, number>();
  await Promise.all(
    rows.map(async (r) => {
      try {
        const res = await withFallback(
          pb,
          (c) =>
            c.collection('survey_responses').getList(1, 1, {
              filter: c.filter('survey = {:s} && tenant = {:t}', { s: r.id, t: tenant }),
              fields: 'id'
            }),
          (x) => x.totalItems === 0
        );
        counts.set(r.id, res.totalItems);
      } catch {
        counts.set(r.id, 0);
      }
    })
  );
  return { surveys: rows.map(toSurvey), counts };
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
