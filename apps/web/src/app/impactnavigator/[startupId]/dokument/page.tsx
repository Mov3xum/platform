import { ImpactCompanyShell, loadImpactCompanyContext } from '@/lib/impact/shell';
import { listDocuments } from '@/lib/impact/data';
import { eyebrow, formatImpactDate, noticeWarn } from '@/components/impact/ui';
import { IMPACT_EXTRACTION_STATUS_LABELS, IMPACT_UPLOAD_STAGE_LABELS } from '@platform/shared';
import { DeleteDocumentButton } from './DeleteDocumentButton';

export const dynamic = 'force-dynamic';

/** Dokumenten (originalets documents-sida): fil, steg, extraktionsstatus, uppladdad av, datum — med den utlästa texten hopfälld. */
export default async function DocumentsPage({ params }: { params: Promise<{ startupId: string }> }) {
  const { startupId } = await params;
  const ctx = await loadImpactCompanyContext(startupId);
  const docs = await listDocuments(ctx.pb, ctx.user.tenant, ctx.company.id, { withText: true });

  return (
    <ImpactCompanyShell ctx={ctx}>
      <div>
        <p className={eyebrow}>Dokument</p>
        <h2 className="mt-1 font-heading text-2xl font-semibold text-foreground">{ctx.company.name}</h2>
        <p className="mt-1 text-sm text-foreground-muted">Underlag som matar analysen. Texten läses ut en gång vid uppladdning och personnummer saneras.</p>
      </div>
      {docs.error ? <p className={noticeWarn}>{docs.error}</p> : null}
      <div className="overflow-hidden rounded-2xl border border-default bg-surface shadow-sm shadow-movexum-svart/5">
        <table className="w-full text-left text-sm">
          <thead className="bg-canvas-subtle text-xs uppercase tracking-wide text-foreground-subtle">
            <tr>
              <th className="px-4 py-3">Fil</th>
              <th className="px-4 py-3">Steg</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Uppladdad av</th>
              <th className="px-4 py-3">Datum</th>
              {ctx.canManage ? <th className="px-4 py-3" /> : null}
            </tr>
          </thead>
          <tbody>
            {docs.items.map((d) => (
              <tr key={d.id} className="border-t border-default align-top">
                <td className="px-4 py-3">
                  <details>
                    <summary className="cursor-pointer font-medium text-foreground">
                      {d.file ? (
                        <a href={`/api/impactnavigator/documents/${d.id}/file`} className="hover:text-link">
                          {d.name}
                        </a>
                      ) : (
                        d.name
                      )}
                    </summary>
                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-canvas-subtle p-3 text-xs text-foreground-muted">
                      {d.text || d.extractionWarning || 'Ingen extraherad text.'}
                    </pre>
                  </details>
                  {!d.file ? <p className="mt-1 text-xs text-foreground-subtle">Importerad från den tidigare appen — bara texten finns.</p> : null}
                </td>
                <td className="px-4 py-3 text-foreground-muted">{IMPACT_UPLOAD_STAGE_LABELS[d.stage]}</td>
                <td className="px-4 py-3 text-foreground-muted">{IMPACT_EXTRACTION_STATUS_LABELS[d.extractionStatus] ?? d.extractionStatus}</td>
                <td className="px-4 py-3 text-foreground-muted">{d.uploadedByName ?? '–'}</td>
                <td className="px-4 py-3 text-foreground-muted mx-tnum">{formatImpactDate(d.createdAt)}</td>
                {ctx.canManage ? (
                  <td className="px-4 py-3 text-right">
                    <DeleteDocumentButton startupId={ctx.company.id} documentId={d.id} name={d.name} />
                  </td>
                ) : null}
              </tr>
            ))}
            {docs.items.length === 0 ? (
              <tr>
                <td colSpan={ctx.canManage ? 6 : 5} className="px-4 py-8 text-center text-sm text-foreground-muted">
                  Inga dokument ännu.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </ImpactCompanyShell>
  );
}
