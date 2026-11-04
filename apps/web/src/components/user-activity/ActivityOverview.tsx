'use client';

import { useMemo } from 'react';
import {
  USER_ACTIVITY_STATUS_LABEL,
  activeDaysWithin,
  activityStatus,
  coreModules,
  emptyUserActivity,
  formatRelativeTime,
  neverOpenedModules,
  stockholmDateKey,
  topModules,
  type UserActivityStats,
  type UserActivityStatus
} from '@platform/shared';
import { Chip } from '@/components/proto';

/**
 * Användaraktivitet (CLAUDE.md § 57) — samma vy under Inställningar →
 * Användare (ledningen, per konto) och under Mitt konto (personen själv).
 * Ren presentation: `now` kommer från servern som ISO-sträng så relativa
 * tider blir identiska vid hydrering.
 */

const MODULE_TITLES: Record<string, string> = Object.fromEntries(coreModules.map((m) => [m.id, m.title]));

export function moduleTitle(id: string): string {
  return MODULE_TITLES[id] ?? id;
}

const STATUS_CHIP: Record<UserActivityStatus, 'yellow' | 'green' | 'copper'> = {
  never: 'yellow',
  active: 'green',
  dormant: 'copper'
};

export function ActivityStatusChip({ stats, now }: { stats: UserActivityStats | null; now: string }) {
  const nowDate = new Date(now);
  const s = stats ?? emptyUserActivity();
  const status = activityStatus(s, nowDate);
  const seen = formatRelativeTime(s.last_seen_at ?? s.last_login_at, nowDate);
  if (status === 'active') {
    return <span className="text-[11.5px] text-foreground-subtle">Aktiv {seen}</span>;
  }
  return (
    <Chip variant={STATUS_CHIP[status]} mono>
      {status === 'dormant' ? `Vilande · ${seen}` : USER_ACTIVITY_STATUS_LABEL[status]}
    </Chip>
  );
}

function absolute(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('sv-SE', {
    timeZone: 'Europe/Stockholm',
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-[0.12em] text-foreground-subtle">{label}</dt>
      <dd className="mt-0.5 text-[13.5px] font-semibold text-foreground">{value}</dd>
      {hint && <dd className="text-[11.5px] text-foreground-subtle">{hint}</dd>}
    </div>
  );
}

/** 30 rutor — en per dag, fylld när personen var inne den dagen. */
function DayStrip({ stats, now }: { stats: UserActivityStats; now: Date }) {
  const days = useMemo(() => {
    const set = new Set(stats.active_days);
    const out: { key: string; active: boolean }[] = [];
    for (let i = 29; i >= 0; i -= 1) {
      const key = stockholmDateKey(new Date(now.getTime() - i * 86_400_000));
      out.push({ key, active: set.has(key) });
    }
    return out;
  }, [stats.active_days, now]);
  return (
    <div className="flex flex-wrap gap-[3px]" aria-label="Aktiva dagar senaste 30 dagarna">
      {days.map((d) => (
        <span
          key={d.key}
          title={`${d.key}${d.active ? ' · aktiv' : ''}`}
          className={`h-3 w-3 rounded-[3px] ${d.active ? 'bg-brand' : 'bg-canvas-muted'}`}
        />
      ))}
    </div>
  );
}

export function ActivityOverview({
  stats,
  now,
  enabledModuleIds,
  self = false
}: {
  stats: UserActivityStats | null;
  now: string;
  /** Modul-id:n i personens sidmeny — ger listan "aldrig öppnat". */
  enabledModuleIds?: readonly string[];
  self?: boolean;
}) {
  const nowDate = new Date(now);
  const s = stats ?? emptyUserActivity();
  const status = activityStatus(s, nowDate);
  const top = topModules(s, 10);
  const maxVisits = top[0]?.visits ?? 1;
  const unopened = enabledModuleIds ? neverOpenedModules(enabledModuleIds, s) : [];
  const activeDays = activeDaysWithin(s, nowDate, 30);

  if (status === 'never') {
    return (
      <div className="space-y-2">
        <Chip variant="yellow" mono>
          {USER_ACTIVITY_STATUS_LABEL.never}
        </Chip>
        <p className="text-[12.5px] text-foreground-muted">
          {self
            ? 'Ingen aktivitet har registrerats för ditt konto ännu.'
            : 'Personen har inte loggat in ännu. Kontrollera att inbjudan nått fram och att lösenordet delats säkert.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Fact
          label="Senast inloggad"
          value={formatRelativeTime(s.last_login_at, nowDate)}
          hint={absolute(s.last_login_at)}
        />
        <Fact
          label="Senast aktiv"
          value={formatRelativeTime(s.last_seen_at, nowDate)}
          hint={s.last_module ? `på ${moduleTitle(s.last_module)}` : absolute(s.last_seen_at)}
        />
        <Fact
          label="Inloggningar"
          value={String(s.login_count)}
          hint={s.first_login_at ? `första ${absolute(s.first_login_at)}` : undefined}
        />
        <Fact label="Aktiva dagar" value={`${activeDays} av 30`} hint="senaste 30 dagarna" />
      </dl>

      <DayStrip stats={s} now={nowDate} />

      {top.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-[0.12em] text-foreground-subtle">
            Mest använda sidor
          </div>
          <ul className="space-y-1.5">
            {top.map((m) => (
              <li key={m.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="w-36 shrink-0 truncate text-[12.5px] text-foreground sm:w-44">{moduleTitle(m.id)}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-canvas-muted">
                    <span
                      className="block h-full rounded-full bg-brand"
                      style={{ width: `${Math.max(6, Math.round((m.visits / maxVisits) * 100))}%` }}
                    />
                  </span>
                </div>
                <span className="whitespace-nowrap text-[11.5px] text-foreground-subtle mx-tnum">
                  {m.visits} besök · {formatRelativeTime(m.last_at, nowDate)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {unopened.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-[0.12em] text-foreground-subtle">
            {self ? 'Sidor du inte öppnat än' : 'I sidmenyn men aldrig öppnat'}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {unopened.map((id) => (
              <Chip key={id} variant="default">
                {moduleTitle(id)}
              </Chip>
            ))}
          </div>
          {!self && (
            <p className="mt-1.5 text-[11.5px] text-foreground-subtle">
              Bra utgångspunkt för en genomgång — eller ta bort det som inte behövs ur sidmenyn.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
