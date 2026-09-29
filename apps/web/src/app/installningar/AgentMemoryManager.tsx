'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AGENT_MEMORY_CATEGORIES,
  countAgentMemoryByCategory,
  getAgentMemoryCategory,
  groupAgentMemoryByCategory,
  inferAgentMemoryCategory,
  matchesAgentMemoryQuery,
  normalizeAgentMemoryCategory,
  type AgentMemoryCategory,
  type AgentMemoryCategorySource
} from '@platform/shared';
import { Chip } from '@/components/proto';
import { Icon } from '@/components/proto/Icon';
import {
  createAgentMemoryAction,
  updateAgentMemoryAction,
  deleteAgentMemoryAction,
  setAgentMemoryCategoryAction,
  type AgentMemoryActionState
} from '@/lib/actions/agent-memory';

export interface AgentMemoryItem {
  id: string;
  key: string;
  content: string;
  /** Kategori (lagrad eller härledd — se categorySource). */
  category: AgentMemoryCategory;
  categorySource: AgentMemoryCategorySource;
  scopeLabel: string;
  scoped: boolean;
  updatedAt: string;
  updatedBy: string;
}

export interface StartupOption {
  id: string;
  name: string;
}

interface AgentMemoryManagerProps {
  items: AgentMemoryItem[];
  startups: StartupOption[];
  /** Förvald kategori från `?kategori=` (t.ex. länk från chattens kvitto). */
  initialCategory?: AgentMemoryCategory | null;
  /** Antal noteringar vars kategori är härledd (inte bekräftad). */
  inferredCount?: number;
}

type ScopeFilter = 'all' | 'tenant' | 'startup';

const MAX_CONTENT = 8000;
const COLLAPSED_CHARS = 420;

const inputClass =
  'w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground ' +
  'focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila ' +
  'dark:focus:ring-movexum-morklila';

const selectClass =
  'rounded-full border border-default bg-surface px-3 py-1.5 text-xs text-foreground ' +
  'focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila ' +
  'dark:focus:ring-movexum-morklila';

function formatDate(iso: string): string {
  if (!iso) return '–';
  try {
    return new Date(iso).toLocaleDateString('sv-SE', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch {
    return iso.slice(0, 10);
  }
}

/** Kategori-select som delas av redigerings- och skapa-formuläret. */
function CategorySelect({
  id,
  name,
  value,
  onChange,
  allowAuto,
  disabled
}: {
  id: string;
  name?: string;
  value: string;
  onChange?: (value: string) => void;
  /** Visa alternativet "Härled automatiskt" (tom sträng). */
  allowAuto?: boolean;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      name={name}
      value={value}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      disabled={disabled}
      className={`mt-1 ${inputClass}`}
    >
      {allowAuto && <option value="">Härled automatiskt ur rubrik och innehåll</option>}
      {AGENT_MEMORY_CATEGORIES.map((c) => (
        <option key={c.id} value={c.id}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

export function AgentMemoryManager({
  items,
  startups,
  initialCategory = null,
  inferredCount = 0
}: AgentMemoryManagerProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draftCategory, setDraftCategory] = useState<string>('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Filter
  const [categoryFilter, setCategoryFilter] = useState<AgentMemoryCategory | 'all'>(
    initialCategory ?? 'all'
  );
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [query, setQuery] = useState('');
  const [onlyInferred, setOnlyInferred] = useState(false);

  // Skapa-formulärets kategori-förhandsvisning (härledd när inget valts).
  const [newKey, setNewKey] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState('');

  useEffect(() => {
    setCategoryFilter(initialCategory ?? 'all');
  }, [initialCategory]);

  const counts = useMemo(() => countAgentMemoryByCategory(items), [items]);
  const scopedCount = useMemo(() => items.filter((i) => i.scoped).length, [items]);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (scopeFilter === 'tenant' && item.scoped) return false;
      if (scopeFilter === 'startup' && !item.scoped) return false;
      if (onlyInferred && item.categorySource !== 'inferred') return false;
      return matchesAgentMemoryQuery(item, query);
    });
  }, [items, categoryFilter, scopeFilter, onlyInferred, query]);

  const groups = useMemo(() => groupAgentMemoryByCategory(filtered), [filtered]);
  const hasActiveFilter =
    categoryFilter !== 'all' || scopeFilter !== 'all' || query.trim() !== '' || onlyInferred;

  const beginEdit = (item: AgentMemoryItem) => {
    setError(null);
    setWarning(null);
    setEditingId(item.id);
    setDraft(item.content);
    setDraftCategory(item.category);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft('');
    setDraftCategory('');
  };

  const runAction = (
    id: string,
    fn: () => Promise<AgentMemoryActionState>,
    onOk?: () => void
  ) => {
    setError(null);
    setWarning(null);
    setBusyId(id);
    startTransition(async () => {
      const res = await fn();
      setBusyId(null);
      if (res.error) {
        setError(res.error);
      } else {
        if (res.warning) setWarning(res.warning);
        onOk?.();
        router.refresh();
      }
    });
  };

  const handleSave = (id: string) => {
    runAction(id, () => updateAgentMemoryAction(id, draft, draftCategory), cancelEdit);
  };

  const handleDelete = (id: string, key: string) => {
    if (!window.confirm(`Ta bort minnesnoteringen "${key}"? Detta går inte att ångra.`)) return;
    runAction(id, () => deleteAgentMemoryAction(id));
  };

  const handleConfirmCategory = (item: AgentMemoryItem) => {
    runAction(item.id, () => setAgentMemoryCategoryAction(item.id, item.category));
  };

  const handleMoveCategory = (item: AgentMemoryItem, category: string) => {
    if (!category || category === item.category) return;
    runAction(item.id, () => setAgentMemoryCategoryAction(item.id, category));
  };

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setWarning(null);
    const formData = new FormData(e.currentTarget);
    setBusyId('__new__');
    startTransition(async () => {
      const res = await createAgentMemoryAction({}, formData);
      setBusyId(null);
      if (res.error) {
        setError(res.error);
      } else {
        if (res.warning) setWarning(res.warning);
        formRef.current?.reset();
        setNewKey('');
        setNewContent('');
        setNewCategory('');
        setAdding(false);
        router.refresh();
      }
    });
  };

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const previewCategory: AgentMemoryCategory =
    normalizeAgentMemoryCategory(newCategory) ?? inferAgentMemoryCategory(newKey, newContent);

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-2xl bg-movexum-pastell-orange px-4 py-3 text-sm text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
          {error}
        </p>
      )}
      {warning && (
        <p className="rounded-2xl bg-movexum-pastell-gul px-4 py-3 text-sm text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul">
          {warning}
        </p>
      )}

      {items.length > 0 && (
        <>
          {/* Kategorichips — snabb överblick av vad minnet innehåller */}
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Kategori">
            <button
              type="button"
              role="tab"
              aria-selected={categoryFilter === 'all'}
              onClick={() => setCategoryFilter('all')}
              className={`mx-btn mx-sm ${categoryFilter === 'all' ? 'mx-primary' : ''}`}
            >
              Alla
              <span className="mx-tnum opacity-70">{items.length}</span>
            </button>
            {AGENT_MEMORY_CATEGORIES.map((c) => {
              const n = counts[c.id] ?? 0;
              if (n === 0) return null;
              const active = categoryFilter === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setCategoryFilter(active ? 'all' : c.id)}
                  className={`mx-btn mx-sm ${active ? 'mx-primary' : ''}`}
                  title={c.description}
                >
                  <Icon name={c.icon} size={12} />
                  {c.label}
                  <span className="mx-tnum opacity-70">{n}</span>
                </button>
              );
            })}
          </div>

          {/* Verktygsrad: sök + scope + härledda */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-subtle">
                <Icon name="search" size={13} />
              </span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Sök i rubriker, innehåll eller bolag…"
                className={`${inputClass} pl-9`}
                aria-label="Sök i AI-minnet"
              />
            </div>
            <select
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value as ScopeFilter)}
              className={selectClass}
              aria-label="Filtrera på scope"
            >
              <option value="all">Alla scope</option>
              <option value="tenant">Hela tenanten ({items.length - scopedCount})</option>
              <option value="startup">Per bolag ({scopedCount})</option>
            </select>
            {inferredCount > 0 && (
              <button
                type="button"
                onClick={() => setOnlyInferred((v) => !v)}
                className={`mx-btn mx-sm ${onlyInferred ? 'mx-primary' : ''}`}
                title="Noteringar där kategorin är härledd ur rubrik och innehåll och ännu inte bekräftad av en människa"
              >
                <Icon name="sparkle" size={12} />
                Härledd kategori
                <span className="mx-tnum opacity-70">{inferredCount}</span>
              </button>
            )}
            {hasActiveFilter && (
              <button
                type="button"
                onClick={() => {
                  setCategoryFilter('all');
                  setScopeFilter('all');
                  setQuery('');
                  setOnlyInferred(false);
                }}
                className="mx-btn mx-sm mx-ghost"
              >
                <Icon name="x" size={12} />
                Rensa filter
              </button>
            )}
            <span className="ml-auto text-[11px] text-foreground-subtle mx-tnum">
              {filtered.length} av {items.length}
            </span>
          </div>
        </>
      )}

      {items.length > 0 && filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-default bg-canvas-subtle p-6 text-center text-[13px] text-foreground-muted">
          Inga noteringar matchar filtret.
        </div>
      )}

      {groups.map((group) => (
        <section key={group.category.id} aria-labelledby={`memcat-${group.category.id}`}>
          <div className="mb-2 mt-2 flex items-center gap-2 border-t border-default pt-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-canvas-muted text-foreground-muted">
              <Icon name={group.category.icon} size={14} />
            </span>
            <h3
              id={`memcat-${group.category.id}`}
              className="font-heading text-[14px] font-semibold text-foreground"
            >
              {group.category.label}
            </h3>
            <span className="text-[11px] text-foreground-subtle mx-tnum">
              {group.items.length}
            </span>
            <span className="hidden text-[11.5px] text-foreground-subtle sm:inline">
              · {group.category.description}
            </span>
          </div>
          <ul className="space-y-3">
            {group.items.map((item) => {
              const isEditing = editingId === item.id;
              const isBusy = isPending && busyId === item.id;
              const isLong = item.content.length > COLLAPSED_CHARS;
              const isExpanded = expanded.has(item.id);
              const shown =
                isLong && !isExpanded ? `${item.content.slice(0, COLLAPSED_CHARS).trimEnd()}…` : item.content;
              return (
                <li
                  key={item.id}
                  className="rounded-2xl border border-default bg-canvas-subtle p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{item.key}</span>
                    <Chip variant={item.scoped ? 'draft' : 'active'} mono>
                      {item.scopeLabel}
                    </Chip>
                    {item.categorySource === 'inferred' && !isEditing && (
                      <Chip variant="yellow" mono>
                        Härledd kategori
                      </Chip>
                    )}
                    <span className="ml-auto text-xs text-foreground-subtle">
                      Uppdaterad {formatDate(item.updatedAt)}
                      {item.updatedBy ? ` · ${item.updatedBy}` : ''}
                    </span>
                  </div>

                  {isEditing ? (
                    <div className="mt-3 space-y-3">
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={6}
                        maxLength={MAX_CONTENT}
                        className={inputClass}
                        aria-label="Innehåll"
                      />
                      <div>
                        <label
                          htmlFor={`memcat-edit-${item.id}`}
                          className="block text-xs font-medium text-foreground-muted"
                        >
                          Kategori
                        </label>
                        <CategorySelect
                          id={`memcat-edit-${item.id}`}
                          value={draftCategory}
                          onChange={setDraftCategory}
                          disabled={isBusy}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleSave(item.id)}
                          disabled={isBusy}
                          className="rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-50"
                        >
                          {isBusy ? 'Sparar…' : 'Spara'}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={isBusy}
                          className="rounded-full border border-default px-4 py-1.5 text-xs font-medium text-foreground-muted transition hover:bg-surface disabled:opacity-50"
                        >
                          Avbryt
                        </button>
                        <span className="ml-auto text-[11px] text-foreground-subtle tabular-nums">
                          {draft.length}/{MAX_CONTENT}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground-muted">
                        {shown}
                      </p>
                      {isLong && (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(item.id)}
                          className="mt-1 text-xs font-medium text-link hover:underline"
                        >
                          {isExpanded ? 'Visa mindre' : 'Visa hela'}
                        </button>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => beginEdit(item)}
                          className="rounded-full border border-default px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:bg-surface"
                        >
                          Redigera
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(item.id, item.key)}
                          disabled={isBusy}
                          className="rounded-full border border-default px-3 py-1.5 text-xs font-medium text-movexum-morkorange transition hover:bg-movexum-pastell-orange disabled:opacity-50 dark:text-movexum-pastell-orange dark:hover:bg-movexum-morkorange/30"
                        >
                          {isBusy ? 'Tar bort…' : 'Ta bort'}
                        </button>
                        <span className="ml-auto flex flex-wrap items-center gap-1.5">
                          {item.categorySource === 'inferred' && (
                            <button
                              type="button"
                              onClick={() => handleConfirmCategory(item)}
                              disabled={isBusy}
                              className="mx-btn mx-sm"
                              title={`Bekräfta kategorin "${getAgentMemoryCategory(item.category).label}"`}
                            >
                              <Icon name="check" size={12} />
                              Bekräfta kategori
                            </button>
                          )}
                          <label className="sr-only" htmlFor={`memcat-move-${item.id}`}>
                            Flytta till kategori
                          </label>
                          <select
                            id={`memcat-move-${item.id}`}
                            value={item.category}
                            onChange={(e) => handleMoveCategory(item, e.target.value)}
                            disabled={isBusy}
                            className={selectClass}
                            title="Flytta till en annan kategori"
                          >
                            {AGENT_MEMORY_CATEGORIES.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        </span>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-default bg-canvas-subtle p-6 text-center text-[13px] text-foreground-muted">
          Inget inlärt minne ännu. När du rättar AI-chatten (&quot;räkna inte lån som
          investeringar&quot;) sparar den slutsatsen här och tar med den i framtida samtal.
        </div>
      )}

      {adding ? (
        <form
          ref={formRef}
          onSubmit={handleAdd}
          className="mt-5 space-y-3 rounded-2xl border border-default bg-surface p-4"
        >
          <div>
            <label htmlFor="mem_key" className="block text-sm font-medium text-foreground-muted">
              Nyckel / rubrik *
            </label>
            <input
              id="mem_key"
              name="key"
              type="text"
              required
              maxLength={200}
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="t.ex. finansiering/investeringar"
              className={`mt-1 ${inputClass}`}
            />
          </div>
          <div>
            <label htmlFor="mem_content" className="block text-sm font-medium text-foreground-muted">
              Innehåll *
            </label>
            <textarea
              id="mem_content"
              name="content"
              required
              rows={4}
              maxLength={MAX_CONTENT}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Bestående regel eller slutsats — t.ex. &quot;Lån och bidrag räknas aldrig som investeringsrundor.&quot; Skriv aldrig personuppgifter."
              className={`mt-1 ${inputClass}`}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="mem_category" className="block text-sm font-medium text-foreground-muted">
                Kategori
              </label>
              <CategorySelect
                id="mem_category"
                name="category"
                value={newCategory}
                onChange={setNewCategory}
                allowAuto
              />
              {!newCategory && (newKey || newContent) && (
                <p className="mt-1 text-[11.5px] text-foreground-subtle">
                  Härleds till: <strong>{getAgentMemoryCategory(previewCategory).label}</strong>
                </p>
              )}
            </div>
            <div>
              <label htmlFor="mem_startup" className="block text-sm font-medium text-foreground-muted">
                Scope
              </label>
              <select id="mem_startup" name="startup" defaultValue="" className={`mt-1 ${inputClass}`}>
                <option value="">Hela tenanten (gäller alla bolag)</option>
                {startups.map((s) => (
                  <option key={s.id} value={s.id}>
                    Bara {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={isPending && busyId === '__new__'}
              className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-50"
            >
              {isPending && busyId === '__new__' ? 'Sparar…' : 'Spara notering'}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
              className="rounded-full border border-default px-5 py-2 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle"
            >
              Avbryt
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding(true);
            setError(null);
          }}
          className="mt-4 rounded-full border border-default px-4 py-2 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle"
        >
          + Lägg till notering manuellt
        </button>
      )}
    </div>
  );
}
