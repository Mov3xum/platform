'use client';

import { useMemo, useState } from 'react';
import {
  COMPETENCE_LEVELS,
  COMPETENCE_LEVEL_LABELS,
  competenceTagLabelFromSlug,
  competenceTagsByArea,
  normalizeCompetenceTagSlug,
  type CompetenceLevel,
  type CompetenceTagDef,
  type StudentTag
} from '@platform/shared';

/**
 * Hashtag-väljare (§ 54) — samma vokabulär som personalens kompetensprofil
 * (§ 29.7). Klick väljer/avmarkerar; med `withLevels` cyklar ett nytt klick
 * nivån (kan bidra → stark → expert). Fritext normaliseras till slug.
 * Renderar dolda `<input name=…>` när `name` ges (server-action-formulär);
 * annars styrs värdet via `onChange` (JSON-fetch på studentsidan).
 */
interface Props {
  vocabulary: readonly CompetenceTagDef[];
  value: StudentTag[];
  onChange: (next: StudentTag[]) => void;
  withLevels?: boolean;
  name?: string;
  max: number;
  placeholder?: string;
}

const LEVEL_TONE: Record<CompetenceLevel, string> = {
  contribute: 'bg-movexum-pastell-bla text-movexum-djupbla dark:bg-movexum-djupbla/40 dark:text-movexum-pastell-bla',
  strong: 'bg-movexum-pastell-lila text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila',
  expert: 'bg-brand text-brand-foreground'
};

export function TagPicker({ vocabulary, value, onChange, withLevels = false, name, max, placeholder }: Props) {
  const [query, setQuery] = useState('');
  const selected = useMemo(() => new Map(value.map((t) => [t.tag, t.level])), [value]);
  const byArea = useMemo(() => competenceTagsByArea(vocabulary).filter((a) => a.tags.length > 0), [vocabulary]);
  const q = query.trim().toLowerCase();
  const matches = q
    ? vocabulary.filter((t) => t.slug.includes(normalizeCompetenceTagSlug(q)) || t.label.toLowerCase().includes(q)).slice(0, 12)
    : [];
  const customSlug = normalizeCompetenceTagSlug(query);
  const canAddCustom = Boolean(customSlug) && !selected.has(customSlug) && !vocabulary.some((t) => t.slug === customSlug);

  function toggle(slug: string) {
    const level = selected.get(slug);
    if (!level) {
      if (value.length >= max) return;
      onChange([...value, { tag: slug, level: 'contribute' }]);
      return;
    }
    if (!withLevels) {
      onChange(value.filter((t) => t.tag !== slug));
      return;
    }
    const i = COMPETENCE_LEVELS.indexOf(level);
    if (i === COMPETENCE_LEVELS.length - 1) onChange(value.filter((t) => t.tag !== slug));
    else onChange(value.map((t) => (t.tag === slug ? { ...t, level: COMPETENCE_LEVELS[i + 1]! } : t)));
  }

  function labelOf(slug: string): string {
    return vocabulary.find((t) => t.slug === slug)?.label ?? competenceTagLabelFromSlug(slug);
  }

  const chip = (slug: string, label: string) => {
    const level = selected.get(slug);
    const on = Boolean(level);
    return (
      <button
        key={slug}
        type="button"
        onClick={() => toggle(slug)}
        aria-pressed={on}
        className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
          on ? LEVEL_TONE[withLevels ? level! : 'expert'] : 'border border-default bg-surface text-foreground-muted hover:bg-canvas-subtle'
        }`}
        title={withLevels && on ? `${COMPETENCE_LEVEL_LABELS[level!]} — klicka för nästa nivå` : undefined}
      >
        #{label}
        {withLevels && on ? <span className="ml-1 opacity-80">· {COMPETENCE_LEVEL_LABELS[level!]}</span> : null}
      </button>
    );
  };

  return (
    <div className="space-y-3">
      {name
        ? value.map((t) => (
            <input key={t.tag} type="hidden" name={name} value={withLevels ? `${t.tag}:${t.level}` : t.tag} />
          ))
        : null}
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">{value.map((t) => chip(t.tag, labelOf(t.tag)))}</div>
      ) : (
        <p className="text-xs text-foreground-subtle">Inga hashtags valda än.</p>
      )}
      {withLevels ? (
        <p className="text-[11px] text-foreground-subtle">Klicka på en vald hashtag för att byta nivå: kan bidra → stark → expert → ta bort.</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder ?? 'Sök eller skriv en egen hashtag…'}
          className="w-full max-w-xs rounded-xl border border-default bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-strong"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (matches[0] && !canAddCustom) toggle(matches[0].slug);
              else if (customSlug) toggle(customSlug);
              setQuery('');
            }
          }}
        />
        <span className="text-[11px] text-foreground-subtle mx-tnum">
          {value.length}/{max}
        </span>
      </div>
      {q ? (
        <div className="flex flex-wrap gap-1.5">
          {matches.map((t) => chip(t.slug, t.label))}
          {canAddCustom ? (
            <button
              type="button"
              onClick={() => {
                toggle(customSlug);
                setQuery('');
              }}
              className="rounded-full border border-dashed border-strong px-2.5 py-1 text-xs font-medium text-foreground-muted hover:bg-canvas-subtle"
            >
              + Lägg till #{customSlug}
            </button>
          ) : null}
        </div>
      ) : (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-semibold text-foreground-muted">Bläddra bland hashtags per område</summary>
          <div className="mt-2 space-y-3">
            {byArea.map((a) => (
              <div key={a.area}>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">{a.label}</p>
                <div className="flex flex-wrap gap-1.5">{a.tags.map((t) => chip(t.slug, t.label))}</div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** Tolkar `tag:level`-värden från dolda inputs tillbaka till StudentTag (server-sida). */
export function parseTagInputs(values: readonly string[]): StudentTag[] {
  return values.map((v) => {
    const [tag, level] = v.split(':');
    return { tag: tag ?? '', level: (COMPETENCE_LEVELS as readonly string[]).includes(level ?? '') ? (level as CompetenceLevel) : 'contribute' };
  });
}
