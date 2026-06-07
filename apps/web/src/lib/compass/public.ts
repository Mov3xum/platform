import 'server-only';
import type PocketBase from 'pocketbase';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import type { CompassModule, CompassQuestion } from './types';

// Publik (oinloggad) resolvning av Startupkompass-moduler.
//
// Den publika sidan /m/<public_slug> och dess API-routar har ingen
// användarsession → vi läser/skriver via en SUPERUSER-klient (bypassar PB:s
// RLS). DÄRFÖR är tenant-scope kritiskt: vi resolvar EN modul på dess globalt
// unika public_slug, härleder tenant FRÅN modulen, och all efterföljande skrivning
// stämplas med just den tenanten — aldrig en tenant från request-bodyn.
// Filtervärden binds via pb.filter() (ingen rå interpolation).

export interface ResolvedPublicModule {
  pb: PocketBase;
  module: CompassModule;
  /** Tenant härledd från modulen — använd för ALLA skrivningar. */
  tenant: string;
}

export async function resolvePublicModule(
  publicSlug: string
): Promise<ResolvedPublicModule | null> {
  const slug = (publicSlug || '').trim();
  if (!slug) return null;

  const su = await getSuperuserPb();
  if (!su.ok) {
    // Saknade superuser-credentials i miljön → degradera snällt (ingen krasch).
    console.error('[compass] public module fetch: superuser unavailable', su.reason);
    return null;
  }

  try {
    const mod = await su.pb
      .collection('compass_modules')
      .getFirstListItem<CompassModule>(
        su.pb.filter('public_slug = {:s} && is_active = true && public_url_enabled = true', {
          s: slug
        })
      );
    if (!mod.tenant) return null;
    return { pb: su.pb, module: mod, tenant: mod.tenant };
  } catch {
    return null;
  }
}

// Whitelist: kända frågenycklar → lead-fält. Inga övriga fält når lead-schemat
// (dataminimering, GDPR § 5). Delas av submit- och quiz-routarna.
const LEAD_FIELD_MAP: Record<
  string,
  'name' | 'email' | 'phone' | 'organization' | 'idea_summary' | 'idea_category'
> = {
  name: 'name',
  namn: 'name',
  email: 'email',
  epost: 'email',
  phone: 'phone',
  telefon: 'phone',
  organization: 'organization',
  bolag: 'organization',
  idea: 'idea_summary',
  idea_summary: 'idea_summary',
  category: 'idea_category',
  kategori: 'idea_category'
};

export function mapAnswersToLead(
  answers: Record<string, string | string[]>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(answers || {})) {
    const field = LEAD_FIELD_MAP[key];
    if (!field) continue;
    const value = Array.isArray(raw) ? raw.join(', ') : raw;
    if (typeof value === 'string' && value.trim().length > 0) {
      out[field] = value.trim().slice(0, field === 'idea_summary' ? 4000 : 200);
    }
  }
  return out;
}

interface AttrLike {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  referrer_url?: string;
}

export function pickAttribution(attr: AttrLike | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!attr) return out;
  const take = (v: unknown, max: number): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t ? t.slice(0, max) : undefined;
  };
  const map: [keyof AttrLike, number][] = [
    ['utm_source', 100],
    ['utm_medium', 100],
    ['utm_campaign', 100],
    ['utm_term', 100],
    ['utm_content', 200],
    ['referrer_url', 500]
  ];
  for (const [k, max] of map) {
    const v = take(attr[k], max);
    if (v) out[k] = v;
  }
  return out;
}

export async function getPublicModuleQuestions(
  pb: PocketBase,
  moduleId: string
): Promise<CompassQuestion[]> {
  try {
    const res = await pb.collection('compass_questions').getFullList<CompassQuestion>({
      filter: pb.filter('module = {:m}', { m: moduleId }),
      sort: 'sort_order',
      batch: 200
    });
    return res;
  } catch {
    return [];
  }
}
