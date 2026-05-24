'use client';

import { useState, useTransition } from 'react';
import { runQuarterlyRecalibrationAction } from '@/lib/actions/internationalization';

interface QuarterlyRecalibrationButtonProps {
  strategyId: string;
}

export function QuarterlyRecalibrationButton({ strategyId }: QuarterlyRecalibrationButtonProps) {
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleRun = () => {
    setError(null);
    setOutput(null);
    startTransition(async () => {
      const res = await runQuarterlyRecalibrationAction(strategyId);
      if (res.error) { setError(res.error); return; }
      setOutput(res.output ?? null);
    });
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        disabled={pending}
        onClick={handleRun}
        className="inline-flex items-center gap-2 rounded-full border border-movexum-lila/40 bg-movexum-pastell-lila/40 px-5 py-2.5 text-sm font-semibold text-movexum-lila transition hover:bg-movexum-pastell-lila dark:border-movexum-morklila/40 dark:bg-movexum-morklila/10 dark:text-movexum-ljuslila dark:hover:bg-movexum-morklila/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? '🔄 Kalibrerar…' : '🔄 Kör kvartalsvis omkalibrering'}
      </button>

      {error && (
        <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-sm text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
          {error}
        </p>
      )}

      {output && (
        <div className="rounded-2xl border border-movexum-bla/30 bg-movexum-pastell-bla p-5 dark:border-movexum-djupbla/50 dark:bg-movexum-morkbla/20">
          <p className="mb-2 text-xs font-medium text-movexum-morkbla dark:text-movexum-pastell-bla">
            Genererat av AI – verifiera innan delning
          </p>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed text-foreground-muted">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}
