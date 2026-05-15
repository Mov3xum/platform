import { requireUser } from '@/lib/auth.server';
import { PageHead } from '@/components/proto';

export default async function UppdragPage() {
  await requireUser();
  return (
    <div className="mx-view-pad mx-wide">
      <PageHead crumb="Hemmaplan / Uppdrag & flöden" title="Uppdrag & flöden" subtitle="Laddar..." />
    </div>
  );
}
