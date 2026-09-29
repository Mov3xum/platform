'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { CONTACT_CATEGORY_LABELS, CONTACT_IMPORT_FIELD_LABELS, type ContactImportField } from '@platform/shared';
import {
  commitContactImportAction,
  previewContactImportAction,
  type ContactImportState
} from '@/lib/actions/contacts';
import { Icon } from '@/components/proto';
import { Notice, btnGhost, btnPrimary, labelClass } from '../ui';

const idle: ContactImportState = { status: 'idle' };
const fileInputClass =
  'block w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground file:mr-3 file:rounded-xl file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-foreground hover:file:bg-brand-hover focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

/**
 * Import av befintliga kontakter (§ 45.5): CSV eller Excel → förhandsgranskning
 * (rubrikmappning, dubbletter, varningar) → bekräfta → upsert i skrivlagret.
 * Rader serialiseras tillbaka till servern som DATA och valideras där igen.
 */
export function ContactImportForm({ owners, meId }: { owners: { id: string; name: string }[]; meId: string }) {
  const [preview, previewAction, previewing] = useActionState(previewContactImportAction, idle);
  const [commit, commitAction, committing] = useActionState(commitContactImportAction, idle);
  const [showAll, setShowAll] = useState(false);

  const state = commit.status !== 'idle' ? commit : preview;

  if (state.status === 'done') {
    const r = state.result;
    return (
      <div className="space-y-4">
        <Notice kind="notice">
          Import klar: {r.created} nya, {r.updated} uppdaterade, {r.skipped} överhoppade.
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
        <Link href="/kontakter" className={btnPrimary}>
          Till kontaktboken <Icon name="arrow" size={13} />
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form action={previewAction} className="space-y-4 rounded-3xl border border-default bg-surface p-5">
        <div>
          <label className={labelClass} htmlFor="file">
            Fil (.csv eller .xlsx)
          </label>
          <input id="file" name="file" type="file" accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required className={fileInputClass} />
        </div>
        <p className="text-xs text-foreground-subtle">
          Första raden ska vara rubriker. Kända kolumner: {Object.values(CONTACT_IMPORT_FIELD_LABELS).join(' · ')}. Även
          Outlook-/Google-exporter (First Name, Last Name, E-mail Address, Company, Job Title) känns igen. Okända kolumner
          ignoreras.
        </p>
        <button type="submit" disabled={previewing} className={btnPrimary}>
          <Icon name="upload" size={13} /> {previewing ? 'Läser…' : 'Förhandsgranska'}
        </button>
        {preview.status === 'error' && <Notice kind="error">{preview.message}</Notice>}
      </form>

      {preview.status === 'preview' && (
        <form action={commitAction} className="space-y-4 rounded-3xl border border-default bg-surface p-5">
          <input type="hidden" name="rows" value={JSON.stringify(preview.preview.rows)} />
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold text-foreground">Förhandsgranskning</h2>
            <span className="text-sm text-foreground-muted mx-tnum">
              {preview.preview.rows.length} kontakter{preview.preview.merged > 0 ? ` · ${preview.preview.merged} dubbletter sammanslagna` : ''}
              {preview.preview.sheet ? ` · ark "${preview.preview.sheet}"` : ''}
            </span>
          </div>
          <div className="flex flex-wrap gap-1 text-xs">
            {preview.preview.mappedFields.map((f) => (
              <span key={f} className="rounded-full bg-movexum-pastell-gron px-2 py-0.5 font-semibold text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
                {CONTACT_IMPORT_FIELD_LABELS[f as ContactImportField] ?? f}
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
                  <th className="px-3 py-2">Namn</th>
                  <th className="px-3 py-2">Organisation</th>
                  <th className="px-3 py-2">Roll</th>
                  <th className="px-3 py-2">Kategori</th>
                  <th className="px-3 py-2">E-post</th>
                  <th className="px-3 py-2">Ägare</th>
                  <th className="px-3 py-2">Samtycke</th>
                </tr>
              </thead>
              <tbody>
                {(showAll ? preview.preview.rows : preview.preview.rows.slice(0, 25)).map((r) => (
                  <tr key={r.line} className="border-t border-default">
                    <td className="px-3 py-1.5 text-foreground">
                      {r.first_name} {r.last_name}
                    </td>
                    <td className="px-3 py-1.5 text-foreground-muted">{r.organization ?? '–'}</td>
                    <td className="px-3 py-1.5 text-foreground-muted">{r.primary_role ?? '–'}</td>
                    <td className="px-3 py-1.5 text-foreground-muted">{r.category ? CONTACT_CATEGORY_LABELS[r.category] : '–'}</td>
                    <td className="px-3 py-1.5 text-foreground-muted">{r.email ?? '–'}</td>
                    <td className="px-3 py-1.5 text-foreground-muted">{r.owner_email ?? <span className="text-foreground-subtle">standard</span>}</td>
                    <td className="px-3 py-1.5 text-foreground-muted">
                      {r.gdpr_consent === true ? 'Ja' : r.gdpr_consent === false ? 'Nej' : <span className="text-foreground-subtle">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.preview.rows.length > 25 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs text-link hover:underline">
              {showAll ? 'Visa färre' : `Visa alla ${preview.preview.rows.length}`}
            </button>
          )}

          <fieldset className="rounded-2xl border border-default p-4">
            <legend className="px-1 text-xs font-semibold text-foreground-muted">Standardägare</legend>
            <p className="mb-2 text-xs text-foreground-subtle">
              Används för rader utan &quot;Ägare&quot;-kolumn (eller där e-posten inte matchar en kollega). Befintliga kontakter
              får ägaren tillagd — ingen tas bort.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {owners.map((o) => (
                <label key={o.id} className="flex items-center gap-2 rounded-xl border border-default bg-canvas-subtle px-3 py-2 text-sm text-foreground">
                  <input type="checkbox" name="owners" value={o.id} defaultChecked={o.id === meId} className="accent-[var(--color-brand)]" />
                  <span className="truncate">
                    {o.name}
                    {o.id === meId ? ' (du)' : ''}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="flex items-start gap-2 rounded-2xl border border-default bg-canvas-subtle px-4 py-3 text-sm text-foreground">
            <input type="checkbox" name="consent_confirmed" required className="mt-0.5 accent-[var(--color-brand)]" />
            <span>
              Jag bekräftar att personerna i filen har informerats om att Movexum lagrar deras kontaktuppgifter (GDPR). Rader
              med uttryckligt &quot;Nej&quot; i samtyckeskolumnen hoppas över oavsett.
            </span>
          </label>

          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={committing || preview.preview.rows.length === 0} className={btnPrimary}>
              {committing ? 'Importerar…' : `Importera ${preview.preview.rows.length} kontakter`}
            </button>
            <Link href="/kontakter" className={btnGhost}>
              Avbryt
            </Link>
          </div>
          {commit.status === 'error' && <Notice kind="error">{commit.message}</Notice>}
        </form>
      )}
    </div>
  );
}
