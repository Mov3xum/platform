import type { Metadata } from 'next';
import Link from 'next/link';
import { TALENT_COMPENSATION_LABELS, TALENT_NEED_KIND_LABELS, TALENT_WORK_MODE_LABELS, isTalentNeedKind, rankNeedsForStudent } from '@platform/shared';
import { listPublishedNeeds, tagLabel } from '@/lib/talent/public';
import { loadTalentPublic } from './_data';
import { PublicCard, TagRow, TalentPublicShell } from './_shell';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ tenant: string }> }): Promise<Metadata> {
  const { tenant } = await params;
  return { title: `Studenter & talang · ${tenant}`, robots: { index: false } };
}

/** Publik tavla med publicerade behov (§ 54). Inloggad student får dem rankade mot sin profil. */
export default async function TalentBoardPage({
  params,
  searchParams
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ typ?: string; borttagen?: string }>;
}) {
  const { tenant } = await params;
  const { typ, borttagen } = await searchParams;
  const { resolved, branding, student, vocabulary } = await loadTalentPublic(tenant);
  const { items, error } = await listPublishedNeeds(resolved);
  const base = `/s/${encodeURIComponent(resolved.tenant.slug)}`;
  const kindFilter = isTalentNeedKind(typ) ? typ : null;
  const filtered = kindFilter ? items.filter((n) => n.kind === kindFilter) : items;
  const ranked = student
    ? rankNeedsForStudent(student, filtered.map((n) => ({ ...n, status: 'published' as const })), { limit: 500 })
    : null;
  const ordered = ranked ? ranked.map((r) => ({ need: filtered.find((n) => n.id === r.item.id)!, matched: new Set(r.matchedTags), reasons: r.reasons })) : filtered.map((need) => ({ need, matched: new Set<string>(), reasons: [] as string[] }));
  const labels = (slug: string) => tagLabel(vocabulary, slug);

  return (
    <TalentPublicShell
      tenant={resolved.tenant}
      branding={branding}
      student={student}
      active="behov"
      title={student ? `Uppdrag som passar dig, ${student.first_name}` : 'Exjobb, praktik och jobb hos bolagen i inkubatorn'}
      body={
        student
          ? 'Sorterat efter hur väl uppdragen matchar dina hashtags och vad du söker. Sök direkt — bolaget ser din profil först då.'
          : 'Startups i inkubatorn söker studenter för examensarbeten, praktik, deltidsjobb och anställning. Skapa en profil så matchas du mot nya uppdrag och kan bli föreslagen av bolagen.'
      }
    >
      {borttagen ? (
        <PublicCard>
          <p style={{ margin: 0 }}>Din profil är borttagen. Tack för den här gången — du är välkommen tillbaka när som helst.</p>
        </PublicCard>
      ) : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link href={base} className={`mx-btn mx-sm${!kindFilter ? ' mx-primary' : ''}`}>
          Alla
        </Link>
        {(Object.keys(TALENT_NEED_KIND_LABELS) as Array<keyof typeof TALENT_NEED_KIND_LABELS>).map((k) => (
          <Link key={k} href={`${base}?typ=${k}`} className={`mx-btn mx-sm${kindFilter === k ? ' mx-primary' : ''}`}>
            {TALENT_NEED_KIND_LABELS[k]}
          </Link>
        ))}
      </div>
      {error ? (
        <PublicCard>
          <p style={{ margin: 0 }}>{error}</p>
        </PublicCard>
      ) : ordered.length === 0 ? (
        <PublicCard>
          <p style={{ margin: 0 }}>Inga publicerade uppdrag just nu. Skapa en profil så kan bolagen hitta dig när något dyker upp.</p>
        </PublicCard>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {ordered.map(({ need, matched, reasons }) => (
            <Link key={need.id} href={`${base}/behov/${need.id}`} className="mx-compass-card" style={{ display: 'grid', gap: 10, textDecoration: 'none' }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="mx-chip mx-purple">{TALENT_NEED_KIND_LABELS[need.kind]}</span>
                <span className="mx-t-sm mx-muted">{need.company}</span>
                {need.deadline ? <span className="mx-t-sm mx-muted">· sök senast {need.deadline}</span> : null}
              </div>
              <h2 className="mx-disp" style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--mx-ink)' }}>
                {need.title}
              </h2>
              <p className="mx-muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
                {need.description.length > 220 ? `${need.description.slice(0, 220)}…` : need.description}
              </p>
              <TagRow tags={need.tags} labels={labels} highlight={matched} />
              <div className="mx-t-sm mx-muted" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span>{need.period}</span>
                {need.location ? <span>{need.location}</span> : null}
                <span>{TALENT_WORK_MODE_LABELS[need.work_mode]}</span>
                <span>{TALENT_COMPENSATION_LABELS[need.compensation]}</span>
                {reasons.length > 0 ? <span style={{ color: 'var(--mx-accent)' }}>{reasons.join(' · ')}</span> : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </TalentPublicShell>
  );
}
