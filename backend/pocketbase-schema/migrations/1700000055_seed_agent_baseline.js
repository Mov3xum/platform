/// <reference path="../pb_data/types.d.ts" />

// Seedar grunduppsättningen av AI-agenter för Movexum-tenanten — idempotent.
// Lägger till 8 nya verktyg ovanpå de 3 default-verktygen i 1700000017:
//
//   Per-bolag (ai_per_startup):
//     - ai_coach_briefing       (🧭 Coachbriefing inför 1:1)
//     - ai_risk_screening       (⚠️ Risk-/red flag-detektor)
//     - ai_pitch_review         (🎤 Pitch-feedback)
//     - ai_next_step_advisor    (🪜 IRL-coach: nästa steg)
//     - ai_industry_pulse       (📰 Branchpuls — live web)
//     - ai_funding_radar        (💰 Bidrags-/investeringsradar — live web)
//   System-wide (ai_system_wide):
//     - ai_portfolio_risk       (🚨 Bolag som tappar fart)
//   Utbildning (education):
//     - edu_irl_levels          (🎓 IRL-nivåer förklarade)
//
// Riskklasser dokumenteras i description (per EU AI Act art. 11, CLAUDE.md 10.1).
// Web-källor som används finns i `web_sources`-fältet; whitelisten upprätthålls
// i `apps/web/src/lib/ai/web.ts`.

migrate(
  (app) => {
    let tenant;
    try {
      tenant = app.findFirstRecordByFilter('tenants', 'slug = "movexum"');
    } catch (e) {
      // Tenant not found — skip seeding
      return;
    }

    const toolsCol = app.findCollectionByNameOrId('tools');

    const baselineTools = [
      {
        key: 'ai_coach_briefing',
        name: 'AI: Coachbriefing inför 1:1',
        category: 'ai_per_startup',
        icon: '🧭',
        model: 'mistral-medium-latest',
        requires_startup: true,
        roles_allowed: ['admin', 'incubator_lead', 'coach', 'mentor'],
        output_format: 'markdown',
        active: true,
        web_sources: [],
        description:
          '<p>Sammanfattar vad som hänt sedan senaste mötet och föreslår 3 frågor att ställa.</p>' +
          '<p><strong>Riskklass:</strong> Begränsad (EU AI Act). Mänsklig granskning krävs innan delning.</p>',
        prompt_template:
          '<p>Du är en inkubatorcoach. Skriv en kort 1-sidig briefing på svenska inför ett 1:1-möte med bolaget.\n\n' +
          'Bolagsdata:\n{{startup}}\n\n' +
          'Milstolpar:\n{{milestones}}\n\n' +
          'Aktiviteter senaste 90 dagar:\n{{activities}}\n\n' +
          'Publika anteckningar:\n{{notes}}\n\n' +
          'Struktur:\n' +
          '1. Vad har hänt sedan sist (max 3 punkter)\n' +
          '2. Vad ligger ute (öppna milstolpar/aktiviteter)\n' +
          '3. 3 konkreta frågor att ställa\n' +
          '4. Varningssignaler att vara uppmärksam på\n\n' +
          'Var kort och direkt. Använd punktlistor.</p>'
      },
      {
        key: 'ai_risk_screening',
        name: 'AI: Risk- och red flag-screening',
        category: 'ai_per_startup',
        icon: '⚠️',
        model: 'mistral-medium-latest',
        requires_startup: true,
        roles_allowed: ['admin', 'incubator_lead', 'coach', 'mentor'],
        output_format: 'markdown',
        active: true,
        web_sources: [],
        description:
          '<p>Identifierar röda flaggor: missade milstolpar, ingen aktivitet, status-stagnation, kontradiktioner i nästa steg.</p>' +
          '<p><strong>Riskklass:</strong> Begränsad. Människa-i-loopen via tilldelningsflödet — output ranker bara bolagsentiteter, aldrig enskilda personer.</p>',
        prompt_template:
          '<p>Du är inkubatoranalytiker. Granska bolagets data för att hitta röda flaggor och varningar.\n\n' +
          'Bolagsdata:\n{{startup}}\n\n' +
          'Milstolpar (kolla missade, försenade, status):\n{{milestones}}\n\n' +
          'Aktiviteter senaste 90 dagar:\n{{activities}}\n\n' +
          'Publika anteckningar:\n{{notes}}\n\n' +
          'Lista röda flaggor på följande format:\n' +
          '- [🔴 Kritisk / 🟡 Varning / 🔵 Info] Kort beskrivning\n' +
          '  - Vad signalet är\n' +
          '  - Rekommenderad åtgärd\n\n' +
          'Avsluta med en kort sammanfattande bedömning (2-3 meningar).</p>'
      },
      {
        key: 'ai_pitch_review',
        name: 'AI: Pitch-feedback',
        category: 'ai_per_startup',
        icon: '🎤',
        model: 'mistral-medium-latest',
        requires_startup: true,
        roles_allowed: [
          'admin',
          'incubator_lead',
          'coach',
          'mentor',
          'startup_member'
        ],
        output_format: 'markdown',
        active: true,
        web_sources: [],
        description:
          '<p>Ger feedback på pitch-narrativet baserat på bolagets beskrivning och status. Användbart inför demos och investerarmöten.</p>' +
          '<p><strong>Riskklass:</strong> Begränsad. AI-genererad feedback — verifiera innan delning.</p>',
        prompt_template:
          '<p>Du är en pitch-coach med erfarenhet av tidiga startupbolag. Ge konkret feedback på bolagets pitch-narrativ utifrån följande data.\n\n' +
          'Bolagsdata:\n{{startup}}\n\n' +
          'Bedöm pitchen längs följande axlar — för varje axel: nuläge (1-2 meningar) + 1-2 konkreta förbättringsförslag.\n' +
          '1. Problem (är problemet tydligt och stort?)\n' +
          '2. Lösning (är differentieringen klar?)\n' +
          '3. Marknad (storlek och timing)\n' +
          '4. Traction (vad bevisar att det funkar?)\n' +
          '5. Team (varför just detta team?)\n' +
          '6. Fråga (ask) — vad behöver bolaget nu?\n\n' +
          'Avsluta med en topp-3-prioritering av vad som behöver förbättras mest inför nästa pitch.</p>'
      },
      {
        key: 'ai_next_step_advisor',
        name: 'AI: IRL-coach – nästa steg',
        category: 'ai_per_startup',
        icon: '🪜',
        model: 'mistral-medium-latest',
        requires_startup: true,
        roles_allowed: [
          'admin',
          'incubator_lead',
          'coach',
          'mentor',
          'startup_member'
        ],
        output_format: 'markdown',
        active: true,
        web_sources: [],
        description:
          '<p>Föreslår 3 konkreta åtgärder för att avancera till nästa IRL-nivå. Tar hänsyn till nuvarande status, nästa steg och milstolpar.</p>' +
          '<p><strong>Riskklass:</strong> Begränsad. Rekommendationer är vägledande — coachen avgör.</p>',
        prompt_template:
          '<p>Du är en IRL-coach (Investment Readiness Level, skala 1-9). Föreslå nästa steg för bolaget.\n\n' +
          'Bolagsdata:\n{{startup}}\n\n' +
          'Milstolpar (uppnådda + planerade):\n{{milestones}}\n\n' +
          'Aktuella aktiviteter:\n{{activities}}\n\n' +
          'Föreslå exakt 3 konkreta åtgärder som tar bolaget mot nästa IRL-nivå.\n' +
          'Sortera efter impact/effort-ratio (högst nytta för minst arbete först).\n\n' +
          'För varje åtgärd:\n' +
          '- Vad ska göras?\n' +
          '- Varför den åtgärden nu?\n' +
          '- Förväntat resultat (mätbart om möjligt)\n' +
          '- Uppskattad tidsåtgång (timmar/dagar/veckor)\n\n' +
          'Avsluta med en mening om vad bolaget bör undvika att fokusera på just nu.</p>'
      },
      {
        key: 'ai_industry_pulse',
        name: 'AI: Branchpuls för ditt bolag',
        category: 'ai_per_startup',
        icon: '📰',
        model: 'mistral-medium-latest',
        requires_startup: true,
        roles_allowed: [
          'admin',
          'incubator_lead',
          'coach',
          'mentor',
          'startup_member'
        ],
        output_format: 'markdown',
        active: true,
        // Live-källor: svenska + EU-tekniknyheter
        web_sources: ['breakit', 'sifted', 'di_digital'],
        description:
          '<p>Hämtar live-nyheter från Breakit, Sifted och Di Digital och filtrerar fram poster som är relevanta för just detta bolag.</p>' +
          '<p><strong>Riskklass:</strong> Begränsad. Live-källor cachas i 30 min. Källor och hämtningstidpunkt visas i körningsvyn.</p>',
        prompt_template:
          '<p>Du är en marknadsanalytiker som följer den svenska och europeiska startupscenen.\n\n' +
          'Bolagsdata:\n{{startup}}\n\n' +
          'Aktuella nyheter (live):\n' +
          'Breakit:\n{{web.breakit}}\n\n' +
          'Sifted:\n{{web.sifted}}\n\n' +
          'Di Digital:\n{{web.di_digital}}\n\n' +
          'Välj ut 3-5 nyheter som är mest relevanta för bolagets sektor, fas och nästa steg.\n' +
          'För varje nyhet:\n' +
          '- Rubrik + källa + datum (om tillgängligt)\n' +
          '- 1-2 meningar om varför den är relevant för just detta bolag\n' +
          '- Ev. konkret åtgärdsförslag (kontakta X, bevaka Y, kopiera Z)\n\n' +
          'Om ingen nyhet är direkt relevant, säg det rakt ut. Hitta inte på poster som inte finns i underlaget.</p>'
      },
      {
        key: 'ai_funding_radar',
        name: 'AI: Bidrags- och investeringsradar',
        category: 'ai_per_startup',
        icon: '💰',
        model: 'mistral-medium-latest',
        requires_startup: true,
        roles_allowed: [
          'admin',
          'incubator_lead',
          'coach',
          'mentor',
          'startup_member'
        ],
        output_format: 'markdown',
        active: true,
        // Live-källor: svensk + EU-finansiering
        web_sources: ['vinnova', 'eic', 'almi'],
        description:
          '<p>Hämtar live-utlysningar från Vinnova, EIC och Almi och matchar mot bolagets fas och inriktning.</p>' +
          '<p><strong>Riskklass:</strong> Begränsad. Källor och hämtningstidpunkt loggas i körningsvyn.</p>',
        prompt_template:
          '<p>Du är expert på offentlig finansiering för startups i Sverige och EU.\n\n' +
          'Bolagsdata:\n{{startup}}\n\n' +
          'Aktuella utlysningar (live):\n' +
          'Vinnova:\n{{web.vinnova}}\n\n' +
          'European Innovation Council (EIC):\n{{web.eic}}\n\n' +
          'Almi:\n{{web.almi}}\n\n' +
          'Identifiera utlysningar och bidrag som matchar bolagets fas, IRL-nivå och inriktning.\n' +
          'Sortera efter passform (bäst först).\n\n' +
          'För varje matchning:\n' +
          '- Namn på utlysning + källa\n' +
          '- Belopp och deadline (om tillgängligt i underlaget)\n' +
          '- Varför den passar just detta bolag (2-3 meningar)\n' +
          '- Länk till mer information\n\n' +
          'Om inga matchningar finns, säg det och föreslå allmänna kriterier att hålla utkik efter. Hitta inte på utlysningar.</p>'
      },
      {
        key: 'ai_portfolio_risk',
        name: 'AI: Bolag som tappar fart',
        category: 'ai_system_wide',
        icon: '🚨',
        model: 'mistral-large-latest',
        requires_startup: false,
        roles_allowed: ['admin', 'incubator_lead'],
        output_format: 'markdown',
        active: true,
        web_sources: [],
        description:
          '<p>Hittar de bolag i portföljen som visar starkast varningssignaler (stagnant status, låg aktivitet, missade milstolpar) och föreslår åtgärder per bolag.</p>' +
          '<p><strong>Riskklass:</strong> Begränsad. Använder bara whitelistade portföljfält — inga personuppgifter, inga konfidentiella anteckningar. Rankar bolagsentiteter, inte individer.</p>',
        prompt_template:
          '<p>Du är portföljanalytiker för en inkubator. Granska den övergripande portföljen och identifiera de bolag som tappar fart.\n\n' +
          'Portföljdata (whitelistade fält, inga personuppgifter):\n{{portfolio}}\n\n' +
          'Topp 5 bolag med högst risksignaler:\n' +
          'För varje bolag:\n' +
          '- Bolagsnamn\n' +
          '- Risksignaler (vad i datan pekar på fart-tapp?)\n' +
          '- Föreslagen åtgärd från inkubatorledningen\n\n' +
          'Avsluta med en sammanfattning av portföljens generella status (2-3 meningar) och 1-2 strukturella observationer (mönster över flera bolag).</p>'
      },
      {
        key: 'edu_irl_levels',
        name: 'IRL-nivåerna förklarade',
        category: 'education',
        icon: '🎓',
        model: 'mistral-small-latest',
        requires_startup: false,
        roles_allowed: [
          'admin',
          'incubator_lead',
          'coach',
          'mentor',
          'partner',
          'startup_member',
          'observer'
        ],
        output_format: 'markdown',
        active: true,
        web_sources: [],
        description:
          '<p>En kort utbildning om IRL-skalan (Investment Readiness Level 1-9): vad varje nivå innebär, vad som krävs för att avancera, och vanliga fallgropar.</p>' +
          '<p><strong>Riskklass:</strong> Minimal. Generiskt utbildningsmaterial utan personuppgifter.</p>',
        prompt_template:
          '<p>Förklara IRL-skalan (Investment Readiness Level 1-9) på svenska. Skriv för en grundare som är ny i inkubatorprocessen.\n\n' +
          'Struktur:\n' +
          '1. Vad är IRL och varför används det\n' +
          '2. Genomgång av varje nivå (1-9): nivåns fokus, typiska aktiviteter, exempel\n' +
          '3. Vad som krävs för att avancera ett steg (i regel)\n' +
          '4. Vanliga fallgropar och missförstånd\n' +
          '5. När man bör flytta sig snabbare respektive ta det lugnt\n\n' +
          'Använd konkreta exempel och svenska termer.</p>'
      }
    ];

    for (const toolData of baselineTools) {
      try {
        app.findFirstRecordByFilter(
          'tools',
          `tenant = "${tenant.id}" && key = "${toolData.key}"`
        );
        continue; // already exists
      } catch (e) {
        // not found — create
      }

      const record = new Record(toolsCol, {
        tenant: tenant.id,
        ...toolData
      });

      app.save(record);
    }
  },
  (app) => {
    // Down-migration: ta bort de seedade verktygen (idempotent).
    const keys = [
      'ai_coach_briefing',
      'ai_risk_screening',
      'ai_pitch_review',
      'ai_next_step_advisor',
      'ai_industry_pulse',
      'ai_funding_radar',
      'ai_portfolio_risk',
      'edu_irl_levels'
    ];

    let tenant;
    try {
      tenant = app.findFirstRecordByFilter('tenants', 'slug = "movexum"');
    } catch (e) {
      return;
    }

    for (const key of keys) {
      try {
        const record = app.findFirstRecordByFilter(
          'tools',
          `tenant = "${tenant.id}" && key = "${key}"`
        );
        app.delete(record);
      } catch (e) {
        /* ignore — already gone */
      }
    }
  }
);
