/**
 * Relevans-skopning av VERKTYGSYTAN i AI-chatten — samma princip som
 * schema-skopningen i `schema-scope.ts` (§ 28.4), men för verktygsschemana.
 *
 * Bakgrund: alla ~40 verktygsdefinitioner (schema + beskrivningar ≈ 12 000
 * tokens) skickades i VARJE Mistral-anrop, oavsett om frågan var "hur många
 * aktiva bolag har vi?" eller "skapa en upphandling". Eftersom varje
 * verktygssteg i agent-loopen är ett eget anrop utan prompt-cache var det
 * den enskilt största posten i turens tokenförbrukning.
 *
 * Princip (progressiv exponering):
 * 1. Läs-/sök-/minnes-/dokumentverktygen och de GENERISKA skrivverktygen
 *    (bolagsfält, aktiviteter, uppgifter, anteckning, godkännande) skickas
 *    alltid.
 * 2. Domänspecifika skrivverktyg (årshjul, Startupkompassen, workshops,
 *    events, uppdrag, de minimis, KPI/kapital, scheman, anslagstavla,
 *    upphandlingar) skickas bara när de senaste användarturerna — eller
 *    agentens persona — matchar domänen (deterministisk synonymkarta, ingen
 *    extra LLM-runda, ingen latens).
 * 3. Självläkning: anropar modellen ändå ett verktyg som inte skickats (den
 *    känner alla namn via guidance-blocken) laddar agent-loopen definitionen
 *    ur den fulla katalogen (`resolveTool`) och kör anropet — samma mönster
 *    som uppskjutna verktyg i Claude Code. Ingen förlorad funktion, bara
 *    lägre tokenkostnad.
 *
 * Säkerhetsgränsen påverkas inte: skopningen styr bara vilka scheman som
 * skickas i prompten. RBAC, tenant och whitelist ligger kvar i det delade
 * skrivlagret (`lib/core/write`) som dispatchen alltid går genom.
 *
 * Ren modul (ingen server-only, inga @/-importer) → enhetstestad.
 */

/**
 * Generiska skrivverktyg som ALLTID skickas (billiga, träffas av en stor
 * andel av vardagsfrågorna, eller är UX-sinkar som guidance kräver).
 */
export const ALWAYS_ON_WRITE_TOOLS: readonly string[] = [
  'update_startup_field',
  'create_startup_activity',
  'update_activity_field',
  'create_task',
  'move_task',
  'create_startup_note',
  'request_approval',
  'memory_write'
];

export interface ToolDomain {
  id: string;
  tools: readonly string[];
  /** Stammar (gemener) som matchas som substring mot kontexttexten. */
  stems: readonly string[];
}

/**
 * Vardagsspråk → domänspecifika skrivverktyg. En falsk positiv är harmlös
 * (kostar bara några hundra tokens), så bredd prioriteras över precision.
 */
export const TOOL_DOMAINS: readonly ToolDomain[] = [
  {
    id: 'annual_wheel',
    tools: ['create_annual_wheel_item', 'update_annual_wheel_item'],
    stems: ['årshjul', 'arshjul', 'hjulet', 'kampanj', 'nyhetsbrev', 'kalender', 'verksamhetsplan', 'styrelse', 'ledningsgrupp']
  },
  {
    id: 'compass',
    tools: ['create_compass_module', 'add_compass_question', 'update_compass_module_field'],
    stems: ['kompass', 'inflöde', 'inflode', 'intag', 'quiz', 'formulär', 'formular', 'wizard', 'modul', 'frågor', 'fragor', 'lead', 'landningssida', 'publik sida']
  },
  {
    id: 'education',
    tools: ['create_workshop', 'assign_workshop', 'assign_education_document'],
    stems: ['workshop', 'utbildning', 'kurs', 'lektion', 'dokument', 'tilldela', 'tilldeln', 'övning', 'ovning']
  },
  {
    id: 'events',
    tools: ['create_event', 'start_meeting'],
    stems: ['event', 'evenemang', 'möte', 'mote', 'kalender', 'träff', 'traff', 'frukost', 'seminari', 'webinar', 'bjud in', 'inbjud', 'spela in', 'inspelning', 'protokoll']
  },
  {
    id: 'missions',
    tools: ['create_mission'],
    stems: ['uppdrag', 'mission', 'team', 'bemann']
  },
  {
    id: 'de_minimis',
    tools: ['register_de_minimis_support'],
    stems: ['minimis', 'statsstöd', 'statsstod', 'stöd', 'stod', 'bidrag', 'vinnova', 'almi', 'tillväxtverket', 'tillvaxtverket']
  },
  {
    id: 'kpi',
    tools: ['add_startup_kpi'],
    stems: ['kpi', 'nyckeltal', 'mätetal', 'matetal', 'omsättning', 'omsattning', 'anställd', 'anstalld', 'kunder', 'mrr', 'arr', 'användare', 'anvandare']
  },
  {
    id: 'capital',
    tools: ['add_capital_round'],
    stems: ['kapital', 'investering', 'runda', 'finansiering', 'bidrag', 'lån', 'loan', 'grant', 'equity', 'såddfinans', 'saddfinans', 'ängel', 'angel']
  },
  {
    id: 'schedule',
    tools: ['schedule_agent'],
    stems: ['schema', 'schemal', 'cron', 'varje vecka', 'varje måndag', 'varje mandag', 'varje dag', 'varje månad', 'varje manad', 'automatis', 'återkommande', 'aterkommande', 'regelbund']
  },
  {
    id: 'org_posts',
    tools: ['create_org_post', 'update_org_post'],
    stems: ['anslagstavla', 'inlägg', 'inlagg', 'internutbildning', 'hemmaplan', 'startsida', 'nyhet', 'notis', 'fäst', 'fast ', 'publicera', 'utgå', 'utga']
  },
  {
    id: 'procurement',
    tools: ['create_procurement', 'create_procurement_calloff', 'update_procurement_calloff'],
    stems: ['upphandling', 'avrop', 'leverantör', 'leverantor', 'ramavtal', 'milstolpe', 'slutrapport', 'excellens', 'anbud']
  }
];

/** Alla verktyg som omfattas av skopningen (övriga passerar alltid). */
export const SCOPED_TOOL_NAMES: ReadonlySet<string> = new Set(
  TOOL_DOMAINS.flatMap((d) => d.tools)
);

/**
 * Avgör vilka domäner kontexttexten aktiverar. Matchar synonymstammar OCH
 * uttryckliga verktygsnamn (t.ex. när användaren citerar hjälp-guiden).
 */
export function matchToolDomains(contextText: string): Set<string> {
  const text = String(contextText || '').toLowerCase();
  const hit = new Set<string>();
  if (!text.trim()) return hit;
  for (const domain of TOOL_DOMAINS) {
    if (domain.stems.some((s) => text.includes(s)) || domain.tools.some((t) => text.includes(t))) {
      hit.add(domain.id);
    }
  }
  return hit;
}

/**
 * Filtrerar en verktygslista till det som ska skickas för den här turen.
 * Verktyg utanför `SCOPED_TOOL_NAMES` (läs/sök/minne/dokument/webb) och de
 * generiska skrivverktygen passerar alltid; domänspecifika bara vid träff.
 * Ordningen bevaras.
 */
export function scopeTools<T extends { function: { name: string } }>(
  tools: readonly T[],
  contextText: string
): T[] {
  const domains = matchToolDomains(contextText);
  const allowed = new Set<string>(ALWAYS_ON_WRITE_TOOLS);
  for (const domain of TOOL_DOMAINS) {
    if (domains.has(domain.id)) domain.tools.forEach((t) => allowed.add(t));
  }
  return tools.filter((t) => {
    const name = t.function.name;
    return !SCOPED_TOOL_NAMES.has(name) || allowed.has(name);
  });
}

/**
 * Bygger en uppslagsfunktion för agent-loopens självläkning: returnerar
 * definitionen för ett verktyg som finns i den fulla katalogen men inte
 * skickades i den skopade listan.
 */
export function makeToolResolver<T extends { function: { name: string } }>(
  fullCatalog: readonly T[]
): (name: string) => T | undefined {
  const byName = new Map(fullCatalog.map((t) => [t.function.name, t]));
  return (name: string) => byName.get(name);
}
