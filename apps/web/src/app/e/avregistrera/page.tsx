import type { Metadata } from 'next';
import { Logo } from '@/components/Logo';
import { unsubscribeSecret, verifyUnsubscribeKey } from '@/lib/unsubscribe-key';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Avregistrering', robots: { index: false } };

const ERROR_TEXT: Record<string, string> = {
  lank: 'Länken är ogiltig. Använd avregistreringslänken längst ned i ett mejl från oss.',
  spara: 'Det gick inte att avregistrera dig just nu. Försök igen om en stund.'
};

// Publik, OINLOGGAD bekräftelsesida för avregistrering (§ 53.5). GET visar
// bara en knapp — själva avregistreringen är en POST, så att en mejlskanner
// som öppnar länken aldrig avregistrerar någon.
export default async function UnsubscribePage({
  searchParams
}: {
  searchParams: Promise<{ k?: string; klart?: string; fel?: string; alla?: string; test?: string }>;
}) {
  const { k, klart, fel, alla, test } = await searchParams;
  if (test) {
    return (
      <main className="mx-compass-landing" style={{ ['--mx-accent' as string]: 'var(--movexum-morkbla)' }}>
        <div className="mx-compass-wrap">
          <div className="mx-compass-head">
            <h1 className="mx-compass-title">Testlänk</h1>
            <p className="mx-compass-body">Det här är en länk från ett testmejl. I ett riktigt utskick avregistrerar den mottagaren.</p>
          </div>
        </div>
      </main>
    );
  }
  const valid = Boolean(verifyUnsubscribeKey(k, unsubscribeSecret()));
  const error = fel && ERROR_TEXT[fel] ? ERROR_TEXT[fel] : !klart && !valid ? ERROR_TEXT.lank : null;

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
            INBJUDNINGAR
          </div>
          {klart ? (
            <>
              <h1 className="mx-compass-title">Du är avregistrerad</h1>
              <p className="mx-compass-body">
                {alla
                  ? 'Du får inga fler utskick från Movexum via e-post. Har du redan tackat ja till ett event står anmälan kvar.'
                  : 'Du får inga fler inbjudningar till event från Movexum. Har du redan tackat ja till ett event står anmälan kvar.'}{' '}
                Vill du ändra dig, hör av dig till oss.
              </p>
            </>
          ) : (
            <>
              <h1 className="mx-compass-title">{alla ? 'Avregistrera dig från Movexums utskick' : 'Avregistrera dig från inbjudningar'}</h1>
              <p className="mx-compass-body">
                {error ?? (alla ? 'Du slutar få alla utskick från Movexum via e-post.' : 'Du slutar få inbjudningar till Movexums event via e-post.')}
              </p>
              {!error && (
                <p className="mx-compass-body" style={{ fontSize: 13 }}>
                  Vill du hellre välja vad du får?{' '}
                  <a href={`/e/installningar?k=${encodeURIComponent(k ?? '')}`} style={{ color: 'var(--mx-accent)' }}>
                    Hantera dina utskick
                  </a>
                  .
                </p>
              )}
            </>
          )}
        </div>
        {!klart && valid && (
          <section className="mx-compass-card">
            <form method="post" action="/api/public/e/unsubscribe">
              <input type="hidden" name="k" value={k} />
              {alla && <input type="hidden" name="alla" value="1" />}
              <button type="submit" className="mx-btn mx-primary">
                Avregistrera mig
              </button>
            </form>
          </section>
        )}
        <footer className="mx-compass-foot">Vi sparar bara att du inte vill ha fler inbjudningar.</footer>
      </div>
    </main>
  );
}
