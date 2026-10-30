import { ImpactCompanyShell, loadImpactCompanyContext } from '@/lib/impact/shell';
import { listNotes } from '@/lib/impact/data';
import { card, eyebrow, formatImpactDate, noticeWarn } from '@/components/impact/ui';
import { NoteForm } from './NoteForm';

export const dynamic = 'force-dynamic';

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** Interna anteckningar (originalets notes-sida) — bolagskortets `notes`, konfidentiella visas inte här. */
export default async function NotesPage({ params }: { params: Promise<{ startupId: string }> }) {
  const { startupId } = await params;
  const ctx = await loadImpactCompanyContext(startupId);
  const notes = await listNotes(ctx.pb, ctx.company.id);
  const visible = notes.items.filter((n) => !n.confidential);

  return (
    <ImpactCompanyShell ctx={ctx}>
      <div>
        <p className={eyebrow}>Anteckningar</p>
        <h2 className="mt-1 font-heading text-2xl font-semibold text-foreground">{ctx.company.name}</h2>
      </div>
      {notes.error ? <p className={noticeWarn}>{notes.error}</p> : null}
      {ctx.canManage ? <NoteForm startupId={ctx.company.id} /> : null}
      <div className="grid gap-3">
        {visible.map((n) => (
          <article key={n.id} className={card}>
            <p className="whitespace-pre-wrap text-sm text-foreground">{stripHtml(n.body)}</p>
            <p className="mt-3 text-xs text-foreground-subtle">
              {n.authorName ?? 'Okänd'} · {formatImpactDate(n.createdAt, true)}
            </p>
          </article>
        ))}
        {visible.length === 0 ? <p className="text-sm text-foreground-muted">Inga anteckningar ännu.</p> : null}
      </div>
    </ImpactCompanyShell>
  );
}
