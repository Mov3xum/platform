import 'server-only';
import type PocketBase from 'pocketbase';
import {
  isOrgPostAudience,
  isOrgPostKind,
  sortOrgPosts,
  type OrgPost
} from '@platform/shared';

/**
 * dashboardens anslagstavla (CLAUDE.md § 37) — EN läsväg som delas av
 * startsidan (`/hem`), "Min översikt" (bolagsmedlemmar, audience=all) och
 * server-actions. Läsningen går via den pb-instans anroparen skickar in
 * (användarens auth-token → PB-RLS gäller, § 21: staff/observer ser tenantens
 * alla inlägg, en ren medlem bara `audience = "all"`).
 *
 * Fail-soft: saknas kollektionen (instans där migration 1700000144 inte körts)
 * returneras en tom lista — startsidan renderas utan anslagstavla i stället
 * för att krascha.
 */

/** Kollektionens NAMN, aldrig custom-id:t (§ 30.4-läxan). */
export const ORG_POSTS_COLLECTION = 'org_posts';

interface OrgPostRow {
  id: string;
  tenant: string;
  author?: string;
  title?: string;
  body?: string;
  kind?: string;
  audience?: string;
  pinned?: boolean;
  published_at?: string;
  expires_at?: string;
  link_url?: string;
  created: string;
  updated?: string;
  expand?: { author?: { display_name?: string; email?: string } };
}

export function rowToOrgPost(r: OrgPostRow): OrgPost {
  const author = r.expand?.author;
  return {
    id: r.id,
    tenant: r.tenant,
    author: r.author || '',
    // Visningsnamn — aldrig e-post i UI:t (faller tillbaka på lokaldelen).
    author_name: author?.display_name || author?.email?.split('@')[0] || null,
    title: r.title || '(utan rubrik)',
    body: r.body || '',
    kind: isOrgPostKind(r.kind) ? r.kind : 'news',
    audience: isOrgPostAudience(r.audience) ? r.audience : 'staff',
    pinned: r.pinned === true,
    published_at: r.published_at || null,
    expires_at: r.expires_at || null,
    link_url: r.link_url || null,
    created: r.created,
    updated: r.updated
  };
}

export async function listOrgPosts(
  pb: PocketBase,
  tenantId: string,
  perPage = 100
): Promise<OrgPost[]> {
  if (!tenantId) return [];
  try {
    const res = await pb.collection(ORG_POSTS_COLLECTION).getList<OrgPostRow>(1, perPage, {
      filter: pb.filter('tenant = {:tenant}', { tenant: tenantId }),
      sort: '-pinned,-created',
      expand: 'author'
    });
    return sortOrgPosts(res.items.map(rowToOrgPost));
  } catch {
    // Fail-soft (osorterad retry mot ett schema utan autodate, § 28.5-mönstret).
    try {
      const res = await pb.collection(ORG_POSTS_COLLECTION).getList<OrgPostRow>(1, perPage, {
        filter: pb.filter('tenant = {:tenant}', { tenant: tenantId }),
        expand: 'author'
      });
      return sortOrgPosts(res.items.map(rowToOrgPost));
    } catch {
      return [];
    }
  }
}
