import Link from 'next/link';
import type PocketBase from 'pocketbase';
import {
  SCREENING_REQUEST_RECIPIENT_LABEL,
  SCREENING_REQUEST_STATUS_LABEL,
  STATE_AID_OUTCOME_LABEL,
  VINNOVA_OUTCOME_LABEL,
  diffScreeningRuns,
  formatStockholmDateTime,
  type ScreeningRunChange,
  type ScreeningVerdict,
  type StateAidOutcome,
  type VinnovaOutcome
} from '@platform/shared';
import { Icon } from '@/components/proto';
import { listScreeningRuns, type ScreeningRunRow } from '@/lib/excellence/history.server';
import { listScreeningRequestsForStartup } from '@/lib/excellence/requests.server';
import { recomputeLatestScreeningAction } from '@/lib/actions/excellence';

// Bolagskortets sektion "Statsstöd & Vinnova" (CLAUDE.md § 51.6): alla
// körningar av Bedömning excellens för bolaget (utfall, vem, när, kostnad,
// PDF) med "vad ändrades sedan föregående" mellan två körningar i rad, och
// bolagets begäran om komplettering (till coach/bolag) med status. Reads med
// användarens token → RLS: staff/observer (en ren bolagsmedlem når aldrig
// sektionen — bolagskortets sidguard + list/view-reglerna).

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
const VERDICT_TONE: Record<ScreeningVerdict, string> = {
  yes: STATE_AID_TONE.art22_possible,
  no: STATE_AID_TONE.not_eligible,
  unknown: STATE_AID_TONE.undetermined
};
const CHANGE_TONE: Record<ScreeningRunChange['tone'], string> = {
  better: 'text-movexum-morkgron dark:text-movexum-pastell-gron',
  worse: 'text-movexum-morkorange dark:text-movexum-pastell-orange',
  neutral: 'text-foreground-muted'
};

function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}>{children}</span>;
}

function costText(run: ScreeningRunRow): string | null {
  const c = run.summary?.cost;
  if (!c) return run.mode === 'saved' ? 'inga anrop' : null;
  if (c.credits === null) return 'pris ej angivet';
  const sek = c.sek !== null ? ` ≈ ${c.sek.toLocaleString('sv-SE', { maximumFractionDigits: 0 })} kr` : '';
  return `${c.complete ? '' : 'minst '}${c.credits.toLocaleString('sv-SE')} credits${sek}`;
}

export async function StartupScreeningSection({
  pb,
  tenantId,
  startupId,
  canAssess,
  canRequest,
  feedback
}: {
  pb: PocketBase;
  tenantId: string;
  startupId: string;
  /** admin/incubator_lead/coach — får köra en ny bedömning. */
  canAssess: boolean;
  /** Får skicka/följa upp begäran om komplettering. */
  canRequest: boolean;
  /** `?bedomning=` efter "Räkna om med svaren" (§ 51.8). */
  feedback?: string;
}) {
  const [{ runs, error }, { requests, error: reqError }] = await Promise.all([
    listScreeningRuns(pb, tenantId, startupId, 20),
    listScreeningRequestsForStartup(pb, tenantId, startupId, { limit: 20 })
  ]);
  if (runs.length === 0 && requests.length === 0 && !error && !reqError && !canAssess) return null;

  return (
    <section id="statsstod" className="scroll-mt-24 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Statsstöd & Vinnova</h2>
          <p className="text-[12.5px] text-foreground-muted">
            Bedömning excellens — art. 22 GBER / de minimis och Vinnovas målgrupp. Varje körning sparas här så alla ser samma bild.
          </p>
        </div>
        {canAssess && (
          <div className="flex flex-wrap items-center gap-2">
            {runs.length > 0 && (
              <form action={recomputeLatestScreeningAction}>
                <input type="hidden" name="startup_id" value={startupId} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-full border border-strong px-3 py-1 text-sm font-semibold text-foreground transition hover:bg-canvas-subtle"
                  title="Räknar om den senaste bedömningen på sparat underlag med bolagets manuella svar och kompletteringar — inga nya anrop hos leverantören. Ny PDF sparas här och i dina Filer."
                >
                  <Icon name="rotate-ccw" size={13} /> Räkna om med svaren
                </button>
              </form>
            )}
            <Link
              href={`/bedomning-excellens?startup=${startupId}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
            >
              <Icon name="shield" size={13} /> {runs.length > 0 ? 'Ny bedömning' : 'Gör en bedömning'}
            </Link>
          </div>
        )}
      </div>

      {feedback === 'ok' && (
        <p className="mb-3 rounded-xl bg-movexum-pastell-gron px-3 py-2 text-[12.5px] text-movexum-morkgron dark:bg-movexum-morkgron/30 dark:text-movexum-pastell-gron">
          Bedömningen räknades om med svaren — ny körning och PDF sparad nedan (och i dina Filer).
        </p>
      )}
      {feedback && feedback !== 'ok' && (
        <p className="mb-3 rounded-xl bg-movexum-pastell-orange px-3 py-2 text-[12.5px] text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange">
          {feedback === 'underlag'
            ? 'Inget sparat underlag att räkna om på — den senaste körningen gjordes innan underlaget började sparas (eller fältet saknas: migration 1700000192). Kör en ny bedömning.'
            : feedback === 'behorighet'
              ? 'Du har inte behörighet att räkna om bedömningen.'
              : 'Omräkningen misslyckades — försök igen eller kör en ny bedömning.'}
        </p>
      )}

      {(error || reqError) && (
        <p className="mb-3 rounded-xl bg-movexum-pastell-gul px-3 py-2 text-[12.5px] text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul">
          {error ?? reqError}
        </p>
      )}

      {requests.length > 0 && (
        <div className="mb-5">
          <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Begäran om komplettering</p>
          <ul className="divide-y divide-default rounded-2xl border border-default">
            {requests.map((r) => {
              const answered = r.items.filter((i) => i.status === 'answered').length;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[12.5px]">
                  <Link href={`/komplettering/${r.id}`} className="font-medium text-foreground hover:underline">
                    Till {SCREENING_REQUEST_RECIPIENT_LABEL[r.recipient_kind].toLowerCase()}
                    {r.recipient_name ? ` (${r.recipient_name})` : ''} — {r.items.length} {r.items.length === 1 ? 'punkt' : 'punkter'}
                  </Link>
                  <Chip className={r.status === 'answered' || r.status === 'closed' ? VERDICT_TONE.yes : r.status === 'partially_answered' ? STATE_AID_TONE.de_minimis : VERDICT_TONE.unknown}>
                    {SCREENING_REQUEST_STATUS_LABEL[r.status]}
                    {r.status === 'partially_answered' ? ` ${answered}/${r.items.length}` : ''}
                  </Chip>
                  <span className="flex-1" />
                  <span className="text-[11.5px] text-foreground-subtle mx-tnum">
                    {r.requested_by_name ? `${r.requested_by_name} · ` : ''}
                    {r.created ? formatStockholmDateTime(r.created) : ''}
                    {r.due_at ? ` · senast ${r.due_at.slice(0, 10)}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {runs.length === 0 ? (
        <p className="text-sm text-foreground-subtle">
          Ingen bedömning gjord än.{canAssess ? ' Kör en bedömning så sparas utfallet här.' : ''}
        </p>
      ) : (
        <ol className="space-y-3">
          {runs.map((run, idx) => {
            const prev = runs[idx + 1];
            const diff = prev?.summary && run.summary ? diffScreeningRuns(prev.summary, run.summary) : null;
            const cost = costText(run);
            return (
              <li key={run.id} className="rounded-2xl border border-default px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-foreground mx-tnum">{run.assessed_at ? formatStockholmDateTime(run.assessed_at) : '–'}</span>
                  <span className="text-[11.5px] text-foreground-subtle">
                    {run.mode === 'register' ? `färskt från ${run.provider ?? 'bolagsregistret'}` : 'sparade data'}
                    {run.assessed_by_name ? ` · ${run.assessed_by_name}` : ''}
                    {cost ? ` · kostnad: ${cost}` : ''}
                  </span>
                  <span className="flex-1" />
                  {idx === 0 && <Chip className="bg-canvas-subtle text-foreground-muted">Senaste</Chip>}
                  {run.file && (
                    <a href={`/api/screenings/${run.id}/pdf`} className="text-[12px] font-semibold text-link hover:underline">
                      PDF
                    </a>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Chip className={STATE_AID_TONE[run.state_aid_outcome]}>{STATE_AID_OUTCOME_LABEL[run.state_aid_outcome]}</Chip>
                  <Chip className={VINNOVA_TONE[run.vinnova_outcome]}>Vinnova: {VINNOVA_OUTCOME_LABEL[run.vinnova_outcome]}</Chip>
                  <Chip className={VERDICT_TONE[run.excellence_verdict]}>
                    Excellens: {run.excellence_verdict === 'yes' ? 'Ja' : run.excellence_verdict === 'no' ? 'Nej' : 'Okänt'}
                  </Chip>
                  {run.summary && (
                    <span className="self-center text-[11.5px] text-foreground-subtle mx-tnum">
                      {run.summary.counts.yes} ja / {run.summary.counts.no} nej / {run.summary.counts.unknown} okänt
                      {run.summary.companies.length > 1 ? ` · ${run.summary.companies.length} bolag i koncernen` : ''}
                    </span>
                  )}
                </div>
                {diff && (
                  <div className="mt-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
                      Sedan föregående ({prev.assessed_at ? formatStockholmDateTime(prev.assessed_at) : '–'})
                    </p>
                    {diff.changes.length === 0 ? (
                      <p className="text-[12px] text-foreground-muted">Inga ändringar i utfall eller punkter.</p>
                    ) : (
                      <ul className="mt-0.5 space-y-0.5 text-[12px]">
                        {diff.changes.slice(0, 12).map((c, i) => (
                          <li key={i} className={CHANGE_TONE[c.tone]}>
                            {c.text}
                          </li>
                        ))}
                        {diff.changes.length > 12 && <li className="text-foreground-subtle">… och {diff.changes.length - 12} till (se PDF:n).</li>}
                      </ul>
                    )}
                  </div>
                )}
                {run.summary && run.summary.missing.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[12px] font-semibold text-foreground-muted">
                      Saknat underlag ({run.summary.missing.length})
                      {canRequest && idx === 0 ? ' — skickas som begäran från bedömningen' : ''}
                    </summary>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12px] text-foreground-muted">
                      {run.summary.missing.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
