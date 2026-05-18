/// <reference path="../pb_data/types.d.ts" />

// Extends tool_runs with chat-mode storage:
//   - `messages` (json): ToolRunMessage[] — full conversation incl. system/user/assistant turns
//   - `attachments` (file): user-uploaded files (images, PDFs, text) per chat
//
// Backwards-compatible: legacy runs (no `messages`) still render via `output_md`.

migrate(
  (app) => {
    const tr = app.findCollectionByNameOrId('tool_runs');

    tr.fields.add(
      new Field({
        name: 'messages',
        type: 'json',
        required: false,
        maxSize: 2000000
      })
    );

    tr.fields.add(
      new Field({
        name: 'attachments',
        type: 'file',
        required: false,
        maxSelect: 50,
        maxSize: 10485760, // 10 MB per fil
        mimeTypes: [
          'image/png',
          'image/jpeg',
          'image/webp',
          'application/pdf',
          'text/plain',
          'text/markdown',
          'text/csv'
        ]
      })
    );

    return app.save(tr);
  },
  (app) => {
    const tr = app.findCollectionByNameOrId('tool_runs');
    ['messages', 'attachments'].forEach((name) => {
      const f = tr.fields.getByName(name);
      if (f) tr.fields.remove(f.id);
    });
    return app.save(tr);
  }
);
