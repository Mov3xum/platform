import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/Logo';
import type { PublicTenantBranding } from '@/lib/compass/public';
import type { PublicTalentTenant } from '@/lib/talent/public';

/**
 * Presentationsskal för studentsidan (§ 54) — samma publika språk som
 * Startupkompassen (mx-compass-*). Ingen AppShell, ingen användarsession;
 * navigeringen visar "Min sida" bara när en studentsession finns.
 */
export function TalentPublicShell({
  tenant,
  branding,
  student,
  active,
  eyebrow,
  title,
  body,
  children
}: {
  tenant: PublicTalentTenant;
  branding: PublicTenantBranding;
  student: { first_name: string } | null;
  active: 'behov' | 'registrera' | 'logga-in' | 'jag';
  eyebrow?: string;
  title: string;
  body?: ReactNode;
  children: ReactNode;
}) {
  const base = `/s/${encodeURIComponent(tenant.slug)}`;
  const hasLogo = Boolean(branding.logoLightUrl || branding.logoDarkUrl);
  const link = (href: string, label: string, id: typeof active) => (
    <Link
      href={href}
      className="mx-btn mx-sm"
      style={active === id ? { background: 'var(--mx-accent)', color: '#fff', borderColor: 'var(--mx-accent)' } : undefined}
    >
      {label}
    </Link>
  );
  return (
    <main className="mx-compass-landing" data-layout="classic" style={{ ['--mx-accent' as string]: 'var(--movexum-morkbla)' }}>
      <div className="mx-compass-wrap">
        <header className="mx-compass-topbar">
          <span className="mx-compass-brand">
            <Logo variant="light" href={base} height={hasLogo ? 52 : 40} width={hasLogo ? 260 : 200} logoLightUrl={branding.logoLightUrl} logoDarkUrl={branding.logoDarkUrl} />
          </span>
          <nav aria-label="Studentsidan" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {link(base, 'Uppdrag', 'behov')}
            {student ? link(`${base}/jag`, `Min sida · ${student.first_name}`, 'jag') : link(`${base}/registrera`, 'Skapa profil', 'registrera')}
            {!student ? link(`${base}/logga-in`, 'Logga in', 'logga-in') : null}
          </nav>
        </header>
        <div className="mx-compass-head">
          <div className="mx-compass-eyebrow">{eyebrow ?? `STUDENTER & TALANG · ${tenant.name.toUpperCase()}`}</div>
          <h1 className="mx-compass-title">{title}</h1>
          {body ? <p className="mx-compass-body">{body}</p> : null}
        </div>
        {children}
        <footer className="mx-compass-foot">
          Uppgifterna hanteras inom EU av {tenant.name}. Bolagen ser din profil anonymt tills du själv väljer att ta kontakt. Ingen AI bedömer eller rangordnar
          studenter — matchningen bygger bara på de hashtags du själv valt.
        </footer>
      </div>
    </main>
  );
}

export function PublicCard({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <section className="mx-compass-card" style={{ display: 'grid', gap: 14 }}>
      {title ? (
        <h2 className="mx-disp" style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--mx-ink)' }}>
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

export function TagRow({ tags, labels, highlight }: { tags: readonly string[]; labels: (slug: string) => string; highlight?: ReadonlySet<string> }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {tags.map((t) => (
        <span key={t} className={`mx-chip ${highlight?.has(t) ? 'mx-green' : 'mx-draft'}`}>
          #{labels(t)}
        </span>
      ))}
    </div>
  );
}
