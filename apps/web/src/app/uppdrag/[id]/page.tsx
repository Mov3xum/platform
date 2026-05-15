// Movexum OS — Uppdrag detalj
// Visar fullt flöde + artefakter + AI-förslag för ett enskilt uppdrag.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { PageHead, Icon } from '@/components/proto';
import { MissionFlow } from '@/components/MissionFlow';
import type { Mission } from '@platform/shared';

export default async function MissionDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const pb = await getServerPb();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);

  let mission: Mission | null = null;
  try {
    mission = await pb.collection(PB_COLLECTIONS.missions).getOne<Mission>(id, {
      expand: 'issuer,recipients,mentor,startup'
    });
  } catch {
    notFound();
  }
  if (!mission) notFound();
  if (mission.tenant !== user.tenant) redirect('/uppdrag');

  const canAdvance = isStaff || mission.recipients.includes(user.id);

  return (
    <div
      className="mx-view-pad mx-wide"
      style={{ padding: '20px 24px 0', display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <PageHead
        crumb="Hemmaplan / Uppdrag & flöden / Detalj"
        title={mission.title}
        subtitle={`Uppdrags-ID ${mission.id.slice(0, 8)} · ${mission.type.replace('_', ' ')}`}
        actions={
          <>
            <Link href="/uppdrag" className="mx-btn mx-sm mx-ghost">
              <Icon name="arrow" size={12} /> Alla uppdrag
            </Link>
            <Link
              href={{ pathname: '/uppdrag', query: { m: mission.id } }}
              className="mx-btn mx-sm"
            >
              Öppna i flödesvy
            </Link>
          </>
        }
      />

      <div style={{ maxWidth: 960 }}>
        <MissionFlow mission={mission} currentUserId={user.id} canAdvance={canAdvance} />
      </div>
    </div>
  );
}
