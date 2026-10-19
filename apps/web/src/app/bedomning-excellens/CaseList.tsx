import Link from 'next/link';
import {
  STATE_AID_OUTCOME_LABEL,
  VINNOVA_OUTCOME_LABEL,
  type StateAidOutcome,
  type VinnovaOutcome
} from '@platform/shared';
import type { ScreeningCaseRow } from '@/lib/excellence/cases.server';
import { completeScreeningCaseAction, reopenScreeningCaseAction } from '@/lib/actions/excellence';

// Ärendelistan i Bedömning excellens (CLAUDE.md § 51.10). Aktuella ärenden
// som standard; klarmarkerade ligger under "Avslutade". Ren presentation av
// det page.tsx läst med användarens token (RLS: staff/observer).

const STATE_AID_TONE: Record<StateAidOutcome, string> = {
  art22_possible: 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron',
  de_minimis: 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul',
  not_eligible: 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange',
  undetermined: 'bg-canvas-muted text-foreground-muted'
};
const VINNOVA_TONE: Record<VinnovaOutcome, string> = {
  in_target_possible: STATE_AID_TONE.art22_possible,
  not_in_target: STATE_AID_TONE.not_eligible,
  undetermined: STATE_AID_TONE.undetermined
};

function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}>{children}</span>;
}

function dateText(iso?: string): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'medium', timeStyle: 'short' });
}

function formatOrgNr(orgNr: string): string {
  const d = orgNr.replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 6)}-${d.slice(6)}` : orgNr;
}

interface Props {
  view: 'open' | 'done';
  cases: ScreeningCaseRow[];
  openCount: number | null;
  doneCount: number | null;
  error?: string;
  /** Bara modulens roller klarmarkerar/öppnar (observer läser). */
  canManage: boolean;
}

export function CaseList({ view, cases, openCount, doneCount, error, canManage }: Props) {
  const tab = (key: 'open' | 'done', label: string, count: number | null) => (
    <Link
      href={key === 'open' ? '/bedomning-excellens' : '/bedomning-excellens?visa=avslutade'}
      aria-current={view === key ? 'page' : undefined}
      className={`rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition ${
        view === key ? 'border-brand bg-brand text-brand-foreground' : 'border-default text-foreground-muted hover:bg-canvas-subtle'
      }`}
    >
      {label}
      {count !== null ? ` (${count})` : ''}
    </Link>
  );

  return (
    <section className="rounded-2xl border border-default bg-surface px-5 py-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-[15px] font-semibold text-foreground">Ärenden</h2>
        {tab('open', 'Aktuella', openCount)}
        {tab('done', 'Avslutade', doneCount)}
      </div>

      {error && (
        <p className="mt-4 rounded-xl bg-movexum-pastell-orange px-3 py-2 text-[12.5px] text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange">
          {error}
        </p>
      )}

      {!error && cases.length === 0 && (
        <p className="mt-4 text-sm text-foreground-muted">
          {view === 'open' ? (
            <>
              Inga aktuella ärenden.{' '}
              <Link href="/bedomning-excellens?ny=1" className="font-semibold text-link hover:underline">
                Skapa ärende
              </Link>
            </>
          ) : (
            'Inga avslutade ärenden.'
          )}
        </p>
      )}

      {cases.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-default text-[11px] uppercase tracking-wider text-foreground-subtle">
                <th className="px-3 py-2 font-semibold">Bolag</th>
                <th className="px-3 py-2 font-semibold">Statsstöd</th>
                <th className="px-3 py-2 font-semibold">Vinnova</th>
                <th className="px-3 py-2 font-semibold">Okänt</th>
                <th className="px-3 py-2 font-semibold">{view === 'open' ? 'Senast sparad' : 'Klarmarkerat'}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="border-b border-default last:border-0">
                  <td className="px-3 py-2.5">
                    <Link href={`/bedomning-excellens?arende=${c.id}`} className="font-semibold text-foreground hover:underline">
                      {c.subject_name || formatOrgNr(c.org_nr)}
                    </Link>
                    <div className="text-[11.5px] text-foreground-subtle mx-tnum">
                      {formatOrgNr(c.org_nr)}
                      {c.startup ? ' · Portföljbolag' : ''}
                      {c.mode === 'saved' ? ' · Sparade data' : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {c.state_aid_outcome ? <Chip className={STATE_AID_TONE[c.state_aid_outcome]}>{STATE_AID_OUTCOME_LABEL[c.state_aid_outcome]}</Chip> : '–'}
                  </td>
                  <td className="px-3 py-2.5">
                    {c.vinnova_outcome ? <Chip className={VINNOVA_TONE[c.vinnova_outcome]}>{VINNOVA_OUTCOME_LABEL[c.vinnova_outcome]}</Chip> : '–'}
                  </td>
                  <td className="px-3 py-2.5 text-foreground-muted mx-tnum">{c.unknown_count ?? '–'}</td>
                  <td className="px-3 py-2.5 text-foreground-muted">
                    <div className="mx-tnum">{dateText(view === 'open' ? c.last_assessed_at : c.completed_at)}</div>
                    <div className="text-[11.5px] text-foreground-subtle">
                      {view === 'open' ? c.last_assessed_by_name : c.completed_by_name}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Link
                        href={`/bedomning-excellens?arende=${c.id}`}
                        className="rounded-full border border-strong px-3 py-1 text-[12px] font-semibold text-foreground transition hover:bg-canvas-subtle"
                      >
                        {view === 'open' ? 'Fortsätt' : 'Öppna'}
                      </Link>
                      {canManage && (
                        <form action={view === 'open' ? completeScreeningCaseAction : reopenScreeningCaseAction}>
                          <input type="hidden" name="case_id" value={c.id} />
                          <button
                            type="submit"
                            className="rounded-full bg-brand px-3 py-1 text-[12px] font-semibold text-brand-foreground transition hover:bg-brand-hover"
                          >
                            {view === 'open' ? 'Klarmarkera' : 'Öppna igen'}
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
