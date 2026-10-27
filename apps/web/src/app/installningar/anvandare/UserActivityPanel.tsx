'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/proto/Icon';
import { loadUserActivityAction, type UserActivityLog } from '@/lib/actions/users';
import { activityLabel, activityPresence, summarizeLogins } from '@/lib/users/activity';

/**
 * Aktivitetsloggen för ett konto (CLAUDE.md § 36.4): senaste inloggning och
 * aktivitet, inloggningshistorik och det personen gjort i plattformen
 * (skrivlagrets logg, § 32). Laddas först när raden öppnas, via
 * `loadUserActivityAction` (samma RBAC + tenant-kontroll som övrig
 * administration). Relativa tider räknas efter mount (hydrering).
 */

export function useNow(intervalMs = 60_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function formatStamp(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('sv-SE', {
    timeZone: 'Europe/Stockholm',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function relativeShort(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Math.max(0, now - then);
  const min = Math.round(diff / 60000);
  if (min < 1) return 'nyss';
  if (min < 60) return `${min} min sedan`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs} tim sedan`;
  const days = Math.round(hrs / 24);
  if (days === 1) return 'igår';
  if (days < 30) return `${days} dgr sedan`;
  return new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', timeZone: 'Europe/Stockholm' });
}

/** Grön prick när kontot är aktivt nu, annars neutral. */
export function PresenceDot({ lastActiveAt, now }: { lastActiveAt: string | null; now: number | null }) {
  const presence = now === null ? 'never' : activityPresence(lastActiveAt, now);
  const cls =
    presence === 'online'
      ? 'bg-movexum-gron'
      : presence === 'today' || presence === 'week'
        ? 'bg-movexum-bla'
        : presence === 'never'
          ? 'bg-neutral-300 dark:bg-neutral-700'
          : 'bg-neutral-400 dark:bg-neutral-600';
  return <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${cls}`} />;
}

/** "Aktiv nu" / "Aktiv för 3 tim sedan" / "Senast aktiv 12 sep" / "Aldrig inloggad". */
export function LastActiveLabel({
  lastActiveAt,
  now,
  className
}: {
  lastActiveAt: string | null;
  now: number | null;
  className?: string;
}) {
  if (now === null) {
    // Före mount: ett tomt, lika högt element så raden inte hoppar.
    return <span className={className}>&nbsp;</span>;
  }
  const label = activityLabel(lastActiveAt, now);
  return (
    <span
      className={className}
      title={lastActiveAt ? `Senast aktiv ${formatStamp(lastActiveAt)}` : 'Kontot har aldrig loggat in'}
    >
      {label}
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-foreground-subtle">{label}</div>
      <div className="truncate text-[13px] font-semibold text-foreground">{value}</div>
      {hint && <div className="truncate text-[11px] text-foreground-subtle">{hint}</div>}
    </div>
  );
}

export function UserActivityPanel({ userId }: { userId: string }) {
  const [log, setLog] = useState<UserActivityLog | null>(null);
  const [pending, startTransition] = useTransition();
  const [showAllLogins, setShowAllLogins] = useState(false);
  const now = useNow();

  useEffect(() => {
    let cancelled = false;
    startTransition(async () => {
      try {
        const res = await loadUserActivityAction(userId);
        if (!cancelled) setLog(res);
      } catch {
        if (!cancelled) {
          setLog({
            status: 'error',
            message: 'Kunde inte läsa aktivitetsloggen just nu.',
            lastLoginAt: null,
            lastActiveAt: null,
            loginCount: 0,
            logins: [],
            loginsTotal: 0,
            historyAvailable: true,
            entries: []
          });
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const summary = log ? summarizeLogins(log.logins, now ?? Date.now(), log.loginCount) : null;
  const logins = log ? (showAllLogins ? log.logins : log.logins.slice(0, 8)) : [];

  return (
    <div className="rounded-xl border border-default bg-canvas-subtle p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-foreground">Aktivitet</div>
          <div className="text-[12px] text-foreground-muted">
            När kontot senast var i plattformen, inloggningar och det personen gjort. Ingen sidvisning
            loggas — bara inloggningar och åtgärder.
          </div>
        </div>
        {pending && !log && <span className="text-[11.5px] text-foreground-subtle">Läser…</span>}
      </div>

      {log?.status === 'error' && (
        <p className="rounded-lg bg-movexum-pastell-orange px-3 py-2 text-[12px] text-movexum-morkorange">
          {log.message ?? 'Kunde inte läsa aktivitetsloggen.'}
        </p>
      )}

      {log && log.status === 'ok' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Senast aktiv"
              value={now === null ? '…' : activityLabel(log.lastActiveAt, now)}
              hint={log.lastActiveAt ? formatStamp(log.lastActiveAt) : undefined}
            />
            <Stat
              label="Senaste inloggning"
              value={log.lastLoginAt && now !== null ? relativeShort(log.lastLoginAt, now) : '—'}
              hint={log.lastLoginAt ? formatStamp(log.lastLoginAt) : 'Ingen inloggning registrerad'}
            />
            <Stat
              label="Inloggningar"
              value={summary ? String(summary.total) : '0'}
              hint={summary ? `${summary.last30d} senaste 30 dgr · ${summary.last90d} senaste 90 dgr` : undefined}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section>
              <h4 className="mb-1.5 text-[11px] uppercase tracking-[0.12em] text-foreground-subtle">
                Inloggningar
              </h4>
              {!log.historyAvailable ? (
                <p className="text-[12px] text-movexum-morkgul">
                  Inloggningshistoriken är inte aktiverad på den här instansen (migration 1700000206 behöver
                  köras). Senaste inloggning visas ändå ovan.
                </p>
              ) : log.logins.length === 0 ? (
                <p className="text-[12px] text-foreground-subtle">Inga inloggningar registrerade ännu.</p>
              ) : (
                <ul className="divide-y divide-default rounded-lg border border-default bg-surface">
                  {logins.map((iso, i) => (
                    <li key={`${iso}-${i}`} className="flex items-center justify-between gap-3 px-3 py-1.5 text-[12px]">
                      <span className="flex items-center gap-2 text-foreground">
                        <Icon name="logout" size={11} />
                        {formatStamp(iso)}
                      </span>
                      <span className="text-foreground-subtle">{now === null ? '' : relativeShort(iso, now)}</span>
                    </li>
                  ))}
                  {log.logins.length > 8 && (
                    <li className="px-3 py-1.5">
                      <button
                        type="button"
                        className="text-[12px] text-link hover:underline"
                        onClick={() => setShowAllLogins((v) => !v)}
                      >
                        {showAllLogins ? 'Visa färre' : `Visa alla ${log.logins.length}`}
                      </button>
                    </li>
                  )}
                  {log.loginsTotal > log.logins.length && (
                    <li className="px-3 py-1.5 text-[11.5px] text-foreground-subtle">
                      Visar de {log.logins.length} senaste av {log.loginsTotal}.
                    </li>
                  )}
                </ul>
              )}
            </section>

            <section>
              <h4 className="mb-1.5 text-[11px] uppercase tracking-[0.12em] text-foreground-subtle">
                Åtgärder i plattformen
              </h4>
              {log.entries.length === 0 ? (
                <p className="text-[12px] text-foreground-subtle">
                  Inga registrerade åtgärder ännu. Hit kommer det personen skapar och ändrar via plattformen
                  (samma logg som under Aktivitet).
                </p>
              ) : (
                <ul className="divide-y divide-default rounded-lg border border-default bg-surface">
                  {log.entries.map((e) => {
                    const body = (
                      <>
                        <span className="mt-0.5 shrink-0 text-foreground-subtle">
                          <Icon name={e.icon} size={12} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] text-foreground">{e.title}</span>
                          <span className="block truncate text-[11px] text-foreground-subtle">
                            {now === null ? '' : relativeShort(e.created, now)}
                            {e.detail ? ` · ${e.detail}` : ''}
                            {e.viaAgent ? ' · via AI-chatten' : ''}
                          </span>
                        </span>
                      </>
                    );
                    return (
                      <li key={e.id} className="px-3 py-1.5">
                        {e.href ? (
                          <Link href={e.href} className="flex items-start gap-2 hover:underline">
                            {body}
                          </Link>
                        ) : (
                          <span className="flex items-start gap-2">{body}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
