import { requireUser } from '@/lib/auth.server';
import { PageHead } from '@/components/proto';

export default async function EventsPage() {
  await requireUser();
  return (
    <div className="mx-view-pad mx-wide">
      <PageHead crumb="Hemmaplan / Events" title="Events" subtitle="Laddar..." />
    </div>
  );
}
