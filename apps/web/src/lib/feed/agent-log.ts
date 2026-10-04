import 'server-only';
import type PocketBase from 'pocketbase';
import { escFilter } from '@/lib/pb-filter';
import { isOrgPostKind, orgPostHomePath } from '@platform/shared';

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
  /** Källrad i loggen — låter den personliga feeden (§ 32) dedupa direkta rader. */
  collection?: string;
  recordId?: string;
  actionType?: 'create' | 'update' | 'revert';
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

/** Anslagstavlans inläggstyper (§ 37). */
const ORG_POST_KIND_LABELS: Record<string, string> = {
  news: 'nyhet',
  notice: 'info',
  instruction: 'instruktion',
  celebration: 'firande',
  training: 'internutbildning'
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

    case 'surveys': {
      const href = row.record_id ? `/inflode/utvardering/${row.record_id}` : '/inflode/utvardering';
      const name = str(after.name);
      if (action === 'create') {
        return {
          title: `Ny enkät under Utvärdering: "${name || 'utan namn'}"`,
          detail: after.link_label ? `följer upp ${str(after.link_label)}` : 'opublicerad',
          href,
          icon: 'compass'
        };
      }
      return {
        title: name ? `Utvärdering: enkäten "${name}" ${changedVerb}` : `Utvärdering: en enkät ${changedVerb}`,
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
        const procurementId = str(after.procurement);
        return {
          title: `Nytt kanban-kort: "${trunc(str(after.description), 60) || 'uppgift'}"`,
          href: startupId
            ? `/startups/${startupId}/aktiviteter`
            : missionId
              ? `/uppdrag/${missionId}`
              : procurementId
                ? `/upphandlingar/${procurementId}`
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

    case 'org_posts': {
      const title = str(after.title);
      const kind = str(after.kind);
      const homeHref = isOrgPostKind(kind) ? orgPostHomePath(kind) : '/hem';
      if (action === 'create') {
        return {
          title:
            kind === 'training'
              ? `Ny internutbildning: "${title || 'utan rubrik'}"`
              : kind === 'instruction'
                ? `Ny instruktion: "${title || 'utan rubrik'}"`
                : `Nytt på anslagstavlan: "${title || 'utan rubrik'}"`,
          detail: ORG_POST_KIND_LABELS[kind],
          href: homeHref,
          icon: kind === 'training' ? 'cap' : 'home'
        };
      }
      if (after.deleted === true) {
        return { title: `Anslagstavlan: "${title || 'ett inlägg'}" togs bort`, href: '/hem', icon: 'home' };
      }
      if (row.field === 'pinned') {
        return {
          title: after.pinned === true
            ? `Anslagstavlan: "${title || 'ett inlägg'}" fästes`
            : `Anslagstavlan: "${title || 'ett inlägg'}" lossades`,
          href: '/hem',
          icon: 'home'
        };
      }
      return {
        title: title
          ? `Anslagstavlan: "${title}" ${changedVerb}`
          : `Anslagstavlan: ett inlägg ${changedVerb}`,
        href: '/hem',
        icon: 'home'
      };
    }

    // Målstyrning & verksamhetsplan (§ 42).
    case 'goal_periods': {
      const year = str(after.year);
      const href = year ? `/mal?ar=${year}` : '/mal';
      if (action === 'create') return { title: `Nytt verksamhetsår: ${year || 'år'}`, href, icon: 'target' };
      if (after.deleted === true) {
        return { title: `Verksamhetsår ${year} borttaget`, detail: after.goals ? `${str(after.goals)} mål` : undefined, href: '/mal', icon: 'target' };
      }
      const field = str(row.field);
      if (field === 'year' || field === 'title') {
        return { title: `Verksamhetsår ${year} redigerat`, detail: str(after.title) || undefined, href, icon: 'target' };
      }
      return { title: `Verksamhetsår ${year}: status ${changedVerb}`, detail: str(after.status) || undefined, href, icon: 'target' };
    }
    case 'goals': {
      const year = str(after.year);
      const href = `/mal${year ? `?ar=${year}&` : '?'}mal=${row.record_id ?? ''}`;
      const kindLabel = str(after.kind) === 'personal' ? 'Personligt mål' : 'Mål';
      if (action === 'create') {
        return {
          title: `Nytt ${kindLabel.toLowerCase()}: "${str(after.title) || 'utan titel'}"`,
          detail: str(after.owner_team) || undefined,
          href,
          icon: 'target'
        };
      }
      if (after.deleted === true) {
        return { title: `${kindLabel} "${str(after.title) || ''}" borttaget`, href: year ? `/mal?ar=${year}` : '/mal', icon: 'target' };
      }
      const field = str(row.field);
      return { title: `${kindLabel} "${str(after.title) || ''}": ${field || 'fält'} ${changedVerb}`, href, icon: 'target' };
    }
    case 'goal_indicators': {
      const goalId = str(after.goal);
      const href = goalId ? `/mal?mal=${goalId}` : '/mal';
      if (after.deleted === true) {
        return { title: `Indikator "${str(after.label) || 'indikator'}" borttagen`, detail: str(after.goal_title) || undefined, href, icon: 'target' };
      }
      if (action === 'update') {
        return { title: `Indikator "${str(after.label) || 'indikator'}" ${changedVerb}`, detail: str(after.goal_title) || undefined, href, icon: 'target' };
      }
      return {
        title: `Ny indikator: "${str(after.label) || 'indikator'}"`,
        detail: str(after.goal_title) || undefined,
        href,
        icon: 'target'
      };
    }
    case 'goal_status_entries': {
      const status = str(after.status);
      const label: Record<string, string> = { on_track: 'I fas', delayed: 'Försenad', not_started: 'Ej startad', done: 'Klar' };
      const goalId = str(after.goal);
      const year = str(after.year);
      const q = str(after.quarter);
      return {
        title: `Q${q}: "${str(after.indicator_label) || 'indikator'}" → ${label[status] ?? status}`,
        detail: str(after.goal_title) || undefined,
        href: `/mal${year ? `?ar=${year}&q=${q}&` : `?q=${q}&`}mal=${goalId}`,
        icon: 'target'
      };
    }
    // Kontaktboken (§ 45). Aldrig e-post/telefon i loggen — bara namn/organisation.
    case 'contacts': {
      const name = str(after.name) || 'en kontakt';
      const href = row.record_id ? `/kontakter/${row.record_id}` : '/kontakter';
      if (action === 'create') {
        return {
          title: `Ny kontakt i kontaktboken: ${name}`,
          detail: str(after.organization) || undefined,
          href,
          icon: 'user'
        };
      }
      if (after.deleted === true) {
        return { title: `Kontaktboken: ${name} togs bort`, href: '/kontakter', icon: 'user' };
      }
      const field = str(row.field);
      return {
        title: `Kontaktboken: ${name} — ${field ? FIELD_LABELS[field] ?? field : 'uppgifter'} ${changedVerb}`,
        href,
        icon: 'user'
      };
    }
    case 'contact_requests': {
      const name = str(after.contact_name) || 'en kontakt';
      const contactId = str(after.contact);
      const href = contactId ? `/kontakter/${contactId}?request=${row.record_id ?? ''}` : '/kontakter/forfragningar';
      const startupName = str(after.startup_name);
      if (action === 'create') {
        const status = str(after.status);
        return {
          title:
            status === 'approved'
              ? `Kontakt använd: ${name}${startupName ? ` → ${startupName}` : ''}`
              : `Förfrågan om kontakt: ${name}${startupName ? ` → ${startupName}` : ''}`,
          detail: str(after.purpose) || undefined,
          href,
          icon: 'send'
        };
      }
      const value = str(after.value);
      return {
        title:
          value === 'approved'
            ? `Förfrågan godkänd: ${name}${startupName ? ` → ${startupName}` : ''}`
            : value === 'declined'
              ? `Förfrågan avböjd: ${name}`
              : value === 'withdrawn'
                ? `Förfrågan återkallad: ${name}`
                : `Förfrågan om ${name} ${changedVerb}`,
        href,
        icon: value === 'approved' ? 'check' : 'send'
      };
    }
    // Kompetens-hashtags (§ 29.7) — tenantens vokabulär.
    case 'competence_tags': {
      const slug = str(after.slug);
      const tag = slug ? `#${slug}` : 'en hashtag';
      const href = '/installningar/kompetenser';
      if (after.deleted === true) return { title: `Hashtag borttagen: ${tag}`, href, icon: 'trash' };
      if (action === 'create') {
        return {
          title: str(after.status) === 'approved' ? `Hashtag tillagd: ${tag}` : `Hashtag föreslagen: ${tag}`,
          href,
          icon: 'star'
        };
      }
      const field = str(row.field);
      if (field === 'status') {
        return {
          title: str(after.status) === 'approved' ? `Hashtag godkänd: ${tag}` : `Hashtag åter föreslagen: ${tag}`,
          href,
          icon: 'check'
        };
      }
      return { title: `Hashtag ${tag} ${changedVerb}`, href, icon: 'edit3' };
    }
    // Önskemål & buggar (§ 49) — intern backlog.
    case 'feedback_items': {
      const title = str(after.title) || 'utan rubrik';
      const kindLabel =
        str(after.kind) === 'bug'
          ? 'Bugg'
          : str(after.kind) === 'feature'
            ? 'Önskemål'
            : str(after.kind) === 'change'
              ? 'Ändringsförslag'
              : 'Fråga';
      const areaLabel = str(after.area_label);
      const href = row.record_id ? `/onskemal#kort-${row.record_id}` : '/onskemal';
      if (after.deleted === true) {
        return { title: `${kindLabel} borttaget: "${title}"`, href: '/onskemal', icon: 'trash' };
      }
      if (action === 'create') {
        return {
          title: `${kindLabel} upplagt: "${title}"`,
          detail: areaLabel || undefined,
          href,
          icon: 'help'
        };
      }
      const field = str(row.field);
      if (field === 'answer') {
        return { title: `Svar på "${title}"`, detail: areaLabel || undefined, href, icon: 'message' };
      }
      if (field === 'status') {
        const status = str(after.status);
        return {
          title: status === 'done' ? `Klart: "${title}"` : `Återöppnat: "${title}"`,
          detail: areaLabel || undefined,
          href,
          icon: status === 'done' ? 'check' : 'help'
        };
      }
      return { title: `${kindLabel} ${changedVerb}: "${title}"`, detail: areaLabel || undefined, href, icon: 'pencil' };
    }
    case 'goal_import': {
      const created = typeof after.created === 'number' ? after.created : 0;
      const indicators = typeof after.indicators === 'number' ? after.indicators : 0;
      const year = str(after.year);
      return {
        title: `Mål importerade${year ? ` till ${year}` : ''}: ${created} nya mål, ${indicators} indikatorer`,
        href: year ? `/mal?ar=${year}` : '/mal',
        icon: 'upload'
      };
    }
    case 'contact_import': {
      const created = typeof after.created === 'number' ? after.created : 0;
      const updated = typeof after.updated === 'number' ? after.updated : 0;
      return {
        title: `Kontakter importerade: ${created} nya, ${updated} uppdaterade`,
        href: '/kontakter',
        icon: 'upload'
      };
    }

    // Upphandlingar & excellens-insatser (§ 39).
    case 'procurements': {
      const href = row.record_id ? `/upphandlingar/${row.record_id}` : '/upphandlingar';
      if (action === 'create') {
        return {
          title: `Ny upphandling: "${str(after.title) || 'utan titel'}"`,
          detail: str(after.supplier) || undefined,
          href,
          icon: 'briefcase'
        };
      }
      const field = str(row.field);
      return {
        title: field
          ? `Upphandling: ${field} ${changedVerb}`
          : `En upphandling ${changedVerb}`,
        detail: field === 'status' ? str(row.after_value) || undefined : undefined,
        href,
        icon: 'briefcase'
      };
    }

    case 'procurement_calloffs': {
      const procurementId = str(after.procurement);
      const startupName = str(after.startup_name);
      const href = procurementId ? `/upphandlingar/${procurementId}` : '/upphandlingar';
      if (action === 'create') {
        return {
          title: `Nytt avrop: ${startupName || 'bolag'}${str(after.procurement_title) ? ` — ${str(after.procurement_title)}` : ''}`,
          detail: str(after.title) || undefined,
          href,
          icon: 'briefcase'
        };
      }
      const field = str(row.field);
      const label =
        field === 'milestone_1_approved_at'
          ? 'Milstolpe 1 godkänd'
          : field === 'milestone_2_approved_at'
            ? 'Milstolpe 2 godkänd'
            : field === 'final_report_received_at'
              ? 'Slutrapport mottagen'
              : field === 'evaluation_score'
                ? 'Avrop utvärderat'
                : field
                  ? `Avrop: ${field} ${changedVerb}`
                  : `Ett avrop ${changedVerb}`;
      return {
        title: startupName ? `${label}: ${startupName}` : label,
        href,
        icon: field === 'evaluation_score' ? 'star' : 'check'
      };
    }

    case 'procurement_rules': {
      const name = str(after.name);
      if (after.deleted === true) {
        return { title: `Uppföljningsregel borttagen: "${name || 'regel'}"`, href: '/upphandlingar/regler', icon: 'gear' };
      }
      return {
        title: action === 'create' ? `Ny uppföljningsregel: "${name || 'regel'}"` : `Uppföljningsregel ${changedVerb}: "${name || 'regel'}"`,
        href: '/upphandlingar/regler',
        icon: 'gear'
      };
    }

    case 'procurement_followups': {
      const created = Number(after.created ?? 0);
      const resolved = Number(after.resolved ?? 0);
      const bits = [
        created > 0 ? `${created} nya uppföljningar` : null,
        resolved > 0 ? `${resolved} auto-stängda` : null
      ].filter(Boolean);
      return {
        title: `Uppföljning: ${str(after.procurement_title) || 'upphandling'}`,
        detail: bits.join(' · ') || undefined,
        href: row.record_id ? `/upphandlingar/${row.record_id}` : '/upphandlingar',
        icon: 'zap'
      };
    }

    case 'procurement_documents': {
      const procurementId = str(after.procurement);
      return {
        title: `Upphandlingsunderlag borttaget: "${str(after.filename) || 'dokument'}"`,
        href: procurementId ? `/upphandlingar/${procurementId}` : '/upphandlingar',
        icon: 'doc'
      };
    }

    // Stödcheckar & finansieringsprojekt (§ 46).
    case 'support_check_types': {
      const title = str(after.title);
      if (after.deleted === true) return { title: `Checktyp borttagen: "${title || 'checktyp'}"`, href: '/checkar/typer', icon: 'check' };
      return {
        title: action === 'create' ? `Ny checktyp: "${title || 'checktyp'}"` : `Checktyp ${changedVerb}${row.field ? ` (${fieldLabel(str(row.field))})` : ''}`,
        href: row.record_id ? `/checkar/typer/${row.record_id}` : '/checkar/typer',
        icon: 'check'
      };
    }
    case 'support_check_applications': {
      const href = row.record_id ? `/checkar/${row.record_id}` : '/checkar';
      const startupName = str(after.startup_name);
      const who = startupName ? `${startupName}: ` : '';
      if (action === 'create') {
        return { title: `${who}ny ansökan om ${str(after.check_type_title) || 'stödcheck'}`, detail: str(after.title) || undefined, href, icon: 'check' };
      }
      const field = str(row.field);
      if (field === 'status') {
        const status = str(after.status);
        const label: Record<string, string> = {
          submitted: 'Ansökan inskickad och signerad',
          changes_requested: 'Komplettering begärd',
          under_review: 'Under bedömning',
          approved: `Stödcheck beviljad${typeof after.approved_amount_sek === 'number' ? ` ${Math.round(after.approved_amount_sek).toLocaleString('sv-SE')} kr` : ''}`,
          rejected: 'Ansökan avslagen',
          paid: `Stödcheck utbetald${typeof after.paid_amount_sek === 'number' ? ` ${Math.round(after.paid_amount_sek).toLocaleString('sv-SE')} kr` : ''}`,
          closed: 'Stödcheck avslutad',
          withdrawn: 'Ansökan återkallad'
        };
        return {
          title: `${who}${label[status] ?? `status ${changedVerb}`}`,
          detail: str(after.project_title) || undefined,
          href,
          icon: status === 'approved' || status === 'paid' ? 'shield' : 'check'
        };
      }
      const fieldTitle: Record<string, string> = {
        coach_statement: 'Coachutlåtande lämnat',
        controller_statement: 'Controllerutlåtande lämnat',
        assessment_score: 'Ansökan bedömd',
        funding: 'Finansiering satt',
        final_report_received_at: 'Slutrapport mottagen',
        draft: 'Ansökan uppdaterad'
      };
      return { title: `${who}${fieldTitle[field] ?? `ansökan ${changedVerb}`}`, href, icon: 'check' };
    }
    case 'support_check_comments': {
      const appId = str(after.application);
      return {
        title: `${str(after.startup_name) ? `${str(after.startup_name)}: ` : ''}${action === 'create' ? (after.visible_to_applicant ? 'kompletteringspunkt' : 'intern kommentar') : 'punkt ' + changedVerb}`,
        href: appId ? `/checkar/${appId}#kommentarer` : '/checkar',
        icon: 'message'
      };
    }
    case 'support_check_documents': {
      const appId = str(after.application);
      return {
        title: after.deleted === true ? `Bilaga borttagen: "${str(after.filename) || 'fil'}"` : `${str(after.startup_name) ? `${str(after.startup_name)}: ` : ''}bilaga uppladdad — ${str(after.filename) || 'fil'}`,
        href: appId ? `/checkar/${appId}` : '/checkar',
        icon: 'doc'
      };
    }
    case 'support_check_rules': {
      const name = str(after.name);
      if (after.deleted === true) return { title: `Uppföljningsregel borttagen: "${name || 'regel'}"`, href: '/checkar/regler', icon: 'gear' };
      return { title: action === 'create' ? `Ny uppföljningsregel (stödcheckar): "${name || 'regel'}"` : `Uppföljningsregel ${changedVerb}: "${name || 'regel'}"`, href: '/checkar/regler', icon: 'gear' };
    }
    case 'support_check_followups': {
      const created = Number(after.created ?? 0);
      const resolved = Number(after.resolved ?? 0);
      const bits = [created > 0 ? `${created} nya uppföljningar` : null, resolved > 0 ? `${resolved} auto-stängda` : null].filter(Boolean);
      return {
        title: `Uppföljning: ${str(after.startup_name) || 'stödcheck'}${str(after.application_title) ? ` — ${str(after.application_title)}` : ''}`,
        detail: bits.join(' · ') || undefined,
        href: row.record_id ? `/checkar/${row.record_id}` : '/checkar',
        icon: 'zap'
      };
    }
    case 'funding_projects': {
      const title = str(after.title);
      if (after.deleted === true) return { title: `Finansieringsprojekt borttaget: "${title || 'projekt'}"`, href: '/projekt', icon: 'graph' };
      return {
        title: action === 'create' ? `Nytt finansieringsprojekt: "${title || 'projekt'}"` : `Finansieringsprojekt ${changedVerb}${row.field ? ` (${fieldLabel(str(row.field))})` : ''}`,
        href: row.record_id ? `/projekt/${row.record_id}` : '/projekt',
        icon: 'graph'
      };
    }
    case 'funding_work_packages': {
      const projectId = str(after.project);
      const label = `${str(after.code) ? `${str(after.code)} ` : ''}${str(after.title) || 'arbetspaket'}`;
      return {
        title: after.deleted === true ? `Arbetspaket borttaget: ${label}` : action === 'create' ? `Nytt arbetspaket: ${label}` : `Arbetspaket ${changedVerb}: ${label}`,
        detail: str(after.project_title) || undefined,
        href: projectId ? `/projekt/${projectId}` : '/projekt',
        icon: 'graph'
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
  perPage = 60,
  opts: {
    /** Bara rader där denna användare är actor (den personliga loggen på `/chatt`). */
    actorId?: string;
  } = {}
): Promise<AgentLogEntry[]> {
  let rows: AgentActionRow[] = [];
  try {
    const res = await pb.collection('agent_actions').getList<AgentActionRow>(1, perPage, {
      filter: opts.actorId
        ? pb.filter('tenant = {:tenant} && actor = {:actor}', { tenant, actor: opts.actorId })
        : pb.filter('tenant = {:tenant}', { tenant }),
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
      icon: mapped.icon,
      collection: row.collection,
      recordId: row.record_id,
      actionType: row.action_type
    });
  }
  return entries;
}
