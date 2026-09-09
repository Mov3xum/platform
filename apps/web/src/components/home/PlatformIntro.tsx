import Link from 'next/link';
import { Icon } from '@/components/proto/Icon';

/**
 * Hårdkodad plattformsintro under "Så gör vi" på Hemmaplan (CLAUDE.md § 37).
 * Statiskt innehåll (medvetet inte dynamiskt) — en kort orientering för nya
 * kollegor om vad som finns var. Native <details> → ingen klient-JS, ingen
 * dataväg. Håll texten kort; rutiner som ändras skrivs som instruktioner
 * i listan under (dynamiska inlägg).
 */

interface IntroSection {
  icon: string;
  title: string;
  lead: string;
  points: string[];
  href?: string;
  hrefLabel?: string;
}

const INTRO: IntroSection[] = [
  {
    icon: 'home',
    title: 'Så hänger plattformen ihop',
    lead: 'Movexum OS är vårt gemensamma arbetsrum: allt om bolagen, programmet och verksamheten på ett ställe — EU-suveränt, utan externa molntjänster utanför Europa.',
    points: [
      'Hemmaplan är startsidan: anslagstavla, rutiner, internutbildningar, veckans agenda, bolagsnytt och omvärld.',
      'Sidomenyn följer din roll och dina moduler — saknar du en sida, be en admin slå på den under Inställningar → Användare.',
      'Allt som skrivs i plattformen loggas i aktivitetsloggen med vem, vad och när.'
    ]
  },
  {
    icon: 'message',
    title: 'Chatten — arbeta med rösten eller tangentbordet',
    lead: 'Chatten läser all verksamhetsdata du själv får se och kan utföra vardagsåtgärder åt dig: lägga in aktiviteter i årshjulet, skapa kanban-kort, tilldela workshops, boka events, skriva anteckningar — och administrera den här sidan.',
    points: [
      'Tryck på mikrofonen och tala; texten hamnar i rutan för granskning innan du skickar.',
      'Kritiska åtgärder ber alltid om ditt godkännande med en knapp i chatten.',
      'Fliken Internutbildningar sköts helt via chatten: "lägg upp en internutbildning om GDPR på torsdag".',
      'AI-svar är underlag — verifiera innan du delar vidare. Mistral (Frankrike, EU) driver modellerna.'
    ],
    href: '/chatt',
    hrefLabel: 'Öppna chatten'
  },
  {
    icon: 'people',
    title: 'Bolagen — bolagskortet är sanningen',
    lead: 'Varje bolag har ett kort med fas, IRL-nivå, nästa steg, anteckningar, avtal, KPI:er, kapital, de minimis och en egen kanban under fliken Aktiviteter.',
    points: [
      'Konfidentiella anteckningar når aldrig AI-kontexten — markera dem som konfidentiella när det behövs.',
      'Fasbyten loggas automatiskt i fashistoriken; "Antagen till BC" härleds därifrån.',
      'Personnummer lagras aldrig. Org-nr för enskild firma behandlas som personuppgift.'
    ],
    href: '/startups',
    hrefLabel: 'Alla bolag'
  },
  {
    icon: 'compass',
    title: 'Startupkompassen — inflödet',
    lead: 'Publika intag-moduler (quiz, formulär, AI-chatt) på egna länkar med QR-kod. Varje slutförd modul blir en lead som teamet följer upp manuellt.',
    points: [
      'Notiser om nya inflöden går till adresserna som är satta per modul.',
      'Förhandsgranskningar räknas inte i statistiken — testa fritt.'
    ],
    href: '/inflode',
    hrefLabel: 'Startupkompassen'
  },
  {
    icon: 'calendar',
    title: 'Årshjulet & events',
    lead: 'Årshjulet är vår verksamhetskalender (styrelse, ledning, kampanjer) — hjul, tabell och presentationsläge för måndagsmötet. Events är program­aktiviteter med inbjudningar.',
    points: [
      'Klockslag skrivs i svensk tid; "idag" och "pågår nu" räknas på svenska dygn.',
      'Presentationsläget (F = helskärm) håller sig uppdaterat under hela mötet.'
    ],
    href: '/arshjul',
    hrefLabel: 'Årshjulet'
  },
  {
    icon: 'cap',
    title: 'Utbildning & kunskapsbas',
    lead: 'Workshops och utbildningsdokument byggs under Utbildning och tilldelas bolag. Kunskapsbasen är vårt gemensamma referensmaterial som chatten kan söka i.',
    points: [
      'Förhandsgranska en workshop innan den tilldelas — inget sparas i testläge.',
      'Ladda aldrig upp personuppgifter i kunskapsbasen; personnummer saneras automatiskt.'
    ],
    href: '/education',
    hrefLabel: 'Utbildning'
  },
  {
    icon: 'shield',
    title: 'Regelefterlevnad — det vi alltid gör',
    lead: 'Vi bygger enligt GDPR, EU:s AI-förordning, ISO 27001 och SOC 2. Det märks i vardagen:',
    points: [
      'Minsta behörighet: bolagsmedlemmar ser bara sitt eget bolag.',
      'AI-genererat innehåll märks och granskas alltid av en människa innan det används.',
      'Möten spelas bara in efter att deltagarna informerats; ljud lagras aldrig.'
    ]
  }
];

export function PlatformIntro() {
  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-default bg-surface">
      <div className="flex items-center gap-2 border-b border-default bg-canvas-subtle px-4 py-2">
        <Icon name="help" size={13} className="text-brand" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-subtle">
          Kom igång med plattformen
        </span>
        <span className="ml-auto text-[11px] text-foreground-subtle">{INTRO.length} avsnitt</span>
      </div>
      {INTRO.map((s, i) => (
        <details key={s.title} className={`group ${i > 0 ? 'border-t border-default' : ''}`}>
          <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 transition hover:bg-canvas-subtle [&::-webkit-details-marker]:hidden">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-canvas-muted text-foreground-muted">
              <Icon name={s.icon} size={13} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-foreground">{s.title}</span>
            <Icon
              name="chevdown"
              size={12}
              className="shrink-0 text-foreground-subtle transition group-open:rotate-180"
            />
          </summary>
          <div className="px-4 pb-4 pl-14">
            <p className="text-[13.5px] leading-relaxed text-foreground-muted">{s.lead}</p>
            <ul className="mt-2 space-y-1">
              {s.points.map((p) => (
                <li key={p} className="flex gap-2 text-[13px] leading-relaxed text-foreground-muted">
                  <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-foreground-subtle" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            {s.href && (
              <Link
                href={s.href}
                className="mt-2.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-link hover:underline"
              >
                {s.hrefLabel ?? 'Öppna'}
                <Icon name="arrow-up-right" size={11} />
              </Link>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
