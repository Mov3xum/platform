'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Chip } from '@/components/proto';
import {
  createAgentMemoryAction,
  updateAgentMemoryAction,
  deleteAgentMemoryAction,
  type AgentMemoryActionState
} from '@/lib/actions/agent-memory';

export interface AgentMemoryItem {
  id: string;
  key: string;
  content: string;
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
}

const MAX_CONTENT = 8000;

const inputClass =
  'w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground ' +
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

export function AgentMemoryManager({ items, startups }: AgentMemoryManagerProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const beginEdit = (item: AgentMemoryItem) => {
    setError(null);
    setEditingId(item.id);
    setDraft(item.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft('');
  };

  const runAction = (
    id: string,
    fn: () => Promise<AgentMemoryActionState>,
    onOk?: () => void
  ) => {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      const res = await fn();
      setBusyId(null);
      if (res.error) {
        setError(res.error);
      } else {
        onOk?.();
        router.refresh();
      }
    });
  };

  const handleSave = (id: string) => {
    runAction(id, () => updateAgentMemoryAction(id, draft), cancelEdit);
  };

  const handleDelete = (id: string, key: string) => {
    if (!window.confirm(`Ta bort minnesnoteringen "${key}"? Detta går inte att ångra.`)) return;
    runAction(id, () => deleteAgentMemoryAction(id));
  };

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    setBusyId('__new__');
    startTransition(async () => {
      const res = await createAgentMemoryAction({}, formData);
      setBusyId(null);
      if (res.error) {
        setError(res.error);
      } else {
        formRef.current?.reset();
        setAdding(false);
        router.refresh();
      }
    });
  };

  return (
    <div>
      {error && (
        <p className="mb-4 rounded-2xl bg-movexum-pastell-orange px-4 py-3 text-sm text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
          {error}
        </p>
      )}

      {items.length > 0 ? (
        <ul className="space-y-3">
          {items.map((item) => {
            const isEditing = editingId === item.id;
            const isBusy = isPending && busyId === item.id;
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
                  <span className="ml-auto text-xs text-foreground-subtle">
                    Uppdaterad {formatDate(item.updatedAt)}
                    {item.updatedBy ? ` · ${item.updatedBy}` : ''}
                  </span>
                </div>

                {isEditing ? (
                  <div className="mt-3">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={4}
                      maxLength={MAX_CONTENT}
                      className={inputClass}
                    />
                    <div className="mt-2 flex items-center gap-2">
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
                      {item.content}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
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
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-2xl border border-dashed border-default bg-canvas-subtle p-6 text-center text-[13px] text-foreground-muted">
          Inget inlärt minne ännu. När du rättar AI-chatten (&quot;räkna inte lån som
          investeringar&quot;) sparar den slutsatsen här och tar med den i framtida samtal.
        </div>
      )}

      {adding ? (
        <form ref={formRef} onSubmit={handleAdd} className="mt-5 space-y-3 rounded-2xl border border-default bg-surface p-4">
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
              placeholder="Bestående regel eller slutsats — t.ex. &quot;Lån och bidrag räknas aldrig som investeringsrundor.&quot; Skriv aldrig personuppgifter."
              className={`mt-1 ${inputClass}`}
            />
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
