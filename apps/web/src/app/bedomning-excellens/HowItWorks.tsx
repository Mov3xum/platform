'use client';

// "Så funkar det" — ALLA instruktioner för Bedömning excellens samlade på ett
// ställe (CLAUDE.md § 51, § 51.12): en knapp i sidhuvudet som öppnar guiden
// som ett överlägg, så den aldrig tar plats i flödet. Själva formuläret och
// rapporten bär inga förklarande textstycken; lägg nya instruktioner här,
// inte i rapporten.

import { useEffect, useState } from 'react';
import { MAX_RELATED_COMPANIES } from '@platform/shared';

const STEPS: { title: string; items: string[] }[] = [
  {
    title: 'Ärenden',
    items: [
      'Varje bolag du bedömer blir ett ärende. Skapa ärende uppe till höger, välj bolag och kör bedömningen — ärendet skapas när första bedömningen sparas.',
      'Ärendet sparas varje gång du hämtar, räknar om eller hämtar mer. Öppna det från listan och fortsätt där du slutade — ingen ny hämtning från Roaring.',
      'Ett bolag har högst ett pågående ärende: skapar du ett nytt för samma bolag fylls det befintliga på i stället (med den nya hämtningen).',
      'Under arbetet sparas ingen PDF — Förhandsgranska PDF visar hur den blir utan att spara den.',
      'Klarmarkera när bedömningen är färdig: slutbedömningen sparas på bolagskortet (portföljbolag) och som PDF i dina Filer, och ärendet flyttas till Avslutade. Ett klick räcker — ett dubbelklick sparar inte två gånger. Ärendet kan öppnas igen; nästa klarmarkering sparar en ny slutbedömning.'
    ]
  },
  {
    title: '1. Välj bolag och vad som ska hämtas',
    items: [
      'Välj ett portföljbolag eller skriv ett org-nr (bolaget behöver inte finnas i plattformen).',
      'Hämta från bolagsregistret: bocka i de datadelar som ska begäras ut — ingen är förvald, varje anrop debiteras. För en komplett bedömning: Koncernstruktur (hela koncernen: moder-, syster- och dotterbolag), Grunddata (ålder, status, bolagsform — avgör även börsnotering), Bokslut (tröskelvärden och utdelning) och Verklig huvudman (fristående, indirekt grundarägande).',
      'Ägarnas andra bolag: för varje fysisk huvudman söks vilka andra bolag personen äger eller kontrollerar, och varje hittat bolag får sin SNI-kod (ett anrop per huvudman + grunddata per bolag; kräver Grunddata och Verklig huvudman, som bockas i automatiskt).',
      `Varje bolag i koncernen slås därefter upp med grunddata + bokslut av ditt val (verklig huvudman bara för moderbolag), högst ${MAX_RELATED_COMPANIES} bolag. Kostnaden för hela bedömningen visas i resultatet — leverantörens faktura är facit.`,
      'Bedöm sparade data: använder det som redan finns på bolagskortet, utan nya anrop. Systerbolag syns bara vid en färsk hämtning med Koncernstruktur.',
      'Grundarägande, registrerat de minimis-stöd, IRL och excellensflaggan tas från plattformen när bolaget finns här — alltid de senaste värdena, även i ett ärende som påbörjades tidigare.'
    ]
  },
  {
    title: '2. Läs rapporten',
    items: [
      'Steg 1 prövar art. 22 GBER eller de minimis: grundförutsättningar för startup-bolaget och varje anknutet bolag, ägarbild, koncernkarta, fristående, tröskelvärden och de minimis. Steg 2 prövar Vinnovas målgrupp, steg 3 excellent inkubation.',
      'Varje punkt får Ja / Nej / Okänt med källa (bolagsregister, plattformen eller manuell kontroll). Inget gissas och inget beslut fattas här — beslutet registreras som förut på bolagskortet.',
      'Koncernkartan visar varför ett bolag räknas in: moder-, syster- och dotterbolag är anknutna (100 %), partnerföretag (25–50 %) räknas med sin andel. SNI-koderna visas per bolag.',
      'Ägarnas andra bolag: har ett bolag som en ägare äger samma SNI-kod som startup-bolaget räknas det som anknutet via ägaren (samma marknad, bilaga I art. 3.3) — båda bolagen ska klara kriterierna och räknas samman. Samma SNI-grupp eller saknad kod blir oklart; annan bransch räknas inte. Du kan ändra bedömningen per bolag (t.ex. om marknaden är angränsande eller ägaren inte kontrollerar bolaget).',
      'Registerdata sparas inte på bolagskortet — synka bolagskortet separat om du vill behålla den.'
    ]
  },
  {
    title: '3. Svara på det registret inte kan avgöra',
    items: [
      'Välj svar i väljaren till höger på punkten och skriv en kort motivering/källa (t.ex. bolagsordning, intyg).',
      'Ett eget Nej väger alltid tyngst; ett eget Ja fyller bara en okänd punkt. "Registret gäller" betyder att registret redan avgjort punkten.',
      'Tabellerna (grundarteam med engagemang och mognadsfas, IRL, kommentaren) ändras med Ändra. Engagemanget prövas mot fasens trösklar.',
      'IRL har en plats: bolagskortets KTH-bedömning (fliken Utveckling & IRL). Bedömningen visar den senaste; nivåer och motiveringar du ändrar här sparas som en ny bedömning på bolagskortet när du sparar. Ett tomt fält behåller bolagskortets värde.',
      'Bolag utan bokslut: skriv bolagets egen uppskattning i god tro direkt i tröskelvärdestabellen (bilaga I art. 4.3) — ett bokslut vinner alltid.',
      'Fristående kan sällan avgöras ur registret för nyregistrerade bolag — aktieboken avgör. Lägg till ägarbolag med "Lägg till koncernbolag" under koncernkartan, eller hämta mer om ett bolag direkt i kartan (kostnaden visas innan).',
      'Spara och räkna om längst ned: samma underlag, inga nya anrop. Svaren sparas på bolagskortet och återanvänds vid nästa körning.'
    ]
  },
  {
    title: '4. Be om det som saknas',
    items: [
      'Begär komplettering skickar punkterna till coachen eller direkt till bolaget (svarar under Mitt bolag). Punkter som kräver coachens bedömning (Vinnova, IRL, excellens) går inte till bolaget.',
      'Svaren sparas direkt på bolagskortet (IRL som ny KTH-bedömning) och det pågående ärendet räknas om med dem — ingen omräkning behövs. Samma obesvarade punkter skickas inte två gånger till samma mottagare.'
    ]
  },
  {
    title: 'Var bedömningen sparas',
    items: [
      'Slutbedömningen (när ärendet klarmarkeras) sparas som PDF i dina Filer (i bolagets mapp) och, för portföljbolag, på bolagskortet under Ekonomi & statsstöd → Statsstöd & Vinnova med historik och vad som ändrats sedan förra slutbedömningen.',
      'Ägarbilden visas med namn på verkliga huvudmän — på skärmen, i PDF:n och i ärendet. Personnummer används bara för att söka ägarnas andra bolag och sparas aldrig.',
      'Skriv aldrig personuppgifter i motiveringar och kommentarer.'
    ]
  }
];

export function HowItWorks() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center justify-center rounded-full border border-strong px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-canvas-subtle"
      >
        Så funkar det
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-movexum-svart/40 p-4 sm:p-8" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="how-it-works-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl rounded-2xl border border-default bg-surface px-5 py-4 shadow-xl shadow-movexum-svart/20"
          >
            <div className="flex items-center justify-between gap-3 border-b border-default pb-3">
              <h2 id="how-it-works-title" className="text-[15px] font-semibold text-foreground">
                Så funkar Bedömning excellens
              </h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-full border border-strong px-3 py-1 text-[12px] font-semibold text-foreground hover:bg-canvas-subtle">
                Stäng
              </button>
            </div>
            <div className="mt-3 grid gap-4 pb-2 lg:grid-cols-2">
              {STEPS.map((s) => (
                <div key={s.title}>
                  <h3 className="text-[12.5px] font-semibold text-foreground">{s.title}</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-[12.5px] text-foreground-muted">
                    {s.items.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
