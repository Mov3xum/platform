'use client';

import { useState } from 'react';
import type { WorkshopModule, WorkshopBlock, WorkshopBlockType, WorkshopBlockOption } from '@platform/shared';

const BLOCK_TYPES: { type: WorkshopBlockType; label: string; emoji: string }[] = [
  { type: 'question', label: 'Fråga', emoji: '❓' },
  { type: 'exercise', label: 'Övning', emoji: '✏️' },
  { type: 'instruction', label: 'Instruktion', emoji: '📖' },
  { type: 'video', label: 'Film', emoji: '🎬' },
  { type: 'image', label: 'Bild', emoji: '🖼️' },
  { type: 'ai_chat', label: 'AI-chatt', emoji: '🤖' },
  { type: 'test', label: 'Test/Quiz', emoji: '📝' },
  { type: 'summary', label: 'Sammanfattning', emoji: '📊' }
];

const BLOCK_TYPE_MAP = Object.fromEntries(BLOCK_TYPES.map((b) => [b.type, b]));

let _idSeq = 0;
function uid(prefix: string) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  return `${prefix}_${Date.now()}_${++_idSeq}`;
}

function defaultBlock(type: WorkshopBlockType): WorkshopBlock {
  const meta = BLOCK_TYPE_MAP[type];
  return {
    id: uid('block'),
    type,
    title: meta?.label ?? type,
    required: type !== 'summary' && type !== 'instruction',
    ...(type === 'test' ? { question_type: 'single', options: [] } : {})
  };
}

interface WorkshopBlockBuilderProps {
  initialModules?: WorkshopModule[];
}

export function WorkshopBlockBuilder({ initialModules }: WorkshopBlockBuilderProps) {
  const [modules, setModules] = useState<WorkshopModule[]>(() => {
    if (initialModules && initialModules.length > 0) return initialModules;
    return [{ id: uid('module'), title: 'Modul 1', description: '', blocks: [] }];
  });
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());
  const [addingBlockFor, setAddingBlockFor] = useState<string | null>(null);

  const toggleBlock = (blockId: string) =>
    setExpandedBlocks((prev) => {
      const next = new Set(prev);
      next.has(blockId) ? next.delete(blockId) : next.add(blockId);
      return next;
    });

  // ── Module operations ────────────────────────────────────────────────────

  const addModule = () =>
    setModules((prev) => [
      ...prev,
      { id: uid('module'), title: `Modul ${prev.length + 1}`, description: '', blocks: [] }
    ]);

  const removeModule = (id: string) =>
    setModules((prev) => prev.filter((m) => m.id !== id));

  const moveModule = (id: string, dir: -1 | 1) =>
    setModules((prev) => {
      const i = prev.findIndex((m) => m.id === id);
      if (i < 0) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const updateModule = (id: string, patch: Partial<Pick<WorkshopModule, 'title' | 'description'>>) =>
    setModules((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  // ── Block operations ─────────────────────────────────────────────────────

  const addBlock = (moduleId: string, type: WorkshopBlockType) => {
    const block = defaultBlock(type);
    setModules((prev) =>
      prev.map((m) => (m.id === moduleId ? { ...m, blocks: [...m.blocks, block] } : m))
    );
    setExpandedBlocks((prev) => new Set([...prev, block.id]));
    setAddingBlockFor(null);
  };

  const removeBlock = (moduleId: string, blockId: string) =>
    setModules((prev) =>
      prev.map((m) =>
        m.id === moduleId ? { ...m, blocks: m.blocks.filter((b) => b.id !== blockId) } : m
      )
    );

  const moveBlock = (moduleId: string, blockId: string, dir: -1 | 1) =>
    setModules((prev) =>
      prev.map((m) => {
        if (m.id !== moduleId) return m;
        const i = m.blocks.findIndex((b) => b.id === blockId);
        if (i < 0) return m;
        const j = i + dir;
        if (j < 0 || j >= m.blocks.length) return m;
        const next = [...m.blocks];
        [next[i], next[j]] = [next[j], next[i]];
        return { ...m, blocks: next };
      })
    );

  const updateBlock = (moduleId: string, blockId: string, patch: Partial<WorkshopBlock>) =>
    setModules((prev) =>
      prev.map((m) =>
        m.id === moduleId
          ? { ...m, blocks: m.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)) }
          : m
      )
    );

  // ── Option operations (for test blocks) ──────────────────────────────────

  const addOption = (moduleId: string, blockId: string) => {
    const newOpt: WorkshopBlockOption = { id: uid('opt'), text: '' };
    setModules((prev) =>
      prev.map((m) =>
        m.id === moduleId
          ? {
              ...m,
              blocks: m.blocks.map((b) =>
                b.id === blockId ? { ...b, options: [...(b.options ?? []), newOpt] } : b
              )
            }
          : m
      )
    );
  };

  const updateOption = (
    moduleId: string,
    blockId: string,
    optId: string,
    patch: Partial<WorkshopBlockOption>
  ) =>
    setModules((prev) =>
      prev.map((m) =>
        m.id === moduleId
          ? {
              ...m,
              blocks: m.blocks.map((b) =>
                b.id === blockId
                  ? {
                      ...b,
                      options: (b.options ?? []).map((o) =>
                        o.id === optId ? { ...o, ...patch } : o
                      )
                    }
                  : b
              )
            }
          : m
      )
    );

  const removeOption = (moduleId: string, blockId: string, optId: string) =>
    setModules((prev) =>
      prev.map((m) =>
        m.id === moduleId
          ? {
              ...m,
              blocks: m.blocks.map((b) =>
                b.id === blockId
                  ? { ...b, options: (b.options ?? []).filter((o) => o.id !== optId) }
                  : b
              )
            }
          : m
      )
    );

  // ── Shared styles ────────────────────────────────────────────────────────

  const inputClass =
    'mt-1 w-full rounded-xl border border-default bg-canvas px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
  const labelClass = 'block text-xs font-medium text-foreground-muted';
  const iconBtnClass =
    'inline-flex items-center justify-center rounded-lg border border-default bg-surface px-2 py-1 text-xs text-foreground-muted transition hover:bg-canvas-subtle disabled:cursor-not-allowed disabled:opacity-40';

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Hidden serialized input for form submission */}
      <input type="hidden" name="modules_json" value={JSON.stringify(modules)} />

      {modules.map((mod, modIdx) => (
        <div
          key={mod.id}
          className="rounded-3xl border border-default bg-surface shadow-sm shadow-movexum-svart/5"
        >
          {/* Module header */}
          <div className="flex items-start gap-3 p-4">
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-foreground">
              {modIdx + 1}
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <input
                type="text"
                value={mod.title}
                onChange={(e) => updateModule(mod.id, { title: e.target.value })}
                placeholder="Modulrubrik"
                className="w-full rounded-xl border border-default bg-canvas px-3 py-1.5 text-sm font-semibold text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
              />
              <input
                type="text"
                value={mod.description ?? ''}
                onChange={(e) => updateModule(mod.id, { description: e.target.value })}
                placeholder="Beskrivning (valfritt)"
                className="w-full rounded-xl border border-default bg-canvas px-3 py-1.5 text-xs text-foreground-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
              />
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => moveModule(mod.id, -1)}
                disabled={modIdx === 0}
                className={iconBtnClass}
                title="Flytta upp"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveModule(mod.id, 1)}
                disabled={modIdx === modules.length - 1}
                className={iconBtnClass}
                title="Flytta ned"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => removeModule(mod.id)}
                className={`${iconBtnClass} text-movexum-morkorange hover:bg-movexum-pastell-orange`}
                title="Ta bort modul"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Block list */}
          <div className="px-4 pb-4 space-y-2">
            {mod.blocks.length === 0 && (
              <p className="py-3 text-center text-xs text-foreground-subtle">
                Inga block ännu — välj ett block nedan för att börja.
              </p>
            )}

            {mod.blocks.map((block, blockIdx) => {
              const meta = BLOCK_TYPE_MAP[block.type];
              const isExpanded = expandedBlocks.has(block.id);

              return (
                <div
                  key={block.id}
                  className="rounded-2xl border border-default bg-canvas-subtle/30"
                >
                  {/* Block header row */}
                  <div className="flex items-center gap-2 p-3">
                    <span className="shrink-0 text-base" title={meta?.label}>
                      {meta?.emoji}
                    </span>
                    <input
                      type="text"
                      value={block.title}
                      onChange={(e) => updateBlock(mod.id, block.id, { title: e.target.value })}
                      placeholder="Blocktitel"
                      className="min-w-0 flex-1 rounded-lg border border-default bg-surface px-2 py-1 text-sm text-foreground focus:border-brand focus:outline-none"
                    />
                    <span className="shrink-0 rounded-full bg-movexum-pastell-bla px-2 py-0.5 text-xs font-medium text-movexum-morkbla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla">
                      {meta?.label ?? block.type}
                    </span>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => toggleBlock(block.id)}
                        className={`${iconBtnClass} ${isExpanded ? 'bg-canvas-subtle' : ''}`}
                        title={isExpanded ? 'Dölj inställningar' : 'Redigera'}
                      >
                        {isExpanded ? '▲' : '▼'}
                      </button>
                      <button
                        type="button"
                        onClick={() => moveBlock(mod.id, block.id, -1)}
                        disabled={blockIdx === 0}
                        className={iconBtnClass}
                        title="Flytta upp"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveBlock(mod.id, block.id, 1)}
                        disabled={blockIdx === mod.blocks.length - 1}
                        className={iconBtnClass}
                        title="Flytta ned"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => removeBlock(mod.id, block.id)}
                        className={`${iconBtnClass} text-movexum-morkorange hover:bg-movexum-pastell-orange`}
                        title="Ta bort block"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Expanded block form */}
                  {isExpanded && (
                    <div className="border-t border-default px-3 pb-4 pt-3 space-y-3">
                      {/* Instructions */}
                      <div>
                        <label className={labelClass}>Instruktioner / text</label>
                        <textarea
                          value={block.instructions ?? ''}
                          onChange={(e) =>
                            updateBlock(mod.id, block.id, { instructions: e.target.value })
                          }
                          rows={3}
                          placeholder="Beskriv vad deltagarna ska göra eller läsa…"
                          className={inputClass}
                        />
                      </div>

                      {/* Desired result */}
                      <div>
                        <label className={labelClass}>Önskat resultat</label>
                        <input
                          type="text"
                          value={block.desired_result ?? ''}
                          onChange={(e) =>
                            updateBlock(mod.id, block.id, { desired_result: e.target.value })
                          }
                          placeholder="Vad ska deltagarna ha uppnått när detta block är klart?"
                          className={inputClass}
                        />
                      </div>

                      {/* Video URL */}
                      {block.type === 'video' && (
                        <div>
                          <label className={labelClass}>Video-URL</label>
                          <input
                            type="url"
                            value={block.video_url ?? ''}
                            onChange={(e) =>
                              updateBlock(mod.id, block.id, { video_url: e.target.value })
                            }
                            placeholder="https://www.youtube.com/watch?v=…"
                            className={inputClass}
                          />
                        </div>
                      )}

                      {/* Image URL */}
                      {block.type === 'image' && (
                        <div>
                          <label className={labelClass}>Bild-URL</label>
                          <input
                            type="url"
                            value={block.image_url ?? ''}
                            onChange={(e) =>
                              updateBlock(mod.id, block.id, { image_url: e.target.value })
                            }
                            placeholder="https://example.com/bild.png"
                            className={inputClass}
                          />
                        </div>
                      )}

                      {/* Test / quiz options */}
                      {block.type === 'test' && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-3">
                            <label className={labelClass}>Svarstyp</label>
                            <select
                              value={block.question_type ?? 'single'}
                              onChange={(e) =>
                                updateBlock(mod.id, block.id, {
                                  question_type: e.target.value as 'single' | 'multiple'
                                })
                              }
                              className="rounded-lg border border-default bg-surface px-2 py-1 text-xs text-foreground focus:border-brand focus:outline-none"
                            >
                              <option value="single">Enskild (radio)</option>
                              <option value="multiple">Flerval (checkbox)</option>
                            </select>
                          </div>
                          <label className={labelClass}>Svarsalternativ</label>
                          {(block.options ?? []).map((opt) => (
                            <div key={opt.id} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={opt.isCorrect ?? false}
                                onChange={(e) =>
                                  updateOption(mod.id, block.id, opt.id, {
                                    isCorrect: e.target.checked
                                  })
                                }
                                title="Korrekt svar"
                                className="rounded accent-brand"
                              />
                              <input
                                type="text"
                                value={opt.text}
                                onChange={(e) =>
                                  updateOption(mod.id, block.id, opt.id, { text: e.target.value })
                                }
                                placeholder="Alternativtext…"
                                className="min-w-0 flex-1 rounded-lg border border-default bg-surface px-2 py-1 text-sm text-foreground focus:border-brand focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => removeOption(mod.id, block.id, opt.id)}
                                className={`${iconBtnClass} text-movexum-morkorange hover:bg-movexum-pastell-orange`}
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => addOption(mod.id, block.id)}
                            className="text-xs font-medium text-link hover:underline"
                          >
                            + Lägg till alternativ
                          </button>
                        </div>
                      )}

                      {/* Required toggle (skip for instruction/summary) */}
                      {block.type !== 'instruction' && block.type !== 'summary' && (
                        <label className="flex items-center gap-2 text-xs text-foreground-muted">
                          <input
                            type="checkbox"
                            checked={block.required ?? false}
                            onChange={(e) =>
                              updateBlock(mod.id, block.id, { required: e.target.checked })
                            }
                            className="rounded accent-brand"
                          />
                          Obligatorisk (krävs för att slutföra workshopen)
                        </label>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Block type picker */}
            {addingBlockFor === mod.id ? (
              <div className="rounded-2xl border border-dashed border-brand/40 bg-canvas-subtle/50 p-3">
                <p className="mb-2 text-xs font-medium text-foreground-muted">
                  Välj blocktyp att lägga till:
                </p>
                <div className="flex flex-wrap gap-2">
                  {BLOCK_TYPES.map(({ type, label, emoji }) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => addBlock(mod.id, type)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:border-brand hover:bg-canvas-subtle hover:text-foreground"
                    >
                      <span>{emoji}</span>
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setAddingBlockFor(null)}
                    className="inline-flex items-center rounded-full border border-default bg-surface px-3 py-1.5 text-xs text-foreground-subtle transition hover:bg-canvas-subtle"
                  >
                    Avbryt
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingBlockFor(mod.id)}
                className="w-full rounded-2xl border border-dashed border-default py-2 text-xs font-medium text-foreground-muted transition hover:border-brand hover:text-brand"
              >
                + Lägg till block
              </button>
            )}
          </div>
        </div>
      ))}

      {/* Add module */}
      <button
        type="button"
        onClick={addModule}
        className="inline-flex items-center gap-2 rounded-full border border-dashed border-brand/50 px-5 py-2.5 text-sm font-medium text-brand transition hover:border-brand hover:bg-canvas-subtle"
      >
        + Ny modul
      </button>

      {/* Summary */}
      <p className="text-xs text-foreground-subtle">
        {modules.length} modul{modules.length !== 1 ? 'er' : ''} ·{' '}
        {modules.reduce((acc, m) => acc + m.blocks.length, 0)} block totalt
      </p>
    </div>
  );
}
