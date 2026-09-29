/**
 * Personlig aktivitetslogg — REN mappning (ingen IO, enhetstestad).
 *
 * Loggen under chatten (`/chatt`, CLAUDE.md § 32) visar allt den inloggade
 * själv är inblandad i: det hen gjort (filer, dokument, anteckningar,
 * agentkörningar, tilldelningar) och det hen dragits in i (uppdragsteam,
 * uppgifter, inbjudningar). Den här modulen översätter råa PB-rader från de
 * direkta källorna till feed-poster i du-form. IO:t (vilka rader som läses,
 * med användarens egen token → RLS) ligger i `lib/feed/activity-feed.ts`.
 *
 * PII: titlarna byggs av verksamhetsdata (dokumenttitlar, uppdrags-/
 * workshop-titlar, bolagsnamn, eventnamn) — aldrig e-post, aldrig
 * anteckningstext. Det PERSONLIGA filarkivet (`user_files`, § 17.2) loggas
 * medvetet INTE: det är privat arbetsyta och ska inte kännas övervakad. Det
 * som syns är gemensamt material (kunskapsbas, utbildningsdokument,
 * uppdragsdokumentation) och det som rör andra.
 */

export interface PersonalFeedItem {
  id: string;
  title: string;
  detail?: string;
  created: string;
  href?: string;
  icon: string;
}

interface StartupRef {
  id?: string;
  name?: string;
}

export interface OrgKnowledgeRow {
  id: string;
  title?: string;
  filename?: string;
  created: string;
}

export interface EducationDocumentRow {
  id: string;
  title?: string;
  created: string;
}

export interface MissionParticipantRow {
  user_id?: string;
  role?: string;
  added_at?: string;
}

export interface MissionRow {
  id: string;
  title?: string;
  issuer?: string;
  recipients?: string[];
  mentor?: string;
  participants_json?: MissionParticipantRow[] | null;
  created: string;
  expand?: { startup?: StartupRef };
}

export interface TaskRow {
  id: string;
  description?: string;
  owner?: string;
  assignees?: string[];
  startup?: string;
  mission?: string;
  procurement?: string;
  created: string;
  expand?: { startup?: StartupRef };
}

export interface EventSignupRow {
  id: string;
  event?: string;
  created: string;
  expand?: { event?: { id?: string; name?: string; starts_at?: string } };
}

export interface WorkshopAssignmentRow {
  id: string;
  assigned_by?: string;
  collaborators?: string[];
  created: string;
  expand?: { workshop?: { title?: string }; startup?: StartupRef };
}

export interface DocumentAssignmentRow {
  id: string;
  startup?: string;
  assigned_by?: string;
  collaborators?: string[];
  created: string;
  expand?: { document?: { title?: string }; startup?: StartupRef };
}

export interface NoteRow {
  id: string;
  startup?: string;
  created: string;
  expand?: { startup?: StartupRef };
}

export interface MissionDocumentRow {
  id: string;
  title?: string;
  filename?: string;
  mission?: string;
  created: string;
  expand?: { mission?: { title?: string } };
}

export interface ToolRunRow {
  id: string;
  tool?: string;
  created: string;
  expand?: { tool?: { name?: string }; startup?: StartupRef };
}

export interface AgreementRow {
  id: string;
  title?: string;
  startup?: string;
  sent_at?: string;
  created: string;
  expand?: { startup?: StartupRef };
}

export interface OwnActivityRow {
  id: string;
  title?: string;
  kind?: string;
  created: string;
  expand?: { startup?: StartupRef };
}

export interface PersonalFeedSources {
  /** Den inloggades user-id. */
  me: string;
  orgKnowledge?: OrgKnowledgeRow[];
  educationDocuments?: EducationDocumentRow[];
  missions?: MissionRow[];
  tasks?: TaskRow[];
  eventSignups?: EventSignupRow[];
  workshopAssignments?: WorkshopAssignmentRow[];
  documentAssignments?: DocumentAssignmentRow[];
  notes?: NoteRow[];
  missionDocuments?: MissionDocumentRow[];
  toolRuns?: ToolRunRow[];
  agreements?: AgreementRow[];
  activities?: OwnActivityRow[];
  /**
   * `${collection}:${record_id}` för poster som REDAN finns i den inloggades
   * `agent_actions`-logg (skrivlagret). En direkt rad för samma post hoppas
   * över så samma händelse inte visas två gånger.
   */
  loggedKeys?: Set<string>;
}

function q(s: string | undefined, fallback: string): string {
  const t = (s ?? '').trim();
  return `"${t || fallback}"`;
}

function trunc(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function includes(list: unknown, id: string): boolean {
  return Array.isArray(list) && list.some((v) => v === id);
}

function startupName(r: { expand?: { startup?: StartupRef } }): string | undefined {
  return r.expand?.startup?.name || undefined;
}

function isoOrFallback(candidate: string | undefined, fallback: string): string {
  if (candidate && !Number.isNaN(new Date(candidate).getTime())) return candidate;
  return fallback;
}

/** Bygger feed-poster i du-form ur de direkta källorna. Ordningen sätts av anroparen. */
export function buildPersonalFeedItems(src: PersonalFeedSources): PersonalFeedItem[] {
  const me = src.me;
  const logged = src.loggedKeys ?? new Set<string>();
  const out: PersonalFeedItem[] = [];

  for (const k of src.orgKnowledge ?? []) {
    out.push({
      id: `knowledge-${k.id}`,
      title: `Du laddade upp ${q(k.title || k.filename, 'dokument')} till kunskapsbasen`,
      created: k.created,
      href: '/kunskapsbas',
      icon: 'doc'
    });
  }

  for (const d of src.educationDocuments ?? []) {
    out.push({
      id: `edudoc-${d.id}`,
      title: `Du laddade upp utbildningsdokumentet ${q(d.title, 'dokument')}`,
      created: d.created,
      href: '/education/documents',
      icon: 'cap'
    });
  }

  for (const m of src.missions ?? []) {
    const mine = (m.participants_json ?? []).find((p) => p?.user_id === me);
    const isIssuer = m.issuer === me;
    const isRecipient = includes(m.recipients, me) || (!!mine && mine.role !== 'observer');
    const isMentor = m.mentor === me || mine?.role === 'observer';
    if (!isIssuer && !isRecipient && !isMentor) continue;
    if (isIssuer && logged.has(`missions:${m.id}`)) continue; // redan i skrivlagrets logg
    const title = isIssuer
      ? `Du skapade uppdraget ${q(m.title, 'utan titel')}`
      : isRecipient
        ? `Du ingår i teamet för uppdraget ${q(m.title, 'utan titel')}`
        : `Du är mentor i uppdraget ${q(m.title, 'utan titel')}`;
    out.push({
      id: `mission-${m.id}`,
      title,
      detail: startupName(m),
      // När någon lade till dig i teamet i efterhand är det den tidpunkten som
      // gäller — inte när uppdraget skapades.
      created: isIssuer ? m.created : isoOrFallback(mine?.added_at, m.created),
      href: `/uppdrag/${m.id}`,
      icon: 'people'
    });
  }

  for (const t of src.tasks ?? []) {
    const involved = t.owner === me || includes(t.assignees, me);
    if (!involved) continue;
    if (logged.has(`tasks:${t.id}`)) continue; // du skapade kortet själv (loggat)
    const href = t.startup
      ? `/startups/${t.startup}/aktiviteter`
      : t.mission
        ? `/uppdrag/${t.mission}`
        : t.procurement
          ? `/upphandlingar/${t.procurement}`
          : '/inkorg';
    out.push({
      id: `task-${t.id}`,
      title: `Uppgift till dig: ${q(trunc((t.description ?? '').trim(), 70), 'uppgift')}`,
      detail: startupName(t),
      created: t.created,
      href,
      icon: 'check'
    });
  }

  for (const s of src.eventSignups ?? []) {
    const ev = s.expand?.event;
    const eventId = ev?.id || s.event;
    const starts = ev?.starts_at ? new Date(ev.starts_at) : null;
    out.push({
      id: `signup-${s.id}`,
      title: `Du bjöds in till ${q(ev?.name, 'ett event')}`,
      detail:
        starts && !Number.isNaN(starts.getTime())
          ? starts.toLocaleDateString('sv-SE', {
              day: 'numeric',
              month: 'short',
              timeZone: 'Europe/Stockholm'
            })
          : undefined,
      created: s.created,
      href: eventId ? `/events/${eventId}` : '/events',
      icon: 'calendar'
    });
  }

  for (const a of src.workshopAssignments ?? []) {
    const assigner = a.assigned_by === me;
    const collaborator = includes(a.collaborators, me);
    if (!assigner && !collaborator) continue;
    if (assigner && logged.has(`workshop_assignments:${a.id}`)) continue;
    const ws = q(a.expand?.workshop?.title, 'workshop');
    out.push({
      id: `wsassign-${a.id}`,
      title: assigner
        ? `Du tilldelade workshopen ${ws}`
        : `Du bjöds in som medarbetare på workshopen ${ws}`,
      detail: startupName(a),
      created: a.created,
      href: `/education/assignments/${a.id}`,
      icon: 'cap'
    });
  }

  for (const a of src.documentAssignments ?? []) {
    const assigner = a.assigned_by === me;
    const collaborator = includes(a.collaborators, me);
    if (!assigner && !collaborator) continue;
    if (assigner && logged.has(`education_document_assignments:${a.id}`)) continue;
    const doc = q(a.expand?.document?.title, 'dokument');
    const startupId = a.expand?.startup?.id || a.startup;
    out.push({
      id: `docassign-${a.id}`,
      title: assigner
        ? `Du tilldelade utbildningsdokumentet ${doc}`
        : `Du bjöds in som medarbetare på dokumentet ${doc}`,
      detail: startupName(a),
      created: a.created,
      href: startupId ? `/startups/${startupId}` : '/education/documents',
      icon: 'doc'
    });
  }

  for (const n of src.notes ?? []) {
    if (logged.has(`notes:${n.id}`)) continue;
    const startupId = n.expand?.startup?.id || n.startup;
    const name = startupName(n);
    out.push({
      id: `note-${n.id}`,
      title: name ? `Du skrev en anteckning på ${name}` : 'Du skrev en anteckning på ett bolagskort',
      created: n.created,
      href: startupId ? `/startups/${startupId}` : undefined,
      icon: 'pencil'
    });
  }

  for (const d of src.missionDocuments ?? []) {
    const missionTitle = d.expand?.mission?.title;
    out.push({
      id: `missiondoc-${d.id}`,
      title: `Du laddade upp ${q(d.title || d.filename, 'dokument')} till uppdraget ${q(missionTitle, 'uppdrag')}`,
      created: d.created,
      href: d.mission ? `/uppdrag/${d.mission}` : '/uppdrag',
      icon: 'upload'
    });
  }

  for (const r of src.toolRuns ?? []) {
    if (!r.tool) continue; // connector-chattar utan agent hoppas över
    out.push({
      id: `run-${r.id}`,
      title: `Du körde agenten ${q(r.expand?.tool?.name, 'AI-agent')}`,
      detail: startupName(r),
      created: r.created,
      href: `/toolbox/runs/${r.id}`,
      icon: 'sparkle'
    });
  }

  for (const a of src.agreements ?? []) {
    const startupId = a.expand?.startup?.id || a.startup;
    out.push({
      id: `agreement-${a.id}`,
      title: `Du tilldelade avtalet ${q(a.title, 'avtal')}`,
      detail: startupName(a),
      created: isoOrFallback(a.sent_at, a.created),
      href: startupId ? `/startups/${startupId}` : undefined,
      icon: 'file-text'
    });
  }

  for (const act of src.activities ?? []) {
    // Workshop-tilldelningar visas redan via den direkta raden ovan.
    if (act.kind === 'workshop_assignment') continue;
    if (logged.has(`activities:${act.id}`)) continue;
    const startupId = act.expand?.startup?.id;
    out.push({
      id: `act-${act.id}`,
      title: (act.title ?? '').trim() || 'Aktivitet',
      detail: startupName(act),
      created: act.created,
      href: startupId ? `/startups/${startupId}` : undefined,
      icon: act.kind === 'tool_run' ? 'sparkle' : act.kind === 'workshop_run' ? 'cap' : 'dot'
    });
  }

  return out;
}

/** Nyast först; rader utan tolkbar tidsstämpel hamnar sist. */
export function sortNewestFirst<T extends { created: string }>(items: T[]): T[] {
  const time = (s: string) => {
    const t = new Date(s).getTime();
    return Number.isNaN(t) ? -Infinity : t;
  };
  return [...items].sort((a, b) => time(b.created) - time(a.created));
}
