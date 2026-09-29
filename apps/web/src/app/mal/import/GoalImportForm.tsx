'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import {
  GOAL_FOCUS_AREA_LABELS,
  GOAL_IMPORT_FIELD_LABELS,
  GOAL_INDICATOR_SOURCE_LABELS,
  GOAL_KIND_LABELS,
  GOAL_OWNER_TEAM_LABELS,
  METRIC_DEFINITIONS,
  buildGoalImportTemplateCsv,
  type GoalImportField,
  type MetricKey
} from '@platform/shared';
import { commitGoalImportAction, previewGoalImportAction, type GoalImportState } from '@/lib/actions/goals';
import { Icon } from '@/components/proto';

const idle: GoalImportState = { status: 'idle' };
const inputClass =
  'w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
const labelClass = 'mb-1 block text-xs font-semibold text-foreground-muted';
const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila';
const btnGhost =
  'inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila';
const fileInputClass =
  'block w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground file:mr-3 file:rounded-xl file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-foreground hover:file:bg-brand-hover focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

function Notice({ kind, children }: { kind: 'error' | 'warning' | 'notice'; children: React.ReactNode }) {
  const tone =
    kind === 'error'
      ? 'border-movexum-morkorange/30 bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/20 dark:text-movexum-pastell-orange'
      : kind === 'warning'
        ? 'border-movexum-morkgul/30 bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/20 dark:text-movexum-pastell-gul'
        : 'border-movexum-morkgron/30 bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/30 dark:text-movexum-pastell-gron';
  return <div className={`rounded-lg border px-3 py-2 text-sm ${tone}`}>{children}</div>;
}

function downloadTemplate() {
  const blob = new Blob([buildGoalImportTemplateCsv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'movexum-mal-mall.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Import av mål (§ 42): fil + verksamhetsår → förhandsgranskning (mål med
 * indikatorer, mappade kolumner, varningar) → bekräfta → `importGoals` i
 * skrivlagret. Målen serialiseras tillbaka som DATA och valideras där igen.
 */
export function GoalImportForm({
  periods,
  preselected
}: {
  periods: { id: string; year: number; title: string | null }[];
  preselected: string;
}) {
  const [preview, previewAction, previewing] = useActionState(previewGoalImportAction, idle);
  const [commit, commitAction, committing] = useActionState(commitGoalImportAction, idle);
  const [showAll, setShowAll] = useState(false);
  const state = commit.status !== 'idle' ? commit : preview;

  if (state.status === 'done') {
    const r = state.result;
    return (
      <div className="space-y-4">
        <Notice kind="notice">
          Import klar för {state.year}: {r.created} nya mål, {r.reused} befintliga återanvända, {r.indicatorsCreated} indikatorer
          tillagda{r.skipped > 0 ? `, ${r.skipped} överhoppade` : ''}.
        </Notice>
        {r.warnings.length > 0 && (
          <details className="rounded-2xl border border-default bg-surface p-4 text-sm">
            <summary className="cursor-pointer font-medium text-foreground">{r.warnings.length} varningar</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground-muted">
              {r.warnings.slice(0, 200).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        )}
        <Link href={`/mal?ar=${state.year}`} className={btnPrimary}>
          Till målen <Icon name="arrow" size={13} />
        </Link>
      </div>
    );
  }

  if (periods.length === 0) {
    return (
      <Notice kind="warning">
        Det finns inget öppet verksamhetsår. <Link href="/mal" className="underline">Skapa eller återöppna ett år</Link> innan du importerar.
      </Notice>
    );
  }

  return (
    <div className="space-y-6">
      <form action={previewAction} className="space-y-4 rounded-3xl border border-default bg-surface p-5">
        <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
          <div>
            <label className={labelClass} htmlFor="period">
              Verksamhetsår
            </label>
            <select id="period" name="period" defaultValue={preselected} className={inputClass} required>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.year}
                  {p.title && p.title !== `Verksamhetsplan ${p.year}` ? ` · ${p.title}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="file">
              Fil (.xlsx eller .csv)
            </label>
            <input
              id="file"
              name="file"
              type="file"
              accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              required
              className={fileInputClass}
            />
          </div>
        </div>
        <p className="text-xs text-foreground-subtle">
          Första raden ska vara rubriker. Kända kolumner: {Object.values(GOAL_IMPORT_FIELD_LABELS).join(' · ')}. Fokusområde,
          måltyp, team, mätkälla och metrik skrivs som i plattformen (t.ex. &quot;Inflöde och varumärke&quot;, &quot;Personligt&quot;,
          &quot;Beräknas ur data&quot;, &quot;Nya leads&quot;). Personliga mål anger ägarens e-post. Okända kolumner ignoreras. Skriv inga
          personuppgifter i mål eller beskrivningar.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={previewing} className={btnPrimary}>
            <Icon name="upload" size={13} /> {previewing ? 'Läser…' : 'Förhandsgranska'}
          </button>
          <button type="button" onClick={downloadTemplate} className={btnGhost}>
            <Icon name="download" size={13} /> Ladda ned mall (.csv)
          </button>
        </div>
        {preview.status === 'error' && <Notice kind="error">{preview.message}</Notice>}
      </form>

      {preview.status === 'preview' && (
        <form action={commitAction} className="space-y-4 rounded-3xl border border-default bg-surface p-5">
          <input type="hidden" name="period" value={preview.preview.periodId} />
          <input type="hidden" name="goals" value={JSON.stringify(preview.preview.goals)} />
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold text-foreground">Förhandsgranskning · {preview.preview.year}</h2>
            <span className="text-sm text-foreground-muted mx-tnum">
              {preview.preview.goals.length} mål · {preview.preview.goals.reduce((n, g) => n + g.indicators.length, 0)} indikatorer
              {preview.preview.sheet ? ` · ark "${preview.preview.sheet}"` : ''}
            </span>
          </div>
          <div className="flex flex-wrap gap-1 text-xs">
            {preview.preview.mappedFields.map((f) => (
              <span key={f} className="rounded-full bg-movexum-pastell-gron px-2 py-0.5 font-semibold text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
                {GOAL_IMPORT_FIELD_LABELS[f as GoalImportField] ?? f}
              </span>
            ))}
            {preview.preview.unmappedHeaders.map((h) => (
              <span key={h} className="rounded-full bg-canvas-muted px-2 py-0.5 text-foreground-subtle" title="Kolumnen importeras inte">
                {h} (ignoreras)
              </span>
            ))}
          </div>
          {preview.preview.warnings.length > 0 && (
            <Notice kind="warning">
              <details>
                <summary className="cursor-pointer">{preview.preview.warnings.length} varningar</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {preview.preview.warnings.slice(0, 100).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            </Notice>
          )}

          <div className="overflow-x-auto rounded-2xl border border-default">
            <table className="w-full text-xs">
              <thead className="text-left uppercase tracking-wide text-foreground-subtle">
                <tr>
                  <th className="px-3 py-2">Fokusområde</th>
                  <th className="px-3 py-2">Mål</th>
                  <th className="px-3 py-2">Typ</th>
                  <th className="px-3 py-2">Team</th>
                  <th className="px-3 py-2">Indikatorer</th>
                </tr>
              </thead>
              <tbody>
                {(showAll ? preview.preview.goals : preview.preview.goals.slice(0, 25)).map((g) => (
                  <tr key={g.line} className="border-t border-default align-top">
                    <td className="px-3 py-1.5 text-foreground-muted">{GOAL_FOCUS_AREA_LABELS[g.focus_area]}</td>
                    <td className="px-3 py-1.5 text-foreground">
                      <div className="font-medium">{g.title}</div>
                      {g.description && <div className="text-foreground-subtle">{g.description}</div>}
                    </td>
                    <td className="px-3 py-1.5 text-foreground-muted">
                      {GOAL_KIND_LABELS[g.kind]}
                      {g.kind === 'personal' && <div className="text-foreground-subtle">{g.owner_email ?? 'du'}</div>}
                    </td>
                    <td className="px-3 py-1.5 text-foreground-muted">{GOAL_OWNER_TEAM_LABELS[g.owner_team]}</td>
                    <td className="px-3 py-1.5 text-foreground-muted">
                      {g.indicators.length === 0 ? (
                        <span className="text-foreground-subtle">–</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {g.indicators.map((i) => (
                            <li key={i.line}>
                              {i.label}
                              {i.target !== null ? ` · mål ${i.target}` : ''}
                              <span className="text-foreground-subtle">
                                {' '}
                                · {i.source === 'computed' && i.metric_key ? `${METRIC_DEFINITIONS[i.metric_key as MetricKey]?.label ?? i.metric_key}` : GOAL_INDICATOR_SOURCE_LABELS[i.source]}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.preview.goals.length > 25 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs text-link hover:underline">
              {showAll ? 'Visa färre' : `Visa alla ${preview.preview.goals.length}`}
            </button>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={committing || preview.preview.goals.length === 0} className={btnPrimary}>
              {committing ? 'Importerar…' : `Importera ${preview.preview.goals.length} mål till ${preview.preview.year}`}
            </button>
            <Link href="/mal" className={btnGhost}>
              Avbryt
            </Link>
          </div>
          {commit.status === 'error' && <Notice kind="error">{commit.message}</Notice>}
        </form>
      )}
    </div>
  );
}
