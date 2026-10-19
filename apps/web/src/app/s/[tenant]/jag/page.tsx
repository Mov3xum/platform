import type { Metadata } from 'next';
import Link from 'next/link';
import { STUDENT_LEVEL_LABELS, TALENT_INTEREST_STATUS_LABELS, TALENT_NEED_KIND_LABELS } from '@platform/shared';
import { listInterests, getNeed, type TalentNeedRow } from '@/lib/talent/data';
import { tagLabel } from '@/lib/talent/public';
import { isStudentTokenShape } from '@/lib/talent/student-session';
import { RespondButtons } from '@/components/talent/InterestForm';
import { StudentSelfActions } from '@/components/talent/StudentSelfActions';
import { loadTalentPublic } from '../_data';
import { PublicCard, TagRow, TalentPublicShell } from '../_shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Min sida', robots: { index: false } };

/**
 * Studentens egen sida (§ 54). Med `?t=<token>` visas BARA en knapp som
 * POST:ar tokenen till sessionsrouten — mejlskannrar som förhandsläser
 * länken loggar aldrig in åt studenten (§ 53.5-mönstret).
 */
export default async function StudentHomePage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ t?: string; klart?: string }> }) {
  const { tenant } = await params;
  const { t, klart } = await searchParams;
  const { resolved, branding, student, vocabulary } = await loadTalentPublic(tenant);
  const base = `/s/${encodeURIComponent(resolved.tenant.slug)}`;
  const labels = (slug: string) => tagLabel(vocabulary, slug);

  if (!student) {
    const validToken = isStudentTokenShape(t);
    return (
      <TalentPublicShell tenant={resolved.tenant} branding={branding} student={null} active="jag" title={validToken ? 'Bekräfta och öppna min sida' : 'Min sida'}>
        <PublicCard>
          {validToken ? (
            <form method="post" action={`/api/public/s/${encodeURIComponent(resolved.tenant.slug)}/session`} style={{ display: 'grid', gap: 10 }}>
              <input type="hidden" name="t" value={t} />
              <p style={{ margin: 0, fontSize: 14, color: 'var(--mx-muted)' }}>Tryck på knappen för att bekräfta din e-post och logga in i den här webbläsaren (30 dagar).</p>
              <div>
                <button type="submit" className="mx-btn mx-primary mx-lg">
                  Fortsätt till min sida
                </button>
              </div>
            </form>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--mx-muted)' }}>Du är inte inloggad. Be om en ny inloggningslänk eller skapa en profil.</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Link href={`${base}/logga-in`} className="mx-btn mx-primary">
                  Logga in
                </Link>
                <Link href={`${base}/registrera`} className="mx-btn">
                  Skapa profil
                </Link>
              </div>
            </div>
          )}
        </PublicCard>
      </TalentPublicShell>
    );
  }

  const interests = await listInterests(resolved.pb, resolved.tenant.id, { student: student.id });
  const needs = new Map<string, TalentNeedRow>();
  await Promise.all(
    interests.items.map(async (i) => {
      const n = await getNeed(resolved.pb, resolved.tenant.id, i.need);
      if (n) needs.set(i.need, n);
    })
  );
  const companyOf = (n: TalentNeedRow | undefined) => (!n ? 'Bolag' : n.anonymous ? 'Ett bolag i inkubatorn' : n.startupName ?? 'Ett bolag i inkubatorn');
  const open = interests.items.filter((i) => i.status !== 'declined' && i.status !== 'withdrawn');
  const closed = interests.items.filter((i) => i.status === 'declined' || i.status === 'withdrawn');

  return (
    <TalentPublicShell tenant={resolved.tenant} branding={branding} student={student} active="jag" title={`Hej ${student.first_name}!`} body={klart ? 'Din e-post är bekräftad och profilen är aktiv.' : undefined}>
      {student.status === 'pending' ? (
        <PublicCard>
          <p style={{ margin: 0 }}>Din e-post är inte bekräftad än — använd länken i mejlet. Först då kan bolag se din profil.</p>
        </PublicCard>
      ) : null}
      <PublicCard title="Pågående">
        {open.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: 'var(--mx-muted)' }}>
            Inga pågående kontakter. <Link href={base}>Se uppdragen</Link> och sök dem som passar.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
            {open.map((i) => {
              const n = needs.get(i.need);
              return (
                <li key={i.id} style={{ display: 'grid', gap: 8, paddingBottom: 12, borderBottom: '1px solid var(--mx-line-soft)' }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className={`mx-chip ${i.status === 'matched' ? 'mx-active' : i.status === 'proposed' ? 'mx-purple' : 'mx-done'}`}>{TALENT_INTEREST_STATUS_LABELS[i.status]}</span>
                    <span className="mx-t-sm mx-muted">{companyOf(n)}</span>
                  </div>
                  <Link href={`${base}/behov/${i.need}`} className="mx-disp" style={{ fontSize: 17, fontWeight: 700, color: 'var(--mx-ink)', textDecoration: 'none' }}>
                    {n?.title ?? 'Behovet är inte längre publicerat'}
                  </Link>
                  {n ? <span className="mx-t-sm mx-muted">{TALENT_NEED_KIND_LABELS[n.kind]}</span> : null}
                  {i.status === 'proposed' && i.message ? (
                    <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>
                      <strong>Hälsning från bolaget:</strong> {i.message}
                    </p>
                  ) : null}
                  {i.status === 'proposed' ? (
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--mx-muted)' }}>Bolaget har inte sett ditt namn eller dina kontaktuppgifter. Tackar du ja får de se din profil och hör av sig.</p>
                  ) : null}
                  <RespondButtons tenantSlug={resolved.tenant.slug} interestId={i.id} status={i.status} />
                </li>
              );
            })}
          </ul>
        )}
      </PublicCard>
      {closed.length > 0 ? (
        <PublicCard title="Avslutade">
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, fontSize: 14 }}>
            {closed.map((i) => (
              <li key={i.id}>
                <span className="mx-chip mx-archive">{TALENT_INTEREST_STATUS_LABELS[i.status]}</span> {needs.get(i.need)?.title ?? 'Behov'} · {companyOf(needs.get(i.need))}
              </li>
            ))}
          </ul>
        </PublicCard>
      ) : null}
      <PublicCard title="Min profil">
        <div style={{ display: 'grid', gap: 8, fontSize: 14 }}>
          <div>
            <strong>
              {student.first_name} {student.last_name}
            </strong>{' '}
            · {student.email}
          </div>
          <div className="mx-muted">
            {[student.program, student.university, STUDENT_LEVEL_LABELS[student.level], student.graduation_year ? `examen ${student.graduation_year}` : null].filter(Boolean).join(' · ')}
          </div>
          <div className="mx-muted">
            Söker: {student.seeking.map((k) => TALENT_NEED_KIND_LABELS[k]).join(', ') || '–'} · {student.searchable ? 'Sökbar för bolagen (anonymt)' : 'Inte sökbar'}
          </div>
          <TagRow tags={student.tags.map((t) => t.tag)} labels={labels} />
          {student.summary ? <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{student.summary}</p> : null}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href={`${base}/jag/redigera`} className="mx-btn mx-primary mx-sm">
              Redigera profilen
            </Link>
            <form method="post" action={`/api/public/s/${encodeURIComponent(resolved.tenant.slug)}/session`}>
              <input type="hidden" name="logout" value="1" />
              <button type="submit" className="mx-btn mx-sm">
                Logga ut
              </button>
            </form>
          </div>
        </div>
        <StudentSelfActions tenantSlug={resolved.tenant.slug} status={student.status} expiresAt={student.expires_at} />
      </PublicCard>
    </TalentPublicShell>
  );
}
