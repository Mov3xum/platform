import Link from 'next/link';
import { Icon } from '@/components/proto/Icon';
import { TimeAgo } from './TimeAgo';
import type { DashboardActivity } from '@/components/DashboardChat';

/**
 * Bolagsnytt på Hemmaplan (CLAUDE.md § 37/§ 32) — den samlade aktivitets-
 * loggen som en vertikal tidslinje: en hårlinje med prickar, relativ tid i
 * gutter:n, AI-utförda åtgärder märkta med gnista (art. 13). Ren presentation
 * av redan RLS-filtrerad feed; ingen dataväg.
 */

// Ikon per aktivitetstyp — samma mappning som chattens feed (DashboardChat).
function activityIcon(act: DashboardActivity): string {
  if (act.icon) return act.icon;
  if (act.kind === 'tool_run') return 'sparkle';
  if (act.kind === 'integration_sync') return 'cloud';
  if (act.kind === 'workshop_run' || act.kind === 'workshop_assignment') return 'cap';
  switch (act.type) {
    case 'meeting':
      return 'calendar';
    case 'call':
      return 'people';
    case 'email':
      return 'inbox';
    case 'task':
      return 'check';
    case 'workshop':
      return 'cap';
    default:
      return 'dot';
  }
}

function dotTone(act: DashboardActivity): string {
  if (act.viaAgent || act.kind === 'tool_run') return 'bg-movexum-lila dark:bg-movexum-ljuslila';
  if (act.kind === 'workshop_run' || act.kind === 'workshop_assignment' || act.kind === 'education_document')
    return 'bg-movexum-gron dark:bg-movexum-ljusgron';
  if (act.kind === 'agreement' || act.kind === 'meeting') return 'bg-movexum-morkgul';
  return 'bg-brand';
}

export function CompanyNews({ feed }: { feed: DashboardActivity[] }) {
  if (feed.length === 0) {
    return (
      <p className="text-[13px] leading-relaxed text-foreground-subtle">
        Inga händelser än — aktiviteter från bolagen och det som görs i systemet dyker upp här.
      </p>
    );
  }
  return (
    <ol className="relative ml-[5px] border-l border-default pl-5">
      {feed.map((act) => {
        const href = act.href ?? (act.startupId ? `/startups/${act.startupId}` : undefined);
        const body = (
          <>
            <span
              aria-hidden
              className={`absolute -left-[25px] top-[7px] h-[9px] w-[9px] rounded-full ring-4 ring-canvas ${dotTone(act)}`}
            />
            <span className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.12em] text-foreground-subtle">
              <TimeAgo iso={act.created} />
              {act.startupName && (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate normal-case tracking-normal">{act.startupName}</span>
                </>
              )}
              {act.viaAgent && (
                <span className="inline-flex items-center gap-0.5 normal-case tracking-normal text-movexum-lila dark:text-movexum-ljuslila" title="Utfört via AI-chatten">
                  <Icon name="sparkle" size={9} />
                  AI
                </span>
              )}
            </span>
            <span className="mt-0.5 flex items-start gap-2">
              <span className="mt-[3px] shrink-0 text-foreground-subtle">
                {act.toolIcon ? (
                  <span className="text-[12px] leading-none">{act.toolIcon}</span>
                ) : (
                  <Icon name={activityIcon(act)} size={12} />
                )}
              </span>
              <span className="text-[13px] font-medium leading-snug text-foreground group-hover:underline group-hover:decoration-brand/40 group-hover:underline-offset-4">
                {act.title}
              </span>
            </span>
          </>
        );
        return (
          <li key={act.id} className="relative pb-3.5 last:pb-0" title={act.actorName ? `Av ${act.actorName}` : undefined}>
            {href ? (
              <Link href={href} className="group block">
                {body}
              </Link>
            ) : (
              <div className="group block">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
