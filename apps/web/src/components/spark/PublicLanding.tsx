import { emptySparkAnswers } from '@platform/shared';
import { Logo } from '@/components/Logo';
import { Icon } from '@/components/proto';
import { SparkInterviewForm } from './InterviewForm';

/**
 * SPARK:s publika sida (CLAUDE.md § 61) — den som kommuner och andra partner
 * sprider till företagen. Ren presentation: sidan (`app/energi/[tenant]`)
 * resolvar tenant och ev. partner och skickar in färdiga värden.
 */

const ROLES = [
  {
    icon: 'target',
    tone: 'bg-movexum-pastell-bla text-movexum-djupbla dark:bg-movexum-djupbla/40 dark:text-movexum-pastell-bla',
    title: 'Ni har en energiutmaning',
    text: 'Höga effekttoppar, spillvärme som går förlorad, ont om elkraft eller stigande energikostnader. Vi letar efter lösningar som passar.'
  },
  {
    icon: 'bolt',
    tone: 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron',
    title: 'Ni har en lösning',
    text: 'En produkt, tjänst eller teknik som hjälper andra att ställa om. Vi letar efter företag med behovet, pilotkunder och testmiljöer.'
  },
  {
    icon: 'compass',
    tone: 'bg-movexum-pastell-lila text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila',
    title: 'Ni kan vara testmiljö',
    text: 'En anläggning, en produktionslina eller viljan att vara först. Nya lösningar behöver prövas på riktigt innan de når marknaden.'
  }
] as const;

const STEPS = [
  { title: 'Berätta', text: 'Svara på frågorna. De anpassas efter vad som stämmer in på er, så ni slipper allt som inte är relevant.' },
  { title: 'Vi matchar', text: 'Movexum går igenom behov, lösningar och testmiljöer i regionen och letar efter det som passar ihop.' },
  { title: 'Ni tillfrågas', text: 'Hittar vi något hör vi av oss. Ingenting delas med ett annat företag förrän båda har sagt ja.' }
] as const;

export function SparkPublicLanding({ tenantName, endpoint, via, referrerLabel }: { tenantName: string; endpoint: string; via?: string; referrerLabel?: string }) {
  return (
    <main className="min-h-dvh bg-canvas text-foreground">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <Logo width={116} />
        <span className="font-heading text-xs font-semibold uppercase tracking-[0.28em] text-foreground-subtle">Spark</span>
      </header>

      <section className="mx-auto max-w-5xl px-5">
        <div className="relative overflow-hidden rounded-[2rem] bg-movexum-morkbla px-6 py-12 text-movexum-vit sm:px-12 sm:py-16">
          <svg aria-hidden="true" viewBox="0 0 400 400" className="pointer-events-none absolute -right-44 -top-48 h-[26rem] w-[26rem] text-movexum-bla opacity-25 sm:-right-24 sm:-top-24 sm:opacity-40">
            {[60, 100, 140, 180].map((r) => (
              <circle key={r} cx="200" cy="200" r={r} fill="none" stroke="currentColor" strokeWidth="1" />
            ))}
            <path d="M214 96 148 214h44l-12 90 72-126h-46z" fill="currentColor" opacity="0.5" />
          </svg>
          <div className="relative max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">Energiinnovationer för hållbara industrier och samhällen</p>
            <h1 className="mt-4 font-heading text-4xl font-bold leading-[1.08] sm:text-5xl">Rätt lösning till rätt energiutmaning</h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed opacity-90 sm:text-lg">
              SPARK kopplar ihop företag och offentliga verksamheter som har energiutmaningar med dem som har lösningarna — och med platserna där nya
              lösningar kan testas på riktigt.
            </p>
            {referrerLabel ? (
              <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-movexum-vit/25 px-3.5 py-1.5 text-sm">
                <Icon name="link" size={14} /> Du har fått länken av {referrerLabel}
              </p>
            ) : null}
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <a
                href="#anmalan"
                className="inline-flex items-center gap-2 rounded-full bg-movexum-vit px-6 py-3 text-sm font-semibold text-movexum-morkbla transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila"
              >
                Berätta om ert företag <Icon name="arrow" size={14} />
              </a>
              <span className="text-sm opacity-75">Cirka tio minuter</span>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-12 sm:py-16">
        <h2 className="font-heading text-2xl font-semibold">Vem är det för?</h2>
        <p className="mt-2 max-w-2xl text-sm text-foreground-muted">Ett företag kan vara flera saker samtidigt. Ni väljer själva i första steget, och frågorna följer med.</p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {ROLES.map((r) => (
            <div key={r.title} className="rounded-3xl border border-default bg-surface p-6">
              <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${r.tone}`}>
                <Icon name={r.icon} size={20} />
              </span>
              <h3 className="mt-4 font-heading text-lg font-semibold">{r.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-foreground-muted">{r.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-default bg-canvas-subtle">
        <div className="mx-auto max-w-5xl px-5 py-12 sm:py-14">
          <h2 className="font-heading text-2xl font-semibold">Så går det till</h2>
          <ol className="mt-6 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand font-heading text-sm font-semibold text-brand-foreground mx-tnum">{i + 1}</span>
                <h3 className="mt-3 font-heading text-base font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-foreground-muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="anmalan" className="mx-auto max-w-3xl scroll-mt-6 px-5 py-12 sm:py-16">
        <h2 className="font-heading text-2xl font-semibold">Berätta om ert företag</h2>
        <p className="mb-6 mt-2 text-sm text-foreground-muted">Börja med vad som stämmer in på er. Det går bra att hoppa över frågor ni inte kan svara på.</p>
        <SparkInterviewForm mode="public" initialAnswers={emptySparkAnswers()} publicEndpoint={endpoint} via={via} referrerLabel={referrerLabel} />
      </section>

      <footer className="border-t border-default">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-xs text-foreground-subtle">
          <span>SPARK drivs av {tenantName} tillsammans med partner i regionen.</span>
          <span>Uppgifterna används för matchning inom projektet och delas aldrig utan att ni tillfrågats.</span>
        </div>
      </footer>
    </main>
  );
}
