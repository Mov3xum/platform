import type { Metadata } from 'next';
import { Logo } from '@/components/Logo';
import { readSubscribeToken } from '@/lib/email/subscribe.server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Bekräfta prenumeration', robots: { index: false } };

/**
 * Steg 2 i dubbel opt-in (CLAUDE.md § 54.9). GET visar en knapp — själva
 * bekräftelsen är en POST, så att en mejlskanner som öppnar länken aldrig
 * prenumererar åt någon.
 */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ k?: string; klart?: string; fel?: string }> }) {
  const { k, klart, fel } = await searchParams;
  const payload = !klart ? readSubscribeToken(k) : null;
  const error = fel === 'spara' ? 'Prenumerationen kunde inte sparas just nu. Försök igen om en stund.' : !klart && !payload ? 'Länken är ogiltig eller har gått ut (48 timmar). Fyll i formuläret igen.' : null;
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
          {klart ? (
            <>
              <h1 className="mx-compass-title">Välkommen!</h1>
              <p className="mx-compass-body">Din prenumeration är bekräftad. Du kan ändra dina val eller avsluta via länken i varje mejl.</p>
            </>
          ) : error ? (
            <>
              <h1 className="mx-compass-title">Länken fungerar inte</h1>
              <p className="mx-compass-body">{error}</p>
              <p className="mx-compass-body">
                <a href="/e/prenumerera" style={{ color: 'var(--mx-accent)' }}>
                  Till prenumerationsformuläret
                </a>
              </p>
            </>
          ) : (
            <>
              <h1 className="mx-compass-title">Bekräfta din prenumeration</h1>
              <p className="mx-compass-body">Ett klick till, så är det klart.</p>
            </>
          )}
        </div>
        {payload && !klart && (
          <section className="mx-compass-card">
            <form method="post" action="/api/public/e/bekrafta">
              <input type="hidden" name="k" value={k} />
              <button type="submit" className="mx-btn mx-primary">
                Ja, jag vill ha nyhetsbrevet
              </button>
            </form>
          </section>
        )}
        <footer className="mx-compass-foot">Vi sparar din adress, ditt namn och din organisation (om du angav dem) samt att du gav ditt samtycke.</footer>
      </div>
    </main>
  );
}
