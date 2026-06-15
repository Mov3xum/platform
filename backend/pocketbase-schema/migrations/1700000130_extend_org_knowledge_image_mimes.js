/// <reference path="../pb_data/types.d.ts" />

// Vidgar `org_knowledge.file`-fältets mime-whitelist till att även acceptera
// bilder (PNG/JPG/WebP), CLAUDE.md § 26 / § 28. En uppladdad bild har inget
// textlager — texten "extraheras" i stället via Pixtral-bildigenkänning
// (lib/ai/vision.ts via lib/ai/knowledge.ts): all synlig text transkriberas och
// icke-text-innehåll (tabeller, matriser, diagram) beskrivs till sökbar text,
// som sedan personnummer-saneras, chunkas och embeddas som vilket annat
// dokument som helst. Pixtral kör på Mistral AI:s EU-infrastruktur (samma
// leverantör/DPA, § 10.2).
//
// Oföränderlig migration (nytt filnummer per § 10.3 A.8.32). Ingen ny
// datakategori, ingen ny PII-väg — den igenkända texten saneras som övriga
// format. user_files (§ 27) accepterade redan bilder (migration 1700000085);
// detta är paritet för den tenant-breda kunskapsbasen.

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'];

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('org_knowledge');
    const field = collection.fields.getByName('file');
    if (field) {
      const set = new Set(field.mimeTypes || []);
      for (const m of IMAGE_MIMES) set.add(m);
      field.mimeTypes = Array.from(set);
      app.save(collection);
    }
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('org_knowledge');
    const field = collection.fields.getByName('file');
    if (field) {
      field.mimeTypes = (field.mimeTypes || []).filter((m) => !IMAGE_MIMES.includes(m));
      app.save(collection);
    }
  }
);
