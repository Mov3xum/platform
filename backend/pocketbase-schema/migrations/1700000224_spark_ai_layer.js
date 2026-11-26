/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 61.7 — SPARK:s AI-lager.
//
//   spark_embeddings     en vektor (mistral-embed) per behov/lösning, för
//                        innehållslikhet i matchningen. Polymorf (kind +
//                        record_id) så registrets vanliga läsningar inte bär
//                        vektorerna. `text_hash` avgör om texten ändrats.
//   spark_solutions.ai_* AI:ns FÖRSLAG på TRL och acceleratorkategori med
//                        motivering — skilt från Movexums bedömning
//                        (trl_assessed/accelerator_category), som alltid
//                        sätts av en människa.
//
// Bara verksamhetstext embeddas (rubrik, beskrivning, energiområden) — aldrig
// aktörens namn eller kontaktuppgifter. Vektorerna är denylistade för
// AI-chatten (inget läsvärde). RLS som registret: Movexum-personal +
// observer läser, tenant + skapare pinnas vid create, flyttlås på tenant.
// Speglas i setup-via-api.mjs, asserteras i verify-baseline.mjs.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';
const STAFF_OR_OBSERVER =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const TENANT_MOVE_LOCK = '(@request.body.tenant:isset = false || @request.body.tenant = tenant)';
const READ = `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OBSERVER}`;

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');
    let exists = true;
    try {
      app.findCollectionByNameOrId('spark_embeddings');
    } catch (e) {
      exists = false;
    }
    if (!exists) {
      app.save(
        new Collection({
          id: 'spark_embeddings_collection',
          name: 'spark_embeddings',
          type: 'base',
          fields: [
            { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
            { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
            { name: 'tenant', type: 'relation', required: true, collectionId: tenantsCol.id, cascadeDelete: true, minSelect: 1, maxSelect: 1 },
            // MÅSTE spegla 'need' | 'solution' i lib/spark/ai.server.ts.
            { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['need', 'solution'] },
            { name: 'record_id', type: 'text', required: true, max: 15 },
            { name: 'text_hash', type: 'text', required: false, max: 16 },
            { name: 'model', type: 'text', required: false, max: 60 },
            { name: 'embedding', type: 'json', required: false, maxSize: 80000 },
            { name: 'created_by', type: 'relation', required: false, collectionId: usersCol.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 }
          ],
          indexes: ['CREATE UNIQUE INDEX idx_spark_embeddings_record ON spark_embeddings (tenant, kind, record_id)'],
          listRule: READ,
          viewRule: READ,
          createRule: `${ANY_AUTH} && @request.body.tenant = @request.auth.tenant && @request.body.created_by = @request.auth.id`,
          updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF} && ${TENANT_MOVE_LOCK}`,
          deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF}`
        })
      );
    }

    const solutions = app.findCollectionByNameOrId('spark_solutions');
    const add = [
      { name: 'ai_trl', type: 'number', required: false, min: 0, max: 9, onlyInt: true },
      { name: 'ai_category', type: 'text', required: false, max: 30 },
      { name: 'ai_rationale', type: 'text', required: false, max: 1000 },
      { name: 'ai_confidence', type: 'number', required: false, min: 0, max: 1 },
      { name: 'ai_model', type: 'text', required: false, max: 60 },
      { name: 'ai_suggested_at', type: 'date', required: false }
    ];
    let changed = false;
    for (const f of add) {
      if (!solutions.fields.getByName(f.name)) {
        solutions.fields.add(new Field(f));
        changed = true;
      }
    }
    if (changed) app.save(solutions);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('spark_embeddings'));
    } catch (e) {
      /* redan borta */
    }
    try {
      const solutions = app.findCollectionByNameOrId('spark_solutions');
      for (const name of ['ai_trl', 'ai_category', 'ai_rationale', 'ai_confidence', 'ai_model', 'ai_suggested_at']) {
        const f = solutions.fields.getByName(name);
        if (f) solutions.fields.remove(f);
      }
      app.save(solutions);
    } catch (e) {
      /* kollektionen saknas */
    }
  }
);
