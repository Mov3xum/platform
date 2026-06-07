import Link from 'next/link';
import { Icon } from '@/components/proto';

export interface WorkCard {
  id: string;
  kind: 'tool' | 'workshop' | 'document';
  title: string;
  subtitle?: string;
  statusLabel: string;
  dateLabel?: string;
  overdue?: boolean;
  href: string;
}

const kindMeta: Record<WorkCard['kind'], { icon: string; label: string }> = {
  tool: { icon: 'sparkle', label: 'Verktyg' },
  workshop: { icon: 'cap', label: 'Utbildning' },
  document: { icon: 'doc', label: 'Dokument' }
};

/**
 * Visar vad bolaget har gjort (genomförda verktyg/utbildningar/dokument med
 * grön bock) och vad som är tilldelat men inte gjort ännu. Tomt "Genomfört"
 * = bolaget har inte gjort ett kort än.
 */
export function StartupWorkCards({
  done,
  pending
}: {
  done: WorkCard[];
  pending: WorkCard[];
}) {
  return (
    <section
      id="arbete"
      className="scroll-mt-24 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5"
    >
      <h2 className="mb-1 text-lg font-semibold text-foreground">Verktyg & utbildning</h2>
      <p className="mb-6 text-sm text-foreground-muted">
        Vad bolaget har gjort och vad som väntar på dem.
      </p>

      {/* Tilldelat men inte gjort */}
      <div className="mb-8">
        <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-foreground-subtle">
          <Icon name="hourglass" size={13} /> Tilldelat – inte gjort ännu
          <span className="rounded-full bg-canvas-subtle px-2 py-0.5 text-[11px] font-medium text-foreground-muted">
            {pending.length}
          </span>
        </h3>
        {pending.length === 0 ? (
          <p className="text-sm text-foreground-subtle">
            Inget väntar – bolaget är ikapp med allt som tilldelats.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pending.map((card) => (
              <PendingCard key={`${card.kind}-${card.id}`} card={card} />
            ))}
          </div>
        )}
      </div>

      {/* Genomfört */}
      <div>
        <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-foreground-subtle">
          <Icon name="check" size={13} /> Genomfört
          <span className="rounded-full bg-canvas-subtle px-2 py-0.5 text-[11px] font-medium text-foreground-muted">
            {done.length}
          </span>
        </h3>
        {done.length === 0 ? (
          <p className="text-sm text-foreground-subtle">
            Bolaget har inte gjort något verktyg eller utbildning än.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {done.map((card) => (
              <DoneCard key={`${card.kind}-${card.id}`} card={card} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function DoneCard({ card }: { card: WorkCard }) {
  const meta = kindMeta[card.kind];
  return (
    <Link
      href={card.href}
      className="group flex items-start gap-3 rounded-2xl border border-default bg-canvas-subtle/40 p-4 transition hover:-translate-y-0.5 hover:border-movexum-gron/40 hover:shadow-md"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
        <Icon name="check" size={20} stroke={2.4} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-foreground-subtle">
          <Icon name={meta.icon} size={11} /> {meta.label}
        </div>
        <p className="mt-0.5 truncate font-medium text-foreground">{card.title}</p>
        {card.subtitle ? (
          <p className="mt-0.5 truncate text-xs text-foreground-subtle">{card.subtitle}</p>
        ) : null}
        <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-movexum-morkgron dark:text-movexum-gron">
          {card.statusLabel}
          {card.dateLabel ? (
            <span className="text-foreground-subtle">· {card.dateLabel}</span>
          ) : null}
        </p>
      </div>
    </Link>
  );
}

function PendingCard({ card }: { card: WorkCard }) {
  const meta = kindMeta[card.kind];
  return (
    <Link
      href={card.href}
      className="group flex items-start gap-3 rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5 transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-movexum-pastell-lila text-movexum-lila">
        <Icon name={meta.icon} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-foreground-subtle">
          {meta.label}
        </div>
        <p className="mt-0.5 truncate font-medium text-foreground">{card.title}</p>
        {card.subtitle ? (
          <p className="mt-0.5 truncate text-xs text-foreground-subtle">{card.subtitle}</p>
        ) : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="inline-flex items-center rounded-md bg-movexum-pastell-bla px-1.5 py-0.5 font-medium text-movexum-morkbla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla">
            {card.statusLabel}
          </span>
          {card.dateLabel ? (
            <span
              className={`inline-flex items-center gap-1 ${
                card.overdue ? 'font-medium text-movexum-orange' : 'text-foreground-subtle'
              }`}
            >
              <Icon name="calendar" size={11} /> {card.dateLabel}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
