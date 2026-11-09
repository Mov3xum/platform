import 'server-only';
import type PocketBase from 'pocketbase';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { getAssignmentReadPb } from '@/lib/assignments/read';
import { toolRunStatusLabels, type ToolRunStatus } from '@/lib/labels';
import type { EducationDocumentAssignment } from '@platform/shared';
import type { WorkCard } from '@/components/StartupWorkCards';
import { relDays } from './ui';

export interface WorkshopAssignmentRecord {
  id: string;
  status: 'planned' | 'in_progress' | 'done';
  due_date?: string;
  instructions?: string;
  takeaway_json?: { summary?: string; keyInsights?: string; prioritizedActions?: string; artifacts?: string };
  created: string;
  completed_at?: string;
  expand?: {
    workshop?: { id: string; title: string; version?: string };
    assigned_by?: { id: string; display_name?: string; email: string };
    collaborators?: Array<{ id: string; display_name?: string; email: string }>;
    meeting?: { id: string; name: string; starts_at: string; location?: string };
  };
}

export interface ToolRunRecord {
  id: string;
  tool?: string;
  status: ToolRunStatus;
  deadline?: string;
  created: string;
  expand?: { tool?: { id: string; name: string; category: string } };
}

export interface StartupAssignments {
  toolRuns: ToolRunRecord[];
  workshops: WorkshopAssignmentRecord[];
  documents: EducationDocumentAssignment[];
  done: WorkCard[];
  pending: WorkCard[];
  /** Någon av källorna kunde inte läsas — visas, aldrig tyst tomt. */
  failed: boolean;
}

const DONE_RUN = new Set<ToolRunStatus>(['succeeded', 'approved', 'ready_for_review']);
const PENDING_RUN = new Set<ToolRunStatus>(['assigned', 'in_progress', 'queued', 'running']);

function deadline(iso?: string): { label?: string; overdue: boolean } {
  if (!iso) return { overdue: false };
  const diff = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (diff < 0) return { label: `försenad ${-diff} dgr`, overdue: true };
  if (diff === 0) return { label: 'deadline i dag', overdue: false };
  return { label: `deadline om ${diff} dgr`, overdue: false };
}

/**
 * Bolagets tilldelningar: verktygskörningar, workshops och utbildnings-
 * dokument, plus korten "gjort" / "väntar". Tilldelningarna läses via den
 * robusta klienten (PB v0.23.4, § 21.3) — åtkomsten till bolaget är redan
 * verifierad av `loadStartupPage`, och frågorna är tenant+bolag-scopade.
 */
export async function loadStartupAssignments(
  pb: PocketBase,
  tenant: string,
  startupId: string
): Promise<StartupAssignments> {
  const assignPb = await getAssignmentReadPb();
  const scope = pb.filter('startup = {:startup} && tenant = {:tenant}', { startup: startupId, tenant });
  const [runsRes, wsRes, docsRes] = await Promise.allSettled([
    pb.collection('tool_runs').getList<ToolRunRecord>(1, 100, { filter: scope, sort: '-created', expand: 'tool' }),
    assignPb
      .collection(PB_COLLECTIONS.workshopAssignments)
      .getList<WorkshopAssignmentRecord>(1, 50, { filter: scope, sort: '-created', expand: 'workshop,assigned_by,collaborators,meeting' }),
    assignPb
      .collection(PB_COLLECTIONS.educationDocumentAssignments)
      .getList<EducationDocumentAssignment>(1, 100, { filter: scope, sort: '-created', expand: 'document,completed_by,collaborators,meeting' })
  ]);
  const toolRuns = runsRes.status === 'fulfilled' ? runsRes.value.items : [];
  const workshops = wsRes.status === 'fulfilled' ? wsRes.value.items : [];
  const documents = docsRes.status === 'fulfilled' ? docsRes.value.items : [];

  const done: WorkCard[] = [];
  const pending: WorkCard[] = [];
  for (const run of toolRuns) {
    if (run.status === 'rejected' || run.status === 'failed') continue;
    const card: WorkCard = {
      id: run.id,
      kind: 'tool',
      title: run.expand?.tool?.name || 'Verktyg',
      statusLabel: toolRunStatusLabels[run.status],
      href: `/startups/${startupId}/verktyg/${run.id}`
    };
    if (DONE_RUN.has(run.status)) done.push({ ...card, dateLabel: relDays(run.created) });
    else if (PENDING_RUN.has(run.status)) {
      const dl = deadline(run.deadline);
      pending.push({ ...card, dateLabel: dl.label, overdue: dl.overdue });
    }
  }
  for (const wa of workshops) {
    const card: WorkCard = {
      id: wa.id,
      kind: 'workshop',
      title: wa.expand?.workshop?.title || 'Workshop',
      statusLabel: wa.status === 'done' ? 'Klar' : wa.status === 'in_progress' ? 'Pågår' : 'Planerad',
      href: `/education/assignments/${wa.id}`
    };
    if (wa.status === 'done') done.push({ ...card, dateLabel: relDays(wa.completed_at || wa.created) });
    else {
      const dl = deadline(wa.due_date);
      pending.push({ ...card, dateLabel: dl.label, overdue: dl.overdue });
    }
  }
  for (const da of documents) {
    const card: WorkCard = {
      id: da.id,
      kind: 'document',
      title: da.expand?.document?.title || 'Dokument',
      statusLabel: da.status === 'completed' ? 'Slutförd' : 'Tilldelad',
      href: `/startups/${startupId}/dokument#utbildningsdokument`
    };
    if (da.status === 'completed') done.push({ ...card, dateLabel: relDays(da.completed_at || da.created) });
    else {
      const dl = deadline(da.due_date);
      pending.push({ ...card, dateLabel: dl.label, overdue: dl.overdue });
    }
  }
  // Försenat först, sedan närmast deadline (etiketten bär redan dagarna).
  pending.sort((a, b) => Number(Boolean(b.overdue)) - Number(Boolean(a.overdue)));

  return {
    toolRuns,
    workshops,
    documents,
    done,
    pending,
    failed: [runsRes, wsRes, docsRes].some((r) => r.status === 'rejected')
  };
}
