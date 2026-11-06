/**
 * Export Lab — mockläget (CLAUDE.md § 58). Deterministiska svar utan
 * modellanrop så flödet går att köra lokalt, i tester och på en instans utan
 * MISTRAL_API_KEY (utanför produktion). Utdata går genom SAMMA normaliserare
 * som ett riktigt modellsvar — mocken är ett svar, inte en bakväg.
 */

import type { ExportPlan, ExportProfile, ExportSufficiency, ExportUpdateAnalysis } from './export-lab';
import type { ExportPlanAIInput, ExportProfileAIInput, ExportSufficiencyAIInput, ExportUpdateAIInput } from './export-lab-inputs';

function lower(s: string) {
  return s.toLowerCase();
}

export function mockExportProfile(input: ExportProfileAIInput): ExportProfile {
  const text = lower(`${input.company.industry} ${input.company.innovationAndAmbition} ${input.initialEvidence.map((e) => e.text).join(' ')}`);
  const digital = /saas|mjukvara|app|plattform|ai|digital/.test(text);
  const health = /health|vård|patient|medtech|medicin/.test(text);
  const suggested = input.irl.suggestedLevel ?? 'PREPARE';
  const first = input.company.desiredMarkets[0] ?? 'Norge';
  const second = input.company.desiredMarkets[1] ?? (digital ? 'Tyskland' : 'Finland');
  return {
    companySummary: `${input.company.name} är i fasen ${input.company.phase} inom ${input.company.industry || 'ej angiven bransch'}. Underlaget beskriver en innovation med ambition att nå kunder utanför Sverige.`,
    innovationSummary: digital ? 'En digitalt levererad lösning som kan säljas utan fysisk närvaro.' : 'En produkt eller tjänst som sannolikt kräver lokal partner eller närvaro för leverans och support.',
    internationalAmbitionSummary: input.company.desiredMarkets.length ? `Bolaget nämner själva ${input.company.desiredMarkets.join(', ')} som intressanta marknader.` : 'Bolaget har ännu inte pekat ut specifika marknader.',
    pathway: { code: digital ? 'DIGITAL_FIRST' : 'GRADUAL', labelSv: '', rationale: digital ? 'Digital leverans ger låg geografisk friktion (Born global/Digital först), men marknaderna bör ändå tas i ordning efter språk, betalning och regelverk.' : 'Enligt Uppsala-modellen bör ett bolag med fysisk leverans börja på psykiskt nära marknader i Norden och öka åtagandet i takt med lärandet.' },
    readinessLevel: { level: suggested, labelSv: '', rationale: input.irl.assessed ? 'Nivån följer IRL-profilen: kund- och affärsnivåerna avgör hur nära en första pilotexport bolaget är.' : 'IRL är inte bedömd — nivån bygger på underlaget och bör stämmas av mot en IRL-bedömning på bolagskortet.' },
    readinessDimensions: [
      { key: 'OFFER', status: digital ? 'READY' : 'PARTIAL', rationale: 'Innovationen beskrivs som fungerande men anpassning för en ny marknad är inte belagd (TRL/IPRL).', irlAxes: ['trl', 'iprl'], evidence: [] },
      { key: 'MARKET', status: 'PARTIAL', rationale: 'Kundvalidering på hemmamarknaden finns delvis; efterfrågesignaler från utlandet saknas i underlaget (CRL).', irlAxes: ['crl'], evidence: [] },
      { key: 'BUSINESS', status: 'PARTIAL', rationale: 'Prissättning och betalningsvillkor för en annan marknad är inte beskrivna (BRL).', irlAxes: ['brl'], evidence: [] },
      { key: 'TEAM', status: 'PARTIAL', rationale: 'Underlaget säger inget om språk, tid eller internationell erfarenhet i teamet (TMRL).', irlAxes: ['tmrl'], evidence: [] },
      { key: 'FINANCE', status: 'NOT_READY', rationale: 'Kapital för längre säljcykler och resor framgår inte (FRL).', irlAxes: ['frl'], evidence: [] },
      { key: 'COMPLIANCE', status: health ? 'NOT_READY' : 'PARTIAL', rationale: health ? 'Medicinteknisk reglering kräver klassificering och ev. anmält organ innan export.' : 'Relevanta regelverk är identifierade men inte hanterade.', irlAxes: ['iprl'], evidence: [] }
    ],
    candidateMarkets: [
      {
        code: 'MKT-01',
        country: first,
        region: 'Norden',
        priority: 'PRIMARY',
        rationale: `${first} ligger kulturellt och administrativt nära Sverige, vilket enligt Uppsala-modellen gör den till en rimlig första marknad för att lära billigt.`,
        cage: {
          cultural: { distance: 'LOW', note: 'Liknande affärskultur: platt, konsensusdriven, direkt kommunikation.' },
          administrative: { distance: 'LOW', note: 'EU/EES-regler; moms och tull hanterbara.' },
          geographic: { distance: 'LOW', note: 'Resor och leverans inom en dag.' },
          economic: { distance: 'LOW', note: 'Likartad betalningsvilja och prisnivå.' }
        },
        attractiveness: 'MEDIUM',
        abilityToCompete: 'MEDIUM',
        entryModeHint: digital ? 'DIRECT_EXPORT' : 'INDIRECT_EXPORT',
        regulatoryDomains: health ? ['mdr_ivdr', 'gdpr_data', 'vat_tax'] : ['vat_tax', 'gdpr_data'],
        culturalNotes: ['Beslut tas ofta i konsensus — räkna med fler möten än en första signal antyder (Meyer: deciding).'],
        networkLeads: [],
        evidence: [{ documentName: null, note: 'Bedömningen bygger på bransch, underlag och närhet till Sverige.', excerpt: null }],
        confidence: 'MEDIUM',
        uncertaintyNotes: ['Ingen faktisk efterfrågesignal från marknaden finns i underlaget.']
      },
      {
        code: 'MKT-02',
        country: second,
        region: second === 'Tyskland' ? 'DACH' : 'Norden',
        priority: 'SECONDARY',
        rationale: `${second} är en större marknad med högre krav på referenser och formell dokumentation — rimlig som nästa steg när första marknaden gett lärdomar.`,
        cage: {
          cultural: { distance: second === 'Tyskland' ? 'MEDIUM' : 'LOW', note: second === 'Tyskland' ? 'Högre osäkerhetsundvikande: detaljer, garantier och formella avtal väger tungt (Hofstede).' : 'Nära svensk affärskultur.' },
          administrative: { distance: 'LOW', note: 'EU-marknad.' },
          geographic: { distance: second === 'Tyskland' ? 'MEDIUM' : 'LOW', note: 'Hanterbart avstånd.' },
          economic: { distance: 'LOW', note: 'Jämförbar prisnivå.' }
        },
        attractiveness: 'HIGH',
        abilityToCompete: 'MEDIUM',
        entryModeHint: 'PARTNERSHIP_JV',
        regulatoryDomains: ['product_safety', 'vat_tax'],
        culturalNotes: [],
        networkLeads: [],
        evidence: [],
        confidence: 'LOW',
        uncertaintyNotes: ['Konkurrensbilden är inte kartlagd.']
      }
    ],
    consideredButNotPrioritized: [{ code: 'MKT-50', country: 'USA', rationale: 'Stor administrativ och geografisk distans samt höga kostnader för lokal närvaro — prövas när repeterbar försäljning finns i Europa.' }],
    regulatoryDomains: [
      { key: 'vat_tax', name: 'Moms & skatt', relevance: 'MEDIUM', why: 'Momsregistrering eller OSS krävs vid försäljning inom EU.' },
      ...(health ? [{ key: 'mdr_ivdr', name: 'Medicinteknik (MDR/IVDR)', relevance: 'HIGH' as const, why: 'Klassificering avgör tid och kostnad för varje marknad.' }] : [])
    ],
    otherRegulations: [],
    assumptions: ['Sverige är hemmamarknad och första validering sker där.'],
    warnings: input.initialEvidence.length ? [] : ['Underlaget består enbart av fritext — marknadsvalet är preliminärt.']
  };
}

export function mockExportSufficiency(input: ExportSufficiencyAIInput): ExportSufficiency {
  const checks: ExportSufficiency['checks'] = input.profile.candidateMarkets.map((m, i) => ({
    code: m.code,
    kind: 'MARKET' as const,
    name: m.country,
    informationStatus: (i === 0 ? 'PARTIAL' : 'MISSING') as 'PARTIAL' | 'MISSING',
    rationale: `Underlaget motiverar varför ${m.country} är intressant men saknar faktiska signaler från marknaden.`,
    whatWeKnow: [m.rationale],
    missingInformation: ['Förfrågningar eller kontakter på marknaden', 'Hur leverans, betalning och support ska ske'],
    question: {
      question: `Har ni haft kontakt med kunder, partners eller nätverk i ${m.country} — och i så fall vilka och vad sa de?`,
      missingInformation: 'Faktiska efterfrågesignaler och befintliga kontakter.',
      whyThisMattersForPlan: 'Avgör om marknaden kan tas nätverksdrivet eller behöver byggas från noll, och påverkar inträdesform och tidsplan.',
      severity: (i === 0 ? 'REQUIRED' : 'RECOMMENDED') as 'REQUIRED' | 'RECOMMENDED',
      exampleHelpfulEvidence: 'E-posttrådar, mötesanteckningar, mässkontakter, LOI.'
    },
    confidence: 'LOW' as const
  }));
  checks.push({
    code: 'FINANCE',
    kind: 'DIMENSION',
    name: 'Finansiering & uthållighet',
    informationStatus: 'MISSING',
    rationale: 'Kapital för säljcykel, resor och anpassning framgår inte.',
    whatWeKnow: [],
    missingInformation: ['Runway och budget för internationalisering'],
    question: {
      question: 'Hur många månaders kapital har ni i dag, och hur mycket kan ni avsätta för resor, mässor och anpassning under nästa år?',
      missingInformation: 'Runway och avsatt budget.',
      whyThisMattersForPlan: 'Styr om planen kan innehålla en pilot inom 12 månader eller först behöver finansiering.',
      severity: 'REQUIRED',
      exampleHelpfulEvidence: 'Budget, kassaflödesprognos, beviljade stöd.'
    },
    confidence: 'LOW'
  });
  return {
    readyForPlan: true,
    overallInformationQuality: 45,
    generalComment: 'Underlaget räcker för en första exportplan med tydligt markerade antaganden.',
    checks,
    generalMissingInformation: ['Teamets språk och tid för internationellt arbete'],
    userMessage: 'Svara på det ni kan — det går att gå vidare även om allt inte är besvarat.'
  };
}

export function mockExportPlan(input: ExportPlanAIInput): ExportPlan {
  const markets = input.profile.candidateMarkets.filter((m) => m.priority !== 'EXCLUDED');
  const primary = markets[0];
  return {
    executiveSummary: `${input.company.name} bör arbeta ${input.profile.pathway.code === 'GRADUAL' ? 'stegvis' : 'nätverks- och digitaldrivet'} med ${primary?.country ?? 'en första marknad'} som första steg, stänga IRL-gapen inom finansiering och team, och sikta på en avgränsad pilot inom 12 månader.`,
    internationalStrategy: {
      pathway: input.profile.pathway,
      readinessLevel: input.profile.readinessLevel,
      sequencing: markets.map((m, i) => `${i + 1}. ${m.country} (${m.priority})`).join(' → ') || 'Första marknad väljs efter validering.',
      guidingPrinciples: ['Utgå från befintliga kontakter och kunder (effectuation).', 'Sätt en acceptabel förlust för första marknaden.', 'Testa med en pilotkund innan investering i lokal närvaro.']
    },
    marketPlans: markets.map((m) => ({
      code: m.code,
      country: m.country,
      priority: (m.priority === 'EXCLUDED' ? 'LATER' : m.priority) as 'PRIMARY' | 'SECONDARY' | 'LATER',
      entryMode: { mode: m.entryModeHint ?? 'INDIRECT_EXPORT', labelSv: '', rationale: 'Låg kapitalbindning och snabbt lärande väger tyngre än kontroll i första steget (Root).', alternatives: ['Direkt export när första referenskunden finns'] },
      localValueProposition: `Erbjudandet behöver formuleras mot de behov som är tydligast i ${m.country}; verifiera med 3–5 kundsamtal.`,
      targetSegments: ['Samma segment som på hemmamarknaden'],
      channelsAndPartners: ['Branschnätverk via Enterprise Europe Network', 'Business Sweden-kontor på marknaden'],
      regulatory: m.regulatoryDomains.map((k) => ({ key: k, name: k, requirement: 'Krav att verifiera för marknaden.', actionBeforeEntry: 'Stäm av med rådgivare eller myndighet innan första leverans.', estimatedEffort: 'MEDIUM' as const })),
      culturalPlaybook: [
        { dimension: 'Beslutsfattande', comparedToSweden: 'SIMILAR' as const, implication: 'Konsensusbeslut tar tid.', doThis: 'Identifiera alla som påverkar beslutet tidigt.', avoidThis: 'Pressa fram beslut efter ett möte.' },
        { dimension: 'Förtroende (uppgift/relation)', comparedToSweden: 'SOMEWHAT_DIFFERENT' as const, implication: 'Referenser och personlig relation väger tungt.', doThis: 'Ta med en referenskund till första mötet.', avoidThis: 'Skicka bara ett erbjudande per e-post.' }
      ],
      businessConditions: {
        pricingAndPayment: 'Behåll svensk prismodell i första piloten; verifiera betalningsvillkor och valuta.',
        competition: 'Kartlägg 3 lokala alternativ innan prissättning.',
        logisticsAndDelivery: 'Leverans och support från Sverige i piloten.',
        financingAndSupport: 'Undersök Business Sweden, EEN och Almi; EKN/SEK vid större affärer.'
      },
      risks: ['Säljcykeln blir längre än planerat.'],
      firstMilestones: ['5 kundsamtal genomförda', 'En pilotkund identifierad']
    })),
    firstExportPlan: {
      horizon: '12 månader',
      objective: `En betalande pilotkund i ${primary?.country ?? 'första marknaden'}.`,
      phases: [
        { name: 'Förbered', timeframe: '0–3 månader', goals: ['Stäng IRL-gapen inom finansiering och team'], actions: [{ title: 'Säkra budget för internationalisering', description: 'Avsätt medel för resor, mässor och anpassning.', owner: 'VD', irlAxis: 'frl', marketCode: null }], successCriteria: ['Budget beslutad'] },
        { name: 'Validera', timeframe: '3–6 månader', goals: ['Bekräfta efterfrågan'], actions: [{ title: 'Genomför kundsamtal', description: '5–10 samtal på första marknaden.', owner: 'Grundare', irlAxis: 'crl', marketCode: primary?.code ?? null }], successCriteria: ['3 intresserade kunder'] },
        { name: 'Pilot', timeframe: '6–12 månader', goals: ['Första leverans'], actions: [{ title: 'Pilotavtal', description: 'Avgränsad leverans med utvärdering.', owner: 'VD', irlAxis: 'brl', marketCode: primary?.code ?? null }], successCriteria: ['Pilot signerad och levererad'] }
      ],
      budgetAndResources: { estimatedCosts: ['Resor och möten', 'Översättning och anpassning', 'Rådgivning kring regelverk'], fundingOptions: ['Almi', 'Vinnova', 'EU-program'], supportActors: ['Business Sweden', 'Enterprise Europe Network', 'Movexum'] },
      kpis: [{ name: 'Kundsamtal på första marknaden', target: '10 inom 6 månader', why: 'Validerar efterfrågan (CRL).' }]
    },
    readinessGaps: [{ dimension: 'FINANCE', gap: 'Kapital för säljcykeln saknas', action: 'Sök finansiering eller stöd', irlAxis: 'frl', priority: 'HIGH' }],
    risks: [{ title: 'För tidig internationalisering', description: 'Hemmaaffären tappar fart om teamet splittras.', severity: 'MEDIUM', timeHorizon: 'SHORT', mitigation: 'Avgränsa piloten och sätt stoppkriterier.', marketCode: null }],
    discussionQuestions: [{ question: 'Vilken kund skulle ni helst ha som första referens utomlands?', whyImportant: 'Styr marknadsval och inträdesform.' }],
    informationQualityComment: 'Första plan med tydliga antaganden.',
    assumptions: ['Sverige är validerad hemmamarknad.'],
    limitations: ['Regelverk och tull är inte verifierade.'],
    disclaimer: ''
  };
}

export function mockExportUpdate(input: ExportUpdateAIInput): ExportUpdateAnalysis {
  const updatedPlan: ExportPlan = {
    ...input.currentPlan,
    executiveSummary: `${input.currentPlan.executiveSummary} Uppdaterad med ny information.`,
    assumptions: [...input.currentPlan.assumptions, 'Uppdateringen bygger på bolagets egen rapportering.']
  };
  return {
    updatedPlan,
    deltaSummary: {
      whatChangedSincePreviousPlan: [input.newEvidence.narrative ? 'Bolaget rapporterade nya händelser.' : 'Nya dokument lades till.'],
      marketChanges: [],
      newRisks: [],
      reducedRisks: [],
      recommendedNextDiscussions: ['Stäm av nästa fas i planen.']
    }
  };
}
