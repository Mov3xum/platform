'use client';

import { useState, useTransition } from 'react';
import { REGISTER_SOURCE_LABELS, type AuditCheck, type AuditStatus, type SourceCoverage } from '@platform/shared';
import { backfillRegisterAction, verifyRegisterIntegrityAction, type RegisterActionState } from '@/lib/actions/register';
import { ActionNotice, Chip, Notice, btnGhost, btnPrimary, card, type Tone } from '@/components/register/ui';

const STATUS: Record<AuditStatus, { tone: Tone; label: string }> = {
  ok: { tone: 'good', label: 'I ordning' },
  warn: { tone: 'warn', label: 'Varning' },
  fail: { tone: 'bad', label: 'Brist' },
  info: { tone: 'info', label: 'Info' }
};
const ORDER: AuditStatus[] = ['fail', 'warn', 'info', 'ok'];

export function AuditView({ checks, coverage, canManage, readError }: { checks: AuditCheck[]; coverage: SourceCoverage[]; canManage: boolean; readError: string | null }) {
  const [state, setState] = useState<RegisterActionState>({});
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<RegisterActionState>) =>
    start(async () => {
      try {
        setState(await fn());
      } catch {
        setState({ error: 'Åtgärden kunde inte köras. Ladda om sidan och försök igen.' });
      }
    });
  const sorted = [...checks].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const missing = coverage.reduce((n, c) => (c.expected !== null && c.registered !== null ? n + Math.max(0, c.expected - c.registered) : n), 0);
  return (
    <div className="space-y-6">
      {readError && <Notice tone="bad">{readError}</Notice>}

      <section className={`${card} divide-y divide-default`}>
        {sorted.map((c) => (
          <div key={c.key} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-5 py-3.5">
            <div className="w-24 shrink-0 pt-0.5">
              <Chip tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Chip>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">{c.label}</div>
              <div className="text-sm text-foreground-muted">{c.detail}</div>
              {c.action && <div className="mt-0.5 text-sm text-foreground">Åtgärd: {c.action}</div>}
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">Täckning per källa</h2>
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-default text-xs text-foreground-subtle">
                <th className="px-5 py-2 font-semibold">Källa</th>
                <th className="px-3 py-2 text-right font-semibold">Ska ha ärende</th>
                <th className="px-3 py-2 text-right font-semibold">Har ärende</th>
                <th className="px-5 py-2 text-right font-semibold">Saknas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {coverage.map((c) => {
                const gap = c.expected !== null && c.registered !== null ? Math.max(0, c.expected - c.registered) : null;
                return (
                  <tr key={c.source}>
                    <td className="px-5 py-2 text-foreground">{REGISTER_SOURCE_LABELS[c.source]}</td>
                    <td className="mx-tnum px-3 py-2 text-right text-foreground-muted">{c.expected ?? '–'}</td>
                    <td className="mx-tnum px-3 py-2 text-right text-foreground-muted">{c.registered ?? '–'}</td>
                    <td className="mx-tnum px-5 py-2 text-right">{gap === null ? '–' : gap === 0 ? <span className="text-foreground-muted">0</span> : <Chip tone="bad">{gap}</Chip>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <button className={btnPrimary} disabled={pending || missing === 0} onClick={() => run(backfillRegisterAction)}>
              {pending ? 'Arbetar…' : missing > 0 ? `Efterregistrera saknade (${missing})` : 'Inget att efterregistrera'}
            </button>
            <button className={btnGhost} disabled={pending} onClick={() => run(verifyRegisterIntegrityAction)}>
              Kontrollera kontrollsummor
            </button>
            <a className={btnGhost} href="/api/diarium/export">
              Exportera hela diariet
            </a>
          </div>
        )}
        <ActionNotice state={state} />
      </section>
    </div>
  );
}
