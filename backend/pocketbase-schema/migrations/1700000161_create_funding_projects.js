/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 46.3 — Finansieringsprojekt & arbetspaket. Ett projekt är den
// KASSA ett stöd tas ur (Vinnova Excellens, ett TVV-projekt, EoI, Bas); ett
// arbetspaket (AP) är projektets redovisningsenhet — TVV/strukturfondsprojekt
// rekvireras alltid per AP. Stödcheckarna (1700000163) belastar projekt +
// arbetspaket vid beslut, så upparbetning per projekt/AP räknas ur
// ansökningarna (ingen kopia av beloppen lagras här).
//
// `default_state_aid_basis` är bara en DEFAULT för ansökningarnas
// finansieringsblock — statsstödsgrunden (de minimis/art. 22/inget) avgörs per
// ansökan av admin/incubator_lead. `default_stodgivare` förifyller
// de minimis-postens stödgivare.
//
// RLS: list/view staff/observer-only (intern projektekonomi); createRule
// refererar BARA auth-fält (§ 21.3); update/delete admin/incubator_lead.
// PII: inga personuppgifter (projekt, finansiär, belopp, datum). Autodate
// explicit (§ 28.5).

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const STAFF_OR_LEAD = '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');

    const projects = new Collection({
      id: 'funding_projects_collection',
      name: 'funding_projects',
      type: 'base',
      fields: [
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: tenantsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'title', type: 'text', required: true, min: 1, max: 200 },
        // MÅSTE spegla FUNDING_PROJECT_KINDS i packages/shared/src/funding.ts.
        {
          name: 'kind',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['vinnova', 'tillvaxtverket', 'region', 'eu', 'own', 'other']
        },
        // MÅSTE spegla FUNDING_PROJECT_STATUSES.
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['planned', 'active', 'ended', 'cancelled'] },
        { name: 'funder', type: 'text', required: false, max: 200 },
        { name: 'diarienummer', type: 'text', required: false, max: 80 },
        { name: 'description', type: 'text', required: false, max: 5000 },
        { name: 'budget_sek', type: 'number', required: false, min: 0 },
        { name: 'starts_at', type: 'date', required: false },
        { name: 'ends_at', type: 'date', required: false },
        // MÅSTE spegla STATE_AID_BASES.
        { name: 'default_state_aid_basis', type: 'select', required: false, maxSelect: 1, values: ['de_minimis', 'art22', 'none'] },
        { name: 'default_stodgivare', type: 'text', required: false, max: 200 },
        {
          name: 'responsible',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        {
          name: 'created_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        }
      ],
      indexes: [
        'CREATE INDEX idx_funding_projects_tenant ON funding_projects (tenant)',
        'CREATE INDEX idx_funding_projects_tenant_status ON funding_projects (tenant, status)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      createRule: `${ANY_AUTH} && ${ANY_TENANT}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LEAD}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LEAD}`
    });
    app.save(projects);

    const workPackages = new Collection({
      id: 'funding_work_packages_collection',
      name: 'funding_work_packages',
      type: 'base',
      fields: [
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
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
          name: 'project',
          type: 'relation',
          required: true,
          collectionId: projects.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        // "AP3" — kort kod som visas före titeln.
        { name: 'code', type: 'text', required: false, max: 20 },
        { name: 'title', type: 'text', required: true, min: 1, max: 200 },
        { name: 'description', type: 'text', required: false, max: 2000 },
        { name: 'budget_sek', type: 'number', required: false, min: 0 },
        { name: 'starts_at', type: 'date', required: false },
        { name: 'ends_at', type: 'date', required: false },
        { name: 'sort_order', type: 'number', required: false, onlyInt: true },
        {
          name: 'created_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        }
      ],
      indexes: [
        'CREATE INDEX idx_funding_work_packages_tenant ON funding_work_packages (tenant)',
        'CREATE INDEX idx_funding_work_packages_project ON funding_work_packages (project)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
      createRule: `${ANY_AUTH} && ${ANY_TENANT}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LEAD}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LEAD}`
    });
    return app.save(workPackages);
  },
  (app) => {
    for (const name of ['funding_work_packages', 'funding_projects']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (e) {
        /* ignore */
      }
    }
  }
);
