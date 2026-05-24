/// <reference path="../pb_data/types.d.ts" />

// Adds a dedicated `system_prompt` field to `tools` so each agent can carry
// its own role/scope instruction in the Mistral SYSTEM role — separate from
// `prompt_template`, which remains the data/task template rendered into the
// USER message.
//
// Why a separate field (CLAUDE.md §9.2, §10.1 art. 11):
//   - prompt_template ({{startup.*}}-mall) ≠ agent-roll. Splitting them lets
//     the immutable security preamble (prompt-injection-skydd) always wrap the
//     staff-authored role, instead of the role living inside the user turn.
//   - Only admin/incubator_lead may edit it (same gate as prompt_template),
//     enforced in the server action + the collection's updateRule (STAFF).
//
// Plain text (not editor) so the value goes verbatim into the system role
// without HTML to strip.

migrate(
  (app) => {
    const tools = app.findCollectionByNameOrId('tools');

    tools.fields.add(
      new Field({
        name: 'system_prompt',
        type: 'text',
        required: false,
        max: 20000
      })
    );

    return app.save(tools);
  },
  (app) => {
    const tools = app.findCollectionByNameOrId('tools');
    const f = tools.fields.getByName('system_prompt');
    if (f) tools.fields.remove(f.id);
    return app.save(tools);
  }
);
