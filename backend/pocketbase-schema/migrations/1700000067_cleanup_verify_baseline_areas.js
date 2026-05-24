/// <reference path="../pb_data/types.d.ts" />

// Engångs-städning av efterlämnade probe-rader från verify-baseline.mjs.
// Tidigare körningar av baseline-skriptet kunde lämna rader om delete-
// anropet failade tyst eller om processen aborterades mellan create och
// cleanup. Skriptet i sig städar nu (sweep + try/finally), men den här
// migrationen rensar ut historiska rader som redan finns i remote PB.
//
// Down-migrationen är en no-op — det går inte att återskapa rader vars
// id:n vi inte längre känner till, och själva poängen var att de aldrig
// skulle ha funnits.

migrate(
  (app) => {
    let stale;
    try {
      stale = app.findRecordsByFilter(
        'workshop_areas',
        'name ~ "__verify_baseline_"',
        '-created',
        0,
        0
      );
    } catch (err) {
      // Collection kanske inte finns ännu i en helt tom miljö (förrän
      // 1700000045 har körts). Då finns inga rader att städa heller.
      return;
    }
    for (const record of stale) {
      try {
        app.delete(record);
      } catch (err) {
        // Lämna kvar och fortsätt — bättre att städa det som går.
      }
    }
  },
  (app) => {
    // No-op: kan inte återskapa raderade probe-rader.
  }
);
