import 'server-only';
import type PocketBase from 'pocketbase';
import {
  composeFilter,
  getExposedCollection,
  maskRecord,
  type ExposedCollection
} from './schema';
import type { MistralToolCall, MistralToolDefinition } from './mistral';

const MAX_RESULT_ROWS = 50;
const MAX_FIELD_LENGTH = 400;
const MAX_FILTER_LENGTH = 500;
const MAX_SORT_LENGTH = 200;
const MAX_EXPAND_LENGTH = 200;

/**
 * Builds Mistral tool definitions for the current set of exposed collections.
 * The collection enum is generated from the live discovery so new
 * PocketBase tables show up automatically.
 */
export function buildChatTools(collections: ExposedCollection[]): MistralToolDefinition[] {
  const collectionNames = collections.map((c) => c.name);

  return [
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
}

interface ToolDispatchContext {
  pb: PocketBase;
  tenantId: string;
  collections: ExposedCollection[];
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
    default:
      return { ok: false, error: `Okänt verktyg: ${call.function.name}` };
  }
}

export { type ExposedCollection };
