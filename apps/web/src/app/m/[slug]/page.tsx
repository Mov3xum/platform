import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { PublicModuleRunner } from '@/components/compass/PublicModuleRunner';
import {
  resolvePublicModule,
  getPublicModuleQuestions,
  toPublicModuleView,
  stripQuestionScoring
} from '@/lib/compass/public';

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

  const { pb, module } = resolved;
  // Projektion till publik-säker DTO innan något når den anonyma klienten:
  // strippar system_prompt/notify_emails/model/result_buckets (M3) och
  // scoring-kartan i frågorna.
  const safeModule = toPublicModuleView(module);
  const questions =
    module.flow_type === 'chat'
      ? []
      : stripQuestionScoring(await getPublicModuleQuestions(pb, module.id));

  const accent = module.theme_color && /^#[0-9a-fA-F]{3,8}$/.test(module.theme_color)
    ? module.theme_color
    : undefined;

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--mx-canvas, #ffffff)',
        padding: '24px 16px 64px'
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'grid', gap: 24 }}>
        {/* Toppbar: logotyp + modul-badge */}
        <div className="mx-flex mx-items-c mx-gap-3" style={{ flexWrap: 'wrap' }}>
          <Logo height={28} variant="auto" href="/" />
          <span
            className="mx-chip mx-mono mx-t-xs"
            style={{ background: 'var(--mx-paper-2)', color: 'var(--mx-ink)' }}
          >
            {module.name}
          </span>
        </div>

        {/* Hero */}
        <header style={{ display: 'grid', gap: 8 }}>
          <div
            className="mx-mono mx-t-xs mx-t-up mx-fw-6"
            style={{ color: accent || '#002c40', letterSpacing: '0.08em' }}
          >
            {module.hero_eyebrow || 'STARTUPKOMPASSEN'}
          </div>
          <h1 className="mx-disp" style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.1, margin: 0 }}>
            {module.welcome_title || module.name}
          </h1>
          {(module.welcome_body || module.description) && (
            <p className="mx-t-15 mx-muted" style={{ lineHeight: 1.6, margin: 0, maxWidth: 560 }}>
              {module.welcome_body || module.description}
            </p>
          )}
        </header>

        {/* Flöde */}
        <section
          style={{
            background: module.flow_type === 'chat' ? 'transparent' : 'var(--mx-paper)',
            border: module.flow_type === 'chat' ? 'none' : '1px solid var(--mx-line)',
            borderRadius: 'var(--mx-r-lg, 16px)',
            padding: module.flow_type === 'chat' ? 0 : 24,
            boxShadow: module.flow_type === 'chat' ? 'none' : 'var(--mx-sh-2)'
          }}
        >
          <PublicModuleRunner module={safeModule} questions={questions} />
        </section>

        {/* Transparens (EU AI Act art. 50 för chat) + EU-suveränitet */}
        <footer className="mx-mono mx-t-xs mx-muted" style={{ textAlign: 'center' }}>
          {module.flow_type === 'chat'
            ? 'Drivs av Mistral / Le Chat (EU-suveränt) · Genererat av AI – verifiera innan delning'
            : 'Dina svar hanteras inom EU och delas aldrig vidare.'}
        </footer>
      </div>
    </main>
  );
}
