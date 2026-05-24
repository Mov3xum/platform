/// <reference path="../pb_data/types.d.ts" />

// Seedar demodata för Movexum OS-prototypen (Sprint X, missions, investors,
// deals, events, reports, alumni). Idempotent: hoppar över om data finns.

migrate(
  (app) => {
    let tenant;
    try {
      tenant = app.findFirstRecordByFilter('tenants', 'slug = "movexum"');
    } catch (e) {
      return; // no tenant — bail
    }
    const tenantId = tenant.id;

    // ── 1. Befintliga startups: säkerställ sprint_x / sector / pitch om saknas ──
    let startups = [];
    try {
      startups = app.findRecordsByFilter('startups', `tenant = "${tenantId}"`, '-created', 50, 0);
    } catch (e) {
      startups = [];
    }

    const startupsCol = app.findCollectionByNameOrId('startups');

    // Demo-startups om inga finns (annars hoppa över skapande)
    if (startups.length === 0) {
      const demoStartups = [
        {
          name: 'Tidvis',
          phase: 'idea',
          status: 'active',
          sector: 'Tidvattenenergi · Marin Tech',
          pitch: 'Tidvattenkraft för glesbygdens elnät — modulär turbin för Norrlandskusten.',
          next_milestone: 'Pilot Söderhamn · Q3 2026',
          team_size: 4,
          accent: 'cyan',
          irl_level: 3,
          sprint_x_json: { funding: 28, intl: 12, sustain: 78, team: 62 }
        },
        {
          name: 'Polarpump',
          phase: 'pre_revenue',
          status: 'active',
          sector: 'Värmepumpar · Cleantech',
          pitch: 'Bergvärmesystem optimerade för kallt klimat — IoT-styrt för flerbostadshus.',
          next_milestone: 'Serie A pitch · juli 2026',
          team_size: 6,
          accent: 'cyan',
          irl_level: 5,
          sprint_x_json: { funding: 58, intl: 34, sustain: 70, team: 80 }
        },
        {
          name: 'Skogsnod',
          phase: 'early_revenue',
          status: 'active',
          sector: 'Skogsdata · AgriTech',
          pitch: 'AI för skogsbruk: skördemängd, biodiversitet och kolinlagring per hektar.',
          next_milestone: 'Tysk markentré · oktober',
          team_size: 8,
          accent: 'green',
          irl_level: 6,
          sprint_x_json: { funding: 72, intl: 60, sustain: 88, team: 70 }
        },
        {
          name: 'Narva Health',
          phase: 'idea',
          status: 'active',
          sector: 'Healthtech',
          pitch: 'Hemmonitorering för hjärtsviktspatienter med passiv sensorik.',
          next_milestone: 'Etikgranskning Region Gävleborg',
          team_size: 3,
          accent: 'copper',
          irl_level: 2,
          sprint_x_json: { funding: 18, intl: 8, sustain: 40, team: 50 }
        },
        {
          name: 'Gnista Energi',
          phase: 'pre_revenue',
          status: 'active',
          sector: 'Mikronät · Energilagring',
          pitch: 'Batterilager för byalag — mikronätsservice som lokal energiförening äger.',
          next_milestone: 'Energimyndigheten — beslut',
          team_size: 5,
          accent: 'yellow',
          irl_level: 4,
          sprint_x_json: { funding: 45, intl: 22, sustain: 82, team: 64 }
        },
        {
          name: 'Kelda',
          phase: 'scale',
          status: 'active',
          sector: 'Vattenrening · Cleantech',
          pitch: 'Membranfri rening av processvatten för pappersbruk.',
          next_milestone: 'EXIT-förhandling',
          team_size: 14,
          accent: 'cyan',
          irl_level: 8,
          sprint_x_json: { funding: 88, intl: 75, sustain: 92, team: 86 }
        }
      ];

      for (const s of demoStartups) {
        const rec = new Record(startupsCol, { tenant: tenantId, ...s });
        try {
          app.save(rec);
        } catch (e) {
          // skip on error
        }
      }

      try {
        startups = app.findRecordsByFilter('startups', `tenant = "${tenantId}"`, '-created', 50, 0);
      } catch (e) {
        startups = [];
      }
    }

    const byName = {};
    for (const s of startups) byName[s.getString('name')] = s.id;

    // ── 2. Investorer ──
    let investors = [];
    try {
      investors = app.findRecordsByFilter('investors', `tenant = "${tenantId}"`, '-created', 50, 0);
    } catch (e) {
      investors = [];
    }
    if (investors.length === 0) {
      const investorsCol = app.findCollectionByNameOrId('investors');
      const demo = [
        {
          name: 'Norrsken VC',
          focus: ['Impact', 'Pre-seed', 'Seed'],
          ticket_min: 1000000,
          ticket_max: 6000000,
          warmth: 'hot',
          stage_focus: ['pre_seed', 'seed'],
          accent: 'green'
        },
        {
          name: 'Almi Invest',
          focus: ['Regional utveckling', 'Seed', 'Cleantech'],
          ticket_min: 500000,
          ticket_max: 4000000,
          warmth: 'active',
          stage_focus: ['seed'],
          accent: 'cyan'
        },
        {
          name: 'Industrifonden',
          focus: ['DeepTech', 'Seed', 'A'],
          ticket_min: 5000000,
          ticket_max: 20000000,
          warmth: 'tracking',
          stage_focus: ['seed', 'series_a'],
          accent: 'copper'
        },
        {
          name: 'EQT Ventures',
          focus: ['Series A', 'Tech'],
          ticket_min: 20000000,
          ticket_max: 80000000,
          warmth: 'later',
          stage_focus: ['series_a'],
          accent: 'brown'
        },
        {
          name: 'Familjebolag Norr',
          focus: ['Industri', 'Mikrotickets'],
          ticket_min: 300000,
          ticket_max: 1000000,
          warmth: 'hot',
          stage_focus: ['pre_seed'],
          accent: 'yellow'
        }
      ];
      for (const inv of demo) {
        const rec = new Record(investorsCol, { tenant: tenantId, ...inv });
        try {
          app.save(rec);
        } catch (e) {
          // skip
        }
      }
      try {
        investors = app.findRecordsByFilter('investors', `tenant = "${tenantId}"`, '-created', 50, 0);
      } catch (e) {
        investors = [];
      }
    }
    const invByName = {};
    for (const inv of investors) invByName[inv.getString('name')] = inv.id;

    // ── 3. Deals ──
    let deals = [];
    try {
      deals = app.findRecordsByFilter('deals', `tenant = "${tenantId}"`, '-created', 50, 0);
    } catch (e) {
      deals = [];
    }
    if (deals.length === 0 && Object.keys(byName).length && Object.keys(invByName).length) {
      const dealsCol = app.findCollectionByNameOrId('deals');
      const demo = [
        { startup: byName['Polarpump'], investor: invByName['Norrsken VC'], stage: 'dd', amount: 4000000 },
        { startup: byName['Polarpump'], investor: invByName['Almi Invest'], stage: 'meeting', amount: 2000000 },
        { startup: byName['Skogsnod'], investor: invByName['Industrifonden'], stage: 'term_sheet', amount: 12000000 },
        { startup: byName['Gnista Energi'], investor: invByName['Familjebolag Norr'], stage: 'intro', amount: 800000 },
        { startup: byName['Tidvis'], investor: invByName['Almi Invest'], stage: 'intro' },
        { startup: byName['Kelda'], investor: invByName['EQT Ventures'], stage: 'close', amount: 45000000 }
      ];
      for (const d of demo) {
        if (!d.startup || !d.investor) continue;
        const rec = new Record(dealsCol, { tenant: tenantId, ...d });
        try {
          app.save(rec);
        } catch (e) {
          // skip
        }
      }
    }

    // ── 4. Events ──
    let events = [];
    try {
      events = app.findRecordsByFilter(
        'incubator_events',
        `tenant = "${tenantId}"`,
        '-created',
        50,
        0
      );
    } catch (e) {
      events = [];
    }
    if (events.length === 0) {
      const eventsCol = app.findCollectionByNameOrId('incubator_events');
      const demo = [
        {
          name: 'Pitch Day Gävle · våren',
          type: 'pitch',
          status: 'live',
          starts_at: '2026-05-22 09:00:00.000Z',
          accent: 'yellow'
        },
        {
          name: 'Cleantech Nordic Forum',
          type: 'conference',
          status: 'planned',
          starts_at: '2026-06-04 09:00:00.000Z',
          accent: 'green'
        },
        {
          name: 'Investor Speed Dating',
          type: 'matching',
          status: 'planned',
          starts_at: '2026-06-18 13:00:00.000Z',
          accent: 'copper'
        },
        {
          name: 'Hemmaplan Hackday',
          type: 'hack',
          status: 'planned',
          starts_at: '2026-07-02 09:00:00.000Z',
          accent: 'purple'
        },
        {
          name: 'Sommarmingel · Alumni',
          type: 'mingle',
          status: 'planned',
          starts_at: '2026-08-14 17:00:00.000Z',
          accent: 'brown'
        }
      ];
      for (const ev of demo) {
        const rec = new Record(eventsCol, { tenant: tenantId, ...ev });
        try {
          app.save(rec);
        } catch (e) {
          // skip
        }
      }
      try {
        events = app.findRecordsByFilter(
          'incubator_events',
          `tenant = "${tenantId}"`,
          '-created',
          50,
          0
        );
      } catch (e) {
        events = [];
      }
    }

    // ── 5. Event signups för Pitch Day Gävle ──
    const pitchDay = events.find((e) => e.getString('name').indexOf('Pitch Day') === 0);
    if (pitchDay) {
      let signupCount = 0;
      try {
        const existing = app.findRecordsByFilter(
          'event_signups',
          `event = "${pitchDay.id}"`,
          '-created',
          1,
          0
        );
        signupCount = existing.length;
      } catch (e) {
        signupCount = 0;
      }
      if (signupCount === 0) {
        const signupsCol = app.findCollectionByNameOrId('event_signups');
        // 42 anmälda, 31 attended, 12 meeting, 7 application, 3 admitted
        const stages = [];
        for (let i = 0; i < 11; i++) stages.push('signup');
        for (let i = 0; i < 19; i++) stages.push('attended');
        for (let i = 0; i < 5; i++) stages.push('meeting');
        for (let i = 0; i < 4; i++) stages.push('application');
        for (let i = 0; i < 3; i++) stages.push('admitted');
        let n = 0;
        for (const st of stages) {
          n++;
          const rec = new Record(signupsCol, {
            tenant: tenantId,
            event: pitchDay.id,
            name: `Deltagare ${n}`,
            stage: st
          });
          try {
            app.save(rec);
          } catch (e) {
            // skip
          }
        }
      }
    }

    // ── 6. Reports ──
    let reports = [];
    try {
      reports = app.findRecordsByFilter(
        'incubator_reports',
        `tenant = "${tenantId}"`,
        '-created',
        50,
        0
      );
    } catch (e) {
      reports = [];
    }
    if (reports.length === 0) {
      const reportsCol = app.findCollectionByNameOrId('incubator_reports');
      const demo = [
        {
          title: 'Vinnova · Kvartalsrapport Q2 2026',
          recipient: 'vinnova',
          recipient_label: 'Vinnova',
          status: 'draft_ai',
          period_label: 'apr–jun 2026',
          completion: 78,
          accent: 'brown',
          sections_json: [
            { id: 's1', name: 'Bolagsportfölj', state: 'done', auto: true },
            { id: 's2', name: 'Aktiviteter & uppdrag', state: 'done', auto: true },
            { id: 's3', name: 'Antagna under perioden', state: 'done', auto: true },
            { id: 's4', name: 'Kvalitativ analys', state: 'review', auto: false },
            { id: 's5', name: 'Bilagor', state: 'pending', auto: false }
          ],
          preview_md:
            'Under perioden april–juni 2026 har Movexum haft **14 bolag** i aktivt program, fördelat på 4 i förinkubator, 8 i inkubator och 2 i scale-fas. Antagningar under perioden uppgår till **3 bolag** (Narva Health, Gnista Energi, samt ett tillägg).\n\nSektorfördelningen domineras av **cleantech (43%)**, följt av **healthtech (21%)** och **agritech (14%)**. Den regionala spridningen följer länets struktur med tonvikt på Gävle och Söderhamn.\n\n_[Auto-genererat av Rapport-skrivaren · granskas av incubator-team]_'
        },
        {
          title: 'Tillväxtverket · Halvår 2026',
          recipient: 'tillvaxtverket',
          recipient_label: 'Tillväxtverket',
          status: 'review',
          period_label: 'jan–jun 2026',
          completion: 92,
          accent: 'copper',
          sections_json: [
            { id: 't1', name: 'Regional spridning', state: 'done', auto: true },
            { id: 't2', name: 'Jobb skapade', state: 'done', auto: true },
            { id: 't3', name: 'Hållbarhetsbidrag', state: 'done', auto: true },
            { id: 't4', name: 'Slutkommentar', state: 'done', auto: false }
          ]
        },
        {
          title: 'Region Gävleborg · ägarrapport',
          recipient: 'region',
          recipient_label: 'Region Gävleborg',
          status: 'sent',
          period_label: 'helår 2025',
          completion: 100,
          accent: 'green',
          sections_json: []
        }
      ];
      for (const r of demo) {
        const rec = new Record(reportsCol, { tenant: tenantId, ...r });
        try {
          app.save(rec);
        } catch (e) {
          // skip
        }
      }
    }

    // ── 7. Alumni ──
    let alumni = [];
    try {
      alumni = app.findRecordsByFilter('alumni', `tenant = "${tenantId}"`, '-created', 50, 0);
    } catch (e) {
      alumni = [];
    }
    if (alumni.length === 0) {
      const alumniCol = app.findCollectionByNameOrId('alumni');
      const demo = [
        { name: 'Björn Lund', company: 'Geocode → Bolaget såldes 2023', tag: 'exit', exit_year: 2023, active_mentor: true, accent: 'brown' },
        { name: 'Sara Tegnér', company: 'Klimatika → Exit 2024', tag: 'exit', exit_year: 2024, active_mentor: false, accent: 'green' },
        { name: 'Erik Holmström', company: 'Norrkraft (scale 2025)', tag: 'scale', active_mentor: true, accent: 'cyan' },
        { name: 'Linn Wikström', company: 'Solva (i drift)', tag: 'active', active_mentor: true, accent: 'yellow' },
        { name: 'Daniel Friberg', company: 'Backenta (i drift)', tag: 'active', active_mentor: false, accent: 'purple' }
      ];
      for (const a of demo) {
        const rec = new Record(alumniCol, { tenant: tenantId, ...a });
        try {
          app.save(rec);
        } catch (e) {
          // skip
        }
      }
    }
  },
  (app) => {
    // No-op down — seeding is idempotent and we don't want to lose user data.
  }
);
