import 'server-only';
import type PocketBase from 'pocketbase';
import {
  composeFilter,
  getExposedCollection,
  maskRecord,
  type ExposedCollection
} from './schema';
import type { MistralToolCall, MistralToolDefinition } from './mistral';
import {
  agentWritableFields,
  agentCreatableCollections,
  createActivity,
  updateActivityField,
  updateStartupField,
  type Actor,
  type StartupWritableField
} from '@/lib/core/write';

const MAX_RESULT_ROWS = 50;
const MAX_FIELD_LENGTH = 400;
const MAX_FILTER_LENGTH = 500;
const MAX_SORT_LENGTH = 200;
const MAX_EXPAND_LENGTH = 200;

/**
 * Bygger Mistral-tool-definitionerna för en chatt-session. Tar emot
 * vilken actor som ska köra dem så att skrivverktyg bara exponeras
 * när actor är en agent — och då filtrerade till agentens whitelist
 * (`lib/core/write/writable-fields.ts`). UI-vägen använder formulär
 * för skrivning, så `user`-actorn får bara read-only här.
 *
 * Det delade skrivlagret är källan av sanning: även om en LLM skulle
 * gissa fram ett extra fält i `update_startup_field` blockerar kärnan
 * det innan något skrivs. Tool-schemat är hint för modellen, inte
 * säkerhetsgränsen.
 */
export interface BuildToolsOptions {
  actor?: Actor;
}

export function buildChatTools(
  collections: ExposedCollection[],
  options: BuildToolsOptions = {}
): MistralToolDefinition[] {
  const collectionNames = collections.map((c) => c.name);
  const tools: MistralToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'query_collection',
        description:
          'Frågar en PocketBase-kollektion. Tenant-scope läggs till automatiskt server-side. ' +
          'Filter använder PocketBase-syntax: `field = "x"`, `field > 5`, `field ~ "sök"` (innehåller), ' +
          '`field ?= "x"` (matchar något i multi-relation), `relation.field = "x"`, kombinera med && och ||.',
        parameters: {
          type: 'object',
          properties: {
            collection: {
              type: 'string',
              enum: collectionNames,
              description: 'Namn på kollektionen att fråga'
            },
            filter: {
              type: 'string',
              description:
                'PocketBase-filteruttryck (utan tenant — det läggs till automatiskt). ' +
                'Exempel: `name ~ "Enava"`, `phase = "incubation" && irl_level >= 5`. ' +
                'Lämna tomt för alla rader (max 50).'
            },
            sort: {
              type: 'string',
              description:
                'Sortering, t.ex. `-created` eller `name,phase`. Prefix `-` = fallande.'
            },
            limit: {
              type: 'integer',
              description: `Max antal rader (1-${MAX_RESULT_ROWS}, default 20)`,
              minimum: 1,
              maximum: MAX_RESULT_ROWS
            },
            fields: {
              type: 'string',
              description:
                'Komma-separerad lista av fält att hämta. Lämna tomt för alla. ' +
                'Använd `expand.relation.field` för utökade relationer.'
            },
            expand: {
              type: 'string',
              description:
                'Komma-separerade relationer att expandera, t.ex. `startup,investor`.'
            }
          },
          required: ['collection']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'count_collection',
        description:
          'Räknar antalet rader i en kollektion som matchar ett filter. Tenant-scope läggs till automatiskt.',
        parameters: {
          type: 'object',
          properties: {
            collection: {
              type: 'string',
              enum: collectionNames,
              description: 'Namn på kollektionen'
            },
            filter: {
              type: 'string',
              description: 'PocketBase-filteruttryck (tenant läggs till automatiskt)'
            }
          },
          required: ['collection']
        }
      }
    }
  ];

  // Skrivverktyg — bara för agenter. Det delade lagret enforcer:ar
  // whitelist + validering oavsett vad modellen försöker, men vi
  // exponerar bara fält som är `allow` så modellen inte ens behöver
  // gissa.
  if (options.actor?.kind === 'agent') {
    const startupFields = agentWritableFields('startups');
    if (startupFields.length > 0) {
      tools.push({
        type: 'function',
        function: {
          name: 'update_startup_field',
          description:
            'Uppdaterar ETT fält på en startup. Använd när coachen ber dig ' +
            'notera nästa steg, justera IRL-nivå eller liknande. Varje skrivning ' +
            'loggas i agent_actions och kan rullas tillbaka av staff.',
          parameters: {
            type: 'object',
            properties: {
              startupId: {
                type: 'string',
                description: 'PocketBase-id för bolaget (samma som visas i query_collection-svar)'
              },
              field: {
                type: 'string',
                enum: startupFields,
                description: 'Vilket fält som ska uppdateras'
              },
              value: {
                description:
                  'Nytt värde. För `next_step`: kort fritext (max 500 tecken). ' +
                  'För `irl_level`: heltal 1–9 eller null för att rensa.'
              }
            },
            required: ['startupId', 'field', 'value']
          }
        }
      });
    }

    const activityFields = agentWritableFields('activities');
    if (activityFields.length > 0) {
      tools.push({
        type: 'function',
        function: {
          name: 'update_activity_field',
          description:
            'Uppdaterar ETT fält på en befintlig aktivitet (title, description ' +
            'eller status). Använd för att t.ex. markera en uppgift som klar ' +
            '(status="done") eller justera en notering. Varje skrivning loggas ' +
            'i agent_actions och kan rullas tillbaka av staff.',
          parameters: {
            type: 'object',
            properties: {
              activityId: {
                type: 'string',
                description: 'PocketBase-id för aktiviteten (slå upp via query_collection)'
              },
              field: {
                type: 'string',
                enum: activityFields,
                description: 'Vilket fält som ska uppdateras'
              },
              value: {
                description:
                  'Nytt värde. För `status`: en av planned, in_progress, done, cancelled. ' +
                  'För `title`: kort text (max 200 tecken). För `description`: text (max 2000 tecken).'
              }
            },
            required: ['activityId', 'field', 'value']
          }
        }
      });
    }

    if (agentCreatableCollections().includes('activities')) {
      tools.push({
        type: 'function',
        function: {
          name: 'create_startup_activity',
          description:
            'Skapar en aktivitet (anteckning, möte eller manuellt event) kopplat ' +
            'till en startup. Använd för att logga en sammanfattning av samtalet, ' +
            'en planerad åtgärd eller en mötesnotering. Skapas alltid med staff/agent ' +
            'som ägare och dagens datum.',
          parameters: {
            type: 'object',
            properties: {
              startupId: {
                type: 'string',
                description: 'PocketBase-id för bolaget'
              },
              kind: {
                type: 'string',
                enum: ['manual', 'note', 'meeting'],
                description: 'Typ av aktivitet'
              },
              title: {
                type: 'string',
                description: 'Kort titel (max 200 tecken)'
              },
              description: {
                type: 'string',
                description: 'Längre brödtext (valfritt, max 2000 tecken)'
              }
            },
            required: ['startupId', 'kind', 'title']
          }
        }
      });
    }
  }

  return tools;
}

export interface ToolDispatchContext {
  pb: PocketBase;
  tenantId: string;
  collections: ExposedCollection[];
  /**
   * Actor som verktyget körs som. Required när skrivverktyg används —
   * kärnlagret läser actor.kind för att applicera rätt whitelist. För
   * read-only-verktyg ignoreras fältet (tenant räcker).
   */
  actor?: Actor;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

function validateFilter(filter: string): string | null {
  if (filter.length > MAX_FILTER_LENGTH) return 'Filter för långt.';
  if (/@request\b/i.test(filter)) return 'Filter får inte innehålla @request.';
  if (/@collection\b/i.test(filter)) return 'Filter får inte innehålla @collection.';
  return null;
}

function truncateValue(value: unknown): unknown {
  if (typeof value === 'string' && value.length > MAX_FIELD_LENGTH) {
    return value.slice(0, MAX_FIELD_LENGTH) + '…';
  }
  if (Array.isArray(value)) {
    return value.map(truncateValue);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = truncateValue(v);
    }
    return out;
  }
  return value;
}

async function runQueryCollection(
  args: Record<string, unknown>,
  ctx: ToolDispatchContext
): Promise<ToolResult> {
  const collectionName = String(args.collection ?? '');
  const collection = getExposedCollection(ctx.collections, collectionName);
  if (!collection) {
    const available = ctx.collections.map((c) => c.name).join(', ');
    return {
      ok: false,
      error: `Kollektion '${collectionName}' är inte exponerad. Välj från: ${available}`
    };
  }

  const modelFilter = typeof args.filter === 'string' ? args.filter.trim() : '';
  if (modelFilter) {
    const err = validateFilter(modelFilter);
    if (err) return { ok: false, error: err };
  }

  const sort = typeof args.sort === 'string' ? args.sort.trim().slice(0, MAX_SORT_LENGTH) : undefined;
  const expand =
    typeof args.expand === 'string' ? args.expand.trim().slice(0, MAX_EXPAND_LENGTH) : undefined;
  const fields =
    typeof args.fields === 'string' ? args.fields.trim().slice(0, MAX_EXPAND_LENGTH) : undefined;

  let limit = 20;
  if (typeof args.limit === 'number' && Number.isFinite(args.limit)) {
    limit = Math.max(1, Math.min(MAX_RESULT_ROWS, Math.floor(args.limit)));
  }

  const finalFilter = composeFilter(collection, ctx.tenantId, modelFilter);

  try {
    const result = await ctx.pb.collection(collection.name).getList(1, limit, {
      filter: finalFilter || undefined,
      sort: sort || undefined,
      expand: expand || undefined,
      fields: fields || undefined
    });

    const items = result.items.map((item: Record<string, unknown>) => {
      const masked = maskRecord(item, collection);
      return truncateValue(masked) as Record<string, unknown>;
    });

    return {
      ok: true,
      data: {
        collection: collection.name,
        total: result.totalItems,
        returned: items.length,
        items
      }
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Okänt fel vid query.'
    };
  }
}

async function runCountCollection(
  args: Record<string, unknown>,
  ctx: ToolDispatchContext
): Promise<ToolResult> {
  const collectionName = String(args.collection ?? '');
  const collection = getExposedCollection(ctx.collections, collectionName);
  if (!collection) {
    const available = ctx.collections.map((c) => c.name).join(', ');
    return {
      ok: false,
      error: `Kollektion '${collectionName}' är inte exponerad. Välj från: ${available}`
    };
  }

  const modelFilter = typeof args.filter === 'string' ? args.filter.trim() : '';
  if (modelFilter) {
    const err = validateFilter(modelFilter);
    if (err) return { ok: false, error: err };
  }

  const finalFilter = composeFilter(collection, ctx.tenantId, modelFilter);

  try {
    const result = await ctx.pb.collection(collection.name).getList(1, 1, {
      filter: finalFilter || undefined,
      fields: 'id'
    });
    return {
      ok: true,
      data: { collection: collection.name, count: result.totalItems }
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Okänt fel vid count.'
    };
  }
}

export async function dispatchToolCall(
  call: MistralToolCall,
  ctx: ToolDispatchContext
): Promise<ToolResult> {
  let args: Record<string, unknown> = {};
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    return { ok: false, error: `Ogiltig JSON i tool-argument: ${call.function.arguments}` };
  }

  switch (call.function.name) {
    case 'query_collection':
      return runQueryCollection(args, ctx);
    case 'count_collection':
      return runCountCollection(args, ctx);
    case 'update_startup_field':
      return runUpdateStartupField(args, ctx);
    case 'create_startup_activity':
      return runCreateStartupActivity(args, ctx);
    case 'update_activity_field':
      return runUpdateActivityField(args, ctx);
    default:
      return { ok: false, error: `Okänt verktyg: ${call.function.name}` };
  }
}

function requireAgentActor(ctx: ToolDispatchContext): Actor | { error: string } {
  if (!ctx.actor || ctx.actor.kind !== 'agent') {
    return { error: 'Skrivverktyg får bara köras från en agent-kontext.' };
  }
  return ctx.actor;
}

async function runUpdateStartupField(
  args: Record<string, unknown>,
  ctx: ToolDispatchContext
): Promise<ToolResult> {
  const actor = requireAgentActor(ctx);
  if ('error' in actor) return { ok: false, error: actor.error };

  const startupId = typeof args.startupId === 'string' ? args.startupId.trim() : '';
  const field = typeof args.field === 'string' ? args.field.trim() : '';
  if (!startupId) return { ok: false, error: 'startupId saknas.' };
  if (!field) return { ok: false, error: 'field saknas.' };

  const result = await updateStartupField(ctx.pb, actor, {
    startupId,
    field: field as StartupWritableField,
    value: args.value
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return {
    ok: true,
    data: {
      startupId: result.value.startupId,
      field: result.value.field,
      before: result.value.before,
      after: result.value.after,
      logged_in: 'agent_actions'
    }
  };
}

async function runCreateStartupActivity(
  args: Record<string, unknown>,
  ctx: ToolDispatchContext
): Promise<ToolResult> {
  const actor = requireAgentActor(ctx);
  if ('error' in actor) return { ok: false, error: actor.error };

  const startupId = typeof args.startupId === 'string' ? args.startupId.trim() : '';
  const kind = typeof args.kind === 'string' ? args.kind.trim() : '';
  const title = typeof args.title === 'string' ? args.title : '';
  const description = typeof args.description === 'string' ? args.description : undefined;

  if (!startupId) return { ok: false, error: 'startupId saknas.' };

  const result = await createActivity(ctx.pb, actor, {
    startupId,
    kind: kind as 'manual' | 'note' | 'meeting',
    title,
    description
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return {
    ok: true,
    data: {
      activityId: result.value.activityId,
      startupId: result.value.startupId,
      kind: result.value.kind,
      logged_in: 'agent_actions'
    }
  };
}

async function runUpdateActivityField(
  args: Record<string, unknown>,
  ctx: ToolDispatchContext
): Promise<ToolResult> {
  const actor = requireAgentActor(ctx);
  if ('error' in actor) return { ok: false, error: actor.error };

  const activityId = typeof args.activityId === 'string' ? args.activityId.trim() : '';
  const field = typeof args.field === 'string' ? args.field.trim() : '';
  if (!activityId) return { ok: false, error: 'activityId saknas.' };
  if (field !== 'title' && field !== 'description' && field !== 'status') {
    return { ok: false, error: "field måste vara 'title', 'description' eller 'status'." };
  }

  const result = await updateActivityField(ctx.pb, actor, {
    activityId,
    field: field as 'title' | 'description' | 'status',
    value: args.value
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return {
    ok: true,
    data: {
      activityId: result.value.activityId,
      field: result.value.field,
      before: result.value.before,
      after: result.value.after,
      logged_in: 'agent_actions'
    }
  };
}

export { type ExposedCollection };
