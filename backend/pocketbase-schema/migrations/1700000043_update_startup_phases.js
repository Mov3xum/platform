/// <reference path="../pb_data/types.d.ts" />

const NEW_PHASES = [
  'paus',
  'inflode',
  'lead',
  'boost_chamber',
  'incubation',
  'prescale',
  'acceleration',
  'alumni'
];

const OLD_PHASES = ['idea', 'pre_revenue', 'early_revenue', 'growth', 'scale', 'exit'];

const TO_NEW_PHASE = {
  idea: 'inflode',
  pre_revenue: 'lead',
  early_revenue: 'boost_chamber',
  growth: 'incubation',
  scale: 'acceleration',
  exit: 'alumni'
};

const TO_OLD_PHASE = {
  paus: 'idea',
  inflode: 'idea',
  lead: 'pre_revenue',
  boost_chamber: 'early_revenue',
  incubation: 'growth',
  prescale: 'scale',
  acceleration: 'scale',
  alumni: 'exit'
};

function remapAllStartupRecords(app, mapTo) {
  let records = [];
  try {
    records = app.findRecordsByFilter('startups', 'id != ""', '-created', 5000, 0);
  } catch (e) {
    records = [];
  }

  for (const record of records) {
    const current = record.getString('phase');
    const mapped = mapTo[current];
    if (!mapped || mapped === current) continue;
    record.set('phase', mapped);
    app.save(record);
  }
}

migrate(
  (app) => {
    const startups = app.findCollectionByNameOrId('startups');
    const phaseField = startups.fields.getByName('phase');
    if (phaseField?.values) {
      phaseField.values = NEW_PHASES;
    }
    app.save(startups);

    remapAllStartupRecords(app, TO_NEW_PHASE);

    let pausedRecords = [];
    try {
      pausedRecords = app.findRecordsByFilter(
        'startups',
        'status = "paused" && phase != "paus"',
        '-created',
        5000,
        0
      );
    } catch (e) {
      pausedRecords = [];
    }

    for (const record of pausedRecords) {
      record.set('phase', 'paus');
      app.save(record);
    }
  },
  (app) => {
    remapAllStartupRecords(app, TO_OLD_PHASE);

    const startups = app.findCollectionByNameOrId('startups');
    const phaseField = startups.fields.getByName('phase');
    if (phaseField?.values) {
      phaseField.values = OLD_PHASES;
    }
    return app.save(startups);
  }
);
