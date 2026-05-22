/// <reference path="../pb_data/types.d.ts" />

// Excel-arket "Mätetal" — flexibel KPI-tracking per bolag. Skiljer sig
// från `startup_financials` (1700000059) som är strikt årsbokslut
// (employees, revenue, personnel_cost, corporate_tax). KPI:erna här är
// fria nyckeltal som bolaget eller coachen vill mäta över tid:
// MRR, NPS, antal kunder, gross margin, churn etc.
//
// Datatypen är textbaserad (`value_text`) för att stödja både siffror,
// procent, valutor och beskrivande värden ("Hög", "Beta-launch"). En
// extra `value_numeric` finns för grafer/aggregat när det är vettigt.
//
// `is_current` markerar senaste värdet per (startup, kpi_name) så att
// dashboards kan visa current state utan att sortera. Server action
// ska normalisera vid skrivning (sätt is_current=false på äldre rader
// med samma startup+kpi_name).
//
// CLAUDE.md § 9.3: kpi_name + värde + datum är AI-säkert (företagsdata).

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_MEMBER =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "startup_member")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const startupsCol = app.findCollectionByNameOrId('startups');

    const collection = new Collection({
      id: 'startup_kpis_collection',
      name: 'startup_kpis',
      type: 'base',
      fields: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: tenantsCol.id,
          cascadeDelete: false,
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
        // Excel: "Nyckeltal" — KPI-namn, t.ex. "MRR", "NPS", "Antal kunder".
        { name: 'kpi_name', type: 'text', required: true, max: 100 },
        // Excel: "Värde" — flexibel datatyp.
        { name: 'value_text', type: 'text', required: true, max: 200 },
        // Optional numeric speglar `value_text` för grafer/aggregat.
        { name: 'value_numeric', type: 'number', required: false },
        // Fri enhet — t.ex. "SEK", "%", "users/month".
        { name: 'unit', type: 'text', required: false, max: 30 },
        // Excel: "Mätdatum"
        { name: 'measured_at', type: 'date', required: true },
        // Excel: "Aktuell" — markerar senaste mätningen för aktuell KPI.
        { name: 'is_current', type: 'bool', required: false }
      ],
      indexes: [
        'CREATE INDEX idx_kpis_tenant ON startup_kpis (tenant)',
        'CREATE INDEX idx_kpis_startup ON startup_kpis (startup)',
        'CREATE INDEX idx_kpis_name ON startup_kpis (kpi_name)',
        'CREATE INDEX idx_kpis_current ON startup_kpis (startup, kpi_name, is_current)',
        'CREATE INDEX idx_kpis_measured ON startup_kpis (measured_at)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_MEMBER}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_MEMBER}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && (@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead")`
    });

    return app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('startup_kpis'));
    } catch (e) {
      /* ignore */
    }
  }
);
