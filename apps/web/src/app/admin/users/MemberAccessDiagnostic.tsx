'use client';

import { useActionState } from 'react';
import { diagnoseMemberAccessAction, type DiagnoseState } from '@/lib/actions/users';

const initialState: DiagnoseState = { status: 'idle' };

const inputClass =
  'block w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

function Row({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span
        className={`mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          ok
            ? 'bg-movexum-pastell-gron text-movexum-morkgron'
            : 'bg-movexum-pastell-orange text-movexum-morkorange'
        }`}
      >
        {ok ? '✓' : '!'}
      </span>
      <span className="text-foreground-muted">{children}</span>
    </li>
  );
}

/**
 * Read-only diagnos: varför ser en bolagsmedlem inte sina tilldelade
 * aktiviteter? Visar tenant-match, länkade bolag och var tilldelningar landat.
 */
export function MemberAccessDiagnostic() {
  const [state, formAction, pending] = useActionState(diagnoseMemberAccessAction, initialState);
  const r = state.report;

  return (
    <section className="rounded-3xl border border-default bg-surface p-6">
      <h2 className="text-base font-semibold text-foreground">
        Diagnos: ser en medlem inte sina aktiviteter?
      </h2>
      <p className="mt-2 text-sm text-foreground-muted">
        Slå upp en medlems e-post för att se kopplade bolag, tenant-match och var
        tilldelade workshops faktiskt landat. Read-only, scopad till din organisation.
      </p>

      <form action={formAction} className="mt-4 flex flex-wrap gap-2">
        <input
          type="email"
          name="email"
          required
          placeholder="medlem@bolag.se"
          className={`${inputClass} flex-1`}
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-2xl bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? 'Kör…' : 'Diagnostisera'}
        </button>
      </form>

      {state.status === 'error' && (
        <p className="mt-3 rounded-2xl bg-movexum-pastell-orange px-4 py-3 text-sm text-movexum-morkorange">
          {state.message}
        </p>
      )}

      {state.status === 'ok' && state.message && !r?.userFound && (
        <p className="mt-3 rounded-2xl bg-movexum-pastell-gul px-4 py-3 text-sm text-movexum-morkgul">
          {state.message}
        </p>
      )}

      {r?.userFound && (
        <div className="mt-4 space-y-4">
          <ul className="space-y-1.5">
            <Row ok={!!r.tenantMatch}>
              Kontot ligger i {r.tenantMatch ? 'samma' : 'EN ANNAN'} organisation (tenant){' '}
              {r.tenantMatch ? '' : `(${r.userTenant} ≠ ${r.actorTenant})`}.
            </Row>
            <Row ok={!!r.isPureMember}>
              Roller: {(r.roles ?? []).join(', ') || '—'}
              {r.isPureMember ? ' (ren bolagsmedlem)' : ' (inte en ren bolagsmedlem — får staff-vyn)'}
            </Row>
            <Row ok={r.linked.length > 0}>
              {r.linked.length === 0
                ? 'Inga bolag kopplade (linked_startups är tomt) — medlemmen ser inga aktiviteter.'
                : `${r.linked.length} kopplat bolag.`}
            </Row>
          </ul>

          {r.linked.length > 0 && (
            <div className="rounded-2xl border border-default bg-canvas-subtle p-4">
              <h3 className="mb-2 text-sm font-semibold text-foreground">Kopplade bolag</h3>
              <ul className="space-y-1">
                {r.linked.map((l) => (
                  <li key={l.id} className="text-xs text-foreground-muted">
                    {l.exists ? (
                      <>
                        <span className="font-medium text-foreground">{l.name ?? l.id}</span>{' '}
                        <code className="font-mono">{l.id}</code>
                        {!l.tenantMatch && (
                          <span className="ml-1 font-semibold text-movexum-morkorange">
                            — i annan tenant!
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-movexum-morkorange">
                        Bolags-id <code className="font-mono">{l.id}</code> finns inte (raderat?).
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-2xl border border-default bg-canvas-subtle p-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground">
              Tilldelningar synliga för medlemmens bolag ({r.assignmentsForLinked.length})
            </h3>
            {r.assignmentsForLinked.length === 0 ? (
              <p className="text-xs text-movexum-morkorange">
                Inga workshop-tilldelningar för de kopplade bolagen — så medlemmen ser
                inget. Kolla listan nedan: tilldelades workshopen rätt bolagspost?
              </p>
            ) : (
              <ul className="space-y-1">
                {r.assignmentsForLinked.map((a) => (
                  <li key={a.id} className="text-xs text-foreground-muted">
                    <span className="font-medium text-foreground">{a.workshopTitle ?? a.id}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {r.recentAssignments.length > 0 && (
            <div className="rounded-2xl border border-default bg-canvas-subtle p-4">
              <h3 className="mb-2 text-sm font-semibold text-foreground">
                Senaste workshop-tilldelningar i organisationen
              </h3>
              <p className="mb-2 text-xs text-foreground-subtle">
                Visar VAR tilldelningar landade — jämför bolags-id med medlemmens kopplade bolag.
              </p>
              <ul className="space-y-1">
                {r.recentAssignments.map((a) => (
                  <li key={a.id} className="text-xs text-foreground-muted">
                    <span className="font-medium text-foreground">{a.workshopTitle ?? a.id}</span>
                    {' → '}
                    {a.startupName ?? '—'} <code className="font-mono">{a.startupId}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
