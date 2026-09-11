'use client';

import { useMemo, useState } from 'react';
import { Icon } from '@/components/proto/Icon';
import { TimeAgo } from './TimeAgo';
import type { OmvarldItem } from '@platform/shared';

/**
 * Omvärldsbevakningen på Dashboard (CLAUDE.md § 37.4) — klientdelen, satt
 * som en tidningsspalt: första posten som "toppnyhet" med stor rubrik, resten
 * som notiser i två spalter med hårlinjer (inga kort). Servern har redan
 * hämtat, sanerat och slagit ihop flödena (EU-whitelist, stale-while-
 * revalidate); här sker bara filtrering per källa och en ärlig statusrad:
 * vilka källor som svarade, hur färska posterna är och vilka som är nere
 * (med felorsak i tooltip). Länkar öppnas hos källan.
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

function SourceLine({ item }: { item: OmvarldItem }) {
  return (
    <span className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-brand">
      <span className="truncate">{item.source}</span>
      {item.pubDate && (
        <>
          <span aria-hidden className="text-foreground-subtle">·</span>
          <TimeAgo iso={item.pubDate} className="shrink-0 font-medium normal-case tracking-normal text-foreground-subtle" />
        </>
      )}
    </span>
  );
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
  const [lead, ...rest] = visible;

  return (
    <div>
      {sources.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-default pb-3 text-[12px]">
          <button
            type="button"
            onClick={() => setFilter(null)}
            className={`font-semibold transition ${
              filter === null ? 'text-foreground underline decoration-brand decoration-2 underline-offset-[6px]' : 'text-foreground-subtle hover:text-foreground'
            }`}
          >
            Alla källor
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
                  ? 'text-foreground underline decoration-brand decoration-2 underline-offset-[6px]'
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

      {!lead ? (
        <p className="text-[13px] leading-relaxed text-foreground-subtle">
          {items.length === 0
            ? 'Omvärldsflödena svarar inte just nu. Sidan försöker igen automatiskt.'
            : 'Inga poster från den källan just nu.'}
        </p>
      ) : (
        <>
          <a
            href={lead.link}
            target="_blank"
            rel="noopener noreferrer"
            className="group block"
          >
            <SourceLine item={lead} />
            <h3 className="mt-1.5 font-heading text-[20px] font-semibold leading-tight tracking-tight text-foreground transition group-hover:text-brand md:text-[22px]">
              {lead.title}
            </h3>
            {lead.summary && (
              <p className="mt-2 line-clamp-3 max-w-[64ch] text-[13.5px] leading-relaxed text-foreground-muted">
                {lead.summary}
              </p>
            )}
            <span className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-link">
              Läs hos källan
              <Icon name="external" size={11} />
            </span>
          </a>

          {rest.length > 0 && (
            <ul className="mt-5 grid grid-cols-1 gap-x-8 border-t border-default sm:grid-cols-2">
              {rest.map((item) => (
                <li key={item.link} className="border-b border-default">
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block py-3"
                  >
                    <SourceLine item={item} />
                    <p className="mt-1 line-clamp-2 text-[14px] font-semibold leading-snug text-foreground transition group-hover:text-brand">
                      {item.title}
                    </p>
                    {item.summary && (
                      <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-foreground-muted">
                        {item.summary}
                      </p>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
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
