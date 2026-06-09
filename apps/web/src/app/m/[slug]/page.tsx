import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { PublicModuleRunner } from '@/components/compass/PublicModuleRunner';
import {
  resolvePublicModule,
  getPublicModuleQuestions,
  getPublicTenantBranding,
  getNextModuleLink
} from '@/lib/compass/public';
import { moduleHeroImageUrl } from '@/lib/compass/media';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolvePublicModule(slug);
  if (!resolved) return { title: 'Startupkompassen' };
  const m = resolved.module;
  return {
    title: `${m.welcome_title || m.name} · Startupkompassen`,
    description: m.welcome_body || m.description || undefined,
    robots: { index: false } // publika intag-länkar indexeras inte
  };
}

// Publik, OINLOGGAD modul-sida. Renderas på /m/<public_slug>. En anonym
// besökare får den bare-layouten (root-layouten visar AppShell bara för
// inloggade) — en branded, fristående sida i Startupkompassens paper/ink-känsla.
export default async function PublicModulePage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const resolved = await resolvePublicModule(slug);
  if (!resolved) notFound();

  const { pb, module, tenant } = resolved;
  const [questions, branding, nextModule] = await Promise.all([
    module.flow_type === 'chat'
      ? Promise.resolve([])
      : getPublicModuleQuestions(pb, module.id),
    getPublicTenantBranding(pb, tenant),
    getNextModuleLink(pb, module)
  ]);
  const hasTenantLogo = Boolean(branding.logoLightUrl || branding.logoDarkUrl);

  const accent =
    module.theme_color && /^#[0-9a-fA-F]{3,8}$/.test(module.theme_color)
      ? module.theme_color
      : '#002c40';
  const heroImageUrl = moduleHeroImageUrl(module);
  const isChat = module.flow_type === 'chat';

  const title = module.welcome_title || module.name;
  const eyebrow = module.hero_eyebrow || 'STARTUPKOMPASSEN';
  // Undvik dubblerad rubrik när eyebrow råkar vara identisk med titeln.
  const showEyebrow = eyebrow.trim().toLowerCase() !== (title || '').trim().toLowerCase();
  const body = module.welcome_body || module.description;

  return (
    <main className="mx-compass-landing" style={{ ['--mx-accent' as string]: accent }}>
      <div className="mx-compass-wrap">
        {/* Topbar — wordmark (mörkblå) + valfri målgruppspill */}
        <header className="mx-compass-topbar">
          <span className="mx-compass-brand">
            {/* Tenantens uppladdade logotyp (från /installningar) om den finns,
                annars text-wordmarken. Den publika sidan är alltid ljus. */}
            <Logo
              variant="light"
              href="/"
              height={hasTenantLogo ? 52 : 40}
              width={hasTenantLogo ? 260 : 200}
              logoLightUrl={branding.logoLightUrl}
              logoDarkUrl={branding.logoDarkUrl}
            />
          </span>
          {module.target_audience && (
            <span className="mx-compass-aud">{module.target_audience}</span>
          )}
        </header>

        {/* Omslagsbild — visas bara när en bild laddats upp (ingen blå
            gradient-fallback; titeln visas ändå i hero-texten nedan) */}
        {heroImageUrl && (
          <div className="mx-compass-hero">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={heroImageUrl} alt="" className="mx-compass-hero-img" />
          </div>
        )}

        {/* Hero-text */}
        <div className="mx-compass-head">
          {showEyebrow && (
            <div className="mx-compass-eyebrow" style={{ color: accent }}>
              {eyebrow}
            </div>
          )}
          <h1 className="mx-compass-title">{title}</h1>
          {body && <p className="mx-compass-body">{body}</p>}
        </div>

        {/* Flöde */}
        <section className={`mx-compass-card${isChat ? ' mx-compass-card-chat' : ''}`}>
          <PublicModuleRunner
            module={module}
            questions={questions}
            brandName={branding.name}
            nextModule={nextModule}
          />
        </section>

        {/* Transparens (EU AI Act art. 50 för chat) + EU-suveränitet */}
        <footer className="mx-compass-foot">
          {isChat
            ? 'Drivs av Mistral / Le Chat (EU-suveränt) · Genererat av AI – verifiera innan delning'
            : 'Dina svar hanteras inom EU och delas aldrig vidare.'}
        </footer>
      </div>
    </main>
  );
}
