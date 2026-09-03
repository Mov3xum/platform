import type { Role } from '@platform/shared';

/**
 * Innehållet i chattens hjälp-guide (§ 33.3) — vad kan jag göra i chatten?
 *
 * ROLLSPECIFIK: varje punkt kan kräva roller (`roles`); guiden byggs med
 * `buildChatGuide(userRoles)` så att en användare bara ser det hens roll
 * faktiskt får göra. Rollkraven här är en SPEGLING av skrivlagrets policy
 * (`lib/core/write/writable-fields.ts`) för läsbarhetens skull — guiden är
 * ren presentation och ALDRIG säkerhetsgränsen (den ligger kvar i
 * skrivlagret + PB-reglerna, § 33.2). Ändras en policy: uppdatera båda.
 *
 * Exemplen är klickbara i UI:t (fyller chattrutan, skickar inte) och ska
 * därför vara konkreta men generiska — inga riktiga bolagsnamn eller PII.
 */

export interface ChatGuideItem {
  title: string;
  description: string;
  /** Klickbara exempel-prompter (fylls i chattrutan, skickas inte). */
  examples: string[];
  /** Krävda roller. Utelämnad = alla som ser chatten (staff). */
  roles?: Role[];
}

export interface ChatGuideSection {
  id: string;
  title: string;
  /** Ikonnamn i `components/proto/Icon`. */
  icon: string;
  items: ChatGuideItem[];
}

// Speglar rollkonstanterna i lib/core/write/writable-fields.ts.
const STAFF_AND_COACH: Role[] = ['admin', 'incubator_lead', 'coach'];
const EVENT_MANAGE: Role[] = ['admin', 'incubator_lead', 'coach'];
const COMPASS_MANAGE: Role[] = ['admin', 'incubator_lead', 'coach'];
const SCHEDULE_MANAGE: Role[] = ['admin', 'incubator_lead'];

const GUIDE: ChatGuideSection[] = [
  {
    id: 'fraga',
    title: 'Fråga & analysera',
    icon: 'search',
    items: [
      {
        title: 'Portfölj- och bolagsdata',
        description:
          'Chatten läser live-data ur plattformen — bolag, faser, IRL-nivåer, KPI:er, kapital, uppgifter och mycket mer. Den gissar aldrig.',
        examples: [
          'Vilka bolag är i inkubationsfas med IRL 5 eller högre?',
          'Hur mycket kapital har portföljbolagen tagit in i år, per bolag?'
        ]
      },
      {
        title: 'Diagram & nyckeltal direkt i chatten',
        description:
          'Be om ett diagram eller nyckeltalskort — det ritas brandat i full bredd och kan laddas ned som bild.',
        examples: ['Visa ett stapeldiagram över antal aktiva bolag per kommun']
      },
      {
        title: 'Kunskapsbasen & dina filer',
        description:
          'Chatten söker i organisationens uppladdade material (/kunskapsbas) och i dina egna filer (/filer).',
        examples: ['Vad säger vår coachningsprocess om det första bolagsmötet?']
      }
    ]
  },
  {
    id: 'dokument',
    title: 'Dokument & djupdykning',
    icon: 'doc',
    items: [
      {
        title: 'Brandade dokument',
        description:
          'PowerPoint, Excel, Word eller PDF med Movexums grafiska profil — siffrorna hämtas ur plattformen. Filen sparas i dina Filer.',
        examples: ['Ta fram en kvartalsrapport som PowerPoint för ett av bolagen']
      },
      {
        title: 'Djupdykning',
        description:
          'Slå på Djupdykning i chattrutan för större uppgifter — den planerar, hämtar data i flera steg och sammanställer ett utkast i tråden.',
        examples: [
          'Jämför de tre mest kapitalintensiva bolagen och sammanställ en styrelserapport'
        ]
      }
    ]
  },
  {
    id: 'bolagskort',
    title: 'Bolagskort & CRM',
    icon: 'pencil',
    items: [
      {
        title: 'Uppdatera bolagsfält',
        description: 'Sätt nästa steg eller justera IRL-nivån direkt från samtalet.',
        roles: STAFF_AND_COACH,
        examples: ['Sätt nästa steg för bolaget till "Boka investerarmöte i oktober"']
      },
      {
        title: 'Aktiviteter & anteckningar',
        description:
          'Logga mötesanteckningar och aktiviteter på bolagskortet, eller markera dem som klara. Konfidentiella anteckningar skrivs i UI:t — chatten skriver bara icke-konfidentiellt.',
        examples: [
          'Logga en mötesanteckning på bolaget: vi gick igenom prissättningen',
          'Skriv en anteckning på bolagskortet om partnerdialogen'
        ]
      },
      {
        title: 'KPI:er & mottaget kapital',
        description:
          'Registrera nyckeltal (äldre värde med samma namn avmarkeras) och kapital/stöd bolaget tagit emot.',
        examples: [
          'Registrera att bolagets MRR nu är 120 000 kr',
          'Lägg in att bolaget fick 500 000 kr i bidrag från Vinnova i juni'
        ]
      }
    ]
  },
  {
    id: 'planera',
    title: 'Planera & tilldela',
    icon: 'calendar',
    items: [
      {
        title: 'Årshjulet',
        description: 'Lägg in och flytta aktiviteter i verksamhetskalendern (/arshjul).',
        examples: ['Lägg in bokslutsarbete i årshjulet i april, kategori ledning']
      },
      {
        title: 'Tilldela workshops & utbildningsdokument',
        description:
          'Tilldela en befintlig workshop eller ett uppladdat dokument till ett bolag, med deadline och instruktioner. Medarbetare och möte kopplas på i /education.',
        examples: ['Tilldela workshopen om internationalisering till bolaget, deadline på fredag']
      },
      {
        title: 'Kanban-kort',
        description:
          'Skapa kort på bolags- och uppdragstavlorna och flytta dem mellan kolumner. Kollegor tilldelas på tavlan.',
        examples: [
          'Lägg ett kort på bolagets tavla: följ upp LOI, deadline nästa fredag',
          'Markera LOI-uppföljningen som klar'
        ]
      },
      {
        title: 'Events',
        description:
          'Boka ett event/möte i kalendern (status "planerat"). Deltagare bjuds in i /events.',
        roles: EVENT_MANAGE,
        examples: ['Boka en pitchträning torsdag 14:00 i Gävle']
      },
      {
        title: 'Uppdrag',
        description:
          'Skapa ett uppdrags-utkast (t.ex. en bolagsutmaning). Teamet kopplas på — gärna med AI-teamförslaget — och uppdraget startas i /uppdrag.',
        examples: ['Skapa ett uppdrag kring bolagets exportsatsning, deadline sista oktober']
      }
    ]
  },
  {
    id: 'bygg',
    title: 'Bygg innehåll',
    icon: 'compass',
    items: [
      {
        title: 'Startupkompass-moduler',
        description:
          'Bygg intag-moduler (quiz, formulär eller AI-chatt) med frågor — som opublicerade utkast. Publicering görs i modul-admin.',
        roles: COMPASS_MANAGE,
        examples: [
          'Gör ett quiz i Startupkompassen som heter "Är du redo för inkubator?" med fem frågor'
        ]
      },
      {
        title: 'Workshop-utkast',
        description:
          'Skapa en workshop med mål, instruktioner och textmoduler. Bild/film och publicering görs i byggaren i /education.',
        examples: ['Skapa en workshop om prissättning med tre moduler']
      }
    ]
  },
  {
    id: 'efterlevnad',
    title: 'Regelefterlevnad & automation',
    icon: 'shield',
    items: [
      {
        title: 'De minimis-stöd',
        description:
          'Registrera mottaget stöd — posten prövas automatiskt mot förordningens tak och det samlade taket (300 000 EUR) och blockeras vid överskridande.',
        examples: ['Registrera 50 000 kr de minimis-stöd från Almi för bolaget, beslut 1 september']
      },
      {
        title: 'Schemalägg AI-agenter',
        description:
          'Låt en agent köras automatiskt på ett schema — resultatet landar i verktygslådan och aktivitetsfeeden.',
        roles: SCHEDULE_MANAGE,
        examples: ['Kör portföljöversikten varje måndag 07:00']
      }
    ]
  }
];

/** Punkter som gäller oavsett vad du gör — visas som fotnot i guiden. */
export const CHAT_GUIDE_NOTES: string[] = [
  'Tala i stället för att skriva: håll in mikrofonen så transkriberas rösten till chattrutan (granska innan du skickar).',
  'Rätta chatten när den har fel — den kan spara korrigeringen i sitt minne så att den gäller i framtida samtal.',
  'Allt chatten utför loggas och syns i aktivitetsloggen under Aktivitet, med klickbara länkar.',
  'Publicering, teamtilldelning och inbjudningar görs alltid av en människa i respektive vy.',
  'AI-svar är underlag — verifiera innan delning.'
];

/**
 * Bygger guiden för en användares roller: punkter med rollkrav filtreras
 * bort när ingen av användarens roller matchar, och tomma sektioner tas bort.
 */
export function buildChatGuide(userRoles: Role[]): ChatGuideSection[] {
  return GUIDE.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => !item.roles || item.roles.some((r) => userRoles.includes(r))
    )
  })).filter((section) => section.items.length > 0);
}
