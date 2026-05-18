/// <reference path="../pb_data/types.d.ts" />

// Extends the startups collection with company-register fields drawn
// from the existing Movexum Bolagslista (Excel-arket med 156 bolag):
//
//   org_nr        — svenskt organisationsnummer (XXXXXX-XXXX)
//   kommun        — hemkommun (primärt Gävleborg, fri text för flex)
//   bolagsform    — Aktiebolag / Handelsbolag / etc.
//   industri      — branschklassificering ("Mjukvara och ICT" osv).
//                   Skild från fältet `sector` som används som fri tagg.
//   intagsdatum   — när bolaget togs in i inkubatorn ("Togs in")
//   avslutsdatum  — när inkubatorrelationen avslutades ("Lämnat")
//   bolag_status  — bolagets OPERATIONELLA status (aktiv/konkurs/...),
//                   kompletterar befintliga `status` som beskriver
//                   inkubatorrelationen (active/alumni/paused/rejected).
//
// Alla fält är optional → bakåtkompatibelt mot seedade demo-bolag och
// befintliga rader. CLAUDE.md § 10.5 (PR-checklista) iakttagen:
// inga PII-fält, org_nr för aktiebolag = inte PII (GDPR skäl 14).

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('startups');

    if (!collection.fields.getByName('org_nr')) {
      collection.fields.add(
        new Field({
          name: 'org_nr',
          type: 'text',
          required: false,
          max: 12,
          pattern: '^\\d{6}-\\d{4}$'
        })
      );
    }

    if (!collection.fields.getByName('kommun')) {
      collection.fields.add(
        new Field({
          name: 'kommun',
          type: 'text',
          required: false,
          max: 100
        })
      );
    }

    if (!collection.fields.getByName('bolagsform')) {
      collection.fields.add(
        new Field({
          name: 'bolagsform',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: [
            'aktiebolag',
            'handelsbolag',
            'kommanditbolag',
            'enskild_firma',
            'ekonomisk_forening',
            'ideell_forening',
            'annat'
          ]
        })
      );
    }

    if (!collection.fields.getByName('industri')) {
      collection.fields.add(
        new Field({
          name: 'industri',
          type: 'text',
          required: false,
          max: 200
        })
      );
    }

    if (!collection.fields.getByName('intagsdatum')) {
      collection.fields.add(
        new Field({
          name: 'intagsdatum',
          type: 'date',
          required: false
        })
      );
    }

    if (!collection.fields.getByName('avslutsdatum')) {
      collection.fields.add(
        new Field({
          name: 'avslutsdatum',
          type: 'date',
          required: false
        })
      );
    }

    if (!collection.fields.getByName('bolag_status')) {
      collection.fields.add(
        new Field({
          name: 'bolag_status',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: ['aktiv', 'vilande', 'konkurs', 'likvidering', 'avregistrerat']
        })
      );
    }

    // Indexes — partial unique on (tenant, org_nr) ignorerar tomma org_nr
    // så att rader utan registernummer inte krockar.
    const existingIndexes = new Set(collection.indexes || []);
    const newIndexes = [
      'CREATE INDEX idx_startups_org_nr ON startups (org_nr)',
      "CREATE UNIQUE INDEX idx_startups_tenant_org_nr ON startups (tenant, org_nr) WHERE org_nr != ''",
      'CREATE INDEX idx_startups_kommun ON startups (kommun)',
      'CREATE INDEX idx_startups_bolag_status ON startups (bolag_status)'
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
    for (const name of [
      'org_nr',
      'kommun',
      'bolagsform',
      'industri',
      'intagsdatum',
      'avslutsdatum',
      'bolag_status'
    ]) {
      const field = collection.fields.getByName(name);
      if (field) collection.fields.remove(field.id);
    }
    const droppedNames = [
      'idx_startups_org_nr',
      'idx_startups_tenant_org_nr',
      'idx_startups_kommun',
      'idx_startups_bolag_status'
    ];
    collection.indexes = (collection.indexes || []).filter(
      (sql) => !droppedNames.some((n) => sql.includes(n))
    );
    return app.save(collection);
  }
);
