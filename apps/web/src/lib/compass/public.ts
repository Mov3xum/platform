import 'server-only';
import type PocketBase from 'pocketbase';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { getPublicPbUrl } from '@/lib/pb-url';
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

  // Slå upp en AKTIV + PUBLIK modul. Vi matchar i första hand på den globalt
  // unika `public_slug` (CLAUDE.md § 23.2). Som defensiv fallback matchar vi
  // även på den interna `slug` — fortfarande begränsat till is_active +
  // public_url_enabled, och tenant härleds ALLTID FRÅN modulen (aldrig från
  // request-bodyn). Det gör flödet robust mot att en delad länk/klient skickar
  // den interna sluggen i stället för den publika (symptomet "Modul saknas
  // eller är inte publik." på resultatsteget trots att modulen är publicerad).
  const tryFilter = async (expr: string): Promise<CompassModule | null> => {
    try {
      return await su.pb
        .collection('compass_modules')
        .getFirstListItem<CompassModule>(su.pb.filter(expr, { s: slug }));
    } catch {
      return null;
    }
  };

  const mod =
    (await tryFilter('public_slug = {:s} && is_active = true && public_url_enabled = true')) ||
    (await tryFilter('slug = {:s} && is_active = true && public_url_enabled = true'));

  if (!mod) {
    console.error('[compass] public module not found for slug', slug);
    return null;
  }
  if (!mod.tenant) return null;
  return { pb: su.pb, module: mod, tenant: mod.tenant };
}

export interface PublicTenantBranding {
  logoLightUrl?: string;
  logoDarkUrl?: string;
  name?: string;
}

// Hämtar tenantens uppladdade logotyp (från /installningar) för den publika
// modulsidan. Logofälten serveras tokenlöst via PocketBase (samma mönster som
// auth.server.ts + compass-hero, CLAUDE.md § 18.2) → fungerar för en anonym
// besökare. Returnerar tomt objekt om tenant/logo saknas (text-wordmark visas).
export async function getPublicTenantBranding(
  pb: PocketBase,
  tenantId: string
): Promise<PublicTenantBranding> {
  if (!tenantId) return {};
  try {
    const tenant = await pb
      .collection('tenants')
      .getOne<{ id: string; name?: string; logo_light?: string; logo_dark?: string }>(tenantId);
    const base = getPublicPbUrl().replace(/\/$/, '');
    const fileUrl = (filename?: string) =>
      filename
        ? `${base}/api/files/tenants/${tenantId}/${encodeURIComponent(filename)}`
        : undefined;
    return {
      name: tenant.name,
      logoLightUrl: fileUrl(tenant.logo_light),
      logoDarkUrl: fileUrl(tenant.logo_dark)
    };
  } catch {
    return {};
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

export function buildModuleChatSystemPrompt(
  module: Pick<CompassModule, 'name' | 'chat_persona' | 'system_prompt'>,
  questions: CompassQuestion[]
): string | undefined {
  const segments: string[] = [];

  if (module.chat_persona) {
    segments.push(`Du agerar som "${module.chat_persona}".`);
  }

  if (module.system_prompt) {
    segments.push(module.system_prompt);
  }

  if (questions.length > 0) {
    const guide = questions
      .map((question, index) => {
        const lines = [`${index + 1}. ${question.key}: ${question.prompt}`];
        lines.push(`   Typ: ${question.input_type}${question.required ? ' (obligatorisk)' : ''}`);
        if (question.help_text) lines.push(`   Hjälp: ${question.help_text}`);
        if (question.choices?.length) {
          lines.push(
            '   Alternativ: ' +
              question.choices
                .map((choice) => {
                  const next = choice.next_key ? ` → ${choice.next_key}` : '';
                  return `${choice.label} [${choice.value}]${next}`;
                })
                .join(' · ')
          );
        }
        return lines.join('\n');
      })
      .join('\n\n');

    segments.push(
      [
        'Frågebank för modulen:',
        'Använd frågorna som en dynamisk intervjuguide.',
        'Ställ en fråga i taget, anpassa ordningen efter användarens svar och hoppa till choice.next_key när det finns ett angivet nästa steg.',
        'När du har tillräckligt underlag, sammanfatta kort och fortsätt till nästa relevanta fråga eller be om kontaktuppgifter om de saknas.',
        guide
      ].join('\n')
    );
  }

  return segments.length > 0 ? segments.join('\n\n') : undefined;
}
