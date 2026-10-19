import type { Metadata } from 'next';
import { Logo } from '@/components/Logo';
import { loadPreferences } from '@/lib/email/preferences.server';
import { EMAIL_CATEGORIES, EMAIL_CATEGORY_DESCRIPTIONS, EMAIL_CATEGORY_LABELS } from '@platform/shared';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Dina utskick', robots: { index: false } };

const ERROR_TEXT: Record<string, string> = {
  lank: 'Länken är ogiltig. Använd länken "Hantera dina utskick" längst ned i ett mejl från oss.',
  spara: 'Dina val kunde inte sparas just nu. Försök igen om en stund.'
};

/**
 * Preferenscentret (CLAUDE.md § 55.9) — publik, OINLOGGAD sida där mottagaren
 * väljer vilka utskick hen vill ha från Movexum. GET visar bara valen; POST
 * sparar. Visar förnamn och kategorier — aldrig e-postadressen.
 */
export default async function PreferencesPage({
  searchParams
}: {
  searchParams: Promise<{ k?: string; klart?: string; fel?: string; test?: string }>;
}) {
  const { k, klart, fel, test } = await searchParams;
  const view = test ? null : await loadPreferences(k);
  const error = fel && ERROR_TEXT[fel] ? ERROR_TEXT[fel] : null;

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
            DINA UTSKICK
          </div>
          {test ? (
            <>
              <h1 className="mx-compass-title">Testlänk</h1>
              <p className="mx-compass-body">Det här är en länk från ett testmejl. I ett riktigt utskick leder den till mottagarens egna val.</p>
            </>
          ) : klart ? (
            <>
              <h1 className="mx-compass-title">Dina val är sparade</h1>
              <p className="mx-compass-body">Tack! Du kan ändra dig när som helst via länken i ett mejl från oss.</p>
            </>
          ) : !view ? (
            <>
              <h1 className="mx-compass-title">Länken fungerar inte</h1>
              <p className="mx-compass-body">{error ?? ERROR_TEXT.lank}</p>
            </>
          ) : (
            <>
              <h1 className="mx-compass-title">{view.firstName ? `Hej ${view.firstName}!` : 'Hej!'}</h1>
              <p className="mx-compass-body">Välj vad du vill få från Movexum. Du kan ändra dig när som helst.</p>
            </>
          )}
        </div>
        {view && !klart && (
          <section className="mx-compass-card">
            {error && <p className="mx-compass-body">{error}</p>}
            <form method="post" action="/api/public/e/preferenser" style={{ display: 'grid', gap: 14 }}>
              <input type="hidden" name="k" value={k} />
              {EMAIL_CATEGORIES.map((cat) => {
                const on = !view.optOut.has('all') && !view.optOut.has(cat) && (cat !== 'newsletter' || view.newsletterConsent || !view.optOut.has(cat));
                return (
                  <label key={cat} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
                    <input type="checkbox" name={`cat_${cat}`} defaultChecked={on} style={{ marginTop: 4, width: 18, height: 18, accentColor: 'var(--mx-accent)' }} />
                    <span>
                      <span style={{ fontWeight: 600, display: 'block' }}>{EMAIL_CATEGORY_LABELS[cat]}</span>
                      <span className="mx-compass-body" style={{ fontSize: 13 }}>
                        {EMAIL_CATEGORY_DESCRIPTIONS[cat]}
                        {cat === 'newsletter' && !view.newsletterConsent ? ' Genom att kryssa i ger du ditt samtycke till nyhetsbrevet.' : ''}
                      </span>
                    </span>
                  </label>
                );
              })}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="submit" className="mx-btn mx-primary">
                  Spara mina val
                </button>
                <button type="submit" name="alla_av" value="1" className="mx-btn mx-sm">
                  Avregistrera mig från allt
                </button>
              </div>
            </form>
          </section>
        )}
        <footer className="mx-compass-foot">Vi sparar bara dina val — inget annat. Uppgifterna hanteras inom EU.</footer>
      </div>
    </main>
  );
}
