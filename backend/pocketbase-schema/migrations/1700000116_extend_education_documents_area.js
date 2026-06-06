/// <reference path="../pb_data/types.d.ts" />

// Kopplar utbildningsdokument (education_documents, migration 1700000088) till
// ett OMRÅDE (workshop_areas, migration 1700000045) — precis som workshops kan
// grupperas per område. Fältet är valfritt (ett dokument kan sakna område och
// hamnar då i "Övriga"). cascadeDelete=false: tas ett område bort behålls
// dokumentet (relationen nollställs i server-actionen, samma mönster som
// workshops.area). Ingen PII, ingen AI-inferens → minimal riskklass
// (CLAUDE.md § 18.3). Rör inga API-regler.
//
// Oföränderlighet (ISO 27001 A.8.32): NY migration, befintliga rörs ej.

const DOC_AREA_INDEX =
  'CREATE INDEX idx_education_documents_tenant_area ON education_documents (tenant, area)';

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('education_documents');
    if (!collection.fields.getByName('area')) {
      collection.fields.add(
        new Field({
          name: 'area',
          type: 'relation',
          required: false,
          collectionId: 'workshop_areas_collection',
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        })
      );
    }
    if (!collection.indexes.includes(DOC_AREA_INDEX)) {
      collection.indexes.push(DOC_AREA_INDEX);
    }
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('education_documents');
    const areaField = collection.fields.getByName('area');
    if (areaField) collection.fields.remove(areaField);
    collection.indexes = collection.indexes.filter((idx) => idx !== DOC_AREA_INDEX);
    app.save(collection);
  }
);
