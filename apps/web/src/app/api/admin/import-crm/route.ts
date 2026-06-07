import { NextResponse } from 'next/server';
import {
  analyzeImportAction,
  previewImportAction,
  commitImportAction
} from '@/lib/actions/import-general';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
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