'use client';

import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/proto/Icon';
import { TimeAgo } from './TimeAgo';
import { PostComposer, draftFrom, emptyDraft } from './PostComposer';
import { PostMedia } from './PostMedia';
import { deleteOrgPostAction, setOrgPostPinnedAction } from '@/lib/actions/org-posts';
import { ORG_POST_KIND_LABELS, canEditOrgPost, type OrgPostKind, type OrgPost, type Role } from '@platform/shared';

/**
 * Anslagstavlan på dashboarden (CLAUDE.md § 37) — klientdelen.
 *
 * Servern renderar markdown → HTML via lib/safe-html (`bodyHtml`) och skickar
 * PII-fri metadata; här sköts bara UI-tillstånd (redigerare, utfällning, meny)
 * och anrop till server-actions, som är säkerhetsgränsen (RBAC + validering).
 *
 * Uttryck (2026-09): inga kort — anslagstavlan sätts som en tidningssida
 * (första inlägget som toppnyhet, resten som notiser i spalter) och rutinerna
 * som en numrerad handbok med hårlinjer. Redigeraren (`PostComposer`, § 37.6)
 * ger verktygsrad, emoji och media; media renderas via `PostMedia`.
 */

export interface BoardPost extends OrgPost {
  /** Renderad via lib/safe-html på servern — säker att sätta som innerHTML. */
  bodyHtml: string;
  excerpt: string;
  /** Publiceringsdatum i framtiden (syns bara för författare/moderatorer). */
  scheduled: boolean;
}

interface Props {
  posts: BoardPost[];
  userId: string;
  roles: Role[];
  canAuthor: boolean;
  /** `board` = kort med brödtext; `compact` = hopfällda rader (instruktioner). */
  variant?: 'board' | 'compact';
  /** Förvald typ i "Nytt inlägg"-redigeraren. */
  newKind?: OrgPostKind;
  /** Rubrik för listan (eyebrow). Utelämnas när listan ligger i en flik som redan har rubrik. */
  label?: string;
  description?: string;
  emptyText: string;
  /** Etikett på "nytt"-knappen (default följer variant). */
  newLabel?: string;
  /** Begränsa typvalet i redigeraren (t.ex. bara `training` i Internutbildningar-fliken). */
  kinds?: readonly OrgPostKind[];
  /** Renderas ovanför listan (t.ex. hårdkodad plattformsintro i "Så gör vi"). */
  children?: ReactNode;
}

const KIND_TONE: Record<OrgPostKind, string> = {
  news: 'text-brand',
  notice: 'text-foreground-muted',
  instruction: 'text-movexum-lila dark:text-movexum-ljuslila',
  celebration: 'text-movexum-morkgul',
  training: 'text-movexum-gron dark:text-movexum-ljusgron'
};

const KIND_ICON: Record<OrgPostKind, string> = {
  news: 'spark',
  notice: 'bell',
  instruction: 'doc',
  celebration: 'star',
  training: 'cap'
};

const EXPAND_THRESHOLD = 320;
/** Toppnyheten får visa hela texten upp till den här längden innan "Läs hela" behövs. */
const LEAD_THRESHOLD = 1400;

export function OrgPostList({
  posts,
  userId,
  roles,
  canAuthor,
  variant = 'board',
  newKind = 'news',
  label,
  description,
  emptyText,
  newLabel,
  kinds,
  children
}: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuFor]);

  function toggle(id: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function run(fn: () => Promise<{ ok?: boolean; error?: string }>) {
    setMenuFor(null);
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error || 'Något gick fel.');
      router.refresh();
    });
  }

  const compact = variant === 'compact';
  const [lead, ...rest] = compact ? [null, ...posts] : posts;

  const menuButton = (post: BoardPost) => (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMenuFor((cur) => (cur === post.id ? null : post.id));
        }}
        className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-subtle opacity-50 transition hover:bg-canvas-muted hover:text-foreground group-hover:opacity-100"
        aria-label="Fler val (fäst, redigera, ta bort)"
        aria-haspopup="menu"
        aria-expanded={menuFor === post.id}
      >
        <Icon name="more" size={15} fill="currentColor" />
      </button>
      {menuFor === post.id && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-8 z-10 w-40 overflow-hidden rounded-xl border border-default bg-surface py-1 text-[13px] shadow-md shadow-movexum-svart/10"
        >
          <button
            type="button"
            onClick={() => run(() => setOrgPostPinnedAction(post.id, !post.pinned))}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-foreground transition hover:bg-canvas-subtle"
          >
            <Icon name="star" size={12} /> {post.pinned ? 'Lossa' : 'Fäst överst'}
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuFor(null);
              setCreating(false);
              setEditingId(post.id);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-foreground transition hover:bg-canvas-subtle"
          >
            <Icon name="pencil" size={12} /> Redigera
          </button>
          <button
            type="button"
            onClick={() => {
              if (!window.confirm(`Ta bort "${post.title}"?`)) return;
              run(() => deleteOrgPostAction(post.id));
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-movexum-morkorange transition hover:bg-movexum-pastell-orange"
          >
            <Icon name="trash" size={12} /> Ta bort
          </button>
        </div>
      )}
    </div>
  );

  const badges = (post: BoardPost) => (
    <>
      {post.pinned && (
        <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-movexum-morkgul">
          <Icon name="star" size={10} fill="currentColor" /> Fäst
        </span>
      )}
      {post.scheduled && (
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-movexum-morkgul">Schemalagt</span>
      )}
      {post.audience === 'all' && (
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-foreground-subtle" title="Visas även för bolagen">
          Hela organisationen
        </span>
      )}
    </>
  );

  const openLink = (post: BoardPost) =>
    post.link_url ? (
      <a
        href={post.link_url}
        target={post.link_url.startsWith('/') ? undefined : '_blank'}
        rel={post.link_url.startsWith('/') ? undefined : 'noopener noreferrer'}
        className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-link underline decoration-link/30 underline-offset-4 transition hover:decoration-link"
      >
        Öppna
        <Icon name="arrow-up-right" size={11} />
      </a>
    ) : null;

  const editorFor = (post: BoardPost) => (
    <PostComposer
      initial={draftFrom(post)}
      editing={post}
      kinds={kinds}
      onDone={(warning) => {
        setEditingId(null);
        setNotice(warning ?? null);
        router.refresh();
      }}
      onCancel={() => setEditingId(null)}
    />
  );

  return (
    <section>
      <div className={`flex items-end justify-between gap-3 ${label || (canAuthor && !creating) ? 'mb-3' : ''}`}>
        <div>
          {label && (
            <h2 className="font-heading text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
              {label}
            </h2>
          )}
          {description && <p className="mt-0.5 text-[12px] text-foreground-subtle">{description}</p>}
        </div>
        {canAuthor && !creating && (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setCreating(true);
            }}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-brand transition hover:underline hover:decoration-brand/40 hover:underline-offset-4"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-brand-foreground">
              <Icon name="plus" size={11} stroke={2.2} />
            </span>
            {newLabel ?? (compact ? 'Ny instruktion' : 'Nytt inlägg')}
          </button>
        )}
      </div>

      {creating && (
        <div className="mb-5">
          <PostComposer
            initial={emptyDraft(newKind)}
            editing={null}
            kinds={kinds}
            onDone={(warning) => {
              setCreating(false);
              setNotice(warning ?? null);
              router.refresh();
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      {error && <p className="mb-2 text-[12px] text-movexum-morkorange">{error}</p>}
      {notice && (
        <p className="mb-3 flex items-start gap-2 rounded-xl bg-movexum-pastell-gul px-3 py-2 text-[12px] text-movexum-morkgul dark:bg-movexum-morkgul/20 dark:text-movexum-pastell-gul">
          <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Stäng" className="shrink-0 opacity-70 hover:opacity-100">
            <Icon name="close" size={12} />
          </button>
        </p>
      )}

      {children}

      {posts.length === 0 && !creating ? (
        <p className="flex max-w-[60ch] items-start gap-3 text-[13.5px] leading-relaxed text-foreground-subtle">
          <span aria-hidden className="mt-[10px] h-px w-6 shrink-0 bg-brand/60" />
          <span>{emptyText}</span>
        </p>
      ) : compact ? (
        /* Så gör vi: numrerade rutiner i samma handboksspråk som plattformsintron. */
        <ol className="border-t border-default">
          {rest.map((post, i) => {
            if (!post) return null;
            const canEdit = canEditOrgPost({ id: userId, roles }, post);
            const isOpen = expanded.has(post.id);
            if (editingId === post.id) {
              return (
                <li key={post.id} className="border-b border-default py-3">
                  {editorFor(post)}
                </li>
              );
            }
            return (
              <li key={post.id} className="group border-b border-default">
                <div className="flex items-baseline gap-4">
                  <button
                    type="button"
                    onClick={() => toggle(post.id)}
                    aria-expanded={isOpen}
                    className="flex min-w-0 flex-1 items-baseline gap-4 py-3 text-left transition hover:text-brand"
                  >
                    <span
                      className={`mx-tnum w-7 shrink-0 font-heading text-[18px] font-light leading-none tracking-tight transition ${
                        isOpen ? 'text-brand' : 'text-foreground-subtle'
                      }`}
                    >
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-heading text-[14px] font-semibold leading-snug text-foreground">
                        {post.title}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-3">{badges(post)}</span>
                    </span>
                    <Icon
                      name="plus"
                      size={14}
                      className={`shrink-0 self-center text-foreground-subtle transition ${isOpen ? 'rotate-45 text-brand' : ''}`}
                    />
                  </button>
                  {canEdit && <div className="self-center">{menuButton(post)}</div>}
                </div>
                {isOpen && (
                  <div className="pb-4 pl-11 pr-6">
                    {post.bodyHtml && (
                      <div
                        className="mx-post-body max-w-[62ch] text-[13.5px] leading-relaxed text-foreground-muted"
                        // Renderad av lib/safe-html på servern (escapad markdown).
                        dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
                      />
                    )}
                    {post.media && post.media.length > 0 && <PostMedia media={post.media} className="mt-3" />}
                    <div className="mt-3 flex flex-wrap items-center gap-4 text-[12px] text-foreground-subtle">
                      {openLink(post)}
                      <span>
                        {post.author_name ? `${post.author_name} · ` : ''}
                        <TimeAgo iso={post.updated || post.created} />
                      </span>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        /* Anslagstavla / Internutbildningar: första inlägget som toppnyhet, resten som notiser i spalter. */
        <div>
          {lead && (
            <article className="group relative">
              {editingId === lead.id ? (
                editorFor(lead)
              ) : (
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className={`inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] ${KIND_TONE[lead.kind]}`}>
                        <Icon name={KIND_ICON[lead.kind]} size={11} />
                        {ORG_POST_KIND_LABELS[lead.kind]}
                      </span>
                      {badges(lead)}
                    </div>
                    <h3 className="mt-1 font-heading text-[18px] font-semibold leading-snug tracking-tight text-foreground md:text-[20px]">
                      {lead.title}
                    </h3>
                    <p className="mt-1.5 text-[12px] text-foreground-subtle">
                      {lead.author_name ? `${lead.author_name} · ` : ''}
                      <TimeAgo iso={lead.published_at || lead.created} />
                    </p>
                    {(expanded.has(lead.id) || lead.body.length <= LEAD_THRESHOLD) && lead.bodyHtml ? (
                      <div
                        className="mx-post-body mt-2.5 max-w-[66ch] text-[13.5px] leading-relaxed text-foreground-muted"
                        // Renderad av lib/safe-html på servern (escapad markdown).
                        dangerouslySetInnerHTML={{ __html: lead.bodyHtml }}
                      />
                    ) : (
                      lead.excerpt && (
                        <p className="mt-2.5 max-w-[66ch] text-[13.5px] leading-relaxed text-foreground-muted">{lead.excerpt}</p>
                      )
                    )}
                    {lead.media && lead.media.length > 0 && <PostMedia media={lead.media} className="mt-3" />}
                    <div className="mt-3 flex flex-wrap items-center gap-4">
                      {lead.body.length > LEAD_THRESHOLD && (
                        <button
                          type="button"
                          onClick={() => toggle(lead.id)}
                          className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-foreground transition hover:text-brand"
                        >
                          {expanded.has(lead.id) ? 'Visa mindre' : 'Läs hela'}
                          <Icon name="chevdown" size={11} className={expanded.has(lead.id) ? 'rotate-180 transition' : 'transition'} />
                        </button>
                      )}
                      {openLink(lead)}
                    </div>
                  </div>
                  {canEditOrgPost({ id: userId, roles }, lead) && menuButton(lead)}
                </div>
              )}
            </article>
          )}

          {rest.length > 0 && (
            <ul className={`grid grid-cols-1 gap-x-8 border-t border-default md:grid-cols-2 ${lead ? 'mt-5' : ''}`}>
              {rest.map((post) => {
                if (!post) return null;
                const canEdit = canEditOrgPost({ id: userId, roles }, post);
                const isOpen = expanded.has(post.id);
                const long = post.body.length > EXPAND_THRESHOLD || (post.media?.length ?? 0) > 0;
                const showBody = isOpen || post.body.length <= EXPAND_THRESHOLD;
                if (editingId === post.id) {
                  return (
                    <li key={post.id} className="border-b border-default py-3 md:col-span-2">
                      {editorFor(post)}
                    </li>
                  );
                }
                return (
                  <li key={post.id} className={`group relative border-b border-default py-4 ${isOpen ? 'md:col-span-2' : ''}`}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className={`inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] ${KIND_TONE[post.kind]}`}>
                            <Icon name={KIND_ICON[post.kind]} size={10} />
                            {ORG_POST_KIND_LABELS[post.kind]}
                          </span>
                          {badges(post)}
                        </div>
                        <h3 className="mt-1 font-heading text-[14.5px] font-semibold leading-snug text-foreground">{post.title}</h3>
                        <p className="mt-0.5 text-[11.5px] text-foreground-subtle">
                          {post.author_name ? `${post.author_name} · ` : ''}
                          <TimeAgo iso={post.published_at || post.created} />
                        </p>
                        {showBody && post.bodyHtml ? (
                          <div
                            className="mx-post-body mt-2 max-w-[66ch] text-[13.5px] leading-relaxed text-foreground-muted"
                            // Renderad av lib/safe-html på servern (escapad markdown).
                            dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
                          />
                        ) : (
                          post.excerpt && (
                            <p className="mt-2 line-clamp-3 text-[13.5px] leading-relaxed text-foreground-muted">{post.excerpt}</p>
                          )
                        )}
                        {post.media && post.media.length > 0 && (
                          <PostMedia media={post.media} compact={!isOpen} className="mt-2.5" />
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-4">
                          {long && (
                            <button
                              type="button"
                              onClick={() => toggle(post.id)}
                              className="inline-flex items-center gap-1 text-[12px] font-semibold text-foreground transition hover:text-brand"
                            >
                              {isOpen ? 'Visa mindre' : 'Läs mer'}
                              <Icon name="chevdown" size={11} className={isOpen ? 'rotate-180 transition' : 'transition'} />
                            </button>
                          )}
                          {openLink(post)}
                        </div>
                      </div>
                      {canEdit && menuButton(post)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
