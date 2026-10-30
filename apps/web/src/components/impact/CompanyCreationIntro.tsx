'use client';

import { useState } from 'react';
import { Icon, type IconName } from '@/components/proto/Icon';

const CREATION_STEPS: Array<{ number: string; title: string; description: string; icon: IconName; current?: boolean }> = [
  { number: '01', title: 'Dela det ni vet', description: 'Lägg in bolagsuppgifter, idébeskrivning och annat underlag som redan finns.', icon: 'briefcase', current: true },
  { number: '02', title: 'Granska bolagsbilden', description: 'Verktyget sammanfattar bolaget och föreslår väsentliga områden som du kan korrigera.', icon: 'search' },
  { number: '03', title: 'Komplettera underlaget', description: 'Du ser vad som saknas eller är osäkert och kan fylla på med relevant information.', icon: 'doc' },
  { number: '04', title: 'Utforska analysen', description: 'Du får en framåtblickande hållbarhetsanalys av bolagets påverkan, risker och möjligheter.', icon: 'graph' }
];

/** Välkomstrutan på skapa-sidan (originalets CompanyCreationIntro) — stängs med knappen, Esc eller klick utanför. */
export function CompanyCreationIntro() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="creation-intro-title"
      aria-describedby="creation-intro-description"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-movexum-svart/70 p-4 sm:p-6 lg:items-center"
      onClick={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
    >
      <section
        className="relative w-full max-w-6xl overflow-hidden rounded-2xl bg-movexum-morkbla text-movexum-vit shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          autoFocus
          onClick={() => setOpen(false)}
          aria-label="Stäng introduktionen och gå till steg 1"
          className="absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-movexum-vit/15 bg-movexum-svart/15 text-movexum-vit transition hover:bg-movexum-vit/15 focus:outline-none focus:ring-2 focus:ring-movexum-vit sm:right-5 sm:top-5"
        >
          <Icon name="x" size={18} />
        </button>
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-movexum-bla/25 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-movexum-lila/25 blur-3xl" />

        <div className="relative grid gap-10 px-6 py-8 pr-16 sm:px-8 sm:py-10 sm:pr-20 lg:px-12 lg:py-12 xl:grid-cols-[0.8fr_1.2fr] xl:gap-14 xl:pr-16">
          <div className="flex flex-col justify-between">
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-movexum-vit/15 bg-movexum-vit/10 px-3 py-1.5 text-xs font-medium tracking-wide">
                <Icon name="sparkle" size={13} />
                Välkommen till Impact Navigator
              </div>
              <h1 id="creation-intro-title" className="max-w-xl font-heading text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
                Från första underlag till tydligare beslut.
              </h1>
              <p id="creation-intro-description" className="mt-5 max-w-lg text-base leading-7 text-movexum-vit/85">
                Vi guidar dig genom fyra steg. Börja med det ni vet i dag – det är helt okej att underlaget är tidigt, ofullständigt eller osäkert.
              </p>
            </div>
            <div className="mt-8">
              <div className="flex items-start gap-3 text-sm leading-6 text-movexum-vit/90">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-movexum-gron text-movexum-vit">
                  <Icon name="check" size={11} />
                </span>
                <p>Du godkänner eller korrigerar alltid verktygets bild innan analysen går vidare.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="mt-7 inline-flex items-center gap-2 rounded-xl bg-movexum-vit px-4 py-2.5 text-sm font-semibold text-movexum-morkbla shadow-sm transition hover:bg-movexum-pastell-bla focus:outline-none focus:ring-2 focus:ring-movexum-vit"
              >
                Gå till steg 1
                <Icon name="arrow" size={15} />
              </button>
            </div>
          </div>

          <ol className="relative grid gap-3 sm:grid-cols-2" aria-label="Så fungerar analysen">
            {CREATION_STEPS.map((step) => (
              <li key={step.number} className="group relative rounded-xl border border-movexum-vit/10 bg-movexum-vit/[0.08] p-5 transition-colors hover:border-movexum-vit/20 hover:bg-movexum-vit/[0.12]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs tracking-widest text-movexum-vit/65 mx-tnum">STEG {step.number}</span>
                  <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${step.current ? 'bg-movexum-gron text-movexum-vit' : 'bg-movexum-vit/10 text-movexum-vit'}`}>
                    <Icon name={step.icon} size={17} />
                  </span>
                </div>
                <h2 className="mt-5 font-heading text-base font-semibold">{step.title}</h2>
                <p className="mt-2 text-sm leading-6 text-movexum-vit/75">{step.description}</p>
                {step.current ? <span className="mt-4 inline-flex rounded-full bg-movexum-gron/30 px-2.5 py-1 text-xs font-medium text-movexum-pastell-gron">Du är här</span> : null}
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
