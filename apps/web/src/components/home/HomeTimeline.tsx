import Link from 'next/link';
import { Fragment } from 'react';
import type { HomeTimeline } from '@platform/shared';

/**
 * 14-dagarsremsan på Hemmaplan (CLAUDE.md § 37): en dagslinjal med årshjulets
 * poster och events som band som löper över sina dagar — perioder blir långa
 * band, enskilda dagar korta, och överlappande band packas i körfält av den
 * rena, enhetstestade `buildHomeTimeline`. Ren presentation (server), ingen
 * dataväg. Färger: events i lila (sekundär accent), årshjulet i mörkblå
 * (brand) — båda som tonade ytor med ink-text så dark mode följer med.
 */

const DAY_MIN_PX = 60;

export function HomeTimelineStrip({ timeline }: { timeline: HomeTimeline }) {
  const { days, spans, lanes } = timeline;
  const cols = days.length;
  // Kolumnbredd efter fönster: en vecka får breda dagar, en månad smala (scrollar i sidled).
  const dayMinPx = cols <= 7 ? 96 : cols <= 14 ? DAY_MIN_PX : 44;
  const laneRows = Math.max(lanes, 1);

  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <div
        className="relative grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(${dayMinPx}px, 1fr))`,
          gridTemplateRows: `auto repeat(${laneRows}, minmax(30px, auto))`,
          columnGap: 0,
          rowGap: 6,
          minWidth: cols * dayMinPx
        }}
      >
        {/* Dagslinjal */}
        {days.map((d, i) => (
          <div
            key={d.date.toISOString()}
            className={`relative flex flex-col items-center pb-3 pt-1 ${
              i > 0 ? 'border-l border-default/70' : ''
            }`}
            style={{ gridColumn: i + 1, gridRow: 1 }}
          >
            {d.monthLabel && (
              <span className="absolute -top-0.5 left-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand">
                {d.monthLabel}
              </span>
            )}
            <span
              className={`mt-3 text-[10px] uppercase tracking-[0.12em] ${
                d.isWeekend ? 'text-foreground-subtle/70' : 'text-foreground-subtle'
              }`}
            >
              {d.weekday}
            </span>
            <span
              className={`mx-tnum mt-0.5 flex h-7 w-7 items-center justify-center rounded-full font-heading text-[13px] font-semibold ${
                d.isToday
                  ? 'bg-brand text-brand-foreground'
                  : d.isWeekend
                    ? 'text-foreground-subtle'
                    : 'text-foreground'
              }`}
              aria-label={d.isToday ? 'Idag' : undefined}
            >
              {d.day}
            </span>
          </div>
        ))}

        {/* Helg-skuggning + idag-linje bakom banden */}
        {spans.length > 0 &&
          days.map((d, i) =>
            d.isWeekend ? (
            <div
              key={`wk-${i}`}
              aria-hidden
              className="pointer-events-none bg-canvas-subtle"
              style={{ gridColumn: i + 1, gridRow: `2 / span ${laneRows}`, marginTop: -6 }}
            />
            ) : null
          )}
        {spans.length > 0 && (
          <div
            aria-hidden
            className="pointer-events-none z-0 border-l border-dashed border-brand/40"
            style={{ gridColumn: 1, gridRow: `2 / span ${laneRows}`, marginTop: -6, marginLeft: -1 }}
          />
        )}

        {/* Band: hela etikettytan (labelTo) är en ljus box så texten aldrig hamnar
            utanför en ruta; postens FAKTISKA dagar markeras med den fylligare
            tonen inuti boxen. Etiketten får därmed flyta ut över lediga dagar i
            samma körfält utan att sticka ut. */}
        {spans.map((s) => {
          const isEvent = s.item.source === 'event';
          const hugs = s.labelTo > s.to; // etiketten får luft bortom de faktiska dagarna
          const bandTone = isEvent
            ? 'bg-movexum-pastell-lila group-hover:bg-movexum-lila/30 dark:bg-movexum-morklila/50 dark:group-hover:bg-movexum-morklila/80'
            : 'bg-brand/10 group-hover:bg-brand/20 dark:bg-brand/20 dark:group-hover:bg-brand/30';
          const boxTone = isEvent
            ? 'bg-movexum-pastell-lila/60 dark:bg-movexum-morklila/35'
            : 'bg-brand/[0.06] dark:bg-brand/15';
          const textTone = isEvent ? 'text-movexum-morklila dark:text-movexum-pastell-lila' : 'text-brand';
          const radius = `${s.clippedStart ? 'rounded-l-sm' : 'rounded-l-full'} ${
            s.clippedEnd ? 'rounded-r-sm' : 'rounded-r-full'
          }`;
          const timeMeta = isEvent && s.item.meta ? s.item.meta.split(' · ')[0] : undefined;
          // Bandet (faktiska dagar) ritas som eget grid-element BAKOM etiketten;
          // etikett-boxen ligger ovanpå, kramar texten (justify-self-start) och
          // är aldrig smalare än bandet — så texten hamnar alltid i en ruta men
          // rutan låtsas inte att aktiviteten pågår längre än den gör.
          return (
            <Fragment key={s.item.id}>
              <span
                aria-hidden
                className={`z-0 mx-0.5 ${bandTone} ${radius}`}
                style={{ gridColumn: `${s.from + 1} / ${s.to + 2}`, gridRow: s.lane + 2 }}
              />
              <Link
                href={s.item.href}
                title={`${s.item.title}${s.item.meta ? ` — ${s.item.meta}` : ''}`}
                className={`group z-10 mx-0.5 inline-flex max-w-full items-center justify-self-start overflow-hidden py-1.5 text-[12px] font-medium leading-none ${textTone} ${radius} ${
                  hugs ? boxTone : ''
                }`}
                style={{
                  gridColumn: `${s.from + 1} / ${s.labelTo + 2}`,
                  gridRow: s.lane + 2,
                  minWidth: `${((s.to - s.from + 1) / (s.labelTo - s.from + 1)) * 100}%`
                }}
              >
                <span className="flex min-w-0 max-w-full items-center gap-1.5 px-2.5">
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${isEvent ? 'bg-movexum-lila dark:bg-movexum-ljuslila' : 'bg-current'}`}
                  />
                  {timeMeta && <span className="mx-tnum shrink-0 opacity-70">{timeMeta}</span>}
                  <span className="truncate group-hover:underline group-hover:underline-offset-4">{s.item.title}</span>
                  {!isEvent && s.item.meta && s.labelTo - s.from + 1 >= 3 && (
                    <span className="hidden truncate opacity-60 md:inline">· {s.item.meta}</span>
                  )}
                </span>
              </Link>
            </Fragment>
          );
        })}

        {spans.length === 0 && (
          <p
            className="self-center py-2 text-[12.5px] text-foreground-subtle"
            style={{ gridColumn: `1 / ${cols + 1}`, gridRow: 2 }}
          >
            Inget inplanerat i perioden — lägg in i årshjulet eller be chatten.
          </p>
        )}
      </div>
    </div>
  );
}
