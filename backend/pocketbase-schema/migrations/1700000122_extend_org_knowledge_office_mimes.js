/// <reference path="../pb_data/types.d.ts" />

// Vidgar `org_knowledge.file`-fältets mime-whitelist till att även acceptera
// Word (DOCX) och PowerPoint (PPTX), CLAUDE.md § 26. Texten extraheras nu
// dependency-fritt ur OOXML (lib/import/zip.ts + lib/import/ooxml-text.ts via
// lib/ai/attachments.ts) — tidigare måste presentationer/Word exporteras till
// PDF först. user_files (§ 27) accepterade redan dessa typer (migration
// 1700000085); detta är paritet för den tenant-breda kunskapsbasen.
//
// Oföränderlig migration (nytt filnummer per § 10.3 A.8.32). Ingen ny
// datakategori, ingen ny PII-väg — extraktionen personnummer-saneras som
// övriga format (lib/ai/knowledge.ts).

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('org_knowledge');
    const field = collection.fields.getByName('file');
    if (field) {
      const set = new Set(field.mimeTypes || []);
      set.add(MIME_DOCX);
      set.add(MIME_PPTX);
      field.mimeTypes = Array.from(set);
      app.save(collection);
    }
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('org_knowledge');
    const field = collection.fields.getByName('file');
    if (field) {
      field.mimeTypes = (field.mimeTypes || []).filter(
        (m) => m !== MIME_DOCX && m !== MIME_PPTX
      );
      app.save(collection);
    }
  }
);
