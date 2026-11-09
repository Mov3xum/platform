import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TALENT_COMPENSATION_LABELS, TALENT_NEED_KIND_LABELS, TALENT_WORK_MODE_LABELS, scoreTalentPair } from '@platform/shared';
import { getPublishedNeed, tagLabel } from '@/lib/talent/public';
import { listInterests } from '@/lib/talent/data';
import { ApplyForm } from '@/components/talent/InterestForm';
import { loadTalentPublic } from '../../_data';
import { PublicCard, TagRow, TalentPublicShell } from '../../_shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false } };

/** Ett publicerat behov med ansökningsformulär (§ 54). */
export default async function PublicNeedPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params;
  const { resolved, branding, student, vocabulary } = await loadTalentPublic(tenant);
  const found = await getPublishedNeed(resolved, id);
  if (!found) notFound();
  const { need, view } = found;
  const base = `/s/${encodeURIComponent(resolved.tenant.slug)}`;
  const labels = (slug: string) => tagLabel(vocabulary, slug);
  const match = student ? scoreTalentPair({ ...need }, student) : null;
  const existing = student ? (await listInterests(resolved.pb, resolved.tenant.id, { need: need.id, student: student.id })).items[0] ?? null : null;

  return (
    <TalentPublicShell tenant={resolved.tenant} branding={branding} student={student} active="behov" eyebrow={`${TALENT_NEED_KIND_LABELS[view.kind].toUpperCase()} · ${view.company.toUpperCase()}`} title={view.title}>
      <PublicCard>
        <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: 1.6, color: 'var(--mx-ink)' }}>{view.description}</p>
        <dl style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', margin: 0, fontSize: 14 }}>
          <div>
            <dt className="mx-label">Period</dt>
            <dd style={{ margin: 0 }}>{view.period}</dd>
          </div>
          {view.scope ? (
            <div>
              <dt className="mx-label">Omfattning</dt>
              <dd style={{ margin: 0 }}>{view.scope}</dd>
            </div>
          ) : null}
          <div>
            <dt className="mx-label">Plats</dt>
            <dd style={{ margin: 0 }}>
              {view.location || 'Ej angiven'} · {TALENT_WORK_MODE_LABELS[view.work_mode]}
            </dd>
          </div>
          <div>
            <dt className="mx-label">Ersättning</dt>
            <dd style={{ margin: 0 }}>
              {TALENT_COMPENSATION_LABELS[view.compensation]}
              {view.compensation_note ? ` — ${view.compensation_note}` : ''}
            </dd>
          </div>
          <div>
            <dt className="mx-label">Handledning</dt>
            <dd style={{ margin: 0 }}>{view.supervisor ? 'Handledare finns på bolaget' : 'Ej angivet'}</dd>
          </div>
          {view.deadline ? (
            <div>
              <dt className="mx-label">Sök senast</dt>
              <dd style={{ margin: 0 }}>{view.deadline}</dd>
            </div>
          ) : null}
        </dl>
        <div>
          <span className="mx-label">Efterfrågade hashtags</span>
          <TagRow tags={view.tags} labels={labels} highlight={match ? new Set(match.matchedTags) : undefined} />
          {match ? (
            <p className="mx-t-sm" style={{ margin: '8px 0 0', color: 'var(--mx-accent)' }}>
              Din matchning: {match.reasons.join(' · ')}
            </p>
          ) : null}
        </div>
      </PublicCard>
      <PublicCard title={student ? 'Sök uppdraget' : 'Intresserad?'}>
        {student ? (
          <ApplyForm tenantSlug={resolved.tenant.slug} needId={need.id} company={view.company} existing={existing?.status ?? null} />
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--mx-muted)' }}>Skapa en profil (tar två minuter) eller logga in för att söka. Bolaget ser din profil först när du själv söker.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link href={`${base}/registrera`} className="mx-btn mx-primary">
                Skapa profil
              </Link>
              <Link href={`${base}/logga-in`} className="mx-btn">
                Logga in
              </Link>
            </div>
          </div>
        )}
      </PublicCard>
      <Link href={base} className="mx-t-sm" style={{ color: 'var(--mx-accent)' }}>
        ← Alla uppdrag
      </Link>
    </TalentPublicShell>
  );
}
