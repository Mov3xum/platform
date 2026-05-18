/// <reference path="../pb_data/types.d.ts" />

// Seedar AI-agenten `ai_breakit_morning` — en Breakit-fokuserad
// morgonbrief som sammanfattar dagens nyheter från Breakit och föreslår
// vad inkubatorpersonal/coacher bör hålla utkik efter i portföljen.
//
// Backas av:
//  - web.ts-whitelisten (`breakit` → publik RSS, sedan migration 1700000054)
//  - `tool_schedules`-collectionen (1700000061) för daglig schemaläggning
//  - integration_providers/breakit (1700000062) som stub för framtida
//    paywall-stöd
//
// EU AI Act art. 11 — riskklass: BEGRÄNSAD. Aggregerar publika nyheter,
// ingen personprofilering, mänsklig granskning krävs innan delning.
// CLAUDE.md § 10.1: Premium-paywall ingår INTE. Provider-stub finns men
// kräver kommersiellt avtal innan aktivering.

migrate(
  (app) => {
    let tenant;
    try {
      tenant = app.findFirstRecordByFilter('tenants', 'slug = "movexum"');
    } catch (e) {
      // Tenant not found — skip seeding (test/dev miljöer utan movexum-seed)
      return;
    }

    const toolsCol = app.findCollectionByNameOrId('tools');
    const key = 'ai_breakit_morning';

    try {
      app.findFirstRecordByFilter(
        'tools',
        `tenant = "${tenant.id}" && key = "${key}"`
      );
      return; // already exists — idempotent
    } catch (e) {
      /* not found — create */
    }

    const record = new Record(toolsCol, {
      tenant: tenant.id,
      key,
      name: 'AI: Breakit-morgonbrief',
      category: 'ai_system_wide',
      icon: '☕',
      model: 'mistral-medium-latest',
      requires_startup: false,
      roles_allowed: ['admin', 'incubator_lead', 'coach', 'mentor'],
      output_format: 'markdown',
      active: true,
      web_sources: ['breakit'],
      description:
        '<p>Daglig morgonbrief som sammanfattar de viktigaste nyheterna ' +
        'från Breakit och pekar ut vad inkubatorpersonal bör hålla utkik ' +
        'efter i portföljen. Hämtar publika gratisartiklar via RSS — ' +
        'Premium-artiklar ingår inte i denna version.</p>' +
        '<p><strong>Riskklass:</strong> Begränsad (EU AI Act art. 11). ' +
        'Publik källa, ingen personprofilering. Mänsklig granskning ' +
        'krävs innan delning utåt.</p>' +
        '<p><strong>Schemaläggning:</strong> Aktivera ett dagligt schema ' +
        'via fliken Schema på den här sidan.</p>',
      prompt_template:
        '<p>Du är inkubator-analytiker. Sammanställ en kort morgonbrief ' +
        'baserat på dagens publika Breakit-nyheter.\n\n' +
        'Senaste från Breakit (live RSS):\n{{web.breakit}}\n\n' +
        'Skriv på svenska. Struktur:\n' +
        '1. Topp 3-5 nyheter som är mest relevanta för svenska tidigfas-bolag.\n' +
        '   För varje: rubrik, källänk, 1-2 meningar om varför det är ' +
        'relevant för en inkubatorportfölj (kapital, exits, regulatoriska ' +
        'förändringar, teknikskiften, etc.).\n' +
        '2. En kort spaningssektion (2-3 meningar) — vilka mönster eller ' +
        'trender ser du i dagens flöde?\n' +
        '3. Förslag på 1-2 bolagstyper i portföljen som coacherna bör ' +
        'prata med idag baserat på nyheterna.\n\n' +
        'Hitta inte på artiklar som inte finns i underlaget. Om RSS-flödet ' +
        'är tomt eller inte gick att hämta, säg det rakt ut.</p>'
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
      const record = app.findFirstRecordByFilter(
        'tools',
        `tenant = "${tenant.id}" && key = "ai_breakit_morning"`
      );
      app.delete(record);
    } catch (e) {
      /* already gone — idempotent */
    }
  }
);
