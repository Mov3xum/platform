import type { Metadata } from 'next';
import QRCode from 'qrcode';
import { Logo } from '@/components/Logo';
import { getPublicTenantBranding } from '@/lib/compass/public';
import { loadSeatsTaken, resolveRsvp, type ResolvedRsvp } from '@/lib/events/rsvp';
import { requestOrigin } from '@/lib/request-origin';
import {
  SEAT_STAGES,
  checkInPath,
  eventSeatsLeft,
  formatStockholmDateTime,
  isRsvpAnswer,
  rsvpAsksAnything,
  rsvpOpen
} from '@platform/shared';
import { OpenedBeacon } from './OpenedBeacon';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Svar på inbjudan', robots: { index: false } };

const DONE_TEXT: Record<string, { title: string; body: string }> = {
  yes: { title: 'Tack — du är anmäld!', body: 'Vi ses. Vill du ändra dig kan du använda länken i mejlet igen fram till eventet.' },
  waitlist: {
    title: 'Du står på väntelistan',
    body: 'Eventet är fullt just nu. Blir det en plats ledig hör vi av oss till dig. Du kan ändra ditt svar via länken i mejlet fram till eventet.'
  },
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
  svar: 'Välj ett av svaren.',
  fullt: 'Eventet är fullt — det finns inte plats för så många. Prova med färre medföljande, eller svara att du inte kan komma.'
};

/** QR-koden för incheckning renderas lokalt (ren JS, inga externa anrop) — som i Startupkompassens delningsvy. */
async function ticketQr(url: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: 'M' });
  } catch {
    return null;
  }
}

// Publik, OINLOGGAD bekräftelsesida för en inbjudan (§ 53.5, § 54.11). GET
// visar bara eventet, gästfrågorna och knapparna — svaret skickas med POST,
// så att en mejlskanner som öppnar länken aldrig svarar åt mottagaren. Efter
// ett ja visas biljetten (QR för incheckning), kalenderfilen och svaren.
export default async function RsvpPage({
  searchParams
}: {
  searchParams: Promise<{ t?: string; svar?: string; klart?: string; fel?: string; test?: string }>;
}) {
  const { t, svar, klart, fel, test } = await searchParams;
  const isTest = test === '1';
  // Ett ja-svar behåller token i adressen så vi kan visa biljett + kalender.
  const needsResolve = !klart || klart === 'yes' || klart === 'waitlist';
  const resolved = needsResolve ? await resolveRsvp(t) : null;
  const branding = resolved ? await getPublicTenantBranding(resolved.pb, resolved.event.tenant) : null;
  const preselected = isRsvpAnswer(svar) ? svar : null;
  const open = resolved ? rsvpOpen(resolved.event, new Date(), 'yes') : false;
  const done = klart && DONE_TEXT[klart] ? DONE_TEXT[klart] : null;
  const settings = resolved?.settings ?? null;

  // Platsläge (bara när eventet har maxantal): visas före svaret och i biljetten.
  let seatsLeft: number | null = null;
  if (resolved && settings && settings.capacity > 0) {
    const taken = await loadSeatsTaken(resolved.pb, resolved.signup.tenant, resolved.event.id);
    seatsLeft = eventSeatsLeft(settings, taken);
  }
  const holdsSeat = resolved ? SEAT_STAGES.includes(resolved.signup.stage) : false;
  const full = seatsLeft !== null && seatsLeft <= 0 && !holdsSeat;

  // Biljett efter ja: QR-koden pekar på personalens incheckningssida.
  let qr: string | null = null;
  if (resolved && klart === 'yes' && t && holdsSeat) {
    const origin = await requestOrigin();
    if (origin) qr = await ticketQr(`${origin}${checkInPath(resolved.event.id, t)}`);
  }

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
            {isTest ? 'INBJUDAN · TESTLÄNK' : 'INBJUDAN'}
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

        {isTest && (
          <section className="mx-compass-card" style={{ borderColor: 'var(--movexum-gul)' }}>
            <p className="mx-compass-body" style={{ margin: 0 }}>
              Det här är en testlänk från ett testmejl. Den är inte kopplad till någon inbjudan, så ett svar sparas inte.
            </p>
          </section>
        )}

        {resolved && !done && t && !resolved.signup.invite_opened_at && <OpenedBeacon token={t} />}

        {resolved && done && (klart === 'yes' || klart === 'waitlist') && (
          <Ticket resolved={resolved} token={t ?? ''} qr={qr} eventName={resolved.event.name || 'Event'} />
        )}

        {resolved && !done && (
          <section className="mx-compass-card">
            {fel && ERROR_TEXT[fel] && (
              <p className="mx-compass-body" style={{ color: 'var(--movexum-morkorange)' }}>
                {ERROR_TEXT[fel]}
              </p>
            )}
            {seatsLeft !== null && open && (
              <p className="mx-compass-body" style={{ marginTop: 0 }}>
                {full
                  ? settings?.waitlist
                    ? 'Eventet är fullt — du kan ställa dig på väntelistan.'
                    : 'Eventet är fullt.'
                  : seatsLeft <= 10
                    ? `${seatsLeft} ${seatsLeft === 1 ? 'plats' : 'platser'} kvar.`
                    : 'Det finns platser kvar.'}
              </p>
            )}
            {holdsSeat && open && (
              <p className="mx-compass-body" style={{ marginTop: 0 }}>
                Du är anmäld{resolved.signup.plus_ones ? ` med ${resolved.signup.plus_ones} medföljande` : ''}. Du kan uppdatera dina svar
                nedan.
              </p>
            )}
            <form method="post" action="/api/public/e/rsvp" style={{ display: 'grid', gap: 12 }}>
              <input type="hidden" name="t" value={t} />
              {open ? (
                <>
                  {settings && rsvpAsksAnything(settings) && <GuestQuestions resolved={resolved} />}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button
                      type="submit"
                      name="svar"
                      value="yes"
                      className={`mx-btn${preselected !== 'no' ? ' mx-primary' : ''}`}
                      disabled={full && !settings?.waitlist}
                    >
                      {full && settings?.waitlist ? 'Ställ mig på väntelistan' : holdsSeat ? 'Uppdatera mitt svar' : 'Jag kommer'}
                    </button>
                    <button type="submit" name="svar" value="no" className={`mx-btn${preselected === 'no' ? ' mx-primary' : ''}`}>
                      Jag kan inte
                    </button>
                  </div>
                </>
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
          {settings?.ask_diet ? ' Uppgifter om kost och allergi är frivilliga, används bara för det här eventet och raderas med det.' : ''}
        </footer>
      </div>
    </main>
  );
}

/** Gästfrågorna som eventet ställer (§ 54.11): medföljande, kost/allergi, egen fråga. Förifylls med tidigare svar. */
function GuestQuestions({ resolved }: { resolved: ResolvedRsvp }) {
  const { settings, signup } = resolved;
  const fieldStyle = { display: 'grid', gap: 6 } as const;
  const labelStyle = { fontSize: 13, fontWeight: 600 } as const;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {settings.plus_ones_max > 0 && (
        <label style={fieldStyle}>
          <span style={labelStyle}>Tar du med någon?</span>
          <select name="plus_ones" className="mx-input" defaultValue={String(signup.plus_ones ?? 0)}>
            {Array.from({ length: settings.plus_ones_max + 1 }, (_, n) => (
              <option key={n} value={n}>
                {n === 0 ? 'Nej, jag kommer själv' : n === 1 ? '1 medföljande' : `${n} medföljande`}
              </option>
            ))}
          </select>
        </label>
      )}
      {settings.ask_diet && (
        <label style={fieldStyle}>
          <span style={labelStyle}>Kost eller allergi vi bör känna till? (frivilligt)</span>
          <input name="diet" className="mx-input" maxLength={300} defaultValue={signup.diet ?? ''} placeholder="T.ex. vegetariskt, nötallergi" />
        </label>
      )}
      {settings.custom_question && (
        <label style={fieldStyle}>
          <span style={labelStyle}>{settings.custom_question}</span>
          <input name="custom_answer" className="mx-input" maxLength={300} defaultValue={signup.custom_answer ?? ''} />
        </label>
      )}
    </div>
  );
}

/** Biljetten efter ett ja (eller väntelistebeskedet): kalenderfil, QR för incheckning, lämnade svar. */
function Ticket({ resolved, token, qr, eventName }: { resolved: ResolvedRsvp; token: string; qr: string | null; eventName: string }) {
  const { signup, event, settings } = resolved;
  const onWaitlist = signup.stage === 'waitlist';
  const calendarHref = token ? `/api/public/e/kalender?t=${encodeURIComponent(token)}` : null;
  return (
    <section className="mx-compass-card" style={{ display: 'grid', gap: 14 }}>
      <div>
        <div className="mx-compass-eyebrow" style={{ color: 'var(--mx-accent)' }}>
          {onWaitlist ? 'VÄNTELISTA' : 'DIN BILJETT'}
        </div>
        <strong style={{ display: 'block', fontSize: 16 }}>{eventName}</strong>
        <span className="mx-compass-body" style={{ margin: 0 }}>
          {formatStockholmDateTime(event.starts_at) || 'Tid meddelas'}
          {event.location ? ` · ${event.location}` : ''}
        </span>
      </div>
      {!onWaitlist && qr && (
        <div style={{ display: 'grid', gap: 6, justifyItems: 'start' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR-kod för incheckning" width={180} height={180} style={{ borderRadius: 12, background: '#fff' }} />
          <span style={{ fontSize: 12, opacity: 0.75 }}>Visa QR-koden vid entrén så checkar vi in dig. Spara gärna sidan eller ta en skärmdump.</span>
        </div>
      )}
      <dl style={{ margin: 0, display: 'grid', gap: 4, fontSize: 14 }}>
        {signup.name && (
          <div>
            <dt style={{ display: 'inline', fontWeight: 600 }}>Namn: </dt>
            <dd style={{ display: 'inline', margin: 0 }}>{signup.name}</dd>
          </div>
        )}
        {settings.plus_ones_max > 0 && (
          <div>
            <dt style={{ display: 'inline', fontWeight: 600 }}>Medföljande: </dt>
            <dd style={{ display: 'inline', margin: 0 }}>{signup.plus_ones ?? 0}</dd>
          </div>
        )}
        {settings.ask_diet && signup.diet && (
          <div>
            <dt style={{ display: 'inline', fontWeight: 600 }}>Kost/allergi: </dt>
            <dd style={{ display: 'inline', margin: 0 }}>{signup.diet}</dd>
          </div>
        )}
        {settings.custom_question && signup.custom_answer && (
          <div>
            <dt style={{ display: 'inline', fontWeight: 600 }}>{settings.custom_question} </dt>
            <dd style={{ display: 'inline', margin: 0 }}>{signup.custom_answer}</dd>
          </div>
        )}
      </dl>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {calendarHref && event.starts_at && (
          <a className="mx-btn mx-primary" href={calendarHref}>
            Lägg i kalendern (.ics)
          </a>
        )}
        {token && (
          <a className="mx-btn" href={`/e/svar?t=${encodeURIComponent(token)}`}>
            Ändra mitt svar
          </a>
        )}
      </div>
    </section>
  );
}
