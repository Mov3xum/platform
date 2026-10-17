import type { Metadata } from 'next';
import { Logo } from '@/components/Logo';
import { getPublicTenantBranding } from '@/lib/compass/public';
import { resolveRsvp } from '@/lib/events/rsvp';
import { formatStockholmDateTime, isRsvpAnswer, rsvpOpen } from '@platform/shared';
import { OpenedBeacon } from './OpenedBeacon';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Svar på inbjudan', robots: { index: false } };

const DONE_TEXT: Record<string, { title: string; body: string }> = {
  yes: { title: 'Tack — du är anmäld!', body: 'Vi ses. Vill du ändra dig kan du använda länken i mejlet igen fram till eventet.' },
  no: { title: 'Tack för beskedet', body: 'Vi har noterat att du inte kan komma. Du kan ändra dig via länken i mejlet fram till eventet.' },
  unsubscribe: {
    title: 'Du är avregistrerad',
    body: 'Du får inga fler inbjudningar från oss. Vill du ändra dig, hör av dig till oss så hjälper vi dig.'
  }
};

const ERROR_TEXT: Record<string, string> = {
  lank: 'Länken är ogiltig. Använd länken i det senaste mejlet du fått.',
  stangd: 'Eventet har redan ägt rum — det går inte längre att svara.',
  spara: 'Ditt svar kunde inte sparas just nu. Försök igen om en stund.',
  svar: 'Välj ett av svaren.'
};

// Publik, OINLOGGAD bekräftelsesida för en inbjudan (§ 53.5). GET visar
// bara eventet och knapparna — svaret skickas med POST, så att en
// mejlskanner som öppnar länken aldrig svarar åt mottagaren.
export default async function RsvpPage({
  searchParams
}: {
  searchParams: Promise<{ t?: string; svar?: string; klart?: string; fel?: string }>;
}) {
  const { t, svar, klart, fel } = await searchParams;
  const resolved = !klart ? await resolveRsvp(t) : null;
  const branding = resolved ? await getPublicTenantBranding(resolved.pb, resolved.event.tenant) : null;
  const preselected = isRsvpAnswer(svar) ? svar : null;
  const open = resolved ? rsvpOpen(resolved.event, new Date(), 'yes') : false;
  const done = klart && DONE_TEXT[klart] ? DONE_TEXT[klart] : null;

  return (
    <main className="mx-compass-landing" style={{ ['--mx-accent' as string]: 'var(--movexum-morkbla)' }}>
      <div className="mx-compass-wrap">
        <header className="mx-compass-topbar">
          <span className="mx-compass-brand">
            <Logo
              variant="light"
              href="/"
              height={branding?.logoLightUrl || branding?.logoDarkUrl ? 52 : 40}
              width={branding?.logoLightUrl || branding?.logoDarkUrl ? 260 : 200}
              logoLightUrl={branding?.logoLightUrl}
              logoDarkUrl={branding?.logoDarkUrl}
            />
          </span>
        </header>
        <div className="mx-compass-head">
          <div className="mx-compass-eyebrow" style={{ color: 'var(--mx-accent)' }}>
            INBJUDAN
          </div>
          {done ? (
            <>
              <h1 className="mx-compass-title">{done.title}</h1>
              <p className="mx-compass-body">{done.body}</p>
            </>
          ) : !resolved ? (
            <>
              <h1 className="mx-compass-title">Länken fungerar inte</h1>
              <p className="mx-compass-body">{ERROR_TEXT[fel || 'lank'] ?? ERROR_TEXT.lank}</p>
            </>
          ) : (
            <>
              <h1 className="mx-compass-title">{resolved.event.name || 'Event'}</h1>
              <p className="mx-compass-body">
                {formatStockholmDateTime(resolved.event.starts_at) || 'Tid meddelas'}
                {resolved.event.location ? ` · ${resolved.event.location}` : ''}
              </p>
            </>
          )}
        </div>

        {resolved && !done && t && !resolved.signup.invite_opened_at && <OpenedBeacon token={t} />}
        {resolved && !done && (
          <section className="mx-compass-card">
            {fel && ERROR_TEXT[fel] && <p className="mx-compass-body">{ERROR_TEXT[fel]}</p>}
            <form method="post" action="/api/public/e/rsvp" style={{ display: 'grid', gap: 12 }}>
              <input type="hidden" name="t" value={t} />
              {open ? (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    type="submit"
                    name="svar"
                    value="yes"
                    className={`mx-btn${preselected !== 'no' ? ' mx-primary' : ''}`}
                  >
                    Jag kommer
                  </button>
                  <button type="submit" name="svar" value="no" className={`mx-btn${preselected === 'no' ? ' mx-primary' : ''}`}>
                    Jag kan inte
                  </button>
                </div>
              ) : (
                <p className="mx-compass-body">{ERROR_TEXT.stangd}</p>
              )}
              {/* Avregistrering gäller kontaktnätet; bolagsmedlemmar bjuds in som del av programmet. */}
              {resolved.signup.contact && (
                <div style={{ borderTop: '1px solid var(--mx-line-soft)', paddingTop: 12 }}>
                  <button
                    type="submit"
                    name="svar"
                    value="unsubscribe"
                    className={`mx-btn mx-sm${preselected === 'unsubscribe' ? ' mx-primary' : ''}`}
                  >
                    Avregistrera mig från fler inbjudningar
                  </button>
                </div>
              )}
            </form>
          </section>
        )}
        <footer className="mx-compass-foot">
          Ditt svar sparas bara som anmälan till eventet och hanteras inom EU.
        </footer>
      </div>
    </main>
  );
}
