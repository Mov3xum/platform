'use client';

import { useMemo, useState } from 'react';
import { Icon } from '@/components/proto/Icon';
import { TimeAgo } from './TimeAgo';
import type { OmvarldItem } from '@platform/shared';

/**
 * Omvärldsbevakningen på Hemmaplan (CLAUDE.md § 37.4) — klientdelen.
 * Servern har redan hämtat, sanerat och slagit ihop flödena (EU-whitelist,
 * stale-while-revalidate); här sker bara filtrering per källa och en ärlig
 * statusrad: vilka källor som svarade, hur färska posterna är och vilka som
 * är nere (med felorsak i tooltip). Länkar öppnas hos källan.
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
  country: string;
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
        <div className="mb-3 flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setFilter(null)}
            className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition ${
              filter === null ? 'bg-brand text-brand-foreground' : 'bg-canvas-muted text-foreground-muted hover:text-foreground'
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
              title={`${s.covers}${s.ok ? ` · ${s.count} poster` : ` · nere${s.error ? `: ${s.error}` : ''}`}`}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                filter === s.key ? 'bg-brand text-brand-foreground' : 'bg-canvas-muted text-foreground-muted hover:text-foreground'
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
        <div className="rounded-2xl border border-dashed border-default px-4 py-8 text-center text-[13px] text-foreground-subtle">
          {items.length === 0
            ? 'Omvärldsflödena svarar inte just nu. Sidan försöker igen automatiskt.'
            : 'Inga poster från den källan just nu.'}
        </div>
      ) : (
        <ul className="divide-y divide-default">
          {visible.map((item) => (
            <li key={item.link}>
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="group -mx-2 flex gap-3 rounded-xl px-2 py-2.5 transition hover:bg-canvas-subtle"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-foreground-subtle">
                    <span className="truncate">{item.source}</span>
                    {item.pubDate && (
                      <>
                        <span aria-hidden>·</span>
                        <TimeAgo iso={item.pubDate} className="shrink-0 normal-case tracking-normal font-medium" />
                      </>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[13.5px] font-medium leading-snug text-foreground">
                    {item.title}
                  </p>
                  {item.summary && (
                    <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-foreground-muted">
                      {item.summary}
                    </p>
                  )}
                </div>
                <Icon
                  name="external"
                  size={12}
                  className="mt-1 shrink-0 text-foreground-subtle transition group-hover:text-foreground"
                />
              </a>
            </li>
          ))}
        </ul>
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
