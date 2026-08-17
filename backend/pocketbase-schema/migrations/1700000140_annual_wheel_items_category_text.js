/// <reference path="../pb_data/types.d.ts" />

// Årshjul (CLAUDE.md § 30) — `annual_wheel_items.category` blir ett TEXT-fält.
//
// Kategorierna är nu dynamiska per tenant (`annual_wheel_categories`, migration
// 1700000139), så fältet kan inte längre vara ett `select` med en fast
// värdelista — en ny kategori skulle kräva en schemaändring vid varje
// tillägg. Fältet byter därför typ till `text` (samma SQLite-kolumntyp), och
// giltigheten kontrolleras i stället i det delade skrivlagret mot tenantens
// kategorier (`lib/core/write/annual-wheel.ts`).
//
// Datamigrering: fältets `id` BEHÅLLS så att PB gör en fält-UPPDATERING i
// stället för drop+create → värdena följer med. Som skyddsnät snapshottas
// alla befintliga värden före ändringen och skrivs tillbaka efteråt om någon
// rad tappat sin kategori (idempotent, kostar inget på en tom tabell).
//
// Riskklass n/a: ingen AI-inferens, ingen PII. Nytt, oföränderligt filnummer
// (§ 10.3 A.8.32). Speglas i setup-via-api.mjs.

const LEGACY_VALUES = ['styrelse', 'ledning', 'gemensamt'];

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('annual_wheel_items');
    const field = collection.fields.getByName('category');
    if (!field) return;
    if (field.type === 'text') return; // redan konverterad (idempotent)

    // 1. Snapshot av befintliga värden (id → category).
    const snapshot = [];
    try {
      const rows = app.findRecordsByFilter('annual_wheel_items', 'id != ""', '', 0, 0);
      for (const r of rows) {
        const value = r.get('category');
        if (value) snapshot.push({ id: r.id, category: String(value) });
      }
    } catch (e) {
      /* tom tabell / kollektion utan rader */
    }

    // 2. Byt typ men BEHÅLL fältets id (= fält-uppdatering, inte drop+create).
    const fieldId = field.id;
    collection.fields.removeById(fieldId);
    collection.fields.add(
      new Field({
        id: fieldId,
        name: 'category',
        type: 'text',
        required: true,
        min: 1,
        max: 40
      })
    );
    app.save(collection);

    // 3. Skyddsnät: skriv tillbaka värden som eventuellt tappades.
    for (const snap of snapshot) {
      try {
        const rec = app.findRecordById('annual_wheel_items', snap.id);
        if (!rec.get('category')) {
          rec.set('category', snap.category);
          app.save(rec);
        }
      } catch (e) {
        /* posten kan ha raderats mellan stegen — hoppa */
      }
    }
  },
  (app) => {
    // Tillbaka till select. Poster som pekar på en egendefinierad kategori
    // (utanför den gamla värdelistan) kan inte representeras av ett select —
    // de flyttas till 'gemensamt' så nedrullningen inte lämnar ogiltig data.
    const collection = app.findCollectionByNameOrId('annual_wheel_items');
    const field = collection.fields.getByName('category');
    if (!field || field.type === 'select') return;

    try {
      const rows = app.findRecordsByFilter('annual_wheel_items', 'id != ""', '', 0, 0);
      for (const r of rows) {
        if (!LEGACY_VALUES.includes(String(r.get('category') || ''))) {
          r.set('category', 'gemensamt');
          app.save(r);
        }
      }
    } catch (e) {
      /* ignore */
    }

    const fieldId = field.id;
    collection.fields.removeById(fieldId);
    collection.fields.add(
      new Field({
        id: fieldId,
        name: 'category',
        type: 'select',
        required: true,
        maxSelect: 1,
        values: LEGACY_VALUES
      })
    );
    app.save(collection);
  }
);
