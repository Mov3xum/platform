import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto';
import { TALENT_NEED_STATUS_LABELS, needPeriodLabel } from '@platform/shared';
import { listInterestsForStartup, listNeeds } from '@/lib/talent/data';
import { KindChip, NeedStatusChip, Notice, TagChips, btnGhost, btnPrimary, fmtDate } from '@/components/talent/ui';
import { requireMemberStartup } from './_shared';

export const dynamic = 'force-dynamic';

/** Bolagets behov mot studenter (§ 54) + ingång till de sökbara studenterna. */
export default async function MemberTalentPage() {
  const { user, pb, startupId, startupName } = await requireMemberStartup();
  const [needs, interests] = await Promise.all([listNeeds(pb, user.tenant, { startup: startupId }), listInterestsForStartup(user.tenant, startupId)]);
  const open = new Map<string, number>();
  const pendingProposals = new Map<string, number>();
  for (const { interest } of interests.items) {
    if (interest.status === 'new' || interest.status === 'dialogue' || interest.status === 'matched') open.set(interest.need, (open.get(interest.need) ?? 0) + 1);
    if (interest.status === 'proposed') pendingProposals.set(interest.need, (pendingProposals.get(interest.need) ?? 0) + 1);
  }
  return (
    <PageShell
      title="Studenter & talang"
      meta={<span className="text-sm text-foreground-subtle">{startupName}</span>}
      actions={
        <Link href="/min-oversikt/talang/ny" className={btnPrimary}>
          <Icon name="plus" size={14} /> Nytt behov
        </Link>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-foreground-muted">
          Behöver ni en student för ett examensarbete, praktik, deltidsjobb eller anställning? Lägg upp behovet — Movexum granskar och publicerar det för studenterna. Ni kan också
          bläddra bland sökbara studenter (anonymt) och föreslå ett uppdrag.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/min-oversikt/talang/studenter" className={btnGhost}>
            <Icon name="search" size={14} /> Bläddra bland studenter
          </Link>
          <Link href="/min-oversikt" className={btnGhost}>
            Tillbaka till Mitt bolag
          </Link>
        </div>
        {needs.missing ? <Notice kind="warning">Funktionen är inte aktiverad i databasen än — kontakta Movexum.</Notice> : null}
        {needs.error ? <Notice kind="error">{needs.error}</Notice> : null}
        {needs.items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default bg-canvas-subtle p-6 text-sm text-foreground-muted">Ni har inga behov upplagda än.</div>
        ) : (
          <ul className="divide-y divide-default rounded-3xl border border-default bg-surface">
            {needs.items.map((n) => (
              <li key={n.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <NeedStatusChip status={n.status} />
                    <KindChip kind={n.kind} />
                    {n.status === 'pending_review' ? <span className="text-xs text-foreground-subtle">Movexum granskar</span> : null}
                  </div>
                  <Link href={`/min-oversikt/talang/${n.id}`} className="block font-heading text-base font-semibold text-foreground hover:underline">
                    {n.title}
                  </Link>
                  <div className="flex flex-wrap gap-3 text-xs text-foreground-subtle">
                    <span>{needPeriodLabel(n)}</span>
                    {n.deadline ? <span>sök senast {fmtDate(n.deadline)}</span> : null}
                    <span className="mx-tnum">{open.get(n.id) ?? 0} intressen</span>
                    {pendingProposals.get(n.id) ? <span className="mx-tnum">{pendingProposals.get(n.id)} förslag väntar på svar</span> : null}
                  </div>
                  <TagChips tags={n.tags} />
                  {n.review_note && (n.status === 'draft' || n.status === 'published') ? <p className="text-xs text-foreground-muted">Movexum: {n.review_note}</p> : null}
                </div>
                <Link href={`/min-oversikt/talang/${n.id}`} className={btnGhost}>
                  {TALENT_NEED_STATUS_LABELS[n.status] === 'Utkast' ? 'Fortsätt' : 'Öppna'}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
