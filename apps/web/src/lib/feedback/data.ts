import 'server-only';
import type PocketBase from 'pocketbase';
import {
  compareFeedbackItems,
  isFeedbackKind,
  isFeedbackStatus,
  type FeedbackKind,
  type FeedbackStatus
} from '@platform/shared';

/**
 * Enda läsvägen för Önskemål & buggar (CLAUDE.md § 49). Reads går via den
 * inkommande klienten (användarens token → RLS § 21: `feedback_items` är
 * staff/observer-only i tenanten). Fail-soft mot ett ännu inte migrerat
 * schema (tom lista + `error`, aldrig krasch). Kollektionen adresseras på
 * NAMN (§ 30.4 p. 1).
 */

export const FEEDBACK_ITEMS = 'feedback_items';

interface UserRef {
  id: string;
  display_name?: string;
  email?: string;
}

interface FeedbackRow {
  id: string;
  tenant: string;
  author?: string;
  title?: string;
  description?: string;
  kind?: string;
  area?: string;
  status?: string;
  answer?: string;
  answered_by?: string;
  answered_at?: string;
  done_by?: string;
  done_at?: string;
  created?: string;
  updated?: string;
  expand?: {
    author?: UserRef;
    answered_by?: UserRef;
    done_by?: UserRef;
  };
}

export interface FeedbackItem {
  id: string;
  tenant: string;
  author: string | null;
  /** Visningsnamn — aldrig e-post (GDPR § 5). */
  authorName: string;
  title: string;
  description: string;
  kind: FeedbackKind;
  area: string;
  status: FeedbackStatus;
  answer: string | null;
  answeredBy: string | null;
  answeredByName: string | null;
  answeredAt: string | null;
  doneBy: string | null;
  doneByName: string | null;
  doneAt: string | null;
  created: string;
  updated: string;
}

function nameOf(ref: UserRef | undefined): string | null {
  if (!ref) return null;
  const n = (ref.display_name ?? '').trim();
  if (n) return n;
  // Aldrig e-postadressen i UI:t — visa en neutral etikett.
  return 'Kollega';
}

export function rowToFeedbackItem(row: FeedbackRow): FeedbackItem {
  return {
    id: row.id,
    tenant: String(row.tenant ?? ''),
    author: row.author ? String(row.author) : null,
    authorName: nameOf(row.expand?.author) ?? (row.author ? 'Kollega' : 'Borttagen användare'),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    kind: isFeedbackKind(row.kind) ? row.kind : 'question',
    area: String(row.area ?? 'annat'),
    status: isFeedbackStatus(row.status) ? row.status : 'open',
    answer: row.answer ? String(row.answer) : null,
    answeredBy: row.answered_by ? String(row.answered_by) : null,
    answeredByName: nameOf(row.expand?.answered_by),
    answeredAt: row.answered_at ? String(row.answered_at) : null,
    doneBy: row.done_by ? String(row.done_by) : null,
    doneByName: nameOf(row.expand?.done_by),
    doneAt: row.done_at ? String(row.done_at) : null,
    created: String(row.created ?? ''),
    updated: String(row.updated ?? '')
  };
}

export interface FeedbackListResult {
  items: FeedbackItem[];
  /** PII-fritt läsfel (schema saknas, RLS …) — visas som banner, aldrig som "tom backlog". */
  error?: string;
  /** true när listan kapades av taket. */
  truncated: boolean;
}

const MAX_ITEMS = 2000;

export async function listFeedbackItems(pb: PocketBase, tenant: string): Promise<FeedbackListResult> {
  const run = (sort: string | undefined) =>
    pb.collection(FEEDBACK_ITEMS).getList<FeedbackRow>(1, MAX_ITEMS, {
      filter: pb.filter('tenant = {:tenant}', { tenant }),
      expand: 'author,answered_by,done_by',
      ...(sort ? { sort } : {})
    });
  try {
    let res;
    try {
      res = await run('-created');
    } catch (err) {
      // Osorterad retry mot ett schema utan autodate (§ 26.4-precedensen).
      if (statusOf(err) === 400) res = await run(undefined);
      else throw err;
    }
    const items = res.items.map(rowToFeedbackItem).sort(compareFeedbackItems);
    return { items, truncated: res.totalItems > items.length };
  } catch (err) {
    const status = statusOf(err);
    console.error('[feedback] list failed', { status });
    return {
      items: [],
      truncated: false,
      error:
        status === 404
          ? 'Kollektionen feedback_items saknas i PocketBase — kör migration 1700000176 (eller "Sync PocketBase").'
          : 'Kunde inte läsa backloggen just nu.'
    };
  }
}

export async function getFeedbackItem(pb: PocketBase, tenant: string, id: string): Promise<FeedbackItem | null> {
  try {
    const row = await pb
      .collection(FEEDBACK_ITEMS)
      .getOne<FeedbackRow>(id, { expand: 'author,answered_by,done_by' });
    const item = rowToFeedbackItem(row);
    return item.tenant === tenant ? item : null;
  } catch {
    return null;
  }
}

function statusOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    return (err as { status?: number }).status;
  }
  return undefined;
}
