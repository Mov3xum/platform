import { requireUser } from '@/lib/auth.server';
import { PageHead } from '@/components/proto';

export default async function CommunityPage() {
  await requireUser();
  return (
    <div className="mx-view-pad mx-wide">
      <PageHead crumb="Hemmaplan / Community" title="Community & alumni" subtitle="Laddar..." />
    </div>
  );
}
