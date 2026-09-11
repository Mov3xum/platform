'use client';

import { useMemo, useState } from 'react';
import { Icon } from '@/components/proto/Icon';
import { TimeAgo } from './TimeAgo';
import type { OmvarldItem } from '@platform/shared';

/**
 * Omvärldsbevakningen på Hemmaplan (CLAUDE.md § 37.4) — klientdelen, satt
 * som SAMMA vertikala tidslinje som Bolagsnytt (hårlinje + prickar, eyebrow
 * med källa och tid) så att interna och externa nyheter läses som två listor
 * i samma språk i sidospalten. Servern har redan hämtat, sanerat och slagit
 * ihop flödena (EU-whitelist, stale-while-revalidate); här sker bara
 * filtrering per källa och en ärlig statusrad: vilka källor som svarade, hur
 * färska posterna är och vilka som är nere (med felorsak i tooltip). Länkar
 * öppnas hos källan.
 */

export interface OmvarldSourceStatus {
  key: string;
  label: string;
  ok: boolean;
  /** Poster från en utgången cache — uppdatering pågår i bakgrunden. */
  stale: boolean;
  fetched_at: string;
  error?: string;
  count: number;
  /** SE/EU — residency-transparens. */
  country: 'SE' | 'EU';
  /** Vem som står bakom källan och vad den bevakar. */
  description: string;
  covers: string;
}

export function OmvarldFeed({
  items,
  sources,
  max = 12
}: {
  items: OmvarldItem[];
  sources: OmvarldSourceStatus[];
  max?: number;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const visible = useMemo(
    () => (filter ? items.filter((i) => i.sourceKey === filter) : items).slice(0, max),
    [items, filter, max]
  );
  const okSources = sources.filter((s) => s.ok);
  const down = sources.filter((s) => !s.ok);

  return (
    <div>
      {sources.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
          <button
            type="button"
            onClick={() => setFilter(null)}
            className={`font-semibold transition ${
              filter === null
                ? 'text-foreground underline decoration-brand decoration-2 underline-offset-[5px]'
                : 'text-foreground-subtle hover:text-foreground'
            }`}
          >
            Alla
          </button>
          {sources.map((s) => (
            <button
              key={s.key}
              type="button"
              disabled={!s.ok || s.count === 0}
              onClick={() => setFilter((f) => (f === s.key ? null : s.key))}
              title={s.ok ? `${s.covers || s.label} · ${s.count} poster` : s.error ? `Nere: ${s.error}` : 'Nere'}
              className={`inline-flex items-center gap-1.5 font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                filter === s.key
                  ? 'text-foreground underline decoration-brand decoration-2 underline-offset-[5px]'
                  : 'text-foreground-subtle hover:text-foreground'
              }`}
            >
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${
                  !s.ok ? 'bg-movexum-orange' : s.stale ? 'bg-movexum-gul' : 'bg-movexum-gron'
                }`}
              />
              {s.label}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-foreground-subtle">
          {items.length === 0
            ? 'Omvärldsflödena svarar inte just nu. Sidan försöker igen automatiskt.'
            : 'Inga poster från den källan just nu.'}
        </p>
      ) : (
        <ol className="relative ml-[5px] border-l border-default pl-5">
          {visible.map((item) => (
            <li key={item.link} className="relative pb-3.5 last:pb-0">
              <a href={item.link} target="_blank" rel="noopener noreferrer" className="group block">
                <span
                  aria-hidden
                  className="absolute -left-[25px] top-[6px] h-[9px] w-[9px] rounded-full bg-movexum-bla ring-4 ring-canvas"
                />
                <span className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.12em] text-foreground-subtle">
                  <span className="truncate">{item.source}</span>
                  {item.pubDate && (
                    <>
                      <span aria-hidden>·</span>
                      <TimeAgo iso={item.pubDate} className="shrink-0 normal-case tracking-normal" />
                    </>
                  )}
                </span>
                <span className="mt-0.5 flex items-start gap-2">
                  <span className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground group-hover:underline group-hover:decoration-brand/40 group-hover:underline-offset-4">
                    {item.title}
                  </span>
                  <Icon name="external" size={11} className="mt-[3px] shrink-0 text-foreground-subtle" />
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}

      <details className="group mt-3 rounded-xl border border-default">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[11.5px] font-medium text-foreground-muted transition hover:text-foreground [&::-webkit-details-marker]:hidden">
          <Icon name="globe" size={12} className="shrink-0 text-brand" />
          Om källorna
          <span className="text-foreground-subtle">· {sources.length} EU-baserade flöden</span>
          <Icon name="chevdown" size={11} className="ml-auto shrink-0 text-foreground-subtle transition group-open:rotate-180" />
        </summary>
        <ul className="divide-y divide-default border-t border-default">
          {sources.map((s) => (
            <li key={s.key} className="px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${
                    !s.ok ? 'bg-movexum-orange' : s.stale ? 'bg-movexum-gul' : 'bg-movexum-gron'
                  }`}
                />
                <span className="text-[12.5px] font-semibold text-foreground">{s.label}</span>
                <span className="rounded-md bg-canvas-muted px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
                  {s.country}
                </span>
                <span className="text-[11px] text-foreground-subtle">{s.covers}</span>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-foreground-muted">{s.description}</p>
              {!s.ok && s.error ? (
                <p className="mt-1 text-[11px] text-movexum-morkorange">Svarar inte just nu: {s.error}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </details>

      <p className="mt-3 text-[11px] leading-relaxed text-foreground-subtle">
        {okSources.length > 0 ? (
          <>
            Live från {okSources.map((s) => s.label).join(', ')}
            {okSources.some((s) => s.stale) ? ' (uppdateras i bakgrunden)' : ''}.{' '}
          </>
        ) : null}
        {down.length > 0 ? (
          <span className="text-movexum-morkorange" title={down.map((s) => `${s.label}: ${s.error ?? 'nere'}`).join('\n')}>
            Svarar inte: {down.map((s) => s.label).join(', ')}.{' '}
          </span>
        ) : null}
        Hämtas direkt från källorna var 15:e minut, inget lagras. Länkarna öppnas hos källan.
      </p>
    </div>
  );
}
