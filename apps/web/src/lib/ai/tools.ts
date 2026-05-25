import 'server-only';
import type PocketBase from 'pocketbase';
import {
  composeFilter,
  getExposedCollection,
  maskRecord,
  type ExposedCollection
} from './schema';
import type { MistralToolCall, MistralToolDefinition } from './mistral';
import { escFilter } from '@/lib/pb-filter';
import type { GeneratedFileRef } from '@platform/shared';
import { renderDocument, validateDocumentSpec } from '@/lib/documents';
import { saveGeneratedFile } from '@/lib/documents/save';
import {
  agentWritableFields,
  agentCreatableCollections,
  createActivity,
  updateActivityField,
  updateStartupField,
  type Actor,
  type StartupWritableField
} from '@/lib/core/write';

const AGENT_MEMORY_COLLECTION = 'agent_memory';
const MAX_MEMORY_KEY = 200;
const MAX_MEMORY_CONTENT = 8000;
const MAX_MEMORY_ROWS = 50;

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
  /**
   * Exponera agentens tvärsessions-minne. `memory_read` läggs till när
   * detta är true; `memory_write` bara när actor dessutom är en agent
   * (interaktiv staff-chatt). Sätt bara true för staff-drivna körningar —
   * collectionens API-regler är staff-only (migration 1700000079).
   */
  includeMemory?: boolean;
  /**
   * Exponera `generate_document` (PPTX/XLSX/DOCX/PDF). Bara för agent-actor
   * i en interaktiv yta där en människa laddar ned/granskar utkastet. Filen
   * sparas i ägarens `user_files` (strikt ägaren-bara) och bifogas svaret.
   */
  includeDocuments?: boolean;
  /**
   * Exponera domänskriv-verktyg (update_startup_field, create_startup_activity,
   * update_activity_field). Default: true när actor är en agent (interaktiv
   * staff-chatt med människa-i-loopen). Sätt false för autonoma körningar
   * (djupa jobb) som får läsa + generera dokument men ALDRIG mutera domändata
   * (§ 16.3 människa-i-loopen).
   */
  includeWrites?: boolean;
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

  // Skrivverktyg — bara för agenter, och bara när includeWrites inte är
  // explicit false (autonoma djupa jobb stänger av domänskrivning men
  // behåller läsning/dokument). Det delade lagret enforcer:ar whitelist +
  // validering oavsett vad modellen försöker.
  if (options.actor?.kind === 'agent' && options.includeWrites !== false) {
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

  // Tvärsessions-minne (Fas 2). memory_read är read-only och kan ges till
  // autonoma staff-körningar; memory_write kräver agent-actor (interaktiv
  // staff-chatt med människa-i-loopen).
  if (options.includeMemory) {
    tools.push({
      type: 'function',
      function: {
        name: 'memory_read',
        description:
          'Läser agentens tvärsessions-minne för denna tenant. Utan `key` ' +
          'listas alla minnesnycklar med innehåll; med `key` returneras just ' +
          'den noteringen. Använd för att minnas tidigare slutsatser eller ' +
          'pågående trådar mellan körningar.',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Valfri nyckel att läsa. Lämna tomt för att lista allt.'
            }
          }
        }
      }
    });
    if (options.actor?.kind === 'agent' && options.includeWrites !== false) {
      tools.push({
        type: 'function',
        function: {
          name: 'memory_write',
          description:
            'Sparar/uppdaterar en notering i agentens tvärsessions-minne (per ' +
            'tenant). Använd för slutsatser värda att minnas till nästa körning. ' +
            'Lagra ALDRIG personuppgifter — bara aggregerade observationer. ' +
            'Skriver över en befintlig nyckel.',
          parameters: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'Kort nyckel/rubrik (max 200 tecken), t.ex. "portfölj/risker".'
              },
              content: {
                type: 'string',
                description: 'Innehåll att spara (max 8000 tecken).'
              }
            },
            required: ['key', 'content']
          }
        }
      });
    }
  }

  // Dokumentgenerering (PPTX/XLSX/DOCX/PDF). Bara agent-actor i en
  // interaktiv yta där en människa laddar ned/granskar (människa-i-loopen,
  // § 10). Modellen levererar ett TYPAT spec; servern renderar
  // deterministiskt → inga hallucinerade siffror.
  if (options.includeDocuments && options.actor?.kind === 'agent') {
    tools.push({
      type: 'function',
      function: {
        name: 'generate_document',
        description:
          'Skapar ett nedladdningsbart dokument (PowerPoint/Excel/Word/PDF) av ' +
          'sammanställd data. VIKTIGT: alla siffror och fakta MÅSTE komma från ' +
          'tidigare query_collection-svar i denna konversation — hitta ALDRIG på ' +
          'data. Systemet renderar filen deterministiskt från ditt spec och sparar ' +
          'den i användarens privata Filer samt bifogar den som nedladdning. ' +
          'Använd `slides` för pptx, `sheets` för xlsx, `sections` för docx/pdf.',
        parameters: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['pptx', 'xlsx', 'docx', 'pdf'],
              description: 'Filformat'
            },
            title: { type: 'string', description: 'Dokumentets titel (visas på försättssidan)' },
            subtitle: { type: 'string', description: 'Valfri undertitel' },
            slides: {
              type: 'array',
              description: 'PPTX: en post per slide.',
              items: {
                type: 'object',
                properties: {
                  layout: { type: 'string', enum: ['title', 'content', 'table', 'chart'] },
                  heading: { type: 'string' },
                  subheading: { type: 'string' },
                  bullets: { type: 'array', items: { type: 'string' } },
                  table: {
                    type: 'object',
                    properties: {
                      columns: { type: 'array', items: { type: 'string' } },
                      rows: { type: 'array', items: { type: 'array', items: {} } }
                    }
                  },
                  chart: {
                    type: 'object',
                    properties: {
                      type: { type: 'string', enum: ['bar', 'line', 'pie'] },
                      categories: { type: 'array', items: { type: 'string' } },
                      series: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            name: { type: 'string' },
                            values: { type: 'array', items: { type: 'number' } }
                          }
                        }
                      }
                    }
                  },
                  notes: { type: 'string' }
                },
                required: ['layout']
              }
            },
            sheets: {
              type: 'array',
              description: 'XLSX: ett blad per post. rows[] är rader med värden i kolumnordning.',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  columns: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        key: { type: 'string' },
                        label: { type: 'string' },
                        type: { type: 'string', enum: ['text', 'number', 'currency', 'date'] }
                      },
                      required: ['key', 'label']
                    }
                  },
                  rows: { type: 'array', items: { type: 'array', items: {} } },
                  totals: { type: 'array', items: {} }
                },
                required: ['name', 'columns', 'rows']
              }
            },
            sections: {
              type: 'array',
              description: 'DOCX/PDF: en post per sektion.',
              items: {
                type: 'object',
                properties: {
                  heading: { type: 'string' },
                  level: { type: 'integer', enum: [1, 2, 3] },
                  paragraphs: { type: 'array', items: { type: 'string' } },
                  bullets: { type: 'array', items: { type: 'string' } },
                  table: {
                    type: 'object',
                    properties: {
                      columns: { type: 'array', items: { type: 'string' } },
                      rows: { type: 'array', items: { type: 'array', items: {} } }
                    }
                  }
                }
              }
            }
          },
          required: ['kind', 'title']
        }
      }
    });
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
  /**
   * Ägare för genererade filer (`generate_document` → `user_files`). Sätts
   * av den interaktiva staff-chatten/tråden. Krävs för dokumentverktyget.
   */
  ownerUserId?: string;
  /** Tråd som ett genererat dokument knyts till (för spårbarhet). */
  chatThreadId?: string;
  /**
   * Mutabel sink: `generate_document` pushar genererade fil-referenser hit
   * så chatt-lagret kan bifoga dem på assistant-svaret (nedladdnings-chip).
   */
  generatedFiles?: GeneratedFileRef[];
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
    case 'memory_read':
      return runMemoryRead(args, ctx);
    case 'memory_write':
      return runMemoryWrite(args, ctx);
    case 'generate_document':
      return runGenerateDocument(args, ctx);
    default:
      return { ok: false, error: `Okänt verktyg: ${call.function.name}` };
  }
}

async function runMemoryRead(
  args: Record<string, unknown>,
  ctx: ToolDispatchContext
): Promise<ToolResult> {
  const key = typeof args.key === 'string' ? args.key.trim() : '';
  let filter = `tenant = "${escFilter(ctx.tenantId)}"`;
  if (key) filter += ` && key = "${escFilter(key)}"`;
  try {
    const result = await ctx.pb
      .collection(AGENT_MEMORY_COLLECTION)
      .getList(1, MAX_MEMORY_ROWS, {
        filter,
        sort: '-updated',
        fields: 'key,content,updated'
      });
    return {
      ok: true,
      data: {
        count: result.totalItems,
        items: result.items.map((m) => ({
          key: m.key,
          content: m.content,
          updated: m.updated
        }))
      }
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Kunde inte läsa minnet.'
    };
  }
}

async function runMemoryWrite(
  args: Record<string, unknown>,
  ctx: ToolDispatchContext
): Promise<ToolResult> {
  const actor = requireAgentActor(ctx);
  if ('error' in actor) return { ok: false, error: actor.error };

  const key = typeof args.key === 'string' ? args.key.trim() : '';
  const content = typeof args.content === 'string' ? args.content : '';
  if (!key) return { ok: false, error: 'key saknas.' };
  if (key.length > MAX_MEMORY_KEY) {
    return { ok: false, error: `key för lång (max ${MAX_MEMORY_KEY} tecken).` };
  }
  if (!content.trim()) return { ok: false, error: 'content saknas.' };
  if (content.length > MAX_MEMORY_CONTENT) {
    return { ok: false, error: `content för långt (max ${MAX_MEMORY_CONTENT} tecken).` };
  }

  const filter = `tenant = "${escFilter(ctx.tenantId)}" && key = "${escFilter(key)}"`;
  try {
    const existing = await ctx.pb
      .collection(AGENT_MEMORY_COLLECTION)
      .getFirstListItem(filter)
      .catch(() => null);
    if (existing) {
      await ctx.pb
        .collection(AGENT_MEMORY_COLLECTION)
        .update((existing as { id: string }).id, {
          content,
          updated_by: actor.id
        });
      return { ok: true, data: { key, action: 'updated' } };
    }
    await ctx.pb.collection(AGENT_MEMORY_COLLECTION).create({
      tenant: ctx.tenantId,
      key,
      content,
      created_by: actor.id,
      updated_by: actor.id
    });
    return { ok: true, data: { key, action: 'created' } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Kunde inte spara minnet.'
    };
  }
}

async function runGenerateDocument(
  args: Record<string, unknown>,
  ctx: ToolDispatchContext
): Promise<ToolResult> {
  const actor = requireAgentActor(ctx);
  if ('error' in actor) return { ok: false, error: actor.error };
  if (!ctx.ownerUserId) {
    return { ok: false, error: 'Dokumentgenerering kräver en inloggad ägare i kontexten.' };
  }
  const v = validateDocumentSpec(args);
  if (!v.ok) return { ok: false, error: v.error };
  try {
    const rendered = await renderDocument(v.spec);
    const ref = await saveGeneratedFile({
      pb: ctx.pb,
      tenant: ctx.tenantId,
      ownerUserId: ctx.ownerUserId,
      rendered,
      docKind: v.spec.kind,
      chatThreadId: ctx.chatThreadId
    });
    if (ctx.generatedFiles) ctx.generatedFiles.push(ref);
    return {
      ok: true,
      data: {
        user_file_id: ref.user_file_id,
        filename: ref.filename,
        kind: v.spec.kind,
        note: 'Dokumentet renderades, sparades i användarens privata Filer och bifogades svaret som nedladdning. Säg till användaren att det är klart och kan laddas ned — påstå inte att du klistrat in innehållet i chatten.'
      }
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Kunde inte generera dokumentet.'
    };
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
