import type { DocumentKind, DocumentAccent } from './types';

// Mall-bibliotek för genererade dokument. Varje mall är en BLUEPRINT: den
// beskriver hur ett professionellt dokument av en viss typ ska struktureras
// (vilka sektioner/slides, vilka primitiver — KPI-kort, callouts, diagram,
// tabeller). Agenten väljer en mall via `template` i `generate_document` och
// fyller den med RIKTIG data (från query_collection). Mallen sätter också
// vettiga defaults (kind + accent) så att varje dokument får ett enhetligt,
// modernt uttryck — inte en generisk friform.
//
// Detta är "rattarna" i förbättrings-loopen (CLAUDE.md § 9.10): justera
// blueprinten här → alla framtida dokument av den typen blir bättre.

export interface DocumentTemplate {
  id: string;
  label: string;
  /** Kort beskrivning (visas för modellen i verktygskatalogen). */
  description: string;
  /** Standardformat. Kan överstyras av modellen vid behov. */
  kind: DocumentKind;
  /** Standard-accenttema. */
  accent: DocumentAccent;
  /** Steg-för-steg-struktur (sektioner/slides) som modellen ska följa. */
  outline: string[];
}

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: 'investor_onepager',
    label: 'Investerar-onepager',
    description: 'Kompakt en-sidare för investerare: problem, lösning, traction och ask.',
    kind: 'pdf',
    accent: 'blue',
    outline: [
      'Sektion "Översikt": kort paragraf om bolaget + 4 KPI-kort (t.ex. ARR, tillväxt, kunder, IRL).',
      'Sektion "Problem & lösning": 2 paragrafer eller bullets.',
      'Sektion "Traction": ett diagram (line/bar) över nyckeltal över tid + 1 callout (variant accent) med höjdpunkt.',
      'Sektion "Marknad & affärsmodell": kort tabell eller bullets.',
      'Sektion "Vad vi söker": callout (variant info) med beloppet/ask + användning av kapital.'
    ]
  },
  {
    id: 'quarterly_report',
    label: 'Kvartalsrapport',
    description: 'Strukturerad kvartalsrapport för ett bolag: sammanfattning, KPI:er, framsteg, ekonomi, risker, nästa steg.',
    kind: 'pdf',
    accent: 'blue',
    outline: [
      'Sektion "Sammanfattning": callout (variant info) med kvartalets viktigaste punkt + 4 KPI-kort med delta vs förra kvartalet.',
      'Sektion "Framsteg": bullets med vad som gjorts.',
      'Sektion "Ekonomi": diagram (bar) över intäkter/kostnader + tabell med nyckeltal (emphasizeLastColumn).',
      'Sektion "Risker & utmaningar": callout (variant warning).',
      'Sektion "Nästa steg": numrerade/bulletade åtgärder.'
    ]
  },
  {
    id: 'board_deck',
    label: 'Styrelsedeck',
    description: 'Presentation inför styrelsemöte: agenda, KPI:er, höjdpunkter, ekonomi, pipeline, beslut.',
    kind: 'pptx',
    accent: 'blue',
    outline: [
      'Slide layout "section" "Agenda" med punkterna i subheading eller bullets.',
      'Slide layout "kpi": 4 KPI-kort (nyckeltal med delta).',
      'Slide layout "content" "Höjdpunkter": bullets + ev. callout.',
      'Slide layout "chart" "Ekonomi": diagram över intäkter/burn över tid.',
      'Slide layout "table" "Pipeline": tabell över affärer/bolag.',
      'Slide layout "content" "Risker": callout (variant warning).',
      'Slide layout "content" "Beslut & frågor": bullets med det styrelsen ska besluta.'
    ]
  },
  {
    id: 'pitch_deck',
    label: 'Pitch deck',
    description: 'Klassiskt pitch-deck: problem, lösning, marknad, produkt, traction, affärsmodell, team, ask.',
    kind: 'pptx',
    accent: 'purple',
    outline: [
      'Slide "section" per kapitel-rubrik vid behov.',
      'Slide "content" Problem (3 bullets).',
      'Slide "content" Lösning (3 bullets + callout).',
      'Slide "kpi" Marknad (TAM/SAM/SOM som KPI-kort).',
      'Slide "content" Produkt.',
      'Slide "chart" Traction (tillväxtdiagram).',
      'Slide "content" Affärsmodell.',
      'Slide "content" Team (bullets).',
      'Slide "content" Ask (callout variant accent).'
    ]
  },
  {
    id: 'portfolio_overview',
    label: 'Portföljöversikt',
    description: 'Översikt över hela inkubatorportföljen: nyckeltal, fördelning per sektor/fas, höjdpunkter.',
    kind: 'pptx',
    accent: 'teal',
    outline: [
      'Slide "kpi": portfölj-KPI:er (antal bolag, aktiva, total kapitalrest, snitt-IRL).',
      'Slide "chart" Fördelning per fas: donut-diagram.',
      'Slide "chart" Sektorfördelning: bar-diagram.',
      'Slide "table" Topp-bolag: tabell (emphasizeLastColumn på ett nyckeltal).',
      'Slide "content" Höjdpunkter & uppmärksamhet: bullets + callout.'
    ]
  },
  {
    id: 'financial_summary',
    label: 'Finansiell sammanställning',
    description: 'Excel-sammanställning av finansiella nyckeltal med KPI-band och summeringsrad.',
    kind: 'xlsx',
    accent: 'blue',
    outline: [
      'Blad "Översikt" med KPI-band (kpis) + tabell över år (kolumntyper: number/currency/percent), totals-rad.',
      'Ev. blad "Per bolag" med en rad per bolag och relevanta kolumner.',
      'Använd kolumntyper currency för SEK-belopp, percent för marginaler.'
    ]
  },
  {
    id: 'company_profile',
    label: 'Bolagsprofil',
    description: 'Word-dokument: bolagsbeskrivning, team, milstolpar och ekonomi.',
    kind: 'docx',
    accent: 'blue',
    outline: [
      'Sektion "Om bolaget": paragraf + 3–4 KPI-kort.',
      'Sektion "Team": bullets.',
      'Sektion "Milstolpar": bullets eller tabell.',
      'Sektion "Ekonomi": diagram + tabell.',
      'Sektion "Sammanfattning": callout.'
    ]
  },
  {
    id: 'coach_briefing',
    label: 'Coach-briefing',
    description: 'Mötesförberedelse inför coachning: ögonblicksbild, senaste aktivitet, fokusområden, talpunkter.',
    kind: 'pdf',
    accent: 'green',
    outline: [
      'Sektion "Ögonblicksbild": 4 KPI-kort (fas, IRL, status, nästa steg).',
      'Sektion "Senaste aktivitet": bullets.',
      'Sektion "Fokusområden": callout (variant accent).',
      'Sektion "Talpunkter": bullets/frågor att ta upp.'
    ]
  },
  {
    id: 'status_memo',
    label: 'Status-PM',
    description: 'Kort statusnotis (1 sida): sammanfattning + punkter + nästa steg.',
    kind: 'docx',
    accent: 'blue',
    outline: [
      'Sektion "Sammanfattning": callout (variant info).',
      'Sektion "Status": bullets.',
      'Sektion "Nästa steg": bullets.'
    ]
  }
];

export function getTemplate(id: string | undefined): DocumentTemplate | undefined {
  if (!id) return undefined;
  return DOCUMENT_TEMPLATES.find((t) => t.id === id);
}

/** Kompakt katalog (id + label + beskrivning) för verktygsbeskrivning/guidance. */
export function listTemplateSummaries(): string {
  return DOCUMENT_TEMPLATES.map((t) => `• ${t.id} (${t.kind}) — ${t.label}: ${t.description}`).join('\n');
}

/** Full blueprint-text för en vald mall (injiceras som guidance vid behov). */
export function templateOutlineText(id: string): string {
  const t = getTemplate(id);
  if (!t) return '';
  return [
    `Mall: ${t.label} (${t.id}), format ${t.kind}, accent ${t.accent}.`,
    'Följ denna struktur:',
    ...t.outline.map((o, i) => `${i + 1}. ${o}`)
  ].join('\n');
}

export const TEMPLATE_IDS = DOCUMENT_TEMPLATES.map((t) => t.id);
