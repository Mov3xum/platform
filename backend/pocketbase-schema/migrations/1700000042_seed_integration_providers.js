/// <reference path="../pb_data/types.d.ts" />

// Seeds the integration_providers catalog with the providers Movexum
// has committed to supporting. Each entry is upserted by slug — running
// the migration again is a no-op for existing rows.

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('integration_providers');

    const providers = [
      // Microsoft 365
      {
        slug: 'teams',
        name: 'Microsoft Teams',
        category: 'microsoft365',
        placeholder: 'MT',
        tagline: 'Realtidskommunikation & möten',
        description:
          'Anslut Teams för att synka möten, kanaler och filer direkt med startup-profiler och aktivitetsfeeden. Få notiser i Teams när milstolpar loggas eller mötesprotokoll skapas.',
        features: [
          'Möten synkas till aktivitetsfeeden',
          'Kanalaviseringar vid uppdateringar',
          'Fildeling länkad till startup-rum',
          'SSO via Azure AD'
        ],
        availability: 'planned',
        sort_order: 10
      },
      {
        slug: 'sharepoint',
        name: 'SharePoint',
        category: 'microsoft365',
        placeholder: 'SP',
        tagline: 'Dokumenthantering & intranät',
        description:
          'Koppla era SharePoint-bibliotek till plattformens projektrum. Avtal, presentationer och rapporter blir automatiskt tillgängliga under rätt startup utan manuell uppladdning.',
        features: [
          'Dokumentbibliotek synkade per startup',
          'Versionskontroll bevaras',
          'Sök i SharePoint direkt från plattformen',
          'Granulär behörighet per team'
        ],
        availability: 'planned',
        sort_order: 20
      },
      {
        slug: 'outlook',
        name: 'Outlook & Kalender',
        category: 'microsoft365',
        placeholder: 'OK',
        tagline: 'E-post, kalender & bokning',
        description:
          'Synka kalender och e-post automatiskt. Bokade möten med bolag dyker upp i aktivitetsfeeden och coacher kan se alla schemalagda sessions utan att lämna plattformen.',
        features: [
          'Kalendersynk med startup-möten',
          'E-posttrådar kopplade till bolagsprofil',
          'Mötesbokningar direkt i plattformen',
          'Påminnelser och uppföljningsflöden'
        ],
        availability: 'planned',
        sort_order: 30
      },

      // AI
      {
        slug: 'klang',
        name: 'Klang AI',
        category: 'ai',
        placeholder: 'KA',
        tagline: 'Kommunikationsanalys & teamdynamik',
        description:
          'Klang AI kartlägger stämning, engagemang och kommunikationsmönster i realtid. Identifiera tidiga signaler på friktion eller drivkraft i bolagsteam innan de eskalerar.',
        features: [
          'Stämningsanalys per team och möte',
          'Engagemangsmätning över tid',
          'Anonymiserade insiktsrapporter',
          'EU-suveränt — data stannar i Europa'
        ],
        availability: 'beta',
        sort_order: 10
      },

      // Collaboration
      {
        slug: 'miro',
        name: 'Miro',
        category: 'collaboration',
        placeholder: 'MI',
        tagline: 'Digital whiteboard & workshops',
        description:
          'Länka Miro-tavlor direkt till startup-profiler. Workshops, business model canvases och roadmaps är alltid ett klick bort från bolagskortet — och visas i aktivitetsfeeden.',
        features: [
          'Tavlor kopplade till startup-profil',
          'Aktivitetslogg när tavlor uppdateras',
          'Inbäddad förhandsvisning i plattformen',
          'Delade mallar för inkubatorworkshops'
        ],
        availability: 'planned',
        sort_order: 10
      },
      {
        slug: 'notion',
        name: 'Notion',
        category: 'collaboration',
        placeholder: 'NO',
        tagline: 'Kunskapsbas & projektdokumentation',
        description:
          'Synka Notion-sidor med plattformens dokumentsektion. Intern wiki, processdokumentation och projektplaner visas automatiskt under rätt bolag eller inkubatorresurs.',
        features: [
          'Sidor länkade per startup och projekt',
          'Sökning i Notion via plattformen',
          'Automatisk taggning med bolagsnyckelord',
          'Offline-cache för kritisk dokumentation'
        ],
        availability: 'planned',
        sort_order: 20
      },

      // Communication
      {
        slug: 'slack',
        name: 'Slack',
        category: 'communication',
        placeholder: 'SL',
        tagline: 'Kanalbaserad teamkommunikation',
        description:
          'Automatiska notiser från plattformen hamnar i rätt Slack-kanal. Milstolpar, dokumentuppladdningar och AI-rapporter skickas dit teamet redan är — utan att man behöver logga in.',
        features: [
          'Anpassade notisregler per kanal',
          'Sammanfattningar skickas automatiskt',
          'Slash-kommandon för snabb bolagssökning',
          'Länk tillbaka till plattformen i varje meddelande'
        ],
        availability: 'beta',
        sort_order: 10
      },
      {
        slug: 'zoom',
        name: 'Zoom',
        category: 'communication',
        placeholder: 'ZO',
        tagline: 'Videokonferenser & inspelningar',
        description:
          'Boka Zoom-möten direkt från bolagskortet. Inspelningar och transkriptioner sparas automatiskt under rätt startup i aktivitetsfeeden och kan processas av AI-verktygen.',
        features: [
          'Mötesbokningar från plattformen',
          'Inspelningar länkade till startup',
          'Transkriptioner för AI-analys',
          'Schemalagda coachingmöten med påminnelser'
        ],
        availability: 'planned',
        sort_order: 20
      },

      // Productivity
      {
        slug: 'google',
        name: 'Google Workspace',
        category: 'productivity',
        placeholder: 'GW',
        tagline: 'Gmail, Drive & Docs',
        description:
          'Välj Google Workspace som alternativ till Microsoft 365. Gmail, Drive, Docs och Kalender synkas med plattformen — samma kraftfulla integration, er valfria ekosystem.',
        features: [
          'Google Drive-mappar per startup',
          'Kalendersynk och mötesbokningar',
          'Docs och Sheets länkade till profiler',
          'SSO via Google Identity'
        ],
        availability: 'planned',
        sort_order: 10
      },
      {
        slug: 'github',
        name: 'GitHub',
        category: 'productivity',
        placeholder: 'GH',
        tagline: 'Kodbaser, issues & CI/CD',
        description:
          'Länka GitHub-repositories till startup-profiler. Pull requests, releases och issues dyker upp i aktivitetsfeeden och ger coacher och investerare teknisk insyn utan att öppna GitHub.',
        features: [
          'Repositories kopplade per startup',
          'PR-aktivitet i aktivitetsfeeden',
          'Issue-status på bolagskortet',
          'CI/CD-status vid releaser'
        ],
        availability: 'planned',
        sort_order: 20
      }
    ];

    for (const p of providers) {
      let existing = null;
      try {
        existing = app.findFirstRecordByFilter(
          'integration_providers',
          `slug = "${p.slug}"`
        );
      } catch (e) {
        // not found — fall through to create
      }

      if (existing) {
        existing.set('name', p.name);
        existing.set('category', p.category);
        existing.set('placeholder', p.placeholder);
        existing.set('tagline', p.tagline);
        existing.set('description', p.description);
        existing.set('features', p.features);
        existing.set('availability', p.availability);
        existing.set('sort_order', p.sort_order);
        if (existing.get('active') === undefined || existing.get('active') === null) {
          existing.set('active', true);
        }
        app.save(existing);
      } else {
        const record = new Record(col, { ...p, active: true });
        app.save(record);
      }
    }
  },
  (app) => {
    const slugs = [
      'teams',
      'sharepoint',
      'outlook',
      'klang',
      'miro',
      'notion',
      'slack',
      'zoom',
      'google',
      'github'
    ];
    for (const slug of slugs) {
      try {
        const r = app.findFirstRecordByFilter(
          'integration_providers',
          `slug = "${slug}"`
        );
        if (r) app.delete(r);
      } catch (e) {
        /* ignore */
      }
    }
  }
);
