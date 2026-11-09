/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 45.8 — egna grupper i kontaktboken ("Frukostgänget",
// "Investerare Gävleborg") som personalen skapar, döper om och tar bort, och
// som inbjudningarna (§ 53.5) kan välja i sin dropdown.
//
//   contact_groups: tenant, name (≤ 80), description (≤ 300), created_by.
//     Unikt index (tenant, name); skiftlägesokänslig unikhet kontrolleras i
//     skrivlagret. Bär inga personuppgifter.
//   contacts.groups: multi-relation → contact_groups (≤ 50, ingen cascade —
//     PocketBase tar bort id:t från kontakterna när en grupp raderas).
//
// RLS: list/view staff/observer-only (§ 21); createRule pinnar tenant och
// skapare (§ 21.8, ingen roll-check/join — § 21.3); update/delete Movexum-
// personal i tenanten (`:each ?=`). Autodate explicit (§ 28.5). Speglas i
// scripts/setup-via-api.mjs och asserteras i verify-baseline.mjs. Riskklass
// n/a. Oföränderlig migration (nytt filnummer, § 10.3 A.8.32).

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');

    let groups;
    try {
      groups = app.findCollectionByNameOrId('contact_groups');
    } catch (e) {
      groups = new Collection({
        id: 'contact_groups_collection',
        name: 'contact_groups',
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
          { name: 'name', type: 'text', required: true, min: 1, max: 80 },
          { name: 'description', type: 'text', required: false, max: 300 },
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
          'CREATE INDEX idx_contact_groups_tenant ON contact_groups (tenant)',
          'CREATE UNIQUE INDEX idx_contact_groups_tenant_name ON contact_groups (tenant, name)'
        ],
        listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
        viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`,
        createRule: `${ANY_AUTH} && @request.body.tenant = @request.auth.tenant && @request.body.created_by = @request.auth.id`,
        updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`,
        deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`
      });
      app.save(groups);
    }

    const contacts = app.findCollectionByNameOrId('contacts');
    if (!contacts.fields.getByName('groups')) {
      contacts.fields.add(
        new Field({
          name: 'groups',
          type: 'relation',
          required: false,
          collectionId: groups.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 50
        })
      );
      app.save(contacts);
    }
  },
  (app) => {
    try {
      const contacts = app.findCollectionByNameOrId('contacts');
      const field = contacts.fields.getByName('groups');
      if (field) {
        contacts.fields.removeById(field.id);
        app.save(contacts);
      }
    } catch (e) {
      /* ignore */
    }
    try {
      app.delete(app.findCollectionByNameOrId('contact_groups'));
    } catch (e) {
      /* ignore */
    }
  }
);
