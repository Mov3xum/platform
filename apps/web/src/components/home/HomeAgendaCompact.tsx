import Link from 'next/link';
import type { HomeTimeline, HomeTimelineSpan } from '@platform/shared';

/**
 * Kompakt kalender på Översikt (CLAUDE.md § 37.1): en liten dagsruta per dag
 * i fönstret (7 i rad — en vecka blir en rad, 14 dagar två, månaden fem) med
 * prickar för vad som händer, och under den en lista dag för dag. Samma
 * underlag som tidigare (`buildHomeTimeline`): lila är events, blått är
 * verksamhetsårshjulet. Ren presentation (server), ingen dataväg.
 */

const MAX_DOTS = 3;

function dotTone(span: HomeTimelineSpan): string {
  return span.item.source === 'event' ? 'bg-movexum-lila dark:bg-movexum-ljuslila' : 'bg-brand';
}

function shortDate(d: Date): string {
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' }).replace('.', '');
}

export function HomeAgendaCompact({
  timeline,
  maxItems = 7,
  moreHref = '/arshjul'
}: {
  timeline: HomeTimeline;
  maxItems?: number;
  moreHref?: string;
}) {
  const { days, spans } = timeline;
  const single = days.length <= 7;
  const ordered = [...spans].sort((a, b) => a.from - b.from || a.lane - b.lane);
  const visible = ordered.slice(0, maxItems);
  const hidden = ordered.length - visible.length;

  return (
    <div>
      {/* Dagsrutor */}
      <div className="grid grid-cols-7 gap-1" role="list" aria-label="Dagar i perioden">
        {days.map((d, i) => {
          const here = spans.filter((s) => s.from <= i && s.to >= i);
          return (
            <div
              key={d.date.toISOString()}
              role="listitem"
              aria-label={`${d.weekday} ${d.day}: ${here.length === 0 ? 'inget inplanerat' : `${here.length} inplanerat`}`}
              className={`flex flex-col items-center rounded-lg px-0.5 ${single ? 'pb-2 pt-1.5' : 'pb-1.5 pt-1'} ${
                d.isToday ? 'bg-brand/[0.06] dark:bg-brand/15' : d.isWeekend ? 'bg-canvas-subtle' : ''
              }`}
            >
              <span
                className={`text-[9.5px] font-semibold uppercase tracking-[0.1em] ${
                  d.isToday ? 'text-brand' : 'text-foreground-subtle'
                }`}
              >
                {d.weekday}
                {d.monthLabel && i > 0 ? ` · ${d.monthLabel}` : ''}
              </span>
              <span
                className={`mx-tnum mt-0.5 flex h-6 w-6 items-center justify-center rounded-full font-heading text-[12.5px] font-semibold ${
                  d.isToday ? 'bg-brand text-brand-foreground' : d.isWeekend ? 'text-foreground-subtle' : 'text-foreground'
                }`}
              >
                {d.day}
              </span>
              <span className="mt-1 flex h-1.5 items-center gap-[3px]" aria-hidden>
                {here.slice(0, MAX_DOTS).map((s) => (
                  <span key={s.item.id} className={`h-1.5 w-1.5 rounded-full ${dotTone(s)}`} />
                ))}
                {here.length > MAX_DOTS && <span className="h-1.5 w-1.5 rounded-full bg-foreground-subtle/50" />}
              </span>
            </div>
          );
        })}
      </div>

      {/* Lista dag för dag */}
      {visible.length === 0 ? (
        <p className="mt-4 text-[12.5px] text-foreground-subtle">
          Inget inplanerat i perioden — lägg in i årshjulet eller be chatten.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-default border-t border-default">
          {visible.map((s) => {
            const day = days[s.from];
            const isEvent = s.item.source === 'event';
            const otherMonth = day.date.getMonth() !== days[0].date.getMonth();
            const when = s.clippedStart
              ? 'Pågår'
              : day.isToday
                ? 'Idag'
                : `${day.weekday} ${otherMonth ? shortDate(day.date) : day.day}`;
            const end = s.item.end && s.item.end.getTime() !== s.item.start.getTime() ? s.item.end : null;
            const detail = [isEvent ? s.item.meta : undefined, end ? `t.o.m. ${shortDate(end)}` : undefined, !isEvent ? s.item.meta : undefined]
              .filter(Boolean)
              .join(' · ');
            return (
              <li key={s.item.id}>
                <Link
                  href={s.item.href}
                  className="group grid grid-cols-[58px_minmax(0,1fr)] items-baseline gap-x-3 py-2"
                >
                  <span
                    className={`mx-tnum text-[11.5px] font-semibold ${
                      day.isToday || s.clippedStart ? 'text-brand' : 'text-foreground-muted'
                    }`}
                  >
                    {when}
                  </span>
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotTone(s)}`} />
                      <span className="truncate text-[13px] font-semibold text-foreground group-hover:underline group-hover:underline-offset-4">
                        {s.item.title}
                      </span>
                    </span>
                    {detail && (
                      <span className="mx-tnum mt-0.5 block truncate pl-3.5 text-[11.5px] text-foreground-subtle">{detail}</span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {hidden > 0 && (
        <Link
          href={moreHref}
          className="mt-2 inline-block text-[12px] font-semibold text-link underline decoration-link/30 underline-offset-4 hover:decoration-link"
        >
          {hidden} till i årshjulet
        </Link>
      )}
    </div>
  );
}
