import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import {
  analyzeImportAction,
  previewImportAction,
  commitImportAction
} from '@/lib/actions/import-general';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  // Explicit gate i routen (defense-in-depth ovanpå requireAdmin i actions):
  // en oautentiserad/obehörig POST ska aldrig ens läsa in filen.
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ status: 'error', message: 'Inloggning krävs.' }, { status: 401 });
  if (!hasRole(user.roles, ['admin'])) {
    return NextResponse.json({ status: 'error', message: 'Endast administratörer får köra importer.' }, { status: 403 });
  }
  const formData = await req.formData();
  const action = String(formData.get('action') || '');

  if (action === 'analyze') {
    return NextResponse.json(await analyzeImportAction(formData));
  }
  if (action === 'preview') {
    return NextResponse.json(await previewImportAction(formData));
  }
  if (action === 'commit') {
    return NextResponse.json(await commitImportAction(formData));
  }

  return NextResponse.json({ status: 'error', message: 'Okänd importåtgärd.' }, { status: 400 });
}