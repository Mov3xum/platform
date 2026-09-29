import 'server-only';
import type PocketBase from 'pocketbase';
import { planSupportCheckFollowups, type ExistingFollowupTask, type SupportCheckRule } from '@platform/shared';
import type { Actor } from '@/lib/core/write';
import { followupSchemaError, syncFollowupTasks, type FollowupSyncCounts } from '@/lib/followups/sync';
import { ensureSupportCheckRules, getApplication, listApplications, listCheckTypes, typesById, type ApplicationRow } from './data';

/**
 * Stödcheckarnas uppföljningssynk (CLAUDE.md § 46.6) — tunt domänskal över
 * den generiska `syncFollowupTasks` (§ 40): läser ansökan + checktyp + regler,
 * planerar via adaptern och lämnar skapa/flytta/auto-stäng till motorn.
 * Länkfältet `support_check_application` gör att bolagets kanban hittar
 * korten via ansökans `startup`; inget `startup` sätts på kortet (§ 21).
 * Nycklarna bär prefixet `check:` (§ 40.2). Ägare av nya kort = bolagets
 * coach (första i `coaches`), annars ansökans skapare, annars aktören.
 */

export interface SupportCheckSyncResult extends FollowupSyncCounts {
  applicationId: string;
}

const SCHEMA_HINT = 'migration 1700000168 (tasks.support_check_application, tasks.rule_key)';

interface TaskRow extends ExistingFollowupTask {
  tenant: string;
}

async function listRuleTasks(pb: PocketBase, tenantId: string, applicationId: string): Promise<TaskRow[]> {
  return pb.collection('tasks').getFullList<TaskRow>({
    filter: pb.filter('tenant = {:t} && support_check_application = {:a} && rule_key != ""', { t: tenantId, a: applicationId }),
    fields: 'id,tenant,rule_key,status,due_at,description',
    batch: 500
  });
}

async function ownerFor(pb: PocketBase, app: ApplicationRow, actor: Actor): Promise<string> {
  try {
    const s = await pb.collection('startups').getOne<{ coaches?: string[]; owner?: string }>(app.startup, { fields: 'id,coaches,owner' });
    const coach = Array.isArray(s.coaches) && s.coaches.length > 0 ? String(s.coaches[0]) : '';
    if (coach) return coach;
    if (s.owner) return String(s.owner);
  } catch {
    /* fail-soft */
  }
  return app.created_by || actor.id;
}

export async function syncSupportCheckFollowups(
  pb: PocketBase,
  actor: Actor,
  applicationId: string,
  opts: { rules?: SupportCheckRule[]; application?: ApplicationRow } = {}
): Promise<SupportCheckSyncResult> {
  const app = opts.application ?? (await getApplication(pb, actor.tenant, applicationId));
  if (!app) return { applicationId, created: 0, updated: 0, resolved: 0, error: 'Ansökan hittades inte.' };
  // Reglerna läses STRIKT: ett läsfel avbryter synken i stället för att
  // tolkas som "inga regler" (vilket skulle auto-stänga varje öppet kort).
  let rules: SupportCheckRule[];
  try {
    rules = opts.rules ?? (await ensureSupportCheckRules(pb, actor.tenant, actor));
  } catch (err) {
    console.warn('[support-checks] followup sync: could not read rules', { tenant: actor.tenant, applicationId, error: err instanceof Error ? err.message : err });
    return { applicationId, created: 0, updated: 0, resolved: 0, error: 'Uppföljningsreglerna kunde inte läsas — synken hoppades över.' };
  }
  const types = await listCheckTypes(pb, actor.tenant);
  let existing: TaskRow[];
  try {
    existing = await listRuleTasks(pb, actor.tenant, app.id);
  } catch (err) {
    console.warn('[support-checks] followup sync: could not read tasks', { tenant: actor.tenant, applicationId, error: err instanceof Error ? err.message : err });
    return { applicationId, created: 0, updated: 0, resolved: 0, error: followupSchemaError(SCHEMA_HINT) };
  }
  const counts = await syncFollowupTasks(pb, actor, {
    plan: planSupportCheckFollowups({ applications: [app], types: typesById(types), rules }),
    existing,
    linkKind: 'support_check',
    linkFields: (w) => ({ support_check_application: w.applicationId }),
    owner: await ownerFor(pb, app, actor),
    requiredFields: ['support_check_application'],
    schemaHint: SCHEMA_HINT,
    audit: {
      collection: 'support_check_followups',
      recordId: app.id,
      context: { application_title: app.title ?? '', startup: app.startup, startup_name: app.startup_name ?? '' }
    }
  });
  return { applicationId: app.id, ...counts };
}

/** Lazy synk av alla öppna ansökningar (körs när /checkar öppnas av staff). */
export async function syncAllSupportCheckFollowups(pb: PocketBase, actor: Actor): Promise<SupportCheckSyncResult[]> {
  const apps = await listApplications(pb, actor.tenant, {
    statuses: ['submitted', 'changes_requested', 'under_review', 'approved', 'paid']
  });
  let rules: SupportCheckRule[];
  try {
    rules = await ensureSupportCheckRules(pb, actor.tenant, actor);
  } catch (err) {
    console.warn('[support-checks] followup sync: could not read rules', { tenant: actor.tenant, error: err instanceof Error ? err.message : err });
    return apps.map((a) => ({ applicationId: a.id, created: 0, updated: 0, resolved: 0, error: 'Uppföljningsreglerna kunde inte läsas — synken hoppades över.' }));
  }
  const out: SupportCheckSyncResult[] = [];
  const schemaError = followupSchemaError(SCHEMA_HINT);
  for (const a of apps) {
    out.push(await syncSupportCheckFollowups(pb, actor, a.id, { rules, application: a }));
    if (out[out.length - 1].error?.includes(schemaError)) break;
  }
  return out;
}
