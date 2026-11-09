import Link from 'next/link';
import type { MissionRef } from '@/lib/missions/activities.server';

// Team som arbetar med en aktivitet (CLAUDE.md § 29.8) — omvända riktningen
// av teamkortets "Aktiviteter & mål". Ren presentation (ingen hook), så den
// kan renderas både på eventsidan (server) och i årshjulets dialog (klient).

const STATUS_LABEL: Record<string, string> = {
  draft: 'utkast',
  preparation: 'förbereds',
  in_progress: 'pågår',
  review: 'granskas',
  done: 'klart',
  archived: 'arkiverat'
};

export function LinkedTeams({ teams, compact = false }: { teams: MissionRef[]; compact?: boolean }) {
  if (teams.length === 0) return null;
  return (
    <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
      <div className="text-xs font-semibold text-foreground-muted">
        {teams.length === 1 ? 'Team som arbetar med aktiviteten' : `${teams.length} team arbetar med aktiviteten`}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {teams.map((t) => (
          <li key={t.id}>
            <Link
              href={`/uppdrag/${t.id}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-2.5 py-0.5 text-[12px] font-medium text-foreground hover:bg-canvas-subtle"
            >
              {t.title}
              {STATUS_LABEL[t.status] ? <span className="text-foreground-subtle">· {STATUS_LABEL[t.status]}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
