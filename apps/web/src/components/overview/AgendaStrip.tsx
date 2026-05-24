import Link from 'next/link';
import { Icon } from '@/components/proto/Icon';
import type { AgendaItem, OutlookState } from '@/lib/overview/status';

const TZ = 'Europe/Stockholm';

function startOfDay(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dayMs = 24 * 60 * 60 * 1000;
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / dayMs);
  if (diff === 0) return 'Idag';
  if (diff === 1) return 'Imorgon';
  return d.toLocaleDateString('sv-SE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: TZ
  });
}

function timeLabel(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('sv-SE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TZ
  }).format(d);
  // Datumfält utan klockslag lagras som midnatt → visa inget klockslag.
  if (parts === '00:00') return null;
  return parts;
}

function AgendaCard({ item }: { item: AgendaItem }) {
  const time = timeLabel(item.startsAt);
  const body = (
    <>
      <div className="flex items-center gap-2 text-[10.5px] font-medium text-foreground-subtle">
        <span className="uppercase tracking-[0.08em]">{dayLabel(item.startsAt)}</span>
        {time && <span className="font-mono">{time}</span>}
        <span className="ml-auto inline-flex items-center gap-1 rounded bg-canvas-muted px-1.5 py-0.5 text-[9.5px]">
          <Icon name={item.source === 'outlook' ? 'calendar' : 'star'} size={9} />
          {item.source === 'outlook' ? 'Outlook' : 'Event'}
        </span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-[13px] font-semibold leading-snug text-foreground">
        {item.title}
      </p>
      {(item.location || item.isOnline) && (
        <div className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-foreground-subtle">
          <Icon name={item.isOnline ? 'globe' : 'pin'} size={10} />
          {item.isOnline ? 'Online' : item.location}
        </div>
      )}
    </>
  );

  const className =
    'flex w-[220px] shrink-0 flex-col rounded-2xl border border-default bg-surface p-3.5 shadow-sm shadow-movexum-svart/5 transition';

  if (item.url) {
    return (
      <Link
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`${className} hover:border-brand/40 hover:shadow-md`}
      >
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}

export function AgendaStrip({
  items,
  outlookState
}: {
  items: AgendaItem[];
  outlookState: OutlookState;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
          Kommande möten & events
        </h2>
        {outlookState !== 'connected' && (
          <Link
            href="/integrationer/outlook-calendar"
            className="inline-flex items-center gap-1 rounded-md bg-canvas-muted px-2 py-0.5 text-[10.5px] text-foreground-muted transition hover:text-foreground"
          >
            <Icon name="calendar" size={11} />
            {outlookState === 'error' ? 'Återanslut Outlook' : 'Anslut Outlook'}
          </Link>
        )}
      </div>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-default px-4 py-5 text-[12px] text-foreground-subtle">
          Inga möten eller events inom kort.
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {items.map((it) => (
            <AgendaCard key={`${it.source}-${it.id}`} item={it} />
          ))}
        </div>
      )}
    </section>
  );
}
