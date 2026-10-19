import type { Metadata } from 'next';
import { Logo } from '@/components/Logo';
import { resolveSubscribeTenant } from '@/lib/email/subscribe.server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Prenumerera på nyhetsbrevet', robots: { index: true } };

/**
 * Publik prenumerationssida för nyhetsbrevet (CLAUDE.md § 55.9) — dubbel
 * opt-in: formuläret skickar ett bekräftelsemejl, inget sparas förrän
 * länken i mejlet klickats. `?org=<tenant-id>` väljer organisation; annars
 * samma tenant som inloggningssidan.
 */
export default async function SubscribePage({
  searchParams
}: {
  searchParams: Promise<{ org?: string; skickat?: string; fel?: string }>;
}) {
  const { org, skickat, fel } = await searchParams;
  const tenant = await resolveSubscribeTenant(org);
  const name = tenant?.name ?? 'Movexum';
  return (
    <main className="mx-compass-landing" style={{ ['--mx-accent' as string]: 'var(--movexum-morkbla)' }}>
      <div className="mx-compass-wrap">
        <header className="mx-compass-topbar">
          <span className="mx-compass-brand">
            <Logo variant="light" href="/" height={40} width={200} />
          </span>
        </header>
        <div className="mx-compass-head">
          <div className="mx-compass-eyebrow" style={{ color: 'var(--mx-accent)' }}>
            NYHETSBREV
          </div>
          {skickat ? (
            <>
              <h1 className="mx-compass-title">Kolla din inkorg</h1>
              <p className="mx-compass-body">
                Vi har skickat ett mejl med en bekräftelselänk. Klicka på den för att starta prenumerationen — annars
                sparas inga uppgifter. Hittar du inget? Titta i skräpposten.
              </p>
            </>
          ) : (
            <>
              <h1 className="mx-compass-title">{name}s nyhetsbrev</h1>
              <p className="mx-compass-body">Nyheter från inkubatorn och startupscenen i regionen, ungefär en gång i månaden. Avsluta när du vill.</p>
            </>
          )}
        </div>
        {!skickat && tenant && (
          <section className="mx-compass-card">
            {fel && <p className="mx-compass-body">{decodeURIComponent(fel)}</p>}
            <form method="post" action="/api/public/e/prenumerera" style={{ display: 'grid', gap: 12 }}>
              <input type="hidden" name="org" value={tenant.id} />
              <label style={{ display: 'grid', gap: 4 }}>
                <span className="mx-t-13 mx-fw-6">E-postadress</span>
                <input className="mx-input" type="email" name="email" required maxLength={254} autoComplete="email" />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className="mx-t-13 mx-fw-6">Namn (frivilligt)</span>
                <input className="mx-input" type="text" name="name" maxLength={120} autoComplete="name" />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className="mx-t-13 mx-fw-6">Organisation (frivilligt)</span>
                <input className="mx-input" type="text" name="organization" maxLength={160} autoComplete="organization" />
              </label>
              {/* Honungsfälla för robotar — fylls aldrig i av människor. */}
              <input type="text" name="website" tabIndex={-1} autoComplete="off" style={{ position: 'absolute', left: -9999 }} aria-hidden="true" />
              <button type="submit" className="mx-btn mx-primary">
                Skicka bekräftelselänk
              </button>
            </form>
          </section>
        )}
        {!tenant && !skickat && <section className="mx-compass-card">Tjänsten är inte tillgänglig just nu.</section>}
        <footer className="mx-compass-foot">
          Vi sparar din adress först när du bekräftat. Du kan avsluta prenumerationen via länken i varje mejl. Uppgifterna hanteras inom EU.
        </footer>
      </div>
    </main>
  );
}
