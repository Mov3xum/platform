/**
 * Relevans-skopning av schema-sammanfattningen i AI-chattens systemprompt.
 *
 * Tidigare skickades FULLA fältlistor för ALLA exponerade kollektioner
 * (~55 st) i varje Mistral-anrop — och eftersom varje verktygs-iteration i
 * agent-loopen är ett eget anrop som bearbetar hela prompten igen blev det
 * tiotusentals tokens per tur. Best practice är progressiv exponering:
 *
 * 1. ALLA kollektionsnamn + beskrivningar finns alltid med (kompakt index)
 *    så modellen vet vad som existerar.
 * 2. FÄLTLISTOR injiceras bara för (a) kärnkollektionerna och (b) kollektioner
 *    som är relevanta för användarens fråga (deterministisk nyckelords-
 *    matchning — ingen extra LLM-runda, ingen latens).
 * 3. För övriga kollektioner använder modellen `describe_collection`
 *    (fält + enum-värden) innan den filtrerar — verktyget finns redan och
 *    guidance-texten instruerar det. Dispatch-fel vid okänt namn listar
 *    dessutom alla giltiga namn → självläkande.
 *
 * Kvaliteten bevaras: inget göms (indexet visar allt), bara detaljnivån
 * styrs. Ren modul (ingen server-only, inga @/-importer) så den kan
 * enhetstestas — samma mönster som budget.ts/redaction.ts.
 */

export interface ScopableCollection {
  name: string;
  description: string;
  tenantField?: string | null;
  fields: Array<{ name: string }>;
}

/**
 * Kärnkollektioner som ALLTID får fulla fältlistor — de träffas av en stor
 * andel av frågorna och är billiga relativt helheten.
 */
export const CORE_SCHEMA_COLLECTIONS: readonly string[] = [
  'startups',
  'activities',
  'tasks'
];

/** Tak för antal kollektioner med fulla fältlistor per prompt (robusthet). */
export const MAX_DETAILED_COLLECTIONS = 12;

/**
 * Vardagsspråk → kollektioner (CLAUDE.md § 9.4, § 15). Stammar matchas som
 * substring mot användarens text (gemener). En falsk positiv är harmlös —
 * den kostar bara en extra detaljrad — så bredd prioriteras över precision.
 */
const STEM_TO_COLLECTIONS: ReadonlyArray<readonly [readonly string[], readonly string[]]> = [
  [
    ['bolag', 'företag', 'foretag', 'startup', 'portfölj', 'portfolj', 'alumn', 'idé', 'ide ', 'pitch'],
    ['startups']
  ],
  [['fas', 'phase', 'boost', 'inkubation', 'prescale', 'acceleration'], ['startup_phase_history']],
  [['team', 'grundare', 'medgrundare', 'founder'], ['startup_team_members']],
  [['kontakt', 'person', 'mentor'], ['contacts', 'startup_contacts']],
  [
    ['ekonomi', 'omsättning', 'omsattning', 'bokslut', 'anställd', 'anstalld', 'intäkt', 'intakt', 'revenue', 'årsredovisning', 'arsredovisning'],
    ['startup_financials']
  ],
  [['nyckeltal', 'kpi', 'mätetal', 'matetal'], ['startup_kpis']],
  [
    ['kapital', 'investering', 'runda', 'finansiering', 'bidrag', 'lån', 'loan', 'grant', 'equity'],
    ['capital_rounds']
  ],
  [
    ['minimis', 'statsstöd', 'statsstod', 'stöd', 'stod'],
    ['de_minimis_stod', 'de_minimis_units', 'de_minimis_regelverk', 'startup_state_aid_periods']
  ],
  [['avtal', 'kontrakt', 'signer', 'signatur', 'nda'], ['agreements', 'agreement_signatures']],
  [['patent', 'varumärke', 'varumarke', 'ipr', 'immaterial'], ['intellectual_property']],
  [
    ['möte', 'mote', 'event', 'evenemang', 'kalender', 'anmäl', 'anmal', 'deltagare', 'träff', 'traff'],
    ['incubator_events', 'event_signups']
  ],
  [['uppgift', 'todo', 'task', 'deadline'], ['tasks']],
  [['anteckning', 'notering'], ['notes']],
  [['milstolpe', 'milestone'], ['milestones']],
  [
    ['workshop', 'utbildning', 'kurs', 'lektion'],
    ['workshops', 'workshop_assignments', 'workshop_runs']
  ],
  [['dokument'], ['education_documents', 'education_document_assignments']],
  [['onboarding', 'introduktion'], ['onboarding_flows', 'onboarding_progress']],
  [
    ['lead', 'inflöde', 'inflode', 'kompass', 'intag', 'quiz'],
    ['compass_leads', 'compass_modules']
  ],
  [['agent', 'verktyg', 'körning', 'korning', 'toolbox'], ['tools', 'tool_runs']],
  [['token', 'kostnad', 'förbruk', 'forbruk', 'spend'], ['ai_usage_events']],
  [['deal', 'investerare', 'investor'], ['deals', 'investors']],
  [['partner'], ['partners', 'partner_engagements']],
  [['uppdrag', 'mission'], ['missions', 'mission_comments']],
  [['strategi'], ['strategies', 'strategy_revisions']],
  [['rapport'], ['incubator_reports', 'startup_financials']],
  [['integration', 'synk', 'brevo', 'howspace'], ['integration_records', 'integration_sync_runs']],
  [['timmar', 'tidrapport', 'nedlagd tid'], ['service_time_entries', 'startup_service_costs']],
  [['sprint'], ['sprint_x_checkins']]
];

/** Tokeniserar ett kollektionsnamn till matchbara stammar (≥ 5 tecken). */
function nameStems(name: string): string[] {
  const stems: string[] = [name];
  for (const token of name.split('_')) {
    if (token.length < 5) continue;
    stems.push(token);
    if (token.endsWith('s')) stems.push(token.slice(0, -1));
  }
  return stems;
}

/**
 * Väljer vilka kollektioner som får fulla fältlistor: kärnset + de som
 * matchar användarens text (synonymkarta + kollektionsnamnets egna tokens).
 * Deterministisk och snabb — ingen extra LLM-runda.
 */
export function selectRelevantCollections(
  collections: ScopableCollection[],
  contextText: string,
  options: { maxDetailed?: number } = {}
): Set<string> {
  const maxDetailed = Math.max(
    options.maxDetailed ?? MAX_DETAILED_COLLECTIONS,
    CORE_SCHEMA_COLLECTIONS.length
  );
  const text = String(contextText || '').toLowerCase();
  const exposedNames = new Set(collections.map((c) => c.name));
  const relevant = new Set<string>();

  for (const core of CORE_SCHEMA_COLLECTIONS) {
    if (exposedNames.has(core)) relevant.add(core);
  }

  const tryAdd = (name: string) => {
    if (relevant.size >= maxDetailed) return;
    if (exposedNames.has(name)) relevant.add(name);
  };

  if (text.trim()) {
    for (const [stems, names] of STEM_TO_COLLECTIONS) {
      if (stems.some((s) => text.includes(s))) {
        for (const name of names) tryAdd(name);
      }
    }
    // Generiskt: kollektionsnamnets egna tokens (framtidssäkrar nya
    // kollektioner som inte finns i synonymkartan).
    for (const c of collections) {
      if (relevant.has(c.name)) continue;
      if (nameStems(c.name).some((s) => text.includes(s))) tryAdd(c.name);
    }
  }

  return relevant;
}

function describeLine(c: ScopableCollection, withFields: boolean): string {
  const scope = c.tenantField ? '' : ' [referensdata, ej tenant-scopad]';
  if (!withFields) return `- ${c.name}${scope}: ${c.description}`;
  const fieldList =
    c.fields.length > 0 ? c.fields.map((f) => f.name).join(', ') : '(fält upptäcks live)';
  return `- ${c.name}${scope}: ${c.description}. Fält: ${fieldList}`;
}

/**
 * Bygger den skopade schema-sammanfattningen: fulla fältlistor för de
 * relevanta kollektionerna, kompakt namn+beskrivning-index för resten med
 * en explicit instruktion att köra `describe_collection` före filtrering.
 */
export function buildScopedSchemaSummary(
  collections: ScopableCollection[],
  relevantNames: ReadonlySet<string>
): string {
  const detailed: string[] = [];
  const compact: string[] = [];
  for (const c of collections) {
    if (relevantNames.has(c.name)) detailed.push(describeLine(c, true));
    else compact.push(describeLine(c, false));
  }
  const parts: string[] = ['Tillgängliga kollektioner i PocketBase:'];
  if (detailed.length > 0) {
    parts.push('', 'MEST RELEVANTA för samtalet (med fält):', ...detailed);
  }
  if (compact.length > 0) {
    parts.push(
      '',
      'ÖVRIGA kollektioner (fältlistor utelämnade för korthet — kör ' +
        '`describe_collection` för fält och giltiga enum-värden INNAN du ' +
        'filtrerar på dessa):',
      ...compact
    );
  }
  return parts.join('\n');
}
