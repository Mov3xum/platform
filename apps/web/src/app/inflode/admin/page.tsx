import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function InflowAdminIndexPage() {
  redirect('/inflode/admin/modules');
}
