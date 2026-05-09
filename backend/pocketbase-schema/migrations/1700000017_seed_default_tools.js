/// <reference path="../pb_data/types.d.ts" />

// Seeds three default tools for the Movexum tenant — idempotent.

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

    const defaultTools = [
      {
        key: 'ai_quarterly_report',
        name: 'AI: Kvartalsrapport per bolag',
        category: 'ai_per_startup',
        icon: '📊',
        model: 'mistral-large-latest',
        requires_startup: true,
        roles_allowed: ['admin', 'incubator_lead', 'coach', 'mentor'],
        output_format: 'markdown',
        active: true,
        description:
          '<p>Genererar en strukturerad Markdown-rapport baserat på bolagets data: milstolpar, aktiviteter de senaste 90 dagarna och publika anteckningar. Konfidentiella anteckningar och e-postadresser exkluderas alltid.</p>',
        prompt_template:
          '<p>Du är en inkubatoranalytiker. Skapa en professionell kvartalsrapport på svenska för startupbolaget baserat på nedanstående data.\n\nBolagsdata:\n{{startup}}\n\nMilstolpar:\n{{milestones}}\n\nAktiviteter (senaste 90 dagar):\n{{activities}}\n\nPublika anteckningar:\n{{notes}}\n\nRapportstruktur:\n1. Sammanfattning\n2. Framsteg och milstolpar\n3. Utmaningar och risker\n4. Rekommenderade nästa steg\n\nAnvänd ett professionellt men lättläst språk. Avslutas med ett positivt uppmuntrande avsnitt.</p>'
      },
      {
        key: 'ai_portfolio_overview',
        name: 'AI: Portföljöversikt',
        category: 'ai_system_wide',
        icon: '🗂️',
        model: 'mistral-large-latest',
        requires_startup: false,
        roles_allowed: ['admin', 'incubator_lead'],
        output_format: 'markdown',
        active: true,
        description:
          '<p>Genererar en övergripande analys av hela portföljen. Använder endast grundläggande bolagsdata (namn, fas, IRL-nivå, status, nästa steg). Inga personuppgifter, anteckningar eller avtal inkluderas.</p>',
        prompt_template:
          '<p>Du är en inkubatoranalytiker. Skapa en strategisk portföljöversikt på svenska baserat på nedanstående bolagsdata.\n\nPortföljdata:\n{{portfolio}}\n\nRapportstruktur:\n1. Portföljöversikt och statistik\n2. Bolag per fas\n3. Framhävda bolag och trender\n4. Rekommendationer för inkubatorledningen\n\nVara datadriven och analytisk. Identifiera mönster och ge konkreta rekommendationer.</p>'
      },
      {
        key: 'template_pitch_deck',
        name: 'Mall: Pitch Deck',
        category: 'template',
        icon: '🎯',
        model: null,
        requires_startup: true,
        roles_allowed: ['admin', 'incubator_lead', 'coach', 'mentor', 'startup_member'],
        output_format: 'markdown',
        active: true,
        description:
          '<p>En strukturerad mall för pitch deck med de 10 viktigaste avsnitten. Kan anpassas per bolag.</p>',
        prompt_template:
          '<p># Pitch Deck Mall\n\n## 1. Problem\n_Vilket problem löser ni? För vem? Hur stort är det?_\n\n## 2. Lösning\n_Er unika lösning på problemet. Varför är den bättre?_\n\n## 3. Marknad\n_TAM / SAM / SOM. Källor och antaganden._\n\n## 4. Affärsmodell\n_Hur tjänar ni pengar? Prissättning och marginaler._\n\n## 5. Traction\n_Kunder, intäkter, tillväxt, viktiga milstolpar hittills._\n\n## 6. Team\n_Grundare och nyckelpersoner. Varför är ni rätt team?_\n\n## 7. Konkurrens\n_Konkurrensbild. Er differentiering och barriärer._\n\n## 8. Roadmap\n_12–18 månaders produktplan och go-to-market._\n\n## 9. Finansiering\n_Belopp som söks, användning, milstolpar som uppnås._\n\n## 10. Kontakt\n_Grundares namn, e-post, hemsida._</p>'
      }
    ];

    for (const toolData of defaultTools) {
      try {
        app.findFirstRecordByFilter('tools', `tenant = "${tenant.id}" && key = "${toolData.key}"`);
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
    try {
      const tenant = app.findFirstRecordByFilter('tenants', 'slug = "movexum"');
      const keys = ['ai_quarterly_report', 'ai_portfolio_overview', 'template_pitch_deck'];
      for (const key of keys) {
        try {
          const record = app.findFirstRecordByFilter(
            'tools',
            `tenant = "${tenant.id}" && key = "${key}"`
          );
          if (record) app.delete(record);
        } catch (e) {
          // ignore
        }
      }
    } catch (e) {
      // ignore
    }
  }
);
