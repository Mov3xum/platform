import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { PageHead, Card, CardHead, Chip, Icon, Meta, Avatar } from '@/components/proto';
import { deleteAlumniFormAction } from '@/lib/actions/community';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import type { Alumni, AlumniTag } from '@platform/shared';

type AvatarAccent = 'ink' | 'green' | 'purple' | 'brown' | 'copper' | 'yellow' | 'cyan';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function alumniTagChip(
  tag: AlumniTag
): { variant: 'done' | 'green' | 'active' | 'review' | 'archive'; label: string } {
  switch (tag) {
    case 'exit':
      return { variant: 'done', label: 'Exit' };
    case 'scale':
      return { variant: 'green', label: 'Scale' };
    case 'active':
      return { variant: 'active', label: 'Aktiv' };
    case 'mentor':
      return { variant: 'review', label: 'Mentor' };
    case 'paused':
      return { variant: 'archive', label: 'Pausad' };
  }
}

export default async function AlumniDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) {
    redirect('/community');
  }

  const pb = await getServerPb();
  let alumni: Alumni | null = null;
  try {
    alumni = await pb.collection(PB_COLLECTIONS.alumni).getOne<Alumni>(id);
  } catch {
    notFound();
  }
  if (!alumni || alumni.tenant !== user.tenant) notFound();

  const canEdit = hasRole(user.roles, ['admin', 'incubator_lead']);
  const tagChip = alumniTagChip(alumni.tag);
  const accent: AvatarAccent = (alumni.accent as AvatarAccent) || 'green';

  return (
    <div className="mx-view-pad mx-wide">
      <PageHead
        crumb={`Community / ${alumni.name}`}
        title={alumni.name}
        subtitle={alumni.company || (alumni.exit_year ? `Exit ${alumni.exit_year}` : 'Alumni')}
        actions={
          <>
            <Link href="/community" className="mx-btn">
              <Icon name="chevron" size={13} style={{ transform: 'rotate(180deg)' }} /> Tillbaka
            </Link>
            {canEdit && (
              <>
                <Link href={`/community/${alumni.id}/edit`} className="mx-btn">
                  Redigera
                </Link>
                <ConfirmDeleteButton
                  action={deleteAlumniFormAction}
                  hiddenField={{ name: 'alumni_id', value: alumni.id }}
                  label="Radera"
                  variant="ghost"
                  description={`Radera "${alumni.name}"? Detta går inte att ångra.`}
                />
              </>
            )}
          </>
        }
      />

      <Card style={{ padding: 20, marginTop: 12 }}>
        <div className="mx-flex mx-items-c mx-gap-3" style={{ flexWrap: 'wrap', gap: 24 }}>
          <Avatar initial={initials(alumni.name)} size="lg" accent={accent} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mx-flex mx-items-c mx-gap-2" style={{ flexWrap: 'wrap' }}>
              <Chip variant={tagChip.variant} mono>
                {tagChip.label}
              </Chip>
              {alumni.active_mentor && (
                <Chip variant="green" mono>
                  Mentor aktiv
                </Chip>
              )}
            </div>
            <div
              className="mx-flex mx-items-c"
              style={{ flexWrap: 'wrap', gap: 24, marginTop: 12 }}
            >
              {alumni.company && (
                <Meta label="Företag" value={<span className="mx-t-13 mx-fw-6">{alumni.company}</span>} />
              )}
              {alumni.exit_year && (
                <Meta
                  label="Exit-år"
                  value={<span className="mx-mono mx-fw-6 mx-t-13">{alumni.exit_year}</span>}
                />
              )}
              {alumni.contact_email && (
                <Meta
                  label="Kontakt"
                  value={
                    <a
                      href={`mailto:${alumni.contact_email}`}
                      className="mx-t-13 mx-fw-6"
                      style={{ color: 'var(--color-link)' }}
                    >
                      {alumni.contact_email}
                    </a>
                  }
                />
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card style={{ padding: 0, marginTop: 12, overflow: 'hidden' }}>
        <CardHead label="Bio" />
        <div style={{ padding: 16 }}>
          {alumni.bio ? (
            <div
              className="mx-t-13"
              style={{ whiteSpace: 'pre-wrap' }}
              dangerouslySetInnerHTML={{ __html: alumni.bio }}
            />
          ) : (
            <div className="mx-muted mx-t-13">Ingen bio tillagd ännu.</div>
          )}
        </div>
      </Card>
    </div>
  );
}
