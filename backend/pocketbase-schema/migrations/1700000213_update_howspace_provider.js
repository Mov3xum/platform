/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 59 — Howspace som egen sida i plattformen. Uppdaterar
// katalograden för `howspace` (seedad av 1700000055) så beskrivningen
// matchar det providern faktiskt gör: workspaces + aggregerad
// deltagarstatistik, visade på `/howspace`, inloggning via SSO direkt mot
// Howspace. Den gamla texten lovade "anonymiserade post-summaries i
// aktivitetsfeeden", som aldrig byggts. Upsertar på slug (idempotent) så en
// instans som bootstrappats utan 1700000055 också får raden.
//
// GDPR: ingen personuppgift (katalogtext). Riskklass oförändrad (begränsad).
// Ingen schemaändring → ingen spegling i setup-via-api.mjs.

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('integration_providers');
    const p = {
      slug: 'howspace',
      name: 'Howspace',
      category: 'learning',
      placeholder: 'HS',
      tagline: 'Collaborative learning & program (EU)',
      description:
        'Howspace (finskt, EU) är Movexums plattform för inkubatorprogram, workshops och kohort-lärande. Anslut Partner API:t så visas era workspaces med aggregerad deltagarstatistik på sidan Howspace i plattformen — personalen öppnar rätt workspace därifrån med ett klick (SSO mot Howspace).',
      features: [
        'Era workspaces samlade på sidan Howspace i plattformen',
        'Aggregerad deltagarstatistik (inga namn eller e-postadresser lagras)',
        'Ett klick in i rätt workspace — inloggning via SSO mot Howspace',
        'EU-suveränt — data stannar i Finland'
      ],
      availability: 'available',
      sort_order: 10
    };

    let existing = null;
    try {
      existing = app.findFirstRecordByFilter('integration_providers', 'slug = "howspace"');
    } catch (e) {
      existing = null;
    }
    if (existing) {
      existing.set('name', p.name);
      existing.set('category', p.category);
      existing.set('placeholder', p.placeholder);
      existing.set('tagline', p.tagline);
      existing.set('description', p.description);
      existing.set('features', p.features);
      existing.set('availability', p.availability);
      existing.set('sort_order', p.sort_order);
      if (existing.get('active') === undefined || existing.get('active') === null) {
        existing.set('active', true);
      }
      app.save(existing);
    } else {
      const record = new Record(col, { ...p, active: true });
      app.save(record);
    }
  },
  (app) => {
    // Ingen rollback av texten — föregående lydelse lovade funktion som inte finns.
  }
);
