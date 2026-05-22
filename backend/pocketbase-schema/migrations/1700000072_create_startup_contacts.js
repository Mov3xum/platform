/// <reference path="../pb_data/types.d.ts" />

// M2M mellan `startups` och `contacts` med rollkontext. Speglar Excel-
// arket "Företag-Person".
//
// En kontakt kan vara kopplad till flera bolag (rådgivare → 5 bolag) och
// ett bolag kan ha flera kontakter (huvudkontakt + jurist + mentor).
// Unique-index på (startup, contact) gör kopplingen idempotent.
//
// `is_primary` markerar huvudkontakten per bolag — flera kan vara TRUE
// men UI/server action ska normalisera till max 1 primärkontakt per
// bolag vid behov.
//
// CLAUDE.md § 9.3 — kontaktkopplingar (men ej PII från kontakten) får
// finnas i AI-kontext, t.ex. "bolag X har 3 mentor-kontakter".

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = startup.tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach")';

migrate(
  (app) => {
    const startupsCol = app.findCollectionByNameOrId('startups');
    const contactsCol = app.findCollectionByNameOrId('contacts');

    const collection = new Collection({
      id: 'startup_contacts_collection',
      name: 'startup_contacts',
      type: 'base',
      fields: [
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
          name: 'contact',
          type: 'relation',
          required: true,
          collectionId: contactsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        // Excel: "Roll" — kontextuell roll för just detta bolag, t.ex.
        // "Affärscoach", "Mentor", "Jurist", "Styrelseledamot".
        { name: 'role', type: 'text', required: false, max: 100 },
        // Excel: "Primärkontakt".
        { name: 'is_primary', type: 'bool', required: false }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_startup_contacts_unique ON startup_contacts (startup, contact)',
        'CREATE INDEX idx_startup_contacts_startup ON startup_contacts (startup)',
        'CREATE INDEX idx_startup_contacts_contact ON startup_contacts (contact)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });

    return app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('startup_contacts'));
    } catch (e) {
      /* ignore */
    }
  }
);
