'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/proto/Icon';
import { TimeAgo } from './TimeAgo';
import {
  createOrgPostAction,
  deleteOrgPostAction,
  setOrgPostPinnedAction,
  updateOrgPostAction
} from '@/lib/actions/org-posts';
import {
  ORG_POST_AUDIENCE_LABELS,
  ORG_POST_BODY_MAX,
  ORG_POST_KINDS,
  ORG_POST_KIND_HINTS,
  ORG_POST_KIND_LABELS,
  ORG_POST_TITLE_MAX,
  canEditOrgPost,
  type OrgPost,
  type OrgPostAudience,
  type OrgPostKind,
  type Role
} from '@platform/shared';

/**
 * Anslagstavlan på Hemmaplan (CLAUDE.md § 37) — klientdelen.
 *
 * Servern renderar markdown → HTML via lib/safe-html (`bodyHtml`) och skickar
 * PII-fri metadata; här sköts bara UI-tillstånd (redigerare, utfällning, meny)
 * och anrop till server-actions, som är säkerhetsgränsen (RBAC + validering).
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
  /** Rubrik för listan (eyebrow). */
  label: string;
  description?: string;
  emptyText: string;
}

const KIND_CHIP: Record<OrgPostKind, string> = {
  news: 'bg-movexum-pastell-bla text-movexum-morkbla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla',
  notice: 'bg-canvas-muted text-foreground-muted',
  instruction:
    'bg-movexum-pastell-lila text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila',
  celebration:
    'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul'
};

const KIND_ICON: Record<OrgPostKind, string> = {
  news: 'spark',
  notice: 'bell',
  instruction: 'doc',
  celebration: 'star'
};

const EXPAND_THRESHOLD = 320;

type Draft = {
  title: string;
  body: string;
  kind: OrgPostKind;
  audience: OrgPostAudience;
  pinned: boolean;
  expires_at: string;
  published_at: string;
  link_url: string;
};

function emptyDraft(kind: OrgPostKind): Draft {
  return {
    title: '',
    body: '',
    kind,
    audience: 'staff',
    pinned: false,
    expires_at: '',
    published_at: '',
    link_url: ''
  };
}

function draftFrom(post: OrgPost): Draft {
  return {
    title: post.title,
    body: post.body,
    kind: post.kind,
    audience: post.audience,
    pinned: post.pinned,
    expires_at: post.expires_at ? post.expires_at.slice(0, 10) : '',
    published_at: post.published_at ? post.published_at.slice(0, 10) : '',
    link_url: post.link_url ?? ''
  };
}

function Editor({
  initial,
  editing,
  onDone,
  onCancel
}: {
  initial: Draft;
  editing: OrgPost | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [more, setMore] = useState(Boolean(initial.expires_at || initial.published_at || initial.link_url));

  function submit() {
    setError(null);
    startTransition(async () => {
      const payload = {
        ...draft,
        expires_at: draft.expires_at || null,
        published_at: draft.published_at || null,
        link_url: draft.link_url || null
      };
      const res = editing
        ? await updateOrgPostAction(editing.id, payload)
        : await createOrgPostAction(payload);
      if (res.ok) onDone();
      else setError(res.error || 'Kunde inte spara inlägget.');
    });
  }

  const field =
    'w-full rounded-xl border border-default bg-surface px-3 py-2 text-[13.5px] text-foreground outline-none transition placeholder:text-foreground-subtle focus:border-strong focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="rounded-2xl border border-strong bg-surface p-4 shadow-sm shadow-movexum-svart/5"
    >
      <div className="mb-3 flex flex-wrap gap-1.5">
        {ORG_POST_KINDS.map((k) => {
          const active = draft.kind === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setDraft((d) => ({ ...d, kind: k }))}
              title={ORG_POST_KIND_HINTS[k]}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition ${
                active ? KIND_CHIP[k] : 'bg-canvas-subtle text-foreground-subtle hover:text-foreground'
              }`}
            >
              <Icon name={KIND_ICON[k]} size={11} />
              {ORG_POST_KIND_LABELS[k]}
            </button>
          );
        })}
      </div>
      <input
        autoFocus
        value={draft.title}
        onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        placeholder="Rubrik"
        maxLength={ORG_POST_TITLE_MAX}
        className={`${field} font-heading text-[15px] font-semibold`}
      />
      <textarea
        value={draft.body}
        onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
        placeholder="Skriv inlägget… (markdown: **fet**, - punkter, ## rubrik)"
        maxLength={ORG_POST_BODY_MAX}
        rows={Math.min(14, Math.max(4, draft.body.split('\n').length + 1))}
        className={`${field} mt-2 resize-y leading-relaxed`}
      />
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-foreground-muted">
        <label className="inline-flex items-center gap-1.5">
          <span className="text-foreground-subtle">Visas för</span>
          <select
            value={draft.audience}
            onChange={(e) => setDraft((d) => ({ ...d, audience: e.target.value as OrgPostAudience }))}
            className="rounded-lg border border-default bg-surface px-2 py-1 text-[12px] text-foreground"
          >
            {(Object.keys(ORG_POST_AUDIENCE_LABELS) as OrgPostAudience[]).map((a) => (
              <option key={a} value={a}>
                {ORG_POST_AUDIENCE_LABELS[a]}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.pinned}
            onChange={(e) => setDraft((d) => ({ ...d, pinned: e.target.checked }))}
            className="accent-brand"
          />
          Fäst överst
        </label>
        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          className="inline-flex items-center gap-1 text-foreground-subtle transition hover:text-foreground"
        >
          <Icon name="chevdown" size={12} className={more ? 'rotate-180 transition' : 'transition'} />
          {more ? 'Färre val' : 'Schemalägg, utgång, länk'}
        </button>
      </div>
      {more && (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <label className="text-[11.5px] text-foreground-subtle">
            Publiceras
            <input
              type="date"
              value={draft.published_at}
              onChange={(e) => setDraft((d) => ({ ...d, published_at: e.target.value }))}
              className={`${field} mt-1`}
            />
          </label>
          <label className="text-[11.5px] text-foreground-subtle">
            Utgår
            <input
              type="date"
              value={draft.expires_at}
              onChange={(e) => setDraft((d) => ({ ...d, expires_at: e.target.value }))}
              className={`${field} mt-1`}
            />
          </label>
          <label className="text-[11.5px] text-foreground-subtle">
            Länk (/… eller https://)
            <input
              value={draft.link_url}
              onChange={(e) => setDraft((d) => ({ ...d, link_url: e.target.value }))}
              placeholder="/startups/…"
              className={`${field} mt-1`}
            />
          </label>
        </div>
      )}
      {error && <p className="mt-2 text-[12px] text-movexum-morkorange">{error}</p>}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl px-3 py-1.5 text-[12.5px] text-foreground-muted transition hover:bg-canvas-subtle hover:text-foreground"
        >
          Avbryt
        </button>
        <button
          type="submit"
          disabled={pending || !draft.title.trim()}
          className="rounded-xl bg-brand px-3.5 py-1.5 text-[12.5px] font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-50"
        >
          {pending ? 'Sparar…' : editing ? 'Spara' : 'Publicera'}
        </button>
      </div>
    </form>
  );
}

export function OrgPostList({
  posts,
  userId,
  roles,
  canAuthor,
  variant = 'board',
  newKind = 'news',
  label,
  description,
  emptyText
}: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
            {label}
          </h2>
          {description && <p className="mt-0.5 text-[12px] text-foreground-subtle">{description}</p>}
        </div>
        {canAuthor && !creating && (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setCreating(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-default bg-surface px-3 py-1.5 text-[12.5px] font-medium text-foreground transition hover:border-strong hover:shadow-sm hover:shadow-movexum-svart/5"
          >
            <Icon name="plus" size={13} />
            {compact ? 'Ny instruktion' : 'Nytt inlägg'}
          </button>
        )}
      </div>

      {creating && (
        <div className="mb-3">
          <Editor
            initial={emptyDraft(newKind)}
            editing={null}
            onDone={() => {
              setCreating(false);
              router.refresh();
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      {error && <p className="mb-2 text-[12px] text-movexum-morkorange">{error}</p>}

      {posts.length === 0 && !creating ? (
        <div className="rounded-2xl border border-dashed border-default px-4 py-8 text-center text-[13px] text-foreground-subtle">
          {emptyText}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-default bg-surface">
          {posts.map((post, i) => {
            const canEdit = canEditOrgPost({ id: userId, roles }, post);
            const isOpen = expanded.has(post.id);
            const long = post.body.length > EXPAND_THRESHOLD;
            const showBody = compact ? isOpen : isOpen || !long;
            const rowBorder = i > 0 ? 'border-t border-default' : '';

            if (editingId === post.id) {
              return (
                <li key={post.id} className={`${rowBorder} p-2`}>
                  <Editor
                    initial={draftFrom(post)}
                    editing={post}
                    onDone={() => {
                      setEditingId(null);
                      router.refresh();
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                </li>
              );
            }

            return (
              <li key={post.id} className={`group relative ${rowBorder} px-4 ${compact ? 'py-2.5' : 'py-3.5'}`}>
                <div className="flex items-start gap-3">
                  {!compact && (
                    <span
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${KIND_CHIP[post.kind]}`}
                    >
                      <Icon name={KIND_ICON[post.kind]} size={13} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {compact ? (
                        <button
                          type="button"
                          onClick={() => toggle(post.id)}
                          className="flex min-w-0 items-center gap-2 text-left"
                          aria-expanded={isOpen}
                        >
                          <Icon
                            name="chevdown"
                            size={12}
                            className={`shrink-0 text-foreground-subtle transition ${isOpen ? 'rotate-180' : '-rotate-90'}`}
                          />
                          <span className="truncate text-[13.5px] font-medium text-foreground">{post.title}</span>
                        </button>
                      ) : (
                        <h3 className="font-heading text-[15px] font-semibold leading-snug text-foreground">
                          {post.title}
                        </h3>
                      )}
                      {post.pinned && (
                        <Icon name="star" size={11} className="shrink-0 text-movexum-gul" fill="currentColor" />
                      )}
                      {post.scheduled && (
                        <span className="rounded-md bg-movexum-pastell-gul px-1.5 py-0.5 text-[10px] font-medium text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul">
                          Schemalagt
                        </span>
                      )}
                      {post.audience === 'all' && (
                        <span
                          className="rounded-md bg-canvas-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground-subtle"
                          title="Visas även för bolagen"
                        >
                          Hela organisationen
                        </span>
                      )}
                    </div>

                    {!compact && (
                      <p className="mt-0.5 text-[11.5px] text-foreground-subtle">
                        {post.author_name ? `${post.author_name} · ` : ''}
                        <TimeAgo iso={post.published_at || post.created} />
                      </p>
                    )}

                    {showBody && post.bodyHtml && (
                      <div
                        className={`mx-post-body text-[13.5px] leading-relaxed text-foreground-muted ${compact ? 'mt-2 pl-5' : 'mt-2'}`}
                        // Renderad av lib/safe-html på servern (escapad markdown).
                        dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
                      />
                    )}
                    {!compact && !isOpen && long && (
                      <p className="mt-2 text-[13.5px] leading-relaxed text-foreground-muted">{post.excerpt}</p>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px]">
                      {!compact && long && (
                        <button
                          type="button"
                          onClick={() => toggle(post.id)}
                          className="inline-flex items-center gap-1 text-foreground-subtle transition hover:text-foreground"
                        >
                          {isOpen ? 'Visa mindre' : 'Läs mer'}
                          <Icon name="chevdown" size={11} className={isOpen ? 'rotate-180 transition' : 'transition'} />
                        </button>
                      )}
                      {post.link_url && (showBody || !compact) && (
                        <a
                          href={post.link_url}
                          target={post.link_url.startsWith('/') ? undefined : '_blank'}
                          rel={post.link_url.startsWith('/') ? undefined : 'noopener noreferrer'}
                          className="inline-flex items-center gap-1 text-link transition hover:underline"
                        >
                          Öppna
                          <Icon name="arrow-up-right" size={11} />
                        </a>
                      )}
                      {compact && isOpen && (
                        <span className="text-foreground-subtle">
                          {post.author_name ? `${post.author_name} · ` : ''}
                          <TimeAgo iso={post.updated || post.created} />
                        </span>
                      )}
                    </div>
                  </div>

                  {canEdit && (
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuFor((cur) => (cur === post.id ? null : post.id));
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-subtle opacity-60 transition hover:bg-canvas-muted hover:text-foreground group-hover:opacity-100"
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
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
