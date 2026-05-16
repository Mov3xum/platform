/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor")';

migrate(
  (app) => {
    const areasCollection = new Collection({
      id: 'workshop_areas_collection',
      name: 'workshop_areas',
      type: 'base',
      fields: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: 'tenants_collection',
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'name',
          type: 'text',
          required: true,
          min: 1,
          max: 120
        }
      ],
      indexes: ['CREATE UNIQUE INDEX idx_workshop_areas_tenant_name ON workshop_areas (tenant, name)'],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });
    app.save(areasCollection);

    const workshopsCollection = app.findCollectionByNameOrId('workshops');
    if (!workshopsCollection.fields.getByName('area')) {
      workshopsCollection.fields.add({
        name: 'area',
        type: 'relation',
        required: false,
        collectionId: 'workshop_areas_collection',
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 1
      });
      if (!workshopsCollection.fields.getByName('area')) {
        throw new Error('Kunde inte lägga till workshops.area i migration 1700000040');
      }
    }
    if (!workshopsCollection.indexes.includes('CREATE INDEX idx_workshops_tenant_area ON workshops (tenant, area)')) {
      workshopsCollection.indexes.push('CREATE INDEX idx_workshops_tenant_area ON workshops (tenant, area)');
    }
    app.save(workshopsCollection);
  },
  (app) => {
    const workshopsCollection = app.findCollectionByNameOrId('workshops');
    const areaField = workshopsCollection.fields.getByName('area');
    if (areaField) workshopsCollection.fields.remove(areaField);
    workshopsCollection.indexes = workshopsCollection.indexes.filter(
      (idx) => idx !== 'CREATE INDEX idx_workshops_tenant_area ON workshops (tenant, area)'
    );
    app.save(workshopsCollection);

    const areasCollection = app.findCollectionByNameOrId('workshop_areas');
    app.delete(areasCollection);
  }
);
