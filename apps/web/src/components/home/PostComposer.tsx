'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Icon } from '@/components/proto/Icon';
import { EmojiPicker } from './EmojiPicker';
import { PostMedia } from './PostMedia';
import { createOrgPostAction, updateOrgPostAction } from '@/lib/actions/org-posts';
import { chatMarkdownToHtml } from '@/lib/safe-html';
import {
  continueList,
  insertAtCursor,
  insertLink,
  toggleLinePrefix,
  wrapSelection,
  type InlineWrap,
  type LinePrefix,
  type TextSel
} from '@/lib/markdown-edit';
import {
  ORG_POST_AUDIENCE_LABELS,
  ORG_POST_BODY_MAX,
  ORG_POST_KINDS,
  ORG_POST_KIND_HINTS,
  ORG_POST_KIND_LABELS,
  ORG_POST_MEDIA_MAX,
  ORG_POST_MEDIA_MIMES,
  ORG_POST_TITLE_MAX,
  validateOrgPostMediaFile,
  type OrgPost,
  type OrgPostAudience,
  type OrgPostKind,
  type OrgPostMedia
} from '@platform/shared';

/**
 * Redigeraren för anslagstavlan (CLAUDE.md § 37.6) — ett inlägg skrivs som
 * markdown med en verktygsrad (fet/kursiv/rubrik/listor/citat/länk), fullt
 * emoji-paket, uppladdning av bilder/film/dokument (knapp, dra-och-släpp,
 * klistra in) och förhandsgranskning som renderar EXAKT som inlägget sedan
 * visas (samma `chatMarkdownToHtml` + `PostMedia`).
 *
 * Säkerhetsgränsen ligger kvar i server-actions (RBAC, validering) och
 * upload-routen (`/api/hem/media`, staff-only, mime/storlek). Klienten
 * förvaliderar bara för snabb feedback.
 */

export type Draft = {
  title: string;
  body: string;
  kind: OrgPostKind;
  audience: OrgPostAudience;
  pinned: boolean;
  expires_at: string;
  published_at: string;
  link_url: string;
  media: OrgPostMedia[];
};

export function emptyDraft(kind: OrgPostKind): Draft {
  return {
    title: '',
    body: '',
    kind,
    audience: 'staff',
    pinned: false,
    expires_at: '',
    published_at: '',
    link_url: '',
    media: []
  };
}

export function draftFrom(post: OrgPost): Draft {
  return {
    title: post.title,
    body: post.body,
    kind: post.kind,
    audience: post.audience,
    pinned: post.pinned,
    expires_at: post.expires_at ? post.expires_at.slice(0, 10) : '',
    published_at: post.published_at ? post.published_at.slice(0, 10) : '',
    link_url: post.link_url ?? '',
    media: post.media ?? []
  };
}

const KIND_CHIP: Record<OrgPostKind, string> = {
  news: 'bg-movexum-pastell-bla text-movexum-morkbla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla',
  notice: 'bg-canvas-muted text-foreground',
  instruction: 'bg-movexum-pastell-lila text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila',
  celebration: 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul',
  training: 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron'
};

const KIND_ICON: Record<OrgPostKind, string> = {
  news: 'spark',
  notice: 'bell',
  instruction: 'doc',
  celebration: 'star',
  training: 'cap'
};

const ACCEPT = Object.values(ORG_POST_MEDIA_MIMES).flat().join(',');

interface Upload {
  key: string;
  name: string;
  kind: 'image' | 'video' | 'file';
  progress: number;
  preview?: string;
  error?: string;
}

function imageSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) return resolve(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

function upload(file: File, onProgress: (pct: number) => void): Promise<OrgPostMedia> {
  return new Promise((resolve, reject) => {
    imageSize(file).then((dims) => {
      const fd = new FormData();
      fd.append('file', file, file.name);
      if (dims) {
        fd.append('width', String(dims.width));
        fd.append('height', String(dims.height));
      }
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/hem/media');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onerror = () => reject(new Error('Nätverksfel vid uppladdningen.'));
      xhr.onload = () => {
        try {
          const json = JSON.parse(xhr.responseText || '{}') as { media?: OrgPostMedia; error?: string };
          if (xhr.status >= 200 && xhr.status < 300 && json.media) resolve(json.media);
          else reject(new Error(json.error || 'Kunde inte ladda upp filen.'));
        } catch {
          reject(new Error('Oväntat svar från servern.'));
        }
      };
      xhr.send(fd);
    });
  });
}

type ToolAction =
  | { type: 'wrap'; wrap: InlineWrap }
  | { type: 'line'; line: LinePrefix }
  | { type: 'link' }
  | { type: 'emoji' }
  | { type: 'media' };

interface Tool {
  action: ToolAction;
  icon: string;
  label: string;
  shortcut?: string;
}

const TOOLS: (Tool | 'sep')[] = [
  { action: { type: 'wrap', wrap: 'bold' }, icon: 'bold', label: 'Fet', shortcut: 'Ctrl+B' },
  { action: { type: 'wrap', wrap: 'italic' }, icon: 'italic', label: 'Kursiv', shortcut: 'Ctrl+I' },
  { action: { type: 'wrap', wrap: 'code' }, icon: 'code', label: 'Kod', shortcut: 'Ctrl+E' },
  'sep',
  { action: { type: 'line', line: 'h2' }, icon: 'heading', label: 'Rubrik' },
  { action: { type: 'line', line: 'ul' }, icon: 'list-ul', label: 'Punktlista', shortcut: 'Ctrl+Shift+8' },
  { action: { type: 'line', line: 'ol' }, icon: 'list-ol', label: 'Numrerad lista', shortcut: 'Ctrl+Shift+7' },
  { action: { type: 'line', line: 'check' }, icon: 'check', label: 'Checklista' },
  { action: { type: 'line', line: 'quote' }, icon: 'quote', label: 'Citat' },
  'sep',
  { action: { type: 'link' }, icon: 'link', label: 'Länk', shortcut: 'Ctrl+K' },
  { action: { type: 'emoji' }, icon: 'smile', label: 'Emoji', shortcut: 'Ctrl+.' },
  { action: { type: 'media' }, icon: 'image', label: 'Bild, film eller dokument' }
];

interface Props {
  initial: Draft;
  editing: OrgPost | null;
  onDone: (warning?: string) => void;
  onCancel: () => void;
  kinds?: readonly OrgPostKind[];
}

export function PostComposer({ initial, editing, onDone, onCancel, kinds = ORG_POST_KINDS }: Props) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [more, setMore] = useState(Boolean(initial.expires_at || initial.published_at || initial.link_url));
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [dragging, setDragging] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const pendingSel = useRef<{ start: number; end: number } | null>(null);

  const uploading = uploads.some((u) => !u.error);

  // Autosize + återställ markören efter en formatering.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 140), 560)}px`;
    if (pendingSel.current) {
      el.setSelectionRange(pendingSel.current.start, pendingSel.current.end);
      pendingSel.current = null;
    }
  }, [draft.body, preview]);

  const readSel = (): TextSel => {
    const el = bodyRef.current;
    return el
      ? { value: draft.body, start: el.selectionStart, end: el.selectionEnd }
      : { value: draft.body, start: draft.body.length, end: draft.body.length };
  };

  const applySel = useCallback((next: TextSel) => {
    pendingSel.current = { start: next.start, end: next.end };
    setDraft((d) => ({ ...d, body: next.value }));
    requestAnimationFrame(() => bodyRef.current?.focus());
  }, []);

  function runTool(action: ToolAction) {
    if (preview && action.type !== 'media') setPreview(false);
    switch (action.type) {
      case 'wrap':
        return applySel(wrapSelection(readSel(), action.wrap));
      case 'line':
        return applySel(toggleLinePrefix(readSel(), action.line));
      case 'link':
        return applySel(insertLink(readSel()));
      case 'emoji':
        return setEmojiOpen((o) => !o);
      case 'media':
        return fileRef.current?.click();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      submit();
      return;
    }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      runTool({ type: 'wrap', wrap: 'bold' });
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      runTool({ type: 'wrap', wrap: 'italic' });
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      runTool({ type: 'wrap', wrap: 'code' });
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      runTool({ type: 'link' });
    } else if (mod && e.key === '.') {
      e.preventDefault();
      setEmojiOpen(true);
    } else if (mod && e.shiftKey && (e.key === '8' || e.key === '*')) {
      e.preventDefault();
      runTool({ type: 'line', line: 'ul' });
    } else if (mod && e.shiftKey && (e.key === '7' || e.key === '/')) {
      e.preventDefault();
      runTool({ type: 'line', line: 'ol' });
    } else if (e.key === 'Enter' && !e.shiftKey && !mod) {
      const next = continueList(readSel());
      if (next) {
        e.preventDefault();
        applySel(next);
      }
    } else if (e.key === 'Escape' && emojiOpen) {
      setEmojiOpen(false);
    }
  }

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      setError(null);
      const room = ORG_POST_MEDIA_MAX - draft.media.length - uploads.filter((u) => !u.error).length;
      if (room <= 0) {
        setError(`Högst ${ORG_POST_MEDIA_MAX} filer per inlägg.`);
        return;
      }
      for (const file of list.slice(0, room)) {
        const v = validateOrgPostMediaFile({ type: file.type, size: file.size, name: file.name });
        const key = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        if (!v.ok) {
          setUploads((u) => [...u, { key, name: file.name, kind: 'file', progress: 0, error: v.error }]);
          continue;
        }
        const preview = v.kind === 'image' ? URL.createObjectURL(file) : undefined;
        setUploads((u) => [...u, { key, name: file.name, kind: v.kind, progress: 0, preview }]);
        upload(file, (pct) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: pct } : x))))
          .then((media) => {
            setDraft((d) => (d.media.length >= ORG_POST_MEDIA_MAX ? d : { ...d, media: [...d.media, media] }));
            setUploads((u) => u.filter((x) => x.key !== key));
            if (preview) URL.revokeObjectURL(preview);
          })
          .catch((err: Error) => {
            setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: err.message } : x)));
          });
      }
      if (list.length > room) setError(`Bara ${room} fil${room === 1 ? '' : 'er'} till fick plats (max ${ORG_POST_MEDIA_MAX}).`);
    },
    [draft.media.length, uploads]
  );

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  }

  function onDragEnter(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }
  function onDragLeave(e: DragEvent) {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  }

  function removeMedia(id: string) {
    setDraft((d) => ({ ...d, media: d.media.filter((m) => m.id !== id) }));
  }
  function moveMedia(id: string, dir: -1 | 1) {
    setDraft((d) => {
      const i = d.media.findIndex((m) => m.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.media.length) return d;
      const next = [...d.media];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...d, media: next };
    });
  }

  function submit() {
    if (pending || uploading || !draft.title.trim()) return;
    setError(null);
    startTransition(async () => {
      const payload = {
        ...draft,
        expires_at: draft.expires_at || null,
        published_at: draft.published_at || null,
        link_url: draft.link_url || null
      };
      const res = editing ? await updateOrgPostAction(editing.id, payload) : await createOrgPostAction(payload);
      if (res.ok) onDone(res.warning);
      else setError(res.error || 'Kunde inte spara inlägget.');
    });
  }

  const previewHtml = useMemo(() => (preview ? chatMarkdownToHtml(draft.body) : ''), [preview, draft.body]);

  const field =
    'w-full rounded-xl border border-default bg-surface px-3 py-2 text-[13.5px] text-foreground outline-none transition placeholder:text-foreground-subtle focus:border-strong focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
  const toolBtn =
    'flex h-8 w-8 items-center justify-center rounded-lg text-foreground-muted transition hover:bg-canvas-muted hover:text-foreground disabled:opacity-40';

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`relative rounded-2xl border bg-surface p-4 shadow-md shadow-movexum-svart/5 transition sm:p-5 ${
        dragging ? 'border-brand ring-2 ring-movexum-pastell-lila dark:ring-movexum-morklila' : 'border-default'
      }`}
      aria-label={editing ? 'Redigera inlägg' : 'Nytt inlägg'}
    >
      <span aria-hidden className="absolute inset-x-5 top-0 h-[2px] rounded-b bg-brand" />

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-surface/85">
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-brand px-4 py-3 font-heading text-[14px] font-semibold text-brand">
            <Icon name="upload" size={16} /> Släpp för att ladda upp
          </div>
        </div>
      )}

      {kinds.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {kinds.map((k) => {
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
      )}

      <input
        autoFocus={!editing}
        value={draft.title}
        onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Rubrik"
        maxLength={ORG_POST_TITLE_MAX}
        aria-label="Rubrik"
        className="w-full border-0 border-b border-default bg-transparent px-0 py-2 font-heading text-[20px] font-semibold tracking-tight text-foreground outline-none transition placeholder:text-foreground-subtle focus:border-brand"
      />

      {/* Verktygsrad */}
      <div className="mt-2 flex flex-wrap items-center gap-0.5 border-b border-default pb-1.5">
        {TOOLS.map((t, i) =>
          t === 'sep' ? (
            <span key={`sep-${i}`} aria-hidden className="mx-1 h-5 w-px bg-default" />
          ) : (
            <span key={t.label} className="relative">
              <button
                type="button"
                // Behåll fokus/markering i textrutan när verktyget klickas.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runTool(t.action)}
                title={t.shortcut ? `${t.label} (${t.shortcut})` : t.label}
                aria-label={t.label}
                aria-pressed={t.action.type === 'emoji' ? emojiOpen : undefined}
                disabled={preview && t.action.type !== 'media' && t.action.type !== 'emoji'}
                className={`${toolBtn} ${t.action.type === 'emoji' && emojiOpen ? 'bg-canvas-muted text-foreground' : ''}`}
              >
                <Icon name={t.icon} size={15} />
              </button>
              {t.action.type === 'emoji' && emojiOpen && (
                <EmojiPicker
                  onPick={(emoji) => {
                    if (preview) setPreview(false);
                    applySel(insertAtCursor(readSel(), emoji));
                  }}
                  onClose={() => setEmojiOpen(false)}
                />
              )}
            </span>
          )
        )}
        <span className="ml-auto flex items-center gap-1">
          <span className="hidden text-[11px] text-foreground-subtle sm:inline">
            {draft.body.length > ORG_POST_BODY_MAX * 0.8 ? `${draft.body.length.toLocaleString('sv-SE')} / ${ORG_POST_BODY_MAX.toLocaleString('sv-SE')}` : ''}
          </span>
          <button
            type="button"
            onClick={() => setPreview((p) => !p)}
            aria-pressed={preview}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition ${
              preview ? 'bg-brand text-brand-foreground' : 'text-foreground-muted hover:bg-canvas-muted hover:text-foreground'
            }`}
          >
            <Icon name={preview ? 'pencil' : 'eye'} size={13} />
            {preview ? 'Redigera' : 'Förhandsgranska'}
          </button>
        </span>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {preview ? (
        <div className="min-h-[140px] py-3">
          {draft.body.trim() ? (
            <div
              className="mx-post-body max-w-[66ch] text-[13.5px] leading-relaxed text-foreground-muted"
              // Renderad av lib/safe-html (escapad markdown) — samma som inläggsvyn.
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          ) : (
            <p className="text-[13px] text-foreground-subtle">Inget att förhandsgranska än — skriv något först.</p>
          )}
          <PostMedia media={draft.media} className="mt-3" />
        </div>
      ) : (
        <textarea
          ref={bodyRef}
          value={draft.body}
          onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder="Skriv inlägget… Markera text och använd verktygsraden, eller skriv markdown direkt. Dra in bilder, film eller dokument — eller klistra in en bild."
          maxLength={ORG_POST_BODY_MAX}
          aria-label="Inläggstext"
          className="mt-1 w-full resize-none border-0 bg-transparent px-0 py-2 text-[14px] leading-relaxed text-foreground outline-none placeholder:text-foreground-subtle"
        />
      )}

      {/* Mediaremsa (bara i redigeringsläge — i förhandsgranskningen visas galleriet) */}
      {!preview && (draft.media.length > 0 || uploads.length > 0) && (
        <ul className="mt-2 flex flex-wrap gap-2 border-t border-default pt-3">
          {draft.media.map((m, i) => (
            <li key={m.id} className="group/tile relative">
              <div className="flex h-[76px] w-[76px] items-center justify-center overflow-hidden rounded-xl border border-default bg-canvas-muted">
                {m.kind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt={m.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex flex-col items-center gap-1 px-1 text-center text-[10px] text-foreground-muted">
                    <Icon name={m.kind === 'video' ? 'video' : 'doc'} size={18} className="text-brand" />
                    <span className="line-clamp-2 w-full break-all leading-tight">{m.name}</span>
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeMedia(m.id)}
                aria-label={`Ta bort ${m.name || 'filen'}`}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-default bg-surface text-foreground-muted opacity-0 shadow-sm transition hover:text-movexum-morkorange group-hover/tile:opacity-100 focus:opacity-100"
              >
                <Icon name="close" size={10} stroke={2.2} />
              </button>
              {draft.media.length > 1 && (
                <span className="absolute inset-x-0 bottom-0 flex justify-between px-0.5 opacity-0 transition group-hover/tile:opacity-100">
                  <button
                    type="button"
                    onClick={() => moveMedia(m.id, -1)}
                    disabled={i === 0}
                    aria-label="Flytta vänster"
                    className="flex h-5 w-5 items-center justify-center rounded-full bg-surface/90 text-foreground shadow-sm disabled:opacity-0"
                  >
                    <Icon name="back" size={10} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveMedia(m.id, 1)}
                    disabled={i === draft.media.length - 1}
                    aria-label="Flytta höger"
                    className="flex h-5 w-5 items-center justify-center rounded-full bg-surface/90 text-foreground shadow-sm disabled:opacity-0"
                  >
                    <Icon name="arrow" size={10} />
                  </button>
                </span>
              )}
            </li>
          ))}
          {uploads.map((u) => (
            <li key={u.key} className="relative">
              <div
                className={`flex h-[76px] w-[76px] items-center justify-center overflow-hidden rounded-xl border ${
                  u.error ? 'border-movexum-morkorange/50' : 'border-default'
                } bg-canvas-muted`}
                title={u.error ?? `${u.name} · ${u.progress} %`}
              >
                {u.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={u.preview} alt="" className={`h-full w-full object-cover ${u.error ? 'opacity-40' : 'opacity-60'}`} />
                ) : (
                  <Icon name={u.error ? 'alert' : u.kind === 'video' ? 'video' : 'doc'} size={18} className={u.error ? 'text-movexum-morkorange' : 'text-foreground-subtle'} />
                )}
                {!u.error && (
                  <span className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-surface/80">
                    <span className="block h-full rounded-full bg-brand transition-[width]" style={{ width: `${u.progress}%` }} />
                  </span>
                )}
              </div>
              {u.error && (
                <button
                  type="button"
                  onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}
                  aria-label="Dölj felet"
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-default bg-surface text-foreground-muted shadow-sm"
                >
                  <Icon name="close" size={10} stroke={2.2} />
                </button>
              )}
            </li>
          ))}
          <li className="flex items-center">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex h-[76px] w-[76px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-strong text-[10.5px] text-foreground-subtle transition hover:border-brand hover:text-brand"
            >
              <Icon name="plus" size={14} />
              Lägg till
            </button>
          </li>
        </ul>
      )}
      {uploads.some((u) => u.error) && (
        <ul className="mt-1.5 space-y-0.5 text-[12px] text-movexum-morkorange">
          {uploads.filter((u) => u.error).map((u) => (
            <li key={u.key}>
              {u.name}: {u.error}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-default pt-3 text-[12px] text-foreground-muted">
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

      {error && (
        <p role="alert" className="mt-2 text-[12px] text-movexum-morkorange">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-foreground-subtle">
          <kbd className="rounded border border-default bg-canvas-subtle px-1 py-px font-body text-[10px]">Ctrl</kbd> +{' '}
          <kbd className="rounded border border-default bg-canvas-subtle px-1 py-px font-body text-[10px]">Enter</kbd> publicerar
          {' · '}markdown stöds
        </span>
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-3 py-1.5 text-[12.5px] text-foreground-muted transition hover:bg-canvas-subtle hover:text-foreground"
          >
            Avbryt
          </button>
          <button
            type="submit"
            disabled={pending || uploading || !draft.title.trim()}
            className="rounded-xl bg-brand px-3.5 py-1.5 text-[12.5px] font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-50"
          >
            {pending ? 'Sparar…' : uploading ? 'Laddar upp…' : editing ? 'Spara' : 'Publicera'}
          </button>
        </span>
      </div>
    </form>
  );
}
