import { requireUser } from '@/lib/auth.server';
import { PageShell } from '@/components/PageShell';
import { listFilesAction } from '@/lib/actions/files';
import FilesList from './FilesList';

export default async function FilerPage() {
  await requireUser();
  const files = await listFilesAction();

  return (
    <PageShell title="Filer">
      <FilesList initialFiles={files} />
    </PageShell>
  );
}
