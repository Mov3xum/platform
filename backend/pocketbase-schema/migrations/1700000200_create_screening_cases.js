/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 51.10 — ärenden i Bedömning excellens.
//
// `screening_cases`: ett ärende per bolag som controllern arbetar med. Varje
// körning, omräkning och "hämta mer" sparar det senaste UNDERLAGET (`context`,
// utan verklig huvudmans namn) och de manuella svaren (`facts`) på ärendet,
// så ett påbörjat ärende fortsätts utan att data hämtas från Roaring igen
// (inga nya debiterade anrop). Ett klarmarkerat ärende (`status = done`)
// försvinner ur listan över aktuella ärenden men finns kvar under "Avslutade"
// och kan öppnas igen. Gäller vilket svenskt org-nr som helst — `startup` är
// satt bara för portföljbolag (där de manuella svaren dessutom bor på
// bolagskortet, § 51.4).
//
// RLS (§ 21.3): list/view staff/observer; create pinnar tenant + skapare
// (§ 21.8, ingen roll-check/join); update Movexum-personal i tenanten;
// delete ledningen eller skaparen. Autodate explicit (§ 28.5).
//
// GDPR § 5: underlaget kan bära grundarnamn/andel (samma uppgifter som
// teamet på bolagskortet) och fri motiveringstext → DENYLISTAD för AI i
// lib/ai/redaction.ts. cascadeDelete på tenant/startup (art. 17).
// Speglas i scripts/setup-via-api.mjs och asserteras i verify-baseline.mjs.
// Riskklass n/a (ingen AI). Oföränderlig migration (nytt filnummer).

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const LEAD = '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';

migrate(
  (app) => {
    try {
      app.findCollectionByNameOrId('screening_cases');
      return;
    } catch (e) {
      // skapas nedan
    }
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');
    const startupsCol = app.findCollectionByNameOrId('startups');
    const user = (name) => ({ name, type: 'relation', required: false, collectionId: usersCol.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 });

    const cases = new Collection({
      id: 'screening_cases_collection',
      name: 'screening_cases',
      type: 'base',
      fields: [
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        { name: 'tenant', type: 'relation', required: true, collectionId: tenantsCol.id, cascadeDelete: true, minSelect: 1, maxSelect: 1 },
        { name: 'startup', type: 'relation', required: false, collectionId: startupsCol.id, cascadeDelete: true, minSelect: 0, maxSelect: 1 },
        { name: 'org_nr', type: 'text', required: true, min: 10, max: 20 },
        { name: 'subject_name', type: 'text', required: false, max: 200 },
        // MÅSTE spegla SCREENING_CASE_STATUSES i apps/web/src/lib/excellence/cases.ts.
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['open', 'done'] },
        { name: 'mode', type: 'select', required: false, maxSelect: 1, values: ['register', 'saved'] },
        { name: 'provider', type: 'text', required: false, max: 60 },
        { name: 'context', type: 'json', required: false, maxSize: 2000000 },
        { name: 'facts', type: 'json', required: false, maxSize: 200000 },
        // MÅSTE spegla StateAidOutcome / VinnovaOutcome / ScreeningVerdict.
        { name: 'state_aid_outcome', type: 'select', required: false, maxSelect: 1, values: ['art22_possible', 'de_minimis', 'not_eligible', 'undetermined'] },
        { name: 'vinnova_outcome', type: 'select', required: false, maxSelect: 1, values: ['in_target_possible', 'not_in_target', 'undetermined'] },
        { name: 'excellence_verdict', type: 'select', required: false, maxSelect: 1, values: ['yes', 'no', 'unknown'] },
        { name: 'unknown_count', type: 'number', required: false, min: 0, onlyInt: true },
        { name: 'last_assessed_at', type: 'date', required: false },
        user('last_assessed_by'),
        // Senaste PDF:en i last_assessed_by:s egna Filer (§ 51.3, ägaren-bara).
        { name: 'file_id', type: 'text', required: false, max: 30 },
        { name: 'file_name', type: 'text', required: false, max: 200 },
        user('created_by'),
        { name: 'completed_at', type: 'date', required: false },
        user('completed_by')
      ],
      indexes: [
        'CREATE INDEX idx_screening_cases_tenant_status ON screening_cases (tenant, status)',
        'CREATE INDEX idx_screening_cases_tenant_org ON screening_cases (tenant, org_nr)',
        'CREATE INDEX idx_screening_cases_startup ON screening_cases (startup)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      createRule: `${ANY_AUTH} && @request.body.tenant = @request.auth.tenant && @request.body.created_by = @request.auth.id`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${LEAD} || @request.auth.id = created_by)`
    });
    return app.save(cases);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('screening_cases'));
    } catch {
      // redan borta
    }
  }
);
