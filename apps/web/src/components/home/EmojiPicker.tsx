'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/proto/Icon';
import type { EmojiEntry, EmojiGroup } from '@/lib/emoji/data';
import {
  applySkinTone,
  loadRecentEmoji,
  pushRecent,
  saveRecentEmoji,
  searchEmoji,
  SKIN_TONES,
  type SkinTone
} from '@/lib/emoji-search';

/**
 * Emoji-väljaren på anslagstavlan (CLAUDE.md § 37.6). Fullt paket (1 400+ emoji
 * i nio kategorier), sök på svenska/engelska, hudton, "senast använda".
 * Katalogen (`lib/emoji/data.ts`, ~40 KB) laddas lazy första gången väljaren
 * öppnas så den aldrig tynger startsidan. Ren klient-UX — ingen dataväg.
 */

const GROUP_ICON: Record<string, string> = {
  recent: '🕘',
  smileys: '😀',
  people: '👋',
  animals: '🐻',
  food: '🍕',
  activities: '🎉',
  travel: '🚀',
  objects: '💡',
  symbols: '✅',
  flags: '🇸🇪'
};

const TONE_SWATCH = ['#f2c896', '#f7dcc4', '#e0bb95', '#bf8f68', '#9b643d', '#5a3a26'];

interface Props {
  onPick: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ onPick, onClose }: Props) {
  const [groups, setGroups] = useState<readonly EmojiGroup[] | null>(null);
  const [bases, setBases] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');
  const [tone, setTone] = useState<SkinTone>(0);
  const [active, setActive] = useState<string>('smileys');
  const [recent, setRecent] = useState<string[]>([]);
  const [hover, setHover] = useState<EmojiEntry | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    import('@/lib/emoji/data').then((m) => {
      if (!alive) return;
      setGroups(m.EMOJI_GROUPS);
      setBases(m.SKIN_TONE_BASES);
    });
    setRecent(loadRecentEmoji());
    try {
      const t = Number(window.localStorage.getItem('movexum-emoji-tone') || 0);
      if (t >= 0 && t <= 5) setTone(t as SkinTone);
    } catch {
      /* bekvämlighet */
    }
    inputRef.current?.focus();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: MouseEvent) => {
      // Förankringen (knappen som öppnade) räknas som "inuti" — annars stänger
      // mousedown och knappens click öppnar igen i samma klick.
      const anchor = rootRef.current?.parentElement ?? rootRef.current;
      if (anchor && !anchor.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const results = useMemo(() => (groups ? searchEmoji(query, groups) : []), [groups, query]);

  function pick(entry: EmojiEntry) {
    const char = applySkinTone(entry[0], tone, bases);
    const next = pushRecent(recent, char);
    setRecent(next);
    saveRecentEmoji(next);
    onPick(char);
  }

  function chooseTone(t: SkinTone) {
    setTone(t);
    try {
      window.localStorage.setItem('movexum-emoji-tone', String(t));
    } catch {
      /* bekvämlighet */
    }
  }

  function jumpTo(id: string) {
    setActive(id);
    setQuery('');
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-group="${id}"]`);
    if (el && scrollRef.current) {
      scrollRef.current.scrollTo({ top: el.offsetTop - 4, behavior: 'smooth' });
    }
  }

  function onScroll() {
    const c = scrollRef.current;
    if (!c || query) return;
    const sections = Array.from(c.querySelectorAll<HTMLElement>('[data-group]'));
    let cur = sections[0]?.dataset.group;
    for (const s of sections) {
      if (s.offsetTop - c.scrollTop <= 40) cur = s.dataset.group;
    }
    if (cur && cur !== active) setActive(cur);
  }

  const cell = (entry: EmojiEntry, key: string) => (
    <button
      key={key}
      type="button"
      onClick={() => pick(entry)}
      onMouseEnter={() => setHover(entry)}
      onFocus={() => setHover(entry)}
      title={entry[1]}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-[22px] leading-none transition hover:bg-canvas-muted focus:bg-canvas-muted focus:outline-none"
    >
      {applySkinTone(entry[0], tone, bases)}
    </button>
  );

  const tabs = groups ? [...(recent.length ? [{ id: 'recent', label: 'Senast använda' }] : []), ...groups] : [];

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Välj emoji"
      className="mx-emoji-pop absolute left-0 top-full z-30 mt-2 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-default bg-surface shadow-lg shadow-movexum-svart/15"
    >
      <div className="flex items-center gap-2 border-b border-default px-3 py-2">
        <Icon name="search" size={14} className="shrink-0 text-foreground-subtle" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Sök emoji… (t.ex. raket, hjärta, fest)"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground-subtle"
        />
        <div className="flex items-center gap-1" title="Hudton">
          {SKIN_TONES.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={i === 0 ? 'Standard (gul)' : `Hudton ${i}`}
              onClick={() => chooseTone(i as SkinTone)}
              className={`h-4 w-4 rounded-full border transition ${
                tone === i ? 'scale-110 border-brand ring-2 ring-movexum-pastell-lila dark:ring-movexum-morklila' : 'border-default'
              }`}
              style={{ background: TONE_SWATCH[i] }}
            />
          ))}
        </div>
      </div>

      {tabs.length > 0 && !query && (
        <div className="flex items-center gap-0.5 overflow-x-auto border-b border-default px-2 py-1">
          {tabs.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => jumpTo(g.id)}
              title={g.label}
              aria-label={g.label}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[17px] leading-none transition ${
                active === g.id ? 'bg-canvas-muted' : 'opacity-60 hover:opacity-100'
              }`}
            >
              {GROUP_ICON[g.id] ?? '•'}
            </button>
          ))}
        </div>
      )}

      <div ref={scrollRef} onScroll={onScroll} className="h-[300px] overflow-y-auto px-2 py-1">
        {!groups ? (
          <p className="px-2 py-6 text-center text-[12.5px] text-foreground-subtle">Laddar emoji…</p>
        ) : query ? (
          results.length === 0 ? (
            <p className="px-2 py-6 text-center text-[12.5px] text-foreground-subtle">Inget matchade „{query}”.</p>
          ) : (
            <div className="grid grid-cols-8 gap-0.5 py-1">{results.map((e) => cell(e, e[0]))}</div>
          )
        ) : (
          <>
            {recent.length > 0 && (
              <section data-group="recent">
                <h4 className="px-1 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-foreground-subtle">
                  Senast använda
                </h4>
                <div className="grid grid-cols-8 gap-0.5">
                  {recent.map((c) => cell([c, ''] as const, `r-${c}`))}
                </div>
              </section>
            )}
            {groups.map((g) => (
              <section key={g.id} data-group={g.id}>
                <h4 className="px-1 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-foreground-subtle">
                  {g.label}
                </h4>
                <div className="grid grid-cols-8 gap-0.5">{g.emoji.map((e) => cell(e, `${g.id}-${e[0]}`))}</div>
              </section>
            ))}
          </>
        )}
      </div>

      <div className="flex h-9 items-center gap-2 border-t border-default px-3 text-[12px] text-foreground-subtle">
        {hover && hover[1] ? (
          <>
            <span className="text-[18px] leading-none">{applySkinTone(hover[0], tone, bases)}</span>
            <span className="truncate">{hover[2] ? hover[2].split(' ')[0] : hover[1]}</span>
          </>
        ) : (
          <span>Klicka för att infoga · Esc stänger</span>
        )}
      </div>
    </div>
  );
}
