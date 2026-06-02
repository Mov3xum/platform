'use client';

import { useState } from 'react';
import type {
  OnboardingModule,
  OnboardingBlock,
  OnboardingBlockType,
  OnboardingBlockOption
} from '@platform/shared';
import {
  MAX_WORKSHOP_IMAGE_BYTES,
  MAX_WORKSHOP_VIDEO_BYTES,
  formatMbLimit,
  validateWorkshopMediaFile
} from '@platform/shared';

const BLOCK_ICON_TEXT: Record<OnboardingBlockType, string> = {
  text: 'TX',
  video: 'VD',
  image: 'IM',
  acknowledge: 'OK',
  question: 'Q',
  quiz: 'QZ'
};

const BLOCK_TYPES: { type: OnboardingBlockType; label: string }[] = [
  { type: 'text', label: 'Text' },
  { type: 'video', label: 'Film' },
  { type: 'image', label: 'Bild' },
  { type: 'acknowledge', label: 'Bekräftelse' },
  { type: 'question', label: 'Fråga' },
  { type: 'quiz', label: 'Quiz' }
];

let _idSeq = 0;
function uid(prefix: string) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  return `${prefix}_${Date.now()}_${++_idSeq}`;
}

function defaultBlock(type: OnboardingBlockType): OnboardingBlock {
  const label = BLOCK_TYPES.find((b) => b.type === type)?.label ?? type;
  return {
    id: uid('block'),
    type,
    title: label,
    // acknowledge är alltid obligatorisk; quiz/question/media föreslås obligatoriska.
    required: type === 'acknowledge' ? true : type !== 'text',
    ...(type === 'quiz' ? { question_type: 'single', options: [] } : {})
  };
}

interface OnboardingBlockBuilderProps {
  initialModules?: OnboardingModule[];
}

export function OnboardingBlockBuilder({ initialModules }: OnboardingBlockBuilderProps) {
  const [modules, setModules] = useState<OnboardingModule[]>(() => {
    if (initialModules && initialModules.length > 0) return initialModules;
    // Stabilt id för start-modulen (hydreringsmismatch annars, jfr WorkshopBlockBuilder).
    return [{ id: 'module_1', title: 'Modul 1', description: '', blocks: [] }];
  });
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());
  const [addingBlockFor, setAddingBlockFor] = useState<string | null>(null);
  const [uploadingByBlockId, setUploadingByBlockId] = useState<Record<string, boolean>>({});
  const [uploadErrorByBlockId, setUploadErrorByBlockId] = useState<Record<string, string>>({});

  const toggleBlock = (blockId: string) =>
    setExpandedBlocks((prev) => {
      const next = new Set(prev);
      next.has(blockId) ? next.delete(blockId) : next.add(blockId);
      return next;
    });

  // ── Module operations ──────────────────────────────────────────────────────
  const addModule = () =>
    setModules((prev) => [
      ...prev,
      { id: uid('module'), title: `Modul ${prev.length + 1}`, description: '', blocks: [] }
    ]);
  const removeModule = (id: string) => setModules((prev) => prev.filter((m) => m.id !== id));
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
  const updateModule = (
    id: string,
    patch: Partial<Pick<OnboardingModule, 'title' | 'description'>>
  ) => setModules((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  // ── Block operations ───────────────────────────────────────────────────────
  const addBlock = (moduleId: string, type: OnboardingBlockType) => {
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
  const updateBlock = (moduleId: string, blockId: string, patch: Partial<OnboardingBlock>) =>
    setModules((prev) =>
      prev.map((m) =>
        m.id === moduleId
          ? { ...m, blocks: m.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)) }
          : m
      )
    );

  const setUploadError = (blockId: string, message?: string) =>
    setUploadErrorByBlockId((prev) => {
      const next = { ...prev };
      if (message) next[blockId] = message;
      else delete next[blockId];
      return next;
    });
  const setUploading = (blockId: string, uploading: boolean) =>
    setUploadingByBlockId((prev) => ({ ...prev, [blockId]: uploading }));

  const handleMediaUpload = async (moduleId: string, block: OnboardingBlock, file: File | null) => {
    if (!file || (block.type !== 'video' && block.type !== 'image')) return;
    const kind = block.type === 'image' ? 'image' : 'video';
    const validation = validateWorkshopMediaFile({ type: file.type, size: file.size }, kind);
    if (!validation.ok) {
      setUploadError(block.id, validation.error);
      return;
    }
    setUploadError(block.id);
    setUploading(block.id, true);
    try {
      // Återanvänder utbildnings-media-routen (workshop_media) → blocket lagrar
      // bara en kort fil-URL i stället för base64 i flödes-JSON:en.
      const fd = new FormData();
      fd.append('file', file, file.name);
      fd.append('kind', kind);
      const res = await fetch('/api/education/media', { method: 'POST', body: fd });
      const dataJson = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !dataJson?.url) {
        throw new Error(dataJson?.error || 'Uppladdningen misslyckades.');
      }
      updateBlock(
        moduleId,
        block.id,
        kind === 'image' ? { image_url: dataJson.url } : { video_url: dataJson.url }
      );
    } catch (err) {
      const details = err instanceof Error && err.message ? `: ${err.message}` : '';
      setUploadError(block.id, `Uppladdningen misslyckades${details}`);
    } finally {
      setUploading(block.id, false);
    }
  };

  const handleMediaInputChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    moduleId: string,
    block: OnboardingBlock
  ) => {
    void handleMediaUpload(moduleId, block, e.target.files?.[0] ?? null);
    e.target.value = '';
  };

  // ── Quiz option operations ───────────────────────────────────────────────────
  const addOption = (moduleId: string, blockId: string) => {
    const newOpt: OnboardingBlockOption = { id: uid('opt'), text: '' };
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
    patch: Partial<OnboardingBlockOption>
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
                      options: (b.options ?? []).map((o) => (o.id === optId ? { ...o, ...patch } : o))
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

  const inputClass =
    'mt-1 w-full rounded-xl border border-default bg-canvas px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
  const labelClass = 'block text-xs font-medium text-foreground-muted';
  const iconBtnClass =
    'inline-flex items-center justify-center rounded-lg border border-default bg-surface px-2 py-1 text-xs text-foreground-muted transition hover:bg-canvas-subtle disabled:cursor-not-allowed disabled:opacity-40';

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
              <button type="button" onClick={() => moveModule(mod.id, -1)} disabled={modIdx === 0} className={iconBtnClass} title="Flytta upp">↑</button>
              <button type="button" onClick={() => moveModule(mod.id, 1)} disabled={modIdx === modules.length - 1} className={iconBtnClass} title="Flytta ned">↓</button>
              <button type="button" onClick={() => removeModule(mod.id)} className={`${iconBtnClass} text-movexum-morkorange hover:bg-movexum-pastell-orange`} title="Ta bort modul">✕</button>
            </div>
          </div>

          {/* Block list */}
          <div className="space-y-2 px-4 pb-4">
            {mod.blocks.length === 0 && (
              <p className="py-3 text-center text-xs text-foreground-subtle">
                Inga block ännu — välj ett block nedan för att börja.
              </p>
            )}

            {mod.blocks.map((block, blockIdx) => {
              const isExpanded = expandedBlocks.has(block.id);
              const label = BLOCK_TYPES.find((b) => b.type === block.type)?.label ?? block.type;
              return (
                <div key={block.id} className="rounded-2xl border border-default bg-canvas-subtle/30">
                  {/* Block header row */}
                  <div className="flex items-center gap-2 p-3">
                    <span className="shrink-0 text-sm text-foreground-muted" title={label} role="img" aria-label={label}>
                      {BLOCK_ICON_TEXT[block.type]}
                    </span>
                    <input
                      type="text"
                      value={block.title}
                      onChange={(e) => updateBlock(mod.id, block.id, { title: e.target.value })}
                      placeholder="Blocktitel"
                      className="min-w-0 flex-1 rounded-lg border border-default bg-surface px-2 py-1 text-sm text-foreground focus:border-brand focus:outline-none"
                    />
                    <span className="shrink-0 rounded-full bg-movexum-pastell-bla px-2 py-0.5 text-xs font-medium text-movexum-morkbla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla">
                      {label}
                    </span>
                    <div className="flex shrink-0 gap-1">
                      <button type="button" onClick={() => toggleBlock(block.id)} className={`${iconBtnClass} ${isExpanded ? 'bg-canvas-subtle' : ''}`} title={isExpanded ? 'Dölj' : 'Redigera'}>{isExpanded ? '▲' : '▼'}</button>
                      <button type="button" onClick={() => moveBlock(mod.id, block.id, -1)} disabled={blockIdx === 0} className={iconBtnClass} title="Flytta upp">↑</button>
                      <button type="button" onClick={() => moveBlock(mod.id, block.id, 1)} disabled={blockIdx === mod.blocks.length - 1} className={iconBtnClass} title="Flytta ned">↓</button>
                      <button type="button" onClick={() => removeBlock(mod.id, block.id)} className={`${iconBtnClass} text-movexum-morkorange hover:bg-movexum-pastell-orange`} title="Ta bort block">✕</button>
                    </div>
                  </div>

                  {/* Expanded block form */}
                  {isExpanded && (
                    <div className="space-y-3 border-t border-default px-3 pb-4 pt-3">
                      <div>
                        <label className={labelClass}>
                          {block.type === 'question' ? 'Frågetext / instruktion' : 'Text / innehåll'}
                        </label>
                        <textarea
                          value={block.body ?? ''}
                          onChange={(e) => updateBlock(mod.id, block.id, { body: e.target.value })}
                          rows={block.type === 'text' || block.type === 'acknowledge' ? 5 : 3}
                          placeholder={
                            block.type === 'acknowledge'
                              ? 'Vad ska bolaget bekräfta att de läst/förstått?'
                              : block.type === 'question'
                                ? 'Vad vill ni att bolaget svarar på?'
                                : 'Skriv informationen bolaget ska ta del av…'
                          }
                          className={inputClass}
                        />
                      </div>

                      {block.type === 'video' && (
                        <div className="space-y-2">
                          <label className={labelClass}>Video</label>
                          <label
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              void handleMediaUpload(mod.id, block, e.dataTransfer.files?.[0] ?? null);
                            }}
                            className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-default bg-surface px-4 py-4 text-center text-xs text-foreground-muted transition hover:border-brand hover:bg-canvas-subtle"
                          >
                            <span>Dra och släpp video här</span>
                            <span className="text-foreground-subtle">eller klicka för att välja fil (max {formatMbLimit(MAX_WORKSHOP_VIDEO_BYTES)})</span>
                            <input type="file" accept="video/*" className="hidden" onChange={(e) => handleMediaInputChange(e, mod.id, block)} />
                          </label>
                          {block.video_url ? (
                            <video controls src={block.video_url} className="max-h-72 w-full rounded-xl border border-default" />
                          ) : null}
                          {uploadingByBlockId[block.id] ? <p className="text-xs text-foreground-subtle">Laddar upp video…</p> : null}
                          {uploadErrorByBlockId[block.id] ? <p role="alert" className="text-xs text-movexum-morkorange">{uploadErrorByBlockId[block.id]}</p> : null}
                        </div>
                      )}

                      {block.type === 'image' && (
                        <div className="space-y-2">
                          <label className={labelClass}>Bild</label>
                          <label
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              void handleMediaUpload(mod.id, block, e.dataTransfer.files?.[0] ?? null);
                            }}
                            className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-default bg-surface px-4 py-4 text-center text-xs text-foreground-muted transition hover:border-brand hover:bg-canvas-subtle"
                          >
                            <span>Dra och släpp bild här</span>
                            <span className="text-foreground-subtle">eller klicka för att välja fil (max {formatMbLimit(MAX_WORKSHOP_IMAGE_BYTES)})</span>
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => handleMediaInputChange(e, mod.id, block)} />
                          </label>
                          {block.image_url ? (
                            <img src={block.image_url} alt={block.title} className="max-h-72 max-w-full rounded-xl border border-default object-contain" />
                          ) : null}
                          {uploadingByBlockId[block.id] ? <p className="text-xs text-foreground-subtle">Laddar upp bild…</p> : null}
                          {uploadErrorByBlockId[block.id] ? <p role="alert" className="text-xs text-movexum-morkorange">{uploadErrorByBlockId[block.id]}</p> : null}
                        </div>
                      )}

                      {block.type === 'quiz' && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-3">
                            <label className={labelClass}>Svarstyp</label>
                            <select
                              value={block.question_type ?? 'single'}
                              onChange={(e) => updateBlock(mod.id, block.id, { question_type: e.target.value as 'single' | 'multiple' })}
                              className="rounded-lg border border-default bg-surface px-2 py-1 text-xs text-foreground focus:border-brand focus:outline-none"
                            >
                              <option value="single">Enskild (radio)</option>
                              <option value="multiple">Flerval (checkbox)</option>
                            </select>
                          </div>
                          <label className={labelClass}>Svarsalternativ (markera rätt svar)</label>
                          {(block.options ?? []).map((opt) => (
                            <div key={opt.id} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={opt.isCorrect ?? false}
                                onChange={(e) => updateOption(mod.id, block.id, opt.id, { isCorrect: e.target.checked })}
                                title="Korrekt svar"
                                className="rounded accent-brand"
                              />
                              <input
                                type="text"
                                value={opt.text}
                                onChange={(e) => updateOption(mod.id, block.id, opt.id, { text: e.target.value })}
                                placeholder="Alternativtext…"
                                className="min-w-0 flex-1 rounded-lg border border-default bg-surface px-2 py-1 text-sm text-foreground focus:border-brand focus:outline-none"
                              />
                              <button type="button" onClick={() => removeOption(mod.id, block.id, opt.id)} className={`${iconBtnClass} text-movexum-morkorange hover:bg-movexum-pastell-orange`}>✕</button>
                            </div>
                          ))}
                          <button type="button" onClick={() => addOption(mod.id, block.id)} className="text-xs font-medium text-link hover:underline">+ Lägg till alternativ</button>
                        </div>
                      )}

                      {/* Required toggle — acknowledge är alltid obligatorisk. */}
                      {block.type === 'acknowledge' ? (
                        <p className="text-xs text-foreground-subtle">Bekräftelseblock är alltid obligatoriska.</p>
                      ) : (
                        <label className="flex items-center gap-2 text-xs text-foreground-muted">
                          <input
                            type="checkbox"
                            checked={block.required ?? false}
                            onChange={(e) => updateBlock(mod.id, block.id, { required: e.target.checked })}
                            className="rounded accent-brand"
                          />
                          Obligatorisk (krävs för att slutföra onboardingen)
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
                <p className="mb-2 text-xs font-medium text-foreground-muted">Välj blocktyp att lägga till:</p>
                <div className="flex flex-wrap gap-2">
                  {BLOCK_TYPES.map(({ type, label }) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => addBlock(mod.id, type)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:border-brand hover:bg-canvas-subtle hover:text-foreground"
                    >
                      <span className="text-xs text-foreground-subtle" role="img" aria-label={label}>{BLOCK_ICON_TEXT[type]}</span>
                      {label}
                    </button>
                  ))}
                  <button type="button" onClick={() => setAddingBlockFor(null)} className="inline-flex items-center rounded-full border border-default bg-surface px-3 py-1.5 text-xs text-foreground-subtle transition hover:bg-canvas-subtle">Avbryt</button>
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

      <button
        type="button"
        onClick={addModule}
        className="inline-flex items-center gap-2 rounded-full border border-dashed border-brand/50 px-5 py-2.5 text-sm font-medium text-brand transition hover:border-brand hover:bg-canvas-subtle"
      >
        + Ny modul
      </button>

      <p className="text-xs text-foreground-subtle">
        {modules.length} modul{modules.length !== 1 ? 'er' : ''} ·{' '}
        {modules.reduce((acc, m) => acc + m.blocks.length, 0)} block totalt
      </p>
    </div>
  );
}
