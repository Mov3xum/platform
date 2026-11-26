import { KTH_TRL_LEVELS, KTH_TRL_SOURCE, KTH_TRL_TERMS, SPARK_TRL_LABELS, kthTrlLevel } from '@platform/shared';

/**
 * TRL-kriterierna (CLAUDE.md § 61.5) — KTH Innovation Readiness Level i
 * Movexums översättning (`kth-trl.ts`). Ren presentation utan state, så
 * komponenterna fungerar i både server- och klientkomponenter.
 */

function CriteriaList({ lines }: { lines: readonly string[] }) {
  return (
    <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs leading-relaxed text-foreground-muted marker:text-foreground-subtle">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

/** Vald nivås kriterier + vad nästa nivå kräver — stöd vid Movexums bedömning. */
export function TrlCriteria({ trl }: { trl: string }) {
  const current = kthTrlLevel(trl);
  if (!current) return null;
  const next = kthTrlLevel(current.level + 1);
  return (
    <div className="rounded-xl border border-default bg-surface p-3">
      <p className="text-xs font-semibold text-foreground">TRL {current.level} är nådd när</p>
      <CriteriaList lines={current.criteria} />
      {next ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold text-link">För TRL {next.level} krävs dessutom</summary>
          <CriteriaList lines={next.criteria} />
        </details>
      ) : null}
    </div>
  );
}

/** Hela skalan med begrepp och källa — uppslag på acceleratorsidan. */
export function TrlReference() {
  return (
    <details className="rounded-2xl border border-default bg-surface">
      <summary className="cursor-pointer px-5 py-4 font-heading text-sm font-semibold text-foreground">
        TRL-skalan — kriterier per nivå
        <span className="ml-2 font-body text-xs font-normal text-foreground-subtle">så avgör ni vilken nivå en lösning har nått</span>
      </summary>
      <div className="border-t border-default px-5 py-4">
        <p className="text-sm text-foreground-muted">
          En nivå är nådd först när dess kriterier är uppfyllda. Saknas belägg för något av dem gäller nivån under.
        </p>
        <ol className="mt-4 grid gap-x-8 gap-y-4 lg:grid-cols-2">
          {KTH_TRL_LEVELS.map((l) => (
            <li key={l.level} className="min-w-0 border-t border-default pt-3">
              <p className="text-sm font-semibold text-foreground">{SPARK_TRL_LABELS[String(l.level)] ?? `TRL ${l.level}`}</p>
              <p className="mt-0.5 text-xs text-foreground-subtle">{l.summary}</p>
              <CriteriaList lines={l.criteria} />
            </li>
          ))}
        </ol>
        <h4 className="mt-6 text-sm font-semibold text-foreground">Begrepp</h4>
        <dl className="mt-2 grid gap-x-8 gap-y-2 lg:grid-cols-2">
          {KTH_TRL_TERMS.map((t) => (
            <div key={t.term} className="min-w-0 text-xs leading-relaxed">
              <dt className="inline font-semibold text-foreground">{t.term}: </dt>
              <dd className="inline text-foreground-muted">{t.definition}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[11px] leading-relaxed text-foreground-subtle">{KTH_TRL_SOURCE}</p>
      </div>
    </details>
  );
}
