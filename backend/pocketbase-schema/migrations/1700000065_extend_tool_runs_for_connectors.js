/// <reference path="../pb_data/types.d.ts" />

// Utökar `tool_runs` med två valfria fält så vi kan spara chat-körningar
// mot Mistral-connectors (built-ins och MCP) — utan att kräva en
// `tool`-rad. När `connector_kind` är satt agerar runs:en som en
// connector-chatt; `tool`-relationen lämnas null.
//
// CLAUDE.md § 10.1 (EU AI Act art. 13): connector_kind + connector_id
// loggas på varje körning så vi alltid kan rekonstruera vilken AI-yta
// som faktiskt genererade output.

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('tool_runs');

    // Gör `tool`-relationen valfri (var tidigare required) eftersom
    // connector-körningar inte har en parent tool.
    const toolField = collection.fields.getByName('tool');
    if (toolField) {
      toolField.required = false;
    }

    collection.fields.add(
      new Field({
        name: 'connector_kind',
        type: 'select',
        required: false,
        maxSelect: 1,
        values: ['builtin', 'mcp']
      })
    );
    collection.fields.add(
      new Field({
        name: 'connector_id',
        type: 'text',
        required: false,
        max: 120
      })
    );

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('tool_runs');
    for (const name of ['connector_kind', 'connector_id']) {
      const field = collection.fields.getByName(name);
      if (field) collection.fields.remove(field.id);
    }
    const toolField = collection.fields.getByName('tool');
    if (toolField) {
      toolField.required = true;
    }
    return app.save(collection);
  }
);
