import { Clock, MapPin, Video, ExternalLink } from 'lucide-react';
import type { OutlookEvent } from '@/lib/app-integrations/providers/outlook_calendar/calendar';
import { LogMeetingButton } from '@/app/startups/[id]/LogMeetingButton';

export type CalendarLogTarget =
  | { startupId: string; contactId?: string }
  | { ambiguous: true };

/**
 * Live kalendervy för Outlook. Grupperar händelser per dag, visar
 * mötestid, plats, om det är ett online-möte (Teams-länken
 * exponeras inte direkt — användaren öppnar via `webLink` i Outlook).
 *
 * Designad för att se ut som "snyggt UI som är live mot kalendern"
 * istället för chat-format. Datat hämtas i page-komponenten via
 * Microsoft Graph och skickas in som färdig prop — den här komponenten
 * är ren rendering.
 */

interface Props {
  events: OutlookEvent[];
  logTargets?: Record<string, CalendarLogTarget>;
}

const DOW = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'];
const MONTH = [
  'januari', 'februari', 'mars', 'april', 'maj', 'juni',
  'juli', 'augusti', 'september', 'oktober', 'november', 'december'
];

function dayKey(iso: string): string {
  const d = new Date(iso);
  // Toleranta mot Graphs `dateTime` utan suffix (de levererar redan i
  // användarens tz pga Prefer-headern, så vi tolkar som lokalt).
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (isSameDay(d, today)) return 'Idag';
  if (isSameDay(d, tomorrow)) return 'Imorgon';
  return `${DOW[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function durationMinutes(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
}

export function OutlookCalendarView({ events, logTargets }: Props) {
  if (events.length === 0) {
    return (
      <div className="rounded-2xl border border-default bg-surface p-8 text-center">
        <p className="text-[13px] text-foreground-muted">
          Inga möten under de kommande 7 dagarna. Andas ut.
        </p>
      </div>
    );
  }

  // Gruppera per dag-key i ordning (events är redan sorterade av Graph).
  const groups = new Map<string, OutlookEvent[]>();
  for (const e of events) {
    const k = dayKey(e.start);
    const list = groups.get(k);
    if (list) list.push(e);
    else groups.set(k, [e]);
  }

  return (
    <div className="flex flex-col gap-5">
      {Array.from(groups.entries()).map(([key, list]) => (
        <section key={key} className="flex flex-col gap-2">
          <h2 className="font-heading text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
            {formatDay(list[0].start)}
          </h2>
          <div className="flex flex-col divide-y divide-default rounded-2xl border border-default bg-surface">
            {list.map((e) => (
              <EventRow key={e.id} event={e} logTarget={logTargets?.[e.id]} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function EventRow({ event, logTarget }: { event: OutlookEvent; logTarget?: CalendarLogTarget }) {
  return (
    <div className="flex items-start gap-4 p-4">
      <div className="flex w-20 shrink-0 flex-col text-[12px] text-foreground-muted">
        {event.isAllDay ? (
          <span className="font-medium text-foreground">Heldag</span>
        ) : (
          <>
            <span className="font-medium text-foreground">{formatTime(event.start)}</span>
            <span className="text-foreground-subtle">{formatTime(event.end)}</span>
            <span className="mt-0.5 text-[10.5px] text-foreground-subtle">
              {durationMinutes(event.start, event.end)} min
            </span>
          </>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-heading text-[14px] font-semibold leading-tight text-foreground">
            {event.subject}
          </h3>
          {event.webLink ? (
            <a
              href={event.webLink}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-foreground-subtle hover:text-foreground"
              title="Öppna i Outlook"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-foreground-muted">
          {event.organizer ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3 text-foreground-subtle" />
              {event.organizer}
            </span>
          ) : null}
          {event.location ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3 text-foreground-subtle" />
              {event.location}
            </span>
          ) : null}
          {event.isOnline ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-movexum-pastell-bla px-2 py-0.5 text-[10.5px] text-movexum-djupbla">
              <Video className="h-3 w-3" />
              Online
            </span>
          ) : null}
        </div>
        {logTarget ? (
          <div className="mt-2.5">
            {'ambiguous' in logTarget ? (
              <span className="text-[11px] text-foreground-subtle">
                Matchar flera bolag — logga via bolagskortet.
              </span>
            ) : (
              <LogMeetingButton
                subject={event.subject}
                startsAt={event.start}
                endsAt={event.end}
                startupId={logTarget.startupId}
                contactId={logTarget.contactId}
              />
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
