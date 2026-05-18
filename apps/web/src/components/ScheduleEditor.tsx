'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  upsertScheduleAction,
  disableScheduleAction,
  deleteScheduleAction
} from '@/lib/actions/schedules';
import { SCHEDULE_PRESETS, describeCron } from '@/lib/scheduling/cron';

export interface ScheduleEditorProps {
  toolId: string;
  scheduleId?: string;
  enabled: boolean;
  cronExpression: string;
  timezone: string;
  lastRunAt?: string;
  nextRunAt?: string;
}

const DEFAULT_CRON = '0 7 * * *';
const DEFAULT_TZ = 'Europe/Stockholm';

function formatDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('sv-SE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

export function ScheduleEditor(props: ScheduleEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cron, setCron] = useState(props.cronExpression || DEFAULT_CRON);
  const [timezone, setTimezone] = useState(props.timezone || DEFAULT_TZ);
  const [enabled, setEnabled] = useState(props.enabled);

  const presetMatch = SCHEDULE_PRESETS.find((p) => p.expression === cron);
  const isCustom = !presetMatch;

  const save = (overrideEnabled?: boolean) => {
    setError(null);
    setInfo(null);
    const finalEnabled = overrideEnabled !== undefined ? overrideEnabled : enabled;
    startTransition(async () => {
      const res = await upsertScheduleAction({
        toolId: props.toolId,
        cronExpression: cron,
        timezone,
        enabled: finalEnabled
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setEnabled(finalEnabled);
      setInfo(
        finalEnabled
          ? 'Schemat är aktivt — nästa körning syns nedan.'
          : 'Schemat sparades men är inaktiverat.'
      );
      router.refresh();
    });
  };

  const disable = () => {
    if (!props.scheduleId) return;
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await disableScheduleAction(props.scheduleId!);
      if (res.error) {
        setError(res.error);
        return;
      }
      setEnabled(false);
      setInfo('Schemat är pausat. Aktivera igen för att återuppta körningarna.');
      router.refresh();
    });
  };

  const remove = () => {
    if (!props.scheduleId) return;
    if (!confirm('Är du säker på att du vill ta bort schemat helt?')) return;
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await deleteScheduleAction(props.scheduleId!);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-5 text-sm text-foreground">
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-foreground-muted">
          Intervall
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          {SCHEDULE_PRESETS.map((preset) => {
            const active = preset.expression === cron;
            return (
              <button
                key={preset.expression}
                type="button"
                onClick={() => setCron(preset.expression)}
                className={
                  'rounded-2xl border px-4 py-3 text-left transition ' +
                  (active
                    ? 'border-brand bg-brand text-brand-foreground'
                    : 'border-default bg-canvas hover:bg-canvas-subtle')
                }
              >
                <div className="text-sm font-medium">{preset.label}</div>
                <div
                  className={
                    'text-xs ' +
                    (active ? 'text-brand-foreground/85' : 'text-foreground-muted')
                  }
                >
                  {preset.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <details className="rounded-2xl border border-default bg-canvas px-4 py-3" open={isCustom}>
        <summary className="cursor-pointer text-xs font-medium text-foreground-muted">
          Egen cron-syntax
        </summary>
        <div className="mt-3 space-y-3">
          <div>
            <label className="block text-xs font-medium text-foreground-muted">
              Cron-uttryck (m h dag månad veckodag)
            </label>
            <input
              type="text"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              spellCheck={false}
              className="mt-1 w-full rounded-xl border border-default bg-surface px-3 py-2 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
              placeholder="0 7 * * *"
            />
            <p className="mt-1 text-xs text-foreground-subtle">
              {describeCron(cron)}
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground-muted">
              Tidszon (IANA)
            </label>
            <input
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              spellCheck={false}
              className="mt-1 w-full rounded-xl border border-default bg-surface px-3 py-2 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
              placeholder="Europe/Stockholm"
            />
          </div>
        </div>
      </details>

      {props.scheduleId && (
        <dl className="grid grid-cols-2 gap-3 rounded-2xl border border-default bg-canvas-subtle p-3 text-xs text-foreground-muted">
          <div>
            <dt className="font-medium text-foreground-muted">Status</dt>
            <dd className="mt-1 font-medium text-foreground">
              {enabled ? 'Aktivt' : 'Pausat'}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground-muted">Nästa körning</dt>
            <dd className="mt-1 font-medium text-foreground">
              {enabled ? formatDate(props.nextRunAt) : '—'}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground-muted">Senast kört</dt>
            <dd className="mt-1 text-foreground">{formatDate(props.lastRunAt)}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground-muted">Tidszon</dt>
            <dd className="mt-1 font-mono text-foreground">{timezone}</dd>
          </div>
        </dl>
      )}

      {error && (
        <div className="rounded-2xl border border-movexum-orange/40 bg-movexum-pastell-orange px-3 py-2 text-xs text-movexum-morkorange">
          {error}
        </div>
      )}
      {info && !error && (
        <div className="rounded-2xl border border-movexum-gron/40 bg-movexum-pastell-gron px-3 py-2 text-xs text-movexum-morkgron">
          {info}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="button"
          onClick={() => save(true)}
          disabled={isPending}
          className="rounded-2xl bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60"
        >
          {isPending ? 'Sparar…' : enabled && props.scheduleId ? 'Uppdatera schema' : 'Aktivera schema'}
        </button>
        {props.scheduleId && enabled && (
          <button
            type="button"
            onClick={disable}
            disabled={isPending}
            className="rounded-2xl border border-default bg-surface px-4 py-2 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle disabled:opacity-60"
          >
            Pausa
          </button>
        )}
        {props.scheduleId && !enabled && (
          <button
            type="button"
            onClick={() => save(true)}
            disabled={isPending}
            className="rounded-2xl border border-default bg-surface px-4 py-2 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle disabled:opacity-60"
          >
            Återaktivera
          </button>
        )}
        {props.scheduleId && (
          <button
            type="button"
            onClick={remove}
            disabled={isPending}
            className="ml-auto text-xs text-foreground-subtle underline-offset-2 hover:text-movexum-morkorange hover:underline disabled:opacity-60"
          >
            Ta bort schema
          </button>
        )}
      </div>

      <p className="text-xs text-foreground-subtle">
        Schemalagda körningar loggas i aktivitetsfeeden under{' '}
        <span className="font-mono">tool_run</span> och syns i fliken
        Senaste körningar nedan. Konfidentiella anteckningar exkluderas
        automatiskt — samma datafilter som vid manuella körningar.
      </p>
    </div>
  );
}
