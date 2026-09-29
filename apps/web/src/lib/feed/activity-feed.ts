import 'server-only';
import type PocketBase from 'pocketbase';
import type { DashboardActivity } from '@/components/DashboardChat';
import { loadAgentLogEntries, type AgentLogEntry } from './agent-log';
import {
  buildPersonalFeedItems,
  sortNewestFirst,
  type AgreementRow,
  type DocumentAssignmentRow,
  type EducationDocumentRow,
  type EventSignupRow,
  type MissionDocumentRow,
  type MissionRow,
  type NoteRow,
  type OrgKnowledgeRow,
  type OwnActivityRow,
  type TaskRow,
  type ToolRunRow,
  type UserFileRow,
  type WorkshopAssignmentRow
} from '@/lib/personal-feed';

/**
 * Den samlade aktivitetsloggen (CLAUDE.md § 32) som EN kronologisk lista:
 * bolagshändelser (`activities`) + systemloggen (`agent_actions` via
 * skrivlagret). Delas av chatten (`/chatt`) och Dashboard (`/hem`) så de två
 * ytorna aldrig får divergerande feed-logik.
 *
 * Läser med användarens egen token → RLS gäller (§ 21). Fail-soft per källa:
 * kan en inte läsas visas feeden utan den.
 */

interface ActivityRow {
  id: string;
  title: string;
  kind?: string;
  type?: string;
  created: string;
  expand?: {
    startup?: { id: string; name: string };
    tool?: { id: string; icon?: string };
  };
}

export async function loadActivityFeed(
  pb: PocketBase,
  tenant: string,
  limit = 60
): Promise<DashboardActivity[]> {
  const [activitiesRes, logRes] = await Promise.allSettled([
    // Verksamhetsövergripande aktivitetslogg — tenant-scopad via startup.tenant
    // (samma regel som /aktivitet). Bara händelser knutna till ett bolag.
    pb.collection('activities').getList<ActivityRow>(1, Math.min(limit, 60), {
      filter: pb.filter('startup.tenant = {:tenant}', { tenant }),
      sort: '-created',
      expand: 'startup,tool',
      fields:
        'id,title,kind,type,created,expand.startup.id,expand.startup.name,expand.tool.id,expand.tool.icon'
    }),
    loadAgentLogEntries(pb, tenant)
  ]);

  const activityRows = activitiesRes.status === 'fulfilled' ? activitiesRes.value.items : [];
  const logEntries = logRes.status === 'fulfilled' ? logRes.value : [];

  return [
    ...activityRows.map(
      (a): DashboardActivity => ({
        id: `act-${a.id}`,
        title: a.title,
        kind: a.kind,
        type: a.type,
        created: a.created,
        startupName: a.expand?.startup?.name,
        startupId: a.expand?.startup?.id,
        toolIcon: a.expand?.tool?.icon
      })
    ),
    ...logEntries.map(
      (e): DashboardActivity => ({
        id: `log-${e.id}`,
        title: e.title,
        kind: 'system_log',
        created: e.created,
        startupName: e.detail,
        href: e.href,
        icon: e.icon,
        actorName: e.actorName,
        viaAgent: e.viaAgent
      })
    )
  ]
    .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
    .slice(0, limit);
}

/**
 * Den PERSONLIGA loggen under chatten (`/chatt`, § 32): allt den inloggade
 * själv är inblandad i — det hen gjort (skrivlagrets logg med `actor = jag`,
 * filer, kunskapsbas, dokument, anteckningar, agentkörningar, tilldelningar)
 * och det hen dragits in i (uppdragsteam, uppgifter, inbjudningar,
 * medarbetarskap). Tenant-bred portföljdata visas i stället på `/hem`
 * (Bolagsnytt) och `/aktivitet`.
 *
 * Alla källor läses med användarens egen token (RLS, § 21) och varje källa
 * är fail-soft — en kollektion som saknas på instansen (omigrerad) eller
 * nekas tar bara bort sina egna rader, aldrig hela loggen. Mappningen är
 * ren och enhetstestad i `lib/personal-feed.ts`.
 */
export async function loadPersonalActivityFeed(
  pb: PocketBase,
  tenant: string,
  userId: string,
  limit = 60
): Promise<DashboardActivity[]> {
  const t = { tenant, me: userId };
  const list = <T>(collection: string, filter: string, extra: Record<string, string> = {}) =>
    pb.collection(collection).getList<T>(1, 20, {
      filter: pb.filter(filter, t),
      sort: '-created',
      ...extra
    });

  const settled = await Promise.allSettled([
    loadAgentLogEntries(pb, tenant, Math.min(limit, 60), { actorId: userId }),
    list<UserFileRow>('user_files', 'tenant = {:tenant} && owner = {:me}', {
      fields: 'id,filename,source,created'
    }),
    list<OrgKnowledgeRow>('org_knowledge', 'tenant = {:tenant} && created_by = {:me}', {
      fields: 'id,title,filename,created'
    }),
    list<EducationDocumentRow>('education_documents', 'tenant = {:tenant} && uploaded_by = {:me}', {
      fields: 'id,title,created'
    }),
    // Multi-relationer matchas med `~` (LIKE på den lagrade JSON-listan) —
    // det fungerar oavsett PB v0.23.4:s `?=`-bugg (§ 21.3). Id:n är 15 tecken
    // slumpmässiga, så en delsträngsträff på fel id är i praktiken utesluten.
    // `recipients` härleds alltid ur participants_json av mission-actions, så
    // teammedlemskap fångas via relationen (participants_json läses bara för
    // `added_at`).
    list<MissionRow>(
      'missions',
      'tenant = {:tenant} && (issuer = {:me} || mentor = {:me} || recipients ~ {:me})',
      { expand: 'startup', fields: 'id,title,issuer,recipients,mentor,participants_json,created,expand.startup.id,expand.startup.name' }
    ),
    list<TaskRow>('tasks', 'tenant = {:tenant} && (owner = {:me} || assignees ~ {:me})', {
      expand: 'startup',
      fields: 'id,description,owner,assignees,startup,mission,procurement,created,expand.startup.id,expand.startup.name'
    }),
    list<EventSignupRow>('event_signups', 'tenant = {:tenant} && user = {:me}', {
      expand: 'event',
      fields: 'id,event,created,expand.event.id,expand.event.name,expand.event.starts_at'
    }),
    list<WorkshopAssignmentRow>(
      'workshop_assignments',
      'tenant = {:tenant} && (assigned_by = {:me} || collaborators ~ {:me})',
      { expand: 'workshop,startup', fields: 'id,assigned_by,collaborators,created,expand.workshop.title,expand.startup.id,expand.startup.name' }
    ),
    list<DocumentAssignmentRow>(
      'education_document_assignments',
      'tenant = {:tenant} && (assigned_by = {:me} || collaborators ~ {:me})',
      { expand: 'document,startup', fields: 'id,startup,assigned_by,collaborators,created,expand.document.title,expand.startup.id,expand.startup.name' }
    ),
    // Aldrig `body` — bara att en anteckning skrevs, på vilket bolag.
    list<NoteRow>('notes', 'startup.tenant = {:tenant} && author = {:me}', {
      expand: 'startup',
      fields: 'id,startup,created,expand.startup.id,expand.startup.name'
    }),
    list<MissionDocumentRow>('mission_documents', 'tenant = {:tenant} && uploaded_by = {:me}', {
      expand: 'mission',
      fields: 'id,title,filename,mission,created,expand.mission.title'
    }),
    // Aldrig messages/output — bara vilken agent, för vilket bolag, när.
    list<ToolRunRow>('tool_runs', 'tenant = {:tenant} && triggered_by = {:me} && tool != ""', {
      expand: 'tool,startup',
      fields: 'id,tool,created,expand.tool.name,expand.startup.id,expand.startup.name'
    }),
    list<AgreementRow>('agreements', 'startup.tenant = {:tenant} && assigned_by = {:me}', {
      expand: 'startup',
      fields: 'id,title,startup,sent_at,created,expand.startup.id,expand.startup.name'
    }),
    list<OwnActivityRow>('activities', 'startup.tenant = {:tenant} && owner = {:me}', {
      expand: 'startup',
      fields: 'id,title,kind,created,expand.startup.id,expand.startup.name'
    })
  ]);

  const items = <T>(i: number): T[] => {
    const r = settled[i];
    if (r.status !== 'fulfilled') return [];
    const v = r.value as unknown;
    return Array.isArray(v) ? (v as T[]) : ((v as { items?: T[] }).items ?? []);
  };

  const logEntries = items<AgentLogEntry>(0);
  const loggedKeys = new Set(
    logEntries
      .filter((e) => e.collection && e.recordId)
      .map((e) => `${e.collection}:${e.recordId}`)
  );

  const direct = buildPersonalFeedItems({
    me: userId,
    loggedKeys,
    userFiles: items<UserFileRow>(1),
    orgKnowledge: items<OrgKnowledgeRow>(2),
    educationDocuments: items<EducationDocumentRow>(3),
    missions: items<MissionRow>(4),
    tasks: items<TaskRow>(5),
    eventSignups: items<EventSignupRow>(6),
    workshopAssignments: items<WorkshopAssignmentRow>(7),
    documentAssignments: items<DocumentAssignmentRow>(8),
    notes: items<NoteRow>(9),
    missionDocuments: items<MissionDocumentRow>(10),
    toolRuns: items<ToolRunRow>(11),
    agreements: items<AgreementRow>(12),
    activities: items<OwnActivityRow>(13)
  });

  const merged: DashboardActivity[] = [
    ...logEntries.map(
      (e): DashboardActivity => ({
        id: `log-${e.id}`,
        title: e.title,
        kind: 'system_log',
        created: e.created,
        startupName: e.detail,
        href: e.href,
        icon: e.icon,
        actorName: e.actorName,
        viaAgent: e.viaAgent
      })
    ),
    ...direct.map(
      (d): DashboardActivity => ({
        id: d.id,
        title: d.title,
        kind: 'personal',
        created: d.created,
        startupName: d.detail,
        href: d.href,
        icon: d.icon
      })
    )
  ];
  return sortNewestFirst(merged).slice(0, limit);
}
