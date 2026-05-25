/// <reference path="../pb_data/types.d.ts" />

// Djupa jobb / subagent-orkestrering. En bakgrundskörning som planerar en
// uppgift, fan-out:ar read-only sub-körningar (mirror av §16.7 coordinator
// fan-out) och syntetiserar ett UTKAST i en chatt-tråd. Auto-publicerar
// ALDRIG — människa-i-loopen (EU AI Act art. 14 / CLAUDE.md § 10).
//
// CLAUDE.md § 10.1: riskklass BEGRÄNSAD (read-only analys-orkestrering,
// utkast granskas av människa). Robusthet (art. 15): bundna tak i
// runnern (MAX_SUBTASKS, per-subtask maxIterations, total token-budget,
// wall-clock). § 10.2 (GDPR): owner + thread cascadeDelete (art. 17);
// `error` PII-fri. Denylistad i lib/ai/schema.ts.

const ANY_AUTH = '@request.auth.id != ""';
const OWNER_MATCH = '@request.auth.id = owner';
const TENANT_MATCH = '@request.auth.tenant = tenant';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');
    const threadsCol = app.findCollectionByNameOrId('chat_threads');

    const collection = new Collection({
      id: 'deep_jobs_col',
      name: 'deep_jobs',
      type: 'base',
      fields: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: tenantsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'owner',
          type: 'relation',
          required: true,
          collectionId: usersCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'thread',
          type: 'relation',
          required: true,
          collectionId: threadsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'instruction', type: 'text', required: true, max: 4000 },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['queued', 'planning', 'running', 'aggregating', 'succeeded', 'failed', 'cancelled']
        },
        { name: 'plan', type: 'json', required: false, maxSize: 100000 },
        { name: 'progress', type: 'number', required: false },
        { name: 'subtask_runs', type: 'json', required: false, maxSize: 50000 },
        { name: 'tokens_in', type: 'number', required: false },
        { name: 'tokens_out', type: 'number', required: false },
        { name: 'cost_estimate_usd', type: 'number', required: false },
        { name: 'error', type: 'text', required: false, max: 1000 },
        { name: 'started_at', type: 'date', required: false },
        { name: 'completed_at', type: 'date', required: false }
      ],
      indexes: [
        'CREATE INDEX idx_dj_owner ON deep_jobs (owner)',
        'CREATE INDEX idx_dj_tenant ON deep_jobs (tenant)',
        'CREATE INDEX idx_dj_thread ON deep_jobs (thread)'
      ],
      // Strikt ägaren-bara (samma som chat_threads). Runnern kör som
      // superuser i bakgrunden men sätter owner explicit.
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`
    });

    app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('deep_jobs'));
    } catch (e) {
      /* ignore */
    }
  }
);
