import { requireUser } from '@/lib/auth.server';
import { PageHead } from '@/components/proto';

export default async function KompassenPage() {
  await requireUser();
  return (
    <div className="mx-view-pad mx-wide">
      <PageHead crumb="Hemmaplan / Startupkompassen" title="Startupkompassen" subtitle="Laddar..." />
    </div>
  );
}
