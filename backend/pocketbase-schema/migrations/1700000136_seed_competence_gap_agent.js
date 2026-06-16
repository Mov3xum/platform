/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 29 (Fas 3) — Seedar en portfölj-agent som identifierar vilka
// KOMPETENSER inkubatorn behöver för att bemanna tvärfunktionella team runt
// bolagens utmaningar, och var det finns gap. Idempotent (skapas bara om den
// saknas för movexum-tenanten).
//
//   ai_competence_gap (ai_system_wide)
//
// Agenten kör read-only mot portföljkontexten ({{portfolio}}) och kan dessutom
// söka i den uppladdade kompetenskartläggningen via kunskapsbasen
// (search_knowledge, § 26) i agent-loopen. Den läser INGA personuppgifter —
// users.competences whitelistas aldrig i AI-kontexten; agenten resonerar om
// portföljens BEHOV och får kompetensinventeringen via kunskapsbasen.
//
// Riskklass: begränsad (EU AI Act art. 11) — strategiskt beslutsstöd, ingen
// profilering av individer, människa-i-loopen granskar utkastet.

migrate(
  (app) => {
    let tenant;
    try {
      tenant = app.findFirstRecordByFilter('tenants', 'slug = "movexum"');
    } catch (e) {
      return; // tenant saknas — hoppa över seeding
    }

    const toolsCol = app.findCollectionByNameOrId('tools');
    const key = 'ai_competence_gap';

    try {
      app.findFirstRecordByFilter('tools', `tenant = "${tenant.id}" && key = "${key}"`);
      return; // finns redan
    } catch (e) {
      /* not found — create */
    }

    const record = new Record(toolsCol, {
      tenant: tenant.id,
      key,
      name: 'AI: Kompetensbehov & team-gap',
      category: 'ai_system_wide',
      icon: '🧩',
      model: 'mistral-large-latest',
      requires_startup: false,
      roles_allowed: ['admin', 'incubator_lead'],
      output_format: 'markdown',
      active: true,
      web_sources: [],
      system_prompt:
        'Du är organisationsutvecklare på en företagsinkubator som arbetar i ' +
        'tvärfunktionella team runt bolagens behov. Du analyserar portföljens ' +
        'utmaningar och vilka kompetenser som krävs för att bemanna teamen. ' +
        'Använd kunskapsbasen (search_knowledge) för att hämta inkubatorns ' +
        'kompetenskartläggning när den finns. Bedöm aldrig enskilda individer ' +
        'på skyddade egenskaper — resonera om kompetensbehov, inte om personer.',
      description:
        '<p>Analyserar portföljens utmaningar och pekar ut vilka kompetenser inkubatorn behöver för att sätta tvärfunktionella team — och var det finns gap att täcka (internt eller externt, t.ex. annan inkubator).</p>' +
        '<p><strong>Riskklass:</strong> Begränsad (EU AI Act). Använder bara whitelistade portföljfält + uppladdad kompetenskartläggning. Ingen profilering av individer. Mänsklig granskning krävs.</p>',
      prompt_template:
        '<p>Du analyserar en inkubators portfölj för att planera bemanningen av tvärfunktionella team.\n\n' +
        'Portföljdata (whitelistade fält, inga personuppgifter):\n{{portfolio}}\n\n' +
        'Använd vid behov kunskapsbasen (search_knowledge) för att hämta Movexums kompetenskartläggning.\n\n' +
        'Leverera:\n' +
        '1. De 5 vanligaste bolagsbehoven/utmaningarna i portföljen just nu.\n' +
        '2. Vilka kompetenser som krävs för att möta dem (använd Movexums kompetenstaxonomi: affärscoaching, affärsutveckling, projektledning, kommunikation, HR/personal, juridik, finansiering/kapital, AI/teknik, hållbarhet, internationalisering, Boost Chamber/spets, design, branschspecifik).\n' +
        '3. Var det sannolikt finns kompetensgap att täcka — internt eller externt (t.ex. extern specialist eller annan inkubator).\n' +
        '4. 2-3 konkreta rekommendationer för hur teamen bör sättas.\n\n' +
        'Var konkret och kort. Hitta inte på data som inte finns i underlaget.</p>'
    });

    app.save(record);
  },
  (app) => {
    let tenant;
    try {
      tenant = app.findFirstRecordByFilter('tenants', 'slug = "movexum"');
    } catch (e) {
      return;
    }
    try {
      const rec = app.findFirstRecordByFilter(
        'tools',
        `tenant = "${tenant.id}" && key = "ai_competence_gap"`
      );
      app.delete(rec);
    } catch (e) {
      /* already gone */
    }
  }
);
