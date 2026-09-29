import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { SurveyRunner } from '@/components/surveys/SurveyRunner';
import { resolvePublicSurvey } from '@/lib/surveys/public';
import { getPublicTenantBranding } from '@/lib/compass/public';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolvePublicSurvey(slug);
  if (!resolved) return { title: 'Enkät' };
  const s = resolved.survey;
  return {
    title: s.welcome_title || s.name,
    description: s.welcome_body || undefined,
    robots: { index: false }
  };
}

// Publik, OINLOGGAD enkätsida (/u/<public_slug>). Fristående yta utan AppShell.
export default async function PublicSurveyPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const resolved = await resolvePublicSurvey(slug);
  if (!resolved) notFound();
  const { pb, survey } = resolved;
  const branding = await getPublicTenantBranding(pb, survey.tenant);
  const hasLogo = Boolean(branding.logoLightUrl || branding.logoDarkUrl);

  return (
    <main
      className="mx-compass-landing"
      style={{ ['--mx-accent' as string]: 'var(--movexum-morkbla)' }}
    >
      <div className="mx-compass-wrap">
        <header className="mx-compass-topbar">
          <span className="mx-compass-brand">
            <Logo
              variant="light"
              href="/"
              height={hasLogo ? 52 : 40}
              width={hasLogo ? 260 : 200}
              logoLightUrl={branding.logoLightUrl}
              logoDarkUrl={branding.logoDarkUrl}
            />
          </span>
        </header>
        <div className="mx-compass-head">
          <div className="mx-compass-eyebrow" style={{ color: 'var(--mx-accent)' }}>
            ENKÄT
          </div>
          <h1 className="mx-compass-title">{survey.welcome_title || survey.name}</h1>
          {survey.welcome_body && <p className="mx-compass-body">{survey.welcome_body}</p>}
        </div>
        <section className="mx-compass-card">
          <SurveyRunner
            slug={slug}
            questions={survey.questions}
            thankYou={survey.thank_you_message || 'Tack för dina svar!'}
          />
        </section>
        <footer className="mx-compass-foot">
          Svaren är anonyma, hanteras inom EU och delas aldrig vidare.
        </footer>
      </div>
    </main>
  );
}
