import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PublicModuleLayout } from '@/components/compass/PublicModuleLayout';
import {
  resolvePublicModule,
  getPublicModuleQuestions,
  getPublicTenantBranding,
  getNextModuleLink
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
// Kompositionen styrs av modulens MALL (`layout`, § 23.7) i PublicModuleLayout;
// sidan här äger bara datahämtningen.
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

  return (
    <PublicModuleLayout
      module={module}
      questions={questions}
      branding={branding}
      nextModule={nextModule}
    />
  );
}
