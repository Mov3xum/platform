/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 11.8 — `startup_ownership`: bolagets ÄGARBILD som synkas från
// bolagsregister (Roaring: koncernstruktur + verklig huvudman) eller matas in
// manuellt. Underlag för Bizmaker-kartans steg 1 (fristående / partner- /
// anknutet företag, art. 3 i bilaga I till GBER) och för Vinnovas krav att
// grundarteamet äger ≥ 75 % (docs/ai/vinnova-statsstod-screening-agent.md).
//
// Dataminimering (GDPR § 5): FYSISKA PERSONER LAGRAS UTAN NAMN OCH UTAN
// PERSONNUMMER — bara `owner_kind = 'person'` + andel/kontrollintervall. Det
// räcker för reglerna (ägarandel), och namnen finns redan i
// `startup_team_members` för grundare som bolaget själva registrerat.
// `name`/`org_nr` fylls BARA för juridiska personer (org-nr för aktiebolag är
// inte personuppgift, GDPR skäl 14; enskild firma exkluderas av providern).
//
// Riktning: `owner` = raden äger startup-bolaget; `holding` = startup-bolaget
// äger raden (dotterbolag/andelar). `relation` är kartans klassning
// (independent/partner/linked) — härledd av providern, granskas av människa.
//
// RLS (§ 21.3): tenant-bred STAFF/OBSERVER-data — ägarbilden är intern
// bedömningsdata som en ren startup_member inte ska läsa via API:t (den ser
// sina egna team-medlemmar på bolagskortet). createRule refererar BARA
// auth-fält (ingen roll-check/tenant-join); roll enforce:as i skrivvägen.
// Speglas i setup-via-api.mjs och asserteras i verify-baseline.mjs
// (MUST_BE_STAFF_OR_OBSERVER + must-exist).

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';

migrate(
  (app) => {
    try {
      app.findCollectionByNameOrId('startup_ownership');
      return; // finns redan
    } catch (e) {
      /* skapa */
    }

    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const startupsCol = app.findCollectionByNameOrId('startups');

    const collection = new Collection({
      id: 'startup_ownership_col',
      name: 'startup_ownership',
      type: 'base',
      fields: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: tenantsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'startup',
          type: 'relation',
          required: true,
          collectionId: startupsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'direction',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['owner', 'holding']
        },
        {
          name: 'owner_kind',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['company', 'person', 'public_body', 'investor', 'other']
        },
        { name: 'name', type: 'text', required: false, max: 200 },
        { name: 'org_nr', type: 'text', required: false, max: 20 },
        { name: 'capital_pct', type: 'number', required: false, min: 0, max: 100 },
        { name: 'voting_pct', type: 'number', required: false, min: 0, max: 100 },
        { name: 'pct_min', type: 'number', required: false, min: 0, max: 100 },
        { name: 'pct_max', type: 'number', required: false, min: 0, max: 100 },
        { name: 'control_basis', type: 'text', required: false, max: 200 },
        { name: 'indirect', type: 'bool', required: false },
        {
          name: 'relation',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: ['independent', 'partner', 'linked', 'unknown']
        },
        {
          name: 'source',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['manual', 'roaring', 'bolagsverket', 'allabolag']
        },
        { name: 'synced_at', type: 'date', required: false },
        { name: 'note', type: 'text', required: false, max: 500 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
      ],
      indexes: [
        'CREATE INDEX idx_startup_ownership_tenant ON startup_ownership (tenant)',
        'CREATE INDEX idx_startup_ownership_startup ON startup_ownership (startup, direction)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      createRule: `${ANY_AUTH} && ${ANY_TENANT}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`
    });

    app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('startup_ownership'));
    } catch (e) {
      /* ignore */
    }
  }
);
