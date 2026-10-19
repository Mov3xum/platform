'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { importSuppressionsAction, type SuppressionImportState } from '@/lib/actions/email-campaigns';
import { Notice, btnPrimary, inputClass, labelClass } from '../../ui';

const idle: SuppressionImportState = { status: 'idle' };

export function SuppressionImportForm() {
  const [state, action, pending] = useActionState(importSuppressionsAction, idle);
  if (state.status === 'done' && state.result) {
    const r = state.result;
    return (
      <div className="space-y-4">
        <Notice kind="notice">
          Klart: {r.added} nya spärrar, {r.existing} fanns redan, {r.contactsUpdated} kontakter markerade.
        </Notice>
        {r.warnings.length > 0 && (
          <details className="rounded-2xl border border-default bg-surface p-4 text-sm">
            <summary className="cursor-pointer font-medium">{r.warnings.length} varningar</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground-muted">
              {r.warnings.slice(0, 200).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        )}
        <Link href="/installningar/e-post" className={btnPrimary}>
          Till spärrlistan
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4 rounded-3xl border border-default bg-surface p-5">
      <div>
        <label className={labelClass} htmlFor="file">
          Fil (.csv eller .xlsx)
        </label>
        <input id="file" name="file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor="reason">
          Orsak för rader utan statuskolumn
        </label>
        <select id="reason" name="reason" className={inputClass} defaultValue="import">
          <option value="import">Importerad spärr (Mailchimp)</option>
          <option value="unsubscribe">Avregistrerade sig</option>
          <option value="bounce">Studsade (cleaned)</option>
          <option value="complaint">Klagomål</option>
        </select>
        <p className="mt-1 text-xs text-foreground-subtle">Har filen en statuskolumn (unsubscribed/cleaned) används den per rad.</p>
      </div>
      {state.status === 'error' && <Notice kind="error">{state.message}</Notice>}
      <button type="submit" className={btnPrimary} disabled={pending}>
        {pending ? 'Importerar…' : 'Importera spärrlistan'}
      </button>
    </form>
  );
}
