'use client';

import { useActionState, useState } from 'react';
import { saveAiBudgetAction, type SaveAiBudgetState } from '@/lib/actions/settings';

interface AiBudgetFormProps {
  tenantBudgetUsd: number;
  envDefaultUsd: number;
  effectiveUsd: number;
  spentUsd: number;
}

const initialState: SaveAiBudgetState = {};

function fmtUsd(n: number): string {
  return `$${n.toLocaleString('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function AiBudgetForm({
  tenantBudgetUsd,
  envDefaultUsd,
  effectiveUsd,
  spentUsd
}: AiBudgetFormProps) {
  const [value, setValue] = useState(tenantBudgetUsd > 0 ? String(tenantBudgetUsd) : '');
  const [result, formAction, isPending] = useActionState(saveAiBudgetAction, initialState);

  const pct = effectiveUsd > 0 ? Math.min(100, (spentUsd / effectiveUsd) * 100) : 0;
  // Statusfärg ur Movexum-paletten (ingen röd, § 2.3): brand < 80 %, gul ≥ 80 %,
  // orange ≥ 95 %.
  const barClass =
    pct >= 95 ? 'bg-movexum-orange' : pct >= 80 ? 'bg-movexum-gul' : 'bg-brand';

  return (
    <div className="space-y-4">
      {/* Förbrukning hittills denna månad */}
      <div className="rounded-xl border border-default bg-canvas-subtle p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[12.5px] text-foreground-muted">Förbrukat denna månad</span>
          <span className="font-mono text-[13px] tabular-nums text-foreground">
            {fmtUsd(spentUsd)}
            {effectiveUsd > 0 && (
              <span className="text-foreground-subtle"> / {fmtUsd(effectiveUsd)}</span>
            )}
          </span>
        </div>
        {effectiveUsd > 0 ? (
          <>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-canvas-muted">
              <div className={`h-full rounded-full ${barClass}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1.5 text-[11.5px] text-foreground-subtle">
              {pct >= 100
                ? 'Taket är nått — nya AI-körningar pausas till nästa månad.'
                : `${Math.round(pct)} % av taket använt.`}
            </p>
          </>
        ) : (
          <p className="mt-1.5 text-[11.5px] text-foreground-subtle">
            Ingen kostnadsspärr aktiv — AI-körningar begränsas inte av något tak.
          </p>
        )}
      </div>

      <form action={formAction} className="space-y-3">
        <label className="block">
          <span className="text-[12.5px] font-semibold text-foreground">Tak (USD/månad)</span>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-foreground-subtle">$</span>
            <input
              type="number"
              name="budget_usd"
              min={0}
              step="1"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0"
              className="w-40 rounded-lg border border-default bg-surface px-3 py-2 font-mono text-[13px] tabular-nums text-foreground outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
            />
          </div>
        </label>

        <p className="text-[11.5px] text-foreground-subtle">
          <span className="font-semibold text-foreground-muted">0 eller tomt</span> = ärver den
          globala standarden
          {envDefaultUsd > 0 ? (
            <> ({fmtUsd(envDefaultUsd)}, satt via <code className="font-mono">MOVEXUM_MONTHLY_AI_BUDGET_USD</code>).</>
          ) : (
            <> (ingen global standard satt → då är spärren <span className="font-semibold">av</span>).</>
          )}
          {' '}Ett värde här gäller bara denna tenant och överstyr den globala standarden.
        </p>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="mx-btn mx-primary"
            disabled={isPending}
            aria-disabled={isPending}
          >
            {isPending ? 'Sparar…' : 'Spara budget'}
          </button>
          {result?.error && (
            <span className="text-[12px] text-movexum-morkorange">{result.error}</span>
          )}
          {result?.success && !isPending && (
            <span className="text-[12px] text-movexum-morkgron">Sparat!</span>
          )}
        </div>
      </form>
    </div>
  );
}
