import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { SURVEY_SUBJECT_PARAM, isValidSurveySubjectId } from '@platform/shared';
import { PublicModuleLayout } from '@/components/compass/PublicModuleLayout';
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

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolveOnce(slug);
  if (!resolved) return { title: 'Startupkompassen' };
  const m = resolved.module;
  return {
    title: `${m.welcome_title || m.name} · Startupkompassen`,
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

  const { pb, module, tenant } = resolved;
  const [questions, branding, nextModule] = await Promise.all([
    module.flow_type === 'chat'
      ? Promise.resolve([])
      : getPublicModuleQuestions(pb, module.id),
    getPublicTenantBranding(pb, tenant),
    getNextModuleLink(pb, module)
  ]);

  // Bara den vitlistade publika projektionen når klienten — hela posten
  // (intern beskrivning, systemprompt, notis-e-post …) stannar på servern.
  return (
    <PublicModuleLayout
      module={toPublicModule(module)}
      questions={questions}
      branding={branding}
      nextModule={nextModule}
      subject={subject}
    />
  );
}
