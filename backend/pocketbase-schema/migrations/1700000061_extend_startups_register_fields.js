/// <reference path="../pb_data/types.d.ts" />

// Utökar startups-collectionen med Movexum Bolagslista-fält (Excel-arket
// med 40 kolumner) så att AI-agenter och bolagskortet kan svara på frågor
// om hela registret, inte bara grundinfo.
//
// Källa: CLAUDE.md § 9.4 (datamodell) + § 10.5 (PR-checklista).
//
// GDPR-anteckning:
//   - `phone` är PII — exkluderas från AI-prompts (se context.ts svartlista).
//   - `founder_gender` + `founder_identifies_as` är art. 9 särskild kategori
//     (kan avslöja etnicitet/läggning) — explicit blockerade i AI-kontext,
//     rättslig grund = berättigat intresse + samtycke vid intag (Vinnova-
//     statistik). DPIA-referens i CLAUDE.md § 10.2.
//   - Person nr lagras INTE.

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('startups');

    const addText = (name, max, opts = {}) => {
      if (!collection.fields.getByName(name)) {
        collection.fields.add(
          new Field({
            name,
            type: 'text',
            required: false,
            max,
            ...opts
          })
        );
      }
    };

    const addBool = (name) => {
      if (!collection.fields.getByName(name)) {
        collection.fields.add(
          new Field({
            name,
            type: 'bool',
            required: false
          })
        );
      }
    };

    const addDate = (name) => {
      if (!collection.fields.getByName(name)) {
        collection.fields.add(
          new Field({
            name,
            type: 'date',
            required: false
          })
        );
      }
    };

    addText('idea_name', 200);
    addText('case_type', 100);

    if (!collection.fields.getByName('status_completion_pct')) {
      collection.fields.add(
        new Field({
          name: 'status_completion_pct',
          type: 'number',
          required: false,
          min: 0,
          max: 100
        })
      );
    }

    addDate('company_registered_at');
    addDate('contacted_at');

    // PII — ej i AI-kontext.
    addText('phone', 30);

    addBool('signed_incubator_agreement');
    addDate('signed_incubator_agreement_at');
    addBool('signed_nda');
    addDate('signed_nda_at');

    // GDPR art. 9 särskild kategori — ej i AI-kontext.
    if (!collection.fields.getByName('founder_gender')) {
      collection.fields.add(
        new Field({
          name: 'founder_gender',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: ['kvinna', 'man', 'icke_binar', 'uppger_ej']
        })
      );
    }

    addBool('potential_bc_case');

    // GDPR art. 9 särskild kategori — ej i AI-kontext.
    addText('founder_identifies_as', 200);

    addBool('signed_bc_agreement');
    addDate('signed_bc_agreement_at');

    addText('preliminary_exit', 200);

    addBool('is_deeptech');
    addBool('meets_excellence_criteria');

    addText('inflow_source', 200);

    addBool('approved_state_aid_art22');
    addText('area', 200);

    addBool('signed_vinnova_incubation_approval');
    addDate('signed_vinnova_incubation_approval_at');

    addBool('approved_de_minimis');

    addText('sent_to', 200);

    if (!collection.fields.getByName('register_notes')) {
      collection.fields.add(
        new Field({
          name: 'register_notes',
          type: 'editor',
          required: false
        })
      );
    }

    addBool('is_regional');
    addBool('signed_partner_agreement');
    addDate('signed_partner_agreement_at');

    const existingIndexes = new Set(collection.indexes || []);
    const newIndexes = [
      'CREATE INDEX idx_startups_company_registered_at ON startups (company_registered_at)',
      'CREATE INDEX idx_startups_is_deeptech ON startups (is_deeptech)',
      'CREATE INDEX idx_startups_is_regional ON startups (is_regional)',
      'CREATE INDEX idx_startups_case_type ON startups (case_type)'
    ];
    for (const idx of newIndexes) {
      if (!existingIndexes.has(idx)) {
        collection.indexes.push(idx);
      }
    }

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('startups');
    const removed = [
      'idea_name',
      'case_type',
      'status_completion_pct',
      'company_registered_at',
      'contacted_at',
      'phone',
      'signed_incubator_agreement',
      'signed_incubator_agreement_at',
      'signed_nda',
      'signed_nda_at',
      'founder_gender',
      'potential_bc_case',
      'founder_identifies_as',
      'signed_bc_agreement',
      'signed_bc_agreement_at',
      'preliminary_exit',
      'is_deeptech',
      'meets_excellence_criteria',
      'inflow_source',
      'approved_state_aid_art22',
      'area',
      'signed_vinnova_incubation_approval',
      'signed_vinnova_incubation_approval_at',
      'approved_de_minimis',
      'sent_to',
      'register_notes',
      'is_regional',
      'signed_partner_agreement',
      'signed_partner_agreement_at'
    ];
    for (const name of removed) {
      const field = collection.fields.getByName(name);
      if (field) collection.fields.remove(field.id);
    }
    const droppedNames = [
      'idx_startups_company_registered_at',
      'idx_startups_is_deeptech',
      'idx_startups_is_regional',
      'idx_startups_case_type'
    ];
    collection.indexes = (collection.indexes || []).filter(
      (sql) => !droppedNames.some((n) => sql.includes(n))
    );
    return app.save(collection);
  }
);
