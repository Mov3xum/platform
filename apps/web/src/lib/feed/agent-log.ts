import 'server-only';
import type PocketBase from 'pocketbase';
import { escFilter } from '@/lib/pb-filter';

/**
 * Samlad händelselogg för aktivitetsfeeden (CLAUDE.md § 32).
 *
 * Läser `agent_actions` — det delade skrivlagrets append-only-audit (§ 16) —
 * och översätter raderna till klickbara feed-poster: årshjulet,
 * Startupkompassen, workshops och bolagsfält-ändringar. Detta är INGEN ny
 * dataväg: läsningen sker med användarens egen token så PB-reglerna gäller
 * (admin/incubator_lead ser tenantens logg, övriga sina egna rader), och
 * before/after-värdena i loggen är redan PII-fria (skrivlagrets ansvar,
 * § 16). Rader för `activities` hoppas över — de syns redan som egna
 * aktivitetsposter i feeden (ingen dubblett).
 */

export interface AgentLogEntry {
  id: string;
  /** Färdigformulerad svensk rubrik ("Ny modul i Startupkompassen: …"). */
  title: string;
  /** Sekundär etikett (datum, fält, flödestyp …). */
  detail?: string;
  /** Vem som utförde åtgärden (visningsnamn, internt). */
  actorName?: string;
  /** true när åtgärden utfördes av AI-agenten i chatten (art. 13-transparens). */
  viaAgent: boolean;
  created: string;
  /** Relativ intern länk — gör raden klickbar. */
  href?: string;
  /** Ikonnamn i `components/proto/Icon`. */
  icon: string;
}

interface AgentActionRow {
  id: string;
  actor_kind?: 'user' | 'agent';
  action_type?: 'create' | 'update' | 'revert';
  collection?: string;
  record_id?: string;
  field?: string;
  after_value?: unknown;
  created: string;
  expand?: { actor?: { display_name?: string; email?: string } };
}

const MONTH_NAMES = [
  'januari',
  'februari',
  'mars',
  'april',
  'maj',
  'juni',
  'juli',
  'augusti',
  'september',
  'oktober',
  'november',
  'december'
];

/** Svenska etiketter för de fält skrivlagret kan ändra. */
const FIELD_LABELS: Record<string, string> = {
  title: 'titeln',
  month: 'månaden',
  day: 'dagen',
  year: 'året',
  tags: 'taggarna',
  category: 'kategorin',
  responsible: 'ansvarig',
  notes: 'anteckningarna',
  next_step: 'nästa steg',
  irl_level: 'IRL-nivån',
  name: 'namnet',
  description: 'beskrivningen',
  intro_message: 'välkomsttexten',
  success_message: 'tacktexten',
  target_audience: 'målgruppen',
  consent_note: 'samtyckestexten',
  flow_type: 'flödestypen',
  status: 'statusen'
};

const FLOW_LABELS: Record<string, string> = {
  chat: 'AI-chatt',
  wizard: 'formulär',
  quiz: 'quiz'
};

/** Kanban-kolumnernas etiketter (§ 15.7). */
const TASK_COLUMN_LABELS: Record<string, string> = {
  backlog: 'Backlogg',
  open: 'Att göra',
  in_progress: 'Pågår',
  review: 'Granskas',
  blocked: 'Blockerad',
  done: 'Klar'
};

function trunc(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function fieldLabel(field?: string): string {
  if (!field) return 'ett fält';
  return FIELD_LABELS[field] ?? field;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Batch-uppslag av rader per id (max 30) med användarens token — RLS gäller.
 * Fail-soft: kan raderna inte läsas returneras en tom map och feed-posten
 * renderas utan namn/länk-berikning.
 */
async function lookupByIds<T extends { id: string }>(
  pb: PocketBase,
  collection: string,
  tenant: string,
  ids: string[],
  fields: string
): Promise<Map<string, T>> {
  const unique = Array.from(new Set(ids.filter(Boolean))).slice(0, 30);
  if (unique.length === 0) return new Map();
  const idFilter = unique.map((id) => `id = "${escFilter(id)}"`).join(' || ');
  try {
    const res = await pb.collection(collection).getList<T>(1, unique.length, {
      filter: `tenant = "${escFilter(tenant)}" && (${idFilter})`,
      fields
    });
    return new Map(res.items.map((r) => [r.id, r]));
  } catch {
    return new Map();
  }
}

interface MappedEntry {
  title: string;
  detail?: string;
  href?: string;
  icon: string;
}

function annualWheelDateDetail(after: Record<string, unknown>): string | undefined {
  const year = Number(after.year);
  if (!Number.isFinite(year)) return undefined;
  const month = Number(after.month);
  if (Number.isFinite(month) && month >= 1 && month <= 12) {
    return `${MONTH_NAMES[month - 1]} ${year}`;
  }
  return String(year);
}

function mapRow(
  row: AgentActionRow,
  moduleById: Map<string, { id: string; slug?: string; name?: string }>,
  startupById: Map<string, { id: string; name?: string }>
): MappedEntry | null {
  const after = asRecord(row.after_value);
  const action = row.action_type ?? 'update';
  // "ändrades"/"togs bort" osv. fungerar oavsett genus — undvik en/ett-fel.
  const changedVerb = action === 'revert' ? 'återställdes' : 'ändrades';

  switch (row.collection) {
    case 'annual_wheel_items': {
      if (action === 'create') {
        return {
          title: `Ny aktivitet i årshjulet: "${str(after.title) || 'utan titel'}"`,
          detail: annualWheelDateDetail(after),
          href: '/arshjul',
          icon: 'calendar'
        };
      }
      const isTitle = row.field === 'title' && str(row.after_value);
      return {
        title: isTitle
          ? `Årshjulet: "${str(row.after_value)}" ${changedVerb}`
          : `Årshjulet: en aktivitet ${changedVerb}`,
        detail: isTitle ? undefined : fieldLabel(row.field),
        href: '/arshjul',
        icon: 'calendar'
      };
    }

    case 'annual_wheel_categories': {
      const label = str(after.label);
      if (action === 'create') {
        return {
          title: `Ny kategori i årshjulet: "${label || 'utan namn'}"`,
          href: '/arshjul',
          icon: 'calendar'
        };
      }
      if (after.deleted === true) {
        return { title: 'Årshjulet: en kategori togs bort', href: '/arshjul', icon: 'calendar' };
      }
      return {
        title: label
          ? `Årshjulet: kategorin "${label}" ${changedVerb}`
          : `Årshjulet: en kategori ${changedVerb}`,
        href: '/arshjul',
        icon: 'calendar'
      };
    }

    case 'compass_modules': {
      const mod = row.record_id ? moduleById.get(row.record_id) : undefined;
      const name = str(after.name) || mod?.name || '';
      const slug = mod?.slug || str(after.slug);
      const href = slug ? `/inflode/admin/modules/${slug}` : '/inflode/admin/modules';
      if (action === 'create') {
        const flow = FLOW_LABELS[str(after.flow_type)];
        return {
          title: `Ny modul i Startupkompassen: "${name || 'utan namn'}"`,
          detail: flow,
          href,
          icon: 'compass'
        };
      }
      return {
        title: name
          ? `Startupkompassen: modulen "${name}" ${changedVerb}`
          : `Startupkompassen: en modul ${changedVerb}`,
        detail: fieldLabel(row.field),
        href,
        icon: 'compass'
      };
    }

    case 'compass_questions': {
      const moduleId = str(after.module);
      const mod = moduleId ? moduleById.get(moduleId) : undefined;
      const href = mod?.slug ? `/inflode/admin/modules/${mod.slug}` : '/inflode/admin/modules';
      return {
        title: mod?.name
          ? `Ny fråga i modulen "${mod.name}"`
          : 'Ny fråga i en Startupkompass-modul',
        detail: 'Startupkompassen',
        href,
        icon: 'compass'
      };
    }

    case 'workshops': {
      if (action === 'create') {
        return {
          title: `Ny workshop: "${str(after.title) || 'utan titel'}"`,
          detail: after.status === 'draft' ? 'utkast' : undefined,
          href: '/education',
          icon: 'cap'
        };
      }
      return { title: `En workshop ${changedVerb}`, href: '/education', icon: 'cap' };
    }

    case 'startups': {
      const startup = row.record_id ? startupById.get(row.record_id) : undefined;
      const name = startup?.name;
      return {
        title: name
          ? `${name}: ${fieldLabel(row.field)} ${changedVerb}`
          : `Ett bolag: ${fieldLabel(row.field)} ${changedVerb}`,
        href: row.record_id ? `/startups/${row.record_id}` : undefined,
        icon: 'pencil'
      };
    }

    // Workshop-tilldelningar skapar redan en egen activities-rad i feeden
    // (skrivlagret speglar UI-flödet) — loggraden vore en dubblett.
    case 'workshop_assignments':
      return null;

    case 'education_document_assignments': {
      const startupId = str(after.startup);
      return {
        title: `Utbildningsdokument tilldelat: "${str(after.document_title) || 'dokument'}"`,
        detail: str(after.startup_name) || undefined,
        href: startupId ? `/startups/${startupId}` : undefined,
        icon: 'doc'
      };
    }

    case 'tasks': {
      if (action === 'create') {
        const startupId = str(after.startup);
        const missionId = str(after.mission);
        return {
          title: `Nytt kanban-kort: "${trunc(str(after.description), 60) || 'uppgift'}"`,
          href: startupId
            ? `/startups/${startupId}/aktiviteter`
            : missionId
              ? `/uppdrag/${missionId}`
              : '/inkorg',
          icon: 'check'
        };
      }
      const column = TASK_COLUMN_LABELS[str(row.after_value)] ?? str(row.after_value);
      return {
        title: column
          ? `Ett kanban-kort flyttades till ${column}`
          : `Ett kanban-kort ${changedVerb}`,
        href: '/inkorg',
        icon: 'check'
      };
    }

    case 'incubator_events': {
      const starts = str(after.starts_at);
      return {
        title: `Nytt event: "${str(after.name) || 'utan namn'}"`,
        detail: starts ? new Date(starts).toLocaleString('sv-SE').slice(0, 16) : undefined,
        href: row.record_id ? `/events/${row.record_id}` : '/events',
        icon: 'calendar'
      };
    }

    case 'missions': {
      const startupName = str(after.startup_name);
      return {
        title: `Nytt uppdrag: "${str(after.title) || 'utan titel'}"`,
        detail: startupName ? `utkast · ${startupName}` : 'utkast',
        href: row.record_id ? `/uppdrag/${row.record_id}` : '/uppdrag',
        icon: 'target'
      };
    }

    case 'de_minimis_stod': {
      const startupId = str(after.startup);
      const belopp = Number(after.belopp_eur);
      return {
        title: `De minimis-stöd registrerat: ${str(after.stodgivare) || 'stödgivare'}`,
        detail: [
          Number.isFinite(belopp) ? `${belopp.toLocaleString('sv-SE')} EUR` : null,
          str(after.startup_name) || null
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
        href: startupId ? `/de-minimis/${startupId}` : '/de-minimis',
        icon: 'shield'
      };
    }

    case 'startup_kpis': {
      const startupId = str(after.startup);
      return {
        title: `KPI registrerad: ${str(after.kpi_name) || 'nyckeltal'}`,
        detail: str(after.startup_name) || undefined,
        href: startupId ? `/startups/${startupId}` : undefined,
        icon: 'graph'
      };
    }

    case 'capital_rounds': {
      const startupId = str(after.startup);
      const amount = Number(after.amount_sek);
      return {
        title: `Kapital registrerat: ${str(after.source) || 'finansiär'}`,
        detail: [
          Number.isFinite(amount) ? `${amount.toLocaleString('sv-SE')} kr` : null,
          str(after.startup_name) || null
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
        href: startupId ? `/startups/${startupId}` : undefined,
        icon: 'graph'
      };
    }

    case 'tool_schedules': {
      const toolId = str(after.tool);
      return {
        title: `Agent schemalagd: ${str(after.tool_name) || 'AI-agent'}`,
        detail: str(after.cron_expression) || undefined,
        href: toolId ? `/toolbox/${toolId}` : '/toolbox',
        icon: 'clock'
      };
    }

    case 'notes': {
      const startupId = str(after.startup);
      return {
        title: str(after.startup_name)
          ? `Ny anteckning: ${str(after.startup_name)}`
          : 'Ny anteckning på ett bolagskort',
        href: startupId ? `/startups/${startupId}` : undefined,
        icon: 'doc'
      };
    }

    // 'activities' (dubblett av feedens egna rader) och okända kollektioner
    // hoppas över — nya kollektioner läggs till medvetet med etikett + länk.
    default:
      return null;
  }
}

/**
 * Hämtar de senaste raderna ur `agent_actions` och mappar dem till klickbara
 * feed-poster. Fail-soft: varje fel ger en tom lista i stället för att fälla
 * sidan (samma princip som övriga feed-källor).
 */
export async function loadAgentLogEntries(
  pb: PocketBase,
  tenant: string,
  perPage = 60
): Promise<AgentLogEntry[]> {
  let rows: AgentActionRow[] = [];
  try {
    const res = await pb.collection('agent_actions').getList<AgentActionRow>(1, perPage, {
      filter: pb.filter('tenant = {:tenant}', { tenant }),
      sort: '-created',
      expand: 'actor'
    });
    rows = res.items;
  } catch {
    return [];
  }

  // Berika med namn/sluggar i två batchade uppslag (RLS via användartoken).
  const moduleIds: string[] = [];
  const startupIds: string[] = [];
  for (const row of rows) {
    if (row.collection === 'compass_modules' && row.record_id) moduleIds.push(row.record_id);
    if (row.collection === 'compass_questions') {
      const moduleId = str(asRecord(row.after_value).module);
      if (moduleId) moduleIds.push(moduleId);
    }
    if (row.collection === 'startups' && row.record_id) startupIds.push(row.record_id);
  }
  const [moduleById, startupById] = await Promise.all([
    lookupByIds<{ id: string; slug?: string; name?: string }>(
      pb,
      'compass_modules',
      tenant,
      moduleIds,
      'id,slug,name'
    ),
    lookupByIds<{ id: string; name?: string }>(pb, 'startups', tenant, startupIds, 'id,name')
  ]);

  const entries: AgentLogEntry[] = [];
  for (const row of rows) {
    const mapped = mapRow(row, moduleById, startupById);
    if (!mapped) continue;
    const actor = row.expand?.actor;
    entries.push({
      id: row.id,
      title: mapped.title,
      detail: mapped.detail,
      actorName: actor?.display_name || actor?.email || undefined,
      viaAgent: row.actor_kind === 'agent',
      created: row.created,
      href: mapped.href,
      icon: mapped.icon
    });
  }
  return entries;
}
