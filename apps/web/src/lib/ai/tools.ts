import 'server-only';
import type PocketBase from 'pocketbase';
import {
  composeFilter,
  getExposedCollection,
  maskRecord,
  searchableTextFields,
  type ExposedCollection
} from './schema';
import { rankCandidates, significantTokens } from './fuzzy';
import type { MistralToolCall, MistralToolDefinition } from './mistral';
import { searchOrgKnowledge, searchUserFiles, renderKnowledgeHits } from './rag';
import { logAiUsage } from './usage';
import { escFilter } from '@/lib/pb-filter';
import { type GeneratedFileRef, FILE_TOPIC_IDS, isFileTopic } from '@platform/shared';
import { renderDocument, validateDocumentSpec } from '@/lib/documents';
import { getTemplate, listTemplateSummaries, TEMPLATE_IDS } from '@/lib/documents/templates';
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

// search_records / aggregate_collection / describe_collection
const MAX_SEARCH_LIMIT = 20;
const SEARCH_CANDIDATE_FETCH = 100; // kandidater per hämtning innan JS-ranking
const SEARCH_THRESHOLD = 0.4;
const MAX_AGG_SCAN = 500; // rader aggregeringen får skanna (robusthet § 10)
const MAX_DISTINCT_VALUES = 40;
const AGG_OPS = ['count', 'sum', 'avg', 'min', 'max'] as const;
type AggOp = (typeof AGG_OPS)[number];

// Display-fält vi försöker läsa ur en expanderad relation när group_by är en
// relation, i prioordning. Bara icke-PII-etiketter (namn/titel) — aldrig
// e-post/telefon/personnr (de maskas ändå uppströms). Faller tillbaka på id.
const GROUP_LABEL_FIELDS = ['name', 'title', 'label'] as const;

/** Etikett för en skalär (icke-relation) grupp-nyckel. */
function scalarGroupLabel(v: unknown): string {
  return v === null || v === undefined || v === '' ? '(tomt)' : String(v);
}

/**
 * Etikett för en relations-grupp: läser name/title/label ur den expanderade
 * posten så att grupperna blir läsbara namn i stället för id:n. Faller tillbaka
 * på det råa id:t om expansionen saknas (t.ex. trasig relation).
 */
function relationGroupLabel(row: Record<string, unknown>, groupBy: string): string {
  const expand = row.expand as Record<string, unknown> | undefined;
  const related = expand?.[groupBy] as Record<string, unknown> | undefined;
  if (related) {
    for (const disp of GROUP_LABEL_FIELDS) {
      const v = related[disp];
      if (typeof v === 'string' && v.trim()) return v;
    }
  }
  const raw = row[groupBy];
  return raw === null || raw === undefined || raw === '' ? '(tomt)' : String(raw);
}

// Systemfält som aldrig är meningsfulla att fuzzy-matcha mot.
const SYSTEM_RECORD_KEYS: ReadonlySet<string> = new Set([
  'id',
  'created',
  'updated',
  'collectionId',
  'collectionName',
  'expand'
]);

// Återanvändbara dokument-sub-scheman (inlineas i generate_document — undviker
// $ref/$defs som Mistral inte alltid resolvar).
const KPIS_SCHEMA = {
  type: 'array',
  description: 'Nyckeltal som stat-kort (max 4 i rad).',
  items: {
    type: 'object',
    properties: {
      label: { type: 'string' },
      value: { type: 'string', description: 'Det stora värdet, t.ex. "2,4 Mkr" eller "37 %".' },
      delta: { type: 'string', description: 'Förändring, t.ex. "+12 %".' },
      trend: { type: 'string', enum: ['up', 'down', 'flat'] },
      caption: { type: 'string' }
    },
    required: ['label', 'value']
  }
} as const;
const CALLOUT_SCHEMA = {
  type: 'object',
  description: 'Färgkodad insikts-/varningsruta.',
  properties: {
    variant: { type: 'string', enum: ['info', 'success', 'warning', 'accent'] },
    title: { type: 'string' },
    body: { type: 'string' }
  },
  required: ['body']
} as const;
const QUOTE_SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string' }, attribution: { type: 'string' } },
  required: ['text']
} as const;
const TABLE_SCHEMA = {
  type: 'object',
  properties: {
    columns: { type: 'array', items: { type: 'string' } },
    rows: { type: 'array', items: { type: 'array', items: {} } },
    emphasizeLastColumn: { type: 'boolean', description: 'Visa proportionella data-barer i sista numeriska kolumnen.' }
  }
} as const;
const CHART_SCHEMA = {
  type: 'object',
  description: 'Diagram — föredra framför långa siffertabeller för trender.',
  properties: {
    type: { type: 'string', enum: ['bar', 'hbar', 'line', 'area', 'pie', 'donut'] },
    title: { type: 'string' },
    unit: { type: 'string', description: 'Enhet på värdeaxeln, t.ex. "kr", "%".' },
    stacked: { type: 'boolean' },
    categories: { type: 'array', items: { type: 'string' } },
    series: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, values: { type: 'array', items: { type: 'number' } } }
      }
    }
  }
} as const;

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
    },
    {
      type: 'function',
      function: {
        name: 'search_records',
        description:
          'Hittar poster via FRITEXT — tolerant mot felstavning, ordföljd och ' +
          'extra ord. Använd detta FÖRST när användaren nämner en sak vid namn ' +
          '(bolag, workshop, person, dokument) i stället för att gissa ett exakt ' +
          'query_collection-filter. Returnerar de mest sannolika träffarna med en ' +
          'score (1.0 = exakt). Tenant-scope och PII-maskning läggs på automatiskt.',
        parameters: {
          type: 'object',
          properties: {
            collection: {
              type: 'string',
              enum: collectionNames,
              description: 'Kollektion att söka i'
            },
            query: {
              type: 'string',
              description:
                'Användarens egna ord, t.ex. "workshop 1 internationalisering" eller ' +
                '"enava". Behöver inte vara exakt stavat.'
            },
            limit: {
              type: 'integer',
              description: `Max antal träffar (1-${MAX_SEARCH_LIMIT}, default 8)`,
              minimum: 1,
              maximum: MAX_SEARCH_LIMIT
            }
          },
          required: ['collection', 'query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'describe_collection',
        description:
          'Beskriver en kollektions fält och giltiga enum-värden. Använd INNAN du ' +
          'filtrerar på status, fas e.d. så du filtrerar på rätt värde (t.ex. ' +
          '"active", inte "aktiv"). Ange `field` för att även få de distinkta ' +
          'värden som faktiskt förekommer i ett fält.',
        parameters: {
          type: 'object',
          properties: {
            collection: {
              type: 'string',
              enum: collectionNames,
              description: 'Kollektion att beskriva'
            },
            field: {
              type: 'string',
              description:
                'Valfritt enkelt fältnamn (inga punkter). Returnerar distinkta ' +
                `värden som förekommer (max ${MAX_DISTINCT_VALUES}).`
            }
          },
          required: ['collection']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'aggregate_collection',
        description:
          'Beräknar summa/snitt/min/max/antal över en kollektion, valfritt ' +
          'grupperat. Använd för totaler och fördelningar i stället för att hämta ' +
          'rader och räkna själv. När `group_by` är ett relationsfält (t.ex. ' +
          '`startup`) returneras gruppen som läsbart NAMN, inte id — så du kan ' +
          'lista "vilka bolag som gjort X" med ETT anrop i stället för en fråga ' +
          'per bolag. Tenant-scope läggs på automatiskt.',
        parameters: {
          type: 'object',
          properties: {
            collection: {
              type: 'string',
              enum: collectionNames,
              description: 'Kollektion att aggregera'
            },
            op: {
              type: 'string',
              enum: [...AGG_OPS],
              description: 'Aggregat: count, sum, avg, min eller max'
            },
            field: {
              type: 'string',
              description:
                'Numeriskt fält att aggregera (krävs för sum/avg/min/max; ' +
                'enkelt fältnamn utan punkter). Ignoreras för count.'
            },
            group_by: {
              type: 'string',
              description: 'Valfritt enkelt fält att gruppera per (t.ex. `phase`).'
            },
            filter: {
              type: 'string',
              description: 'Valfritt PocketBase-filter (tenant läggs till automatiskt).'
            }
          },
          required: ['collection', 'op']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'search_knowledge',
        description:
          'Söker i organisationens KUNSKAPSBAS — uppladdat Movexum-material som ' +
          'processbeskrivningar, mallar, policys, rapporter och presentationer ' +
          '(dokument, inte databasrader). Använd detta när användaren frågar om ' +
          'HUR Movexum arbetar, om interna rutiner/processer, om vad som står i ' +
          'ett uppladdat dokument, eller för bakgrund som inte finns i ' +
          'databastabellerna. Kombinera gärna med query_collection: kunskapsbasen ' +
          'ger kontext/process, databasen ger aktuella siffror. Returnerar de mest ' +
          'relevanta textstyckena med källa. Tenant-scope läggs på automatiskt.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Det du vill veta, med användarens egna ord. T.ex. "vår ' +
                'antagningsprocess för boost chamber" eller "mall för kvartalsrapport".'
            },
            topic: {
              type: 'string',
              enum: [...FILE_TOPIC_IDS],
              description:
                'Valfritt ämnesfilter — begränsar sökningen till EN ämnesmapp. ' +
                'Använd när frågan tydligt hör till ett ämne (t.ex. finansiering, ' +
                'juridik) för snabbare och mer precisa träffar.'
            },
            limit: {
              type: 'integer',
              description: 'Max antal textstycken att hämta (1-12, default 6).',
              minimum: 1,
              maximum: 12
            }
          },
          required: ['query']
        }
      }
    }
  ];

  // Personliga filer (§ 27) — söker i ÄGARENS egna /filer-uppladdningar. Bara i
  // den interaktiva chatten (agent-actor = den inloggade användaren); read-only.
  // Scope:as till actor.id i dispatchern så ingen kan läsa andras filer.
  // Exponeras alltså aldrig i icke-staff-körningar utan inloggad ägare.
  if (options.actor?.kind === 'agent') {
    tools.push({
      type: 'function',
      function: {
        name: 'search_my_files',
        description:
          'Söker i ANVÄNDARENS EGNA uppladdade filer i den personliga Filer-ytan ' +
          '(PDF, Excel, text, CSV m.m. som användaren själv laddat upp). Använd när ' +
          'användaren refererar till "mina filer", "dokumentet jag laddade upp", en ' +
          'rapport/fil de äger, eller vill att du kör mot eget material. Bara den ' +
          'inloggade användarens egna filer nås — aldrig andras. Returnerar de mest ' +
          'relevanta textstyckena med filnamn; etiketten visar även filens ' +
          'ämnesmapp och kopplade bolag (t.ex. "[Acme AB · Finansiering] …") när ' +
          'användaren sorterat filen, så du vet vilket bolag/ämne stycket rör.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Det du vill veta, med användarens egna ord.'
            },
            topic: {
              type: 'string',
              enum: [...FILE_TOPIC_IDS],
              description:
                'Valfritt ämnesfilter — begränsar sökningen till EN ämnesmapp ' +
                '(samma taxonomi som /filer).'
            },
            limit: {
              type: 'integer',
              description: 'Max antal textstycken att hämta (1-12, default 6).',
              minimum: 1,
              maximum: 12
            }
          },
          required: ['query']
        }
      }
    });
  }

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
          'Skapar ett snyggt, brandat och nedladdningsbart dokument ' +
          '(PowerPoint/Excel/Word/PDF) av sammanställd data. VIKTIGT: alla siffror ' +
          'och fakta MÅSTE komma från tidigare query_collection-svar i denna ' +
          'konversation — hitta ALDRIG på data. Systemet renderar filen ' +
          'deterministiskt med Movexums designspråk (rundade kort, mjuka skuggor, ' +
          'KPI-kort, callouts, diagram) och sparar den i användarens privata Filer.\n' +
          'BÖRJA med att välja en `template` som matchar uppgiften och följ dess ' +
          'struktur — det ger ett professionellt resultat. Tillgängliga mallar:\n' +
          listTemplateSummaries() +
          '\nAnvänd `slides` för pptx, `sheets` för xlsx, `sections` för docx/pdf. ' +
          'Använd RIKA element där det passar: `kpis` (nyckeltal som stat-kort), ' +
          '`callout` (färgkodad insikt), `quote`, och `chart` (för att visualisera ' +
          'trender — föredra diagram framför långa siffertabeller).',
        parameters: {
          type: 'object',
          properties: {
            template: {
              type: 'string',
              enum: TEMPLATE_IDS,
              description: 'Mall/blueprint att följa (rekommenderas). Sätter format + accent och styr strukturen.'
            },
            kind: { type: 'string', enum: ['pptx', 'xlsx', 'docx', 'pdf'], description: 'Filformat' },
            accent: {
              type: 'string',
              enum: ['blue', 'purple', 'teal', 'green'],
              description: 'Accenttema (signaturfärg). Default blue (Movexum mörkblå).'
            },
            title: { type: 'string', description: 'Dokumentets titel (visas på försättssidan)' },
            subtitle: { type: 'string', description: 'Valfri undertitel' },
            slides: {
              type: 'array',
              description: 'PPTX: en post per slide.',
              items: {
                type: 'object',
                properties: {
                  layout: { type: 'string', enum: ['title', 'content', 'section', 'table', 'chart', 'kpi', 'quote'], description: '"section" = sektionsdelare, "kpi" = nyckeltalsslide.' },
                  heading: { type: 'string' },
                  subheading: { type: 'string' },
                  bullets: { type: 'array', items: { type: 'string' } },
                  kpis: KPIS_SCHEMA,
                  callout: CALLOUT_SCHEMA,
                  quote: QUOTE_SCHEMA,
                  table: TABLE_SCHEMA,
                  chart: CHART_SCHEMA,
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
                  kpis: KPIS_SCHEMA,
                  columns: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        key: { type: 'string' },
                        label: { type: 'string' },
                        type: { type: 'string', enum: ['text', 'number', 'currency', 'percent', 'date'] }
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
                  kpis: KPIS_SCHEMA,
                  callout: CALLOUT_SCHEMA,
                  quote: QUOTE_SCHEMA,
                  table: TABLE_SCHEMA,
                  chart: CHART_SCHEMA
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

// Människovänliga (svenska) etiketter för live-aktivitetsspåret. Håller sig
// på kollektions-/dokumenttyp-nivå — aldrig användarvärden eller filter (de
// kan innehålla namn användaren skrev) → PII-fritt och säkert att persistera.
const COLLECTION_LABELS: Record<string, string> = {
  startups: 'bolagsdata',
  activities: 'aktiviteter',
  tool_runs: 'AI-körningar',
  startup_financials: 'bolagens ekonomi',
  startup_kpis: 'nyckeltal',
  capital_rounds: 'kapitalrundor',
  intellectual_property: 'immateriella rättigheter',
  agreements: 'avtal',
  incubator_events: 'evenemang',
  event_signups: 'anmälningar',
  startup_phase_history: 'fashistorik',
  ai_usage_events: 'AI-statistik'
};

const DOC_LABELS: Record<string, string> = {
  pptx: 'PowerPoint',
  xlsx: 'Excel-fil',
  docx: 'Word-dokument',
  pdf: 'PDF'
};

function collectionLabel(name: string): string {
  return COLLECTION_LABELS[name] || name || 'data';
}

/**
 * Översätter ett tool-call till en kort svensk etikett för aktivitetsspåret
 * ("Läser bolagsdata", "Skapar PowerPoint"). PII-fri per design: bara
 * verktygsnamn + kollektion/dokumenttyp läses, aldrig filter eller värden.
 */
export function describeToolCall(call: MistralToolCall): { tool: string; label: string } {
  let args: Record<string, unknown> = {};
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    /* etikett faller tillbaka på verktygsnamnet */
  }
  const name = call.function.name;
  const coll = typeof args.collection === 'string' ? args.collection : '';
  switch (name) {
    case 'query_collection':
      return { tool: name, label: `Läser ${collectionLabel(coll)}` };
    case 'count_collection':
      return { tool: name, label: `Räknar ${collectionLabel(coll)}` };
    case 'search_records':
      return { tool: name, label: `Söker i ${collectionLabel(coll)}` };
    case 'describe_collection':
      return { tool: name, label: `Undersöker ${collectionLabel(coll)}` };
    case 'aggregate_collection':
      return { tool: name, label: `Sammanställer ${collectionLabel(coll)}` };
    case 'search_knowledge':
      return { tool: name, label: 'Söker i kunskapsbasen' };
    case 'search_my_files':
      return { tool: name, label: 'Söker i dina filer' };
    case 'update_startup_field':
      return { tool: name, label: 'Uppdaterar bolagsuppgift' };
    case 'create_startup_activity':
      return { tool: name, label: 'Loggar aktivitet' };
    case 'update_activity_field':
      return { tool: name, label: 'Uppdaterar aktivitet' };
    case 'memory_read':
      return { tool: name, label: 'Läser minnet' };
    case 'memory_write':
      return { tool: name, label: 'Sparar i minnet' };
    case 'generate_document': {
      const kind = typeof args.kind === 'string' ? args.kind : '';
      return { tool: name, label: `Skapar ${DOC_LABELS[kind] || 'dokument'}` };
    }
    default:
      return { tool: name, label: 'Arbetar' };
  }
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

/** Plockar ut de (redan maskade) strängvärden en post kan fuzzy-matchas mot. */
function recordSearchTexts(record: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(record)) {
    if (SYSTEM_RECORD_KEYS.has(k)) continue;
    if (typeof v === 'string' && v.trim()) out.push(v);
  }
  return out;
}

async function runSearchRecords(
  args: Record<string, unknown>,
  ctx: ToolDispatchContext
): Promise<ToolResult> {
  const collectionName = String(args.collection ?? '');
  const collection = getExposedCollection(ctx.collections, collectionName);
  if (!collection) {
    const available = ctx.collections.map((c) => c.name).join(', ');
    return { ok: false, error: `Kollektion '${collectionName}' är inte exponerad. Välj från: ${available}` };
  }

  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return { ok: false, error: 'query saknas.' };

  let limit = 8;
  if (typeof args.limit === 'number' && Number.isFinite(args.limit)) {
    limit = Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.floor(args.limit)));
  }

  const tokens = significantTokens(query);
  // Bred OR-`~`-förfiltrering på fria textfält (aldrig maskade fält) för att
  // dra in kandidater billigt. Felstavningar fångas av JS-rankingen nedan via
  // den ofiltrerade fallbacken.
  const textFields = searchableTextFields(collection);
  const prefilterClauses: string[] = [];
  for (const tok of tokens.slice(0, 6)) {
    const safe = escFilter(tok);
    for (const f of textFields.slice(0, 6)) prefilterClauses.push(`${f} ~ "${safe}"`);
  }
  const prefilter = prefilterClauses.join(' || ');

  const candidates: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const addFrom = async (modelFilter: string): Promise<void> => {
    const res = await ctx.pb
      .collection(collection.name)
      .getList(1, SEARCH_CANDIDATE_FETCH, {
        filter: composeFilter(collection, ctx.tenantId, modelFilter) || undefined
      });
    for (const item of res.items as Record<string, unknown>[]) {
      const id = String(item.id ?? '');
      if (id && !seen.has(id)) {
        seen.add(id);
        candidates.push(item);
      }
    }
  };

  try {
    if (prefilter && prefilter.length <= MAX_FILTER_LENGTH) await addFrom(prefilter);
    // Ofiltrerad fallback: ger felstavnings-recall + funkar när schemats
    // textfält är okända (statisk fallback). Capad till SEARCH_CANDIDATE_FETCH.
    if (candidates.length < Math.max(limit, 10)) await addFrom('');
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Okänt fel vid sökning.' };
  }

  const masked = candidates.map((c) => maskRecord(c, collection));
  const ranked = rankCandidates(query, masked, recordSearchTexts, {
    limit,
    threshold: SEARCH_THRESHOLD
  });

  return {
    ok: true,
    data: {
      collection: collection.name,
      query,
      matched: ranked.length,
      items: ranked.map((r) => ({
        score: r.score,
        record: truncateValue(r.item)
      }))
    }
  };
}

async function runDescribeCollection(
  args: Record<string, unknown>,
  ctx: ToolDispatchContext
): Promise<ToolResult> {
  const collectionName = String(args.collection ?? '');
  const collection = getExposedCollection(ctx.collections, collectionName);
  if (!collection) {
    const available = ctx.collections.map((c) => c.name).join(', ');
    return { ok: false, error: `Kollektion '${collectionName}' är inte exponerad. Välj från: ${available}` };
  }

  const fields = collection.fields.map((f) => ({
    name: f.name,
    type: f.type,
    ...(f.values && f.values.length > 0 ? { values: f.values } : {}),
    ...(collection.maskedFields.includes(f.name) ? { masked: true } : {})
  }));

  const data: Record<string, unknown> = {
    collection: collection.name,
    tenant_scoped: Boolean(collection.tenantField),
    fields
  };

  const field = typeof args.field === 'string' ? args.field.trim() : '';
  if (field) {
    if (field.includes('.')) {
      return { ok: false, error: 'Endast enkla fältnamn stöds (inga punkter).' };
    }
    if (collection.maskedFields.includes(field)) {
      return { ok: false, error: `Fältet '${field}' är maskat (PII) och kan inte listas.` };
    }
    try {
      const res = await ctx.pb.collection(collection.name).getList(1, MAX_AGG_SCAN, {
        filter: composeFilter(collection, ctx.tenantId, '') || undefined,
        fields: field
      });
      const distinct: unknown[] = [];
      const seen = new Set<string>();
      for (const item of res.items as Record<string, unknown>[]) {
        const v = item[field];
        if (v === null || v === undefined || v === '') continue;
        const key = String(v);
        if (!seen.has(key)) {
          seen.add(key);
          distinct.push(v);
          if (distinct.length >= MAX_DISTINCT_VALUES) break;
        }
      }
      data.distinct_values = {
        field,
        values: distinct,
        capped: res.totalItems > res.items.length
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Kunde inte läsa fältvärden.' };
    }
  }

  return { ok: true, data };
}

async function runAggregateCollection(
  args: Record<string, unknown>,
  ctx: ToolDispatchContext
): Promise<ToolResult> {
  const collectionName = String(args.collection ?? '');
  const collection = getExposedCollection(ctx.collections, collectionName);
  if (!collection) {
    const available = ctx.collections.map((c) => c.name).join(', ');
    return { ok: false, error: `Kollektion '${collectionName}' är inte exponerad. Välj från: ${available}` };
  }

  const op = String(args.op ?? '') as AggOp;
  if (!AGG_OPS.includes(op)) {
    return { ok: false, error: `Ogiltig op. Välj en av: ${AGG_OPS.join(', ')}` };
  }

  const field = typeof args.field === 'string' ? args.field.trim() : '';
  const groupBy = typeof args.group_by === 'string' ? args.group_by.trim() : '';

  for (const [label, name] of [
    ['field', field],
    ['group_by', groupBy]
  ] as const) {
    if (!name) continue;
    if (name.includes('.')) return { ok: false, error: `Endast enkla fältnamn stöds (${label}).` };
    if (collection.maskedFields.includes(name)) {
      return { ok: false, error: `Fältet '${name}' är maskat (PII) och kan inte aggregeras.` };
    }
  }
  if (op !== 'count' && !field) {
    return { ok: false, error: `op '${op}' kräver ett numeriskt 'field'.` };
  }

  const modelFilter = typeof args.filter === 'string' ? args.filter.trim() : '';
  if (modelFilter) {
    const err = validateFilter(modelFilter);
    if (err) return { ok: false, error: err };
  }

  // Om group_by pekar på ett relationsfält expanderar vi det till ett
  // läsbart namn (name/title/label) så grupperna blir bolagsnamn i stället
  // för id:n. Det låter modellen lista "vilka som gjort X" med ETT anrop —
  // utan en uppföljande fråga per id (N+1). Bara icke-maskade display-fält
  // (name/title/label) läses ur den expanderade posten → ingen PII-bakväg.
  const groupField = groupBy
    ? collection.fields.find((f) => f.name === groupBy)
    : undefined;
  const groupIsRelation = groupField?.type === 'relation';

  // Hämta bara de fält som behövs (dataminimering § 9.3).
  const fieldParts = ['id', field, groupBy].filter(Boolean);
  if (groupIsRelation) {
    for (const disp of GROUP_LABEL_FIELDS) fieldParts.push(`expand.${groupBy}.${disp}`);
  }
  const wanted = fieldParts.join(',');

  try {
    const res = await ctx.pb.collection(collection.name).getList(1, MAX_AGG_SCAN, {
      filter: composeFilter(collection, ctx.tenantId, modelFilter) || undefined,
      fields: wanted || undefined,
      expand: groupIsRelation ? groupBy : undefined
    });
    const rows = res.items as Record<string, unknown>[];
    const capped = res.totalItems > rows.length;

    const reduce = (values: number[]): number | null => {
      if (op === 'count') return values.length;
      const nums = values.filter((n) => Number.isFinite(n));
      if (nums.length === 0) return null;
      if (op === 'sum') return nums.reduce((a, b) => a + b, 0);
      if (op === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
      if (op === 'min') return Math.min(...nums);
      if (op === 'max') return Math.max(...nums);
      return null;
    };
    const numOf = (r: Record<string, unknown>): number => {
      if (op === 'count') return 1;
      return Number(r[field]);
    };

    if (groupBy) {
      const groups = new Map<string, number[]>();
      for (const r of rows) {
        const g = groupIsRelation ? relationGroupLabel(r, groupBy) : scalarGroupLabel(r[groupBy]);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g)!.push(numOf(r));
      }
      const result = Array.from(groups.entries())
        .map(([group, vals]) => ({ group, value: reduce(vals), count: vals.length }))
        .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
      return {
        ok: true,
        data: {
          collection: collection.name,
          op,
          field: field || undefined,
          group_by: groupBy,
          group_label: groupIsRelation ? 'name' : 'value',
          scanned: rows.length,
          capped,
          groups: result
        }
      };
    }

    // Ogrupperad count = sann totalsumma (inte den capade skanningen).
    const value = op === 'count' ? res.totalItems : reduce(rows.map(numOf));
    return {
      ok: true,
      data: {
        collection: collection.name,
        op,
        field: field || undefined,
        scanned: rows.length,
        capped: op === 'count' ? false : capped,
        value
      }
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Okänt fel vid aggregering.' };
  }
}

/**
 * Söker i den tenant-breda kunskapsbasen (org_knowledge, § 26) via RAG. Read-
 * only och tenant-scopad. Loggar query-embeddingens token-utfall i
 * ai_usage_events (surface 'suggestions') när en actor-id finns. Kunskapsbasen
 * är denylistad för query_collection — detta är dess ENDA väg till modellen.
 */
async function runSearchKnowledge(
  args: Record<string, unknown>,
  ctx: ToolDispatchContext
): Promise<ToolResult> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return { ok: false, error: 'query saknas.' };
  let limit: number | undefined;
  if (typeof args.limit === 'number' && Number.isFinite(args.limit)) {
    limit = Math.max(1, Math.min(12, Math.floor(args.limit)));
  }

  const topic = isFileTopic(args.topic) ? args.topic : undefined;

  let result;
  try {
    result = await searchOrgKnowledge(ctx.pb, { tenant: ctx.tenantId, query, topK: limit, topic });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Kunde inte söka i kunskapsbasen.' };
  }

  if (ctx.actor?.id && (result.usage.tokensIn > 0 || result.usage.tokensOut > 0)) {
    void logAiUsage(ctx.pb, {
      tenant: ctx.tenantId,
      userId: ctx.actor.id,
      surface: 'suggestions',
      model: 'mistral-embed',
      tokensIn: result.usage.tokensIn,
      tokensOut: result.usage.tokensOut
    });
  }

  if (result.hits.length === 0) {
    return {
      ok: true,
      data: {
        matched: 0,
        note: 'Inget relevant hittades i kunskapsbasen. Svara utifrån databasen om möjligt, annars säg att underlag saknas.'
      }
    };
  }

  return {
    ok: true,
    data: {
      matched: result.hits.length,
      mode: result.mode,
      sources: [...new Set(result.hits.map((h) => h.title))],
      material: renderKnowledgeHits(result.hits)
    }
  };
}

/**
 * Söker i ÄGARENS egna personliga filer (user_files, § 27) via RAG. Owner-scopad
 * till den inloggade användaren (ctx.actor.id) — kan ALDRIG läsa andras filer.
 * Bara agent-actor (interaktiv chatt) når hit; saknas en agent-actor returneras
 * ett tydligt fel i stället för data. Loggar query-embeddingen i ai_usage_events.
 */
async function runSearchMyFiles(
  args: Record<string, unknown>,
  ctx: ToolDispatchContext
): Promise<ToolResult> {
  if (!ctx.actor || ctx.actor.kind !== 'agent' || !ctx.actor.id) {
    return { ok: false, error: 'Personliga filer kan bara sökas i en inloggad användares egen chatt.' };
  }
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return { ok: false, error: 'query saknas.' };
  let limit: number | undefined;
  if (typeof args.limit === 'number' && Number.isFinite(args.limit)) {
    limit = Math.max(1, Math.min(12, Math.floor(args.limit)));
  }

  const topic = isFileTopic(args.topic) ? args.topic : undefined;

  let result;
  try {
    result = await searchUserFiles(ctx.pb, {
      tenant: ctx.tenantId,
      owner: ctx.actor.id,
      query,
      topK: limit,
      topic
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Kunde inte söka i dina filer.' };
  }

  if (result.usage.tokensIn > 0 || result.usage.tokensOut > 0) {
    void logAiUsage(ctx.pb, {
      tenant: ctx.tenantId,
      userId: ctx.actor.id,
      surface: 'suggestions',
      model: 'mistral-embed',
      tokensIn: result.usage.tokensIn,
      tokensOut: result.usage.tokensOut
    });
  }

  if (result.hits.length === 0) {
    return {
      ok: true,
      data: {
        matched: 0,
        note: 'Inget relevant hittades bland dina uppladdade filer. Filen kan vara ej indexerad (t.ex. PowerPoint/Word — exportera till PDF) eller så saknas materialet.'
      }
    };
  }

  return {
    ok: true,
    data: {
      matched: result.hits.length,
      mode: result.mode,
      sources: [...new Set(result.hits.map((h) => h.title))],
      material: renderKnowledgeHits(result.hits)
    }
  };
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
    case 'search_records':
      return runSearchRecords(args, ctx);
    case 'describe_collection':
      return runDescribeCollection(args, ctx);
    case 'aggregate_collection':
      return runAggregateCollection(args, ctx);
    case 'search_knowledge':
      return runSearchKnowledge(args, ctx);
    case 'search_my_files':
      return runSearchMyFiles(args, ctx);
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
  // Mall-defaults: en vald mall sätter accent/kind om modellen utelämnat dem,
  // så att varje dokument får ett enhetligt, modernt uttryck (mallens blueprint
  // styr själva strukturen via systemprompten, § dokumentmallar).
  const tpl = getTemplate(typeof args.template === 'string' ? args.template : undefined);
  if (tpl) {
    if (!args.accent) args.accent = tpl.accent;
    if (!args.kind) args.kind = tpl.kind;
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
