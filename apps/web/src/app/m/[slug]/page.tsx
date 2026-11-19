import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import {
  COMPASS_LANG_PARAM,
  SURVEY_SUBJECT_PARAM,
  applyCompassModuleTranslation,
  applyCompassQuestionTranslation,
  isValidSurveySubjectId,
  parseCompassLocale,
  type CompassLocale
} from '@platform/shared';
import { PublicModuleLayout } from '@/components/compass/PublicModuleLayout';
import { ensureEnglishTexts } from '@/lib/compass/auto-translate';
import {
  resolvePublicModule,
  getPublicModuleQuestions,
  getPublicTenantBranding,
  getNextModuleLink,
  toPublicModule
} from '@/lib/compass/public';

export const dynamic = 'force-dynamic';

// generateMetadata OCH sidan behöver modulen — dela EN resolvning per request
// (React cache) i stället för två superuser-uppslag per sidvisning.
const resolveOnce = cache((slug: string) => resolvePublicModule(slug));
// Tenantens namn/logotyp — delas likaså mellan metadata och sida.
const brandingOnce = cache((pb: Parameters<typeof getPublicTenantBranding>[0], tenant: string) =>
  getPublicTenantBranding(pb, tenant)
);

const questionsOnce = cache((pb: Parameters<typeof getPublicModuleQuestions>[0], moduleId: string) =>
  getPublicModuleQuestions(pb, moduleId)
);
/**
 * Engelska (§ 23.13): modulen översätts automatiskt första gången någon
 * väljer English och sparas på modulen. En gång per request — metadata och
 * sida delar resultatet (annars skulle den andra översätta om på den ännu
 * inte omlästa modulen).
 */
const englishOnce = cache(async (slug: string): Promise<Record<string, string>> => {
  const resolved = await resolveOnce(slug);
  if (!resolved) return {};
  const questions = await questionsOnce(resolved.pb, resolved.module.id);
  return ensureEnglishTexts(resolved.pb, resolved.module, questions, resolved.tenant);
});

/** Samma sida på ett annat språk — övriga parametrar (UTM, `?om=`) bevaras. */
function languageHref(slug: string, sp: Record<string, string | string[] | undefined>, lang: CompassLocale): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (key === COMPASS_LANG_PARAM || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  if (lang === 'en') params.set(COMPASS_LANG_PARAM, 'en');
  const qs = params.toString();
  return `/m/${encodeURIComponent(slug)}${qs ? `?${qs}` : ''}`;
}

export async function generateMetadata({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { slug } = await params;
  const sp = await searchParams;
  const resolved = await resolveOnce(slug);
  if (!resolved) return { title: 'Sidan finns inte' };
  const texts = parseCompassLocale(sp[COMPASS_LANG_PARAM]) === 'en' ? await englishOnce(slug) : null;
  const m = texts ? applyCompassModuleTranslation(resolved.module, texts) : resolved.module;
  // Fliktiteln bär avsändaren (modulens egen eyebrow, annars tenantens
  // namn) — inte produktnamnet "Startupkompassen" (2026-11).
  const branding = await brandingOnce(resolved.pb, resolved.tenant);
  const sender = (m.hero_eyebrow || '').trim() || branding.name || '';
  const pageTitle = m.welcome_title || m.name;
  return {
    title: sender ? `${pageTitle} · ${sender}` : pageTitle,
    // Bara den publika ingressen — `description` är INTERN (§ 23.7).
    description: m.welcome_body || undefined,
    robots: { index: false } // publika intag-länkar indexeras inte
  };
}

// Publik, OINLOGGAD modul-sida. Renderas på /m/<public_slug>. En anonym
// besökare får den bare-layouten (root-layouten visar AppShell bara för
// inloggade) — en branded, fristående sida i Startupkompassens paper/ink-känsla.
// Kompositionen styrs av modulens MALL (`layout`, § 23.7) i PublicModuleLayout;
// sidan här äger bara datahämtningen.
export default async function PublicModulePage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  // Enkätens subjekt (§ 43): `?om=<id>` — bara ett id-format släpps vidare.
  const subjectRaw = sp[SURVEY_SUBJECT_PARAM];
  const subject = isValidSurveySubjectId(subjectRaw) ? subjectRaw : null;
  const resolved = await resolveOnce(slug);
  if (!resolved) notFound();

  const { pb, module: swedishModule, tenant } = resolved;
  // Språkknappen finns på alla moduler; English översätts automatiskt.
  const locale: CompassLocale = parseCompassLocale(sp[COMPASS_LANG_PARAM]);
  // Frågorna behövs även för chatten (avslutsstegets obligatoriska frågor, § 23.10).
  const [swedishQuestions, branding, nextModule, texts] = await Promise.all([
    questionsOnce(pb, swedishModule.id),
    brandingOnce(pb, tenant),
    getNextModuleLink(pb, swedishModule),
    locale === 'en' ? englishOnce(slug) : Promise.resolve(null)
  ]);
  const visibleModule = texts ? applyCompassModuleTranslation(swedishModule, texts) : swedishModule;
  const questions = texts ? applyCompassQuestionTranslation(swedishQuestions, texts) : swedishQuestions;
  const languageLinks = { sv: languageHref(slug, sp, 'sv'), en: languageHref(slug, sp, 'en') };

  // Bara den vitlistade publika projektionen når klienten — hela posten
  // (intern beskrivning, systemprompt, notis-e-post …) stannar på servern.
  return (
    <PublicModuleLayout
      module={toPublicModule(visibleModule)}
      questions={questions}
      branding={branding}
      nextModule={nextModule}
      subject={subject}
      locale={locale}
      languageLinks={languageLinks}
    />
  );
}
