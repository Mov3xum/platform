import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { escFilter } from '@/lib/pb-filter';
import { canManageStartupDeMinimis, loadRegelverk } from '@/lib/de-minimis/data';
import { buildForsakranPdf } from '@/lib/de-minimis/forsakran-pdf';
import { safeFilename } from '@/lib/documents/brand';
import type { DeMinimisStod, DeMinimisUnit, DeMinimisUnitOrgnr } from '@platform/shared';

// Genererar en de minimis-försäkran (PDF) för en enhet. Auth + tenant-
// isolation speglar server-actions: staff eller länkad bolagsmedlem.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ unitId: string }> }
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Ej inloggad.' }, { status: 401 });

  const { unitId } = await params;
  const pb = await getServerPb();

  let unit: DeMinimisUnit;
  try {
    unit = await pb.collection(PB_COLLECTIONS.deMinimisUnits).getOne<DeMinimisUnit>(unitId, {
      expand: 'startup'
    });
  } catch {
    return NextResponse.json({ error: 'Enheten hittades inte.' }, { status: 404 });
  }
  if (String(unit.tenant) !== user.tenant) {
    return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });
  }
  const startupId = String(unit.startup);
  if (!canManageStartupDeMinimis(user, startupId)) {
    return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });
  }

  const expand = (unit as DeMinimisUnit & { expand?: { startup?: { name?: string } } }).expand;
  const startupName = expand?.startup?.name || unit.namn || 'Bolaget';

  let orgnrList: string[] = [];
  let stod: DeMinimisStod[] = [];
  try {
    const orgnrRows = await pb
      .collection(PB_COLLECTIONS.deMinimisUnitOrgnr)
      .getFullList<DeMinimisUnitOrgnr>({ filter: `unit = "${escFilter(unitId)}"` });
    orgnrList = orgnrRows.map((r) => r.organisationsnummer).filter(Boolean);

    stod = await pb
      .collection(PB_COLLECTIONS.deMinimisStod)
      .getFullList<DeMinimisStod>({ filter: `unit = "${escFilter(unitId)}"`, sort: 'beslutsdatum' });
  } catch (err) {
    console.error('[de-minimis/forsakran] load failed', {
      tenantId: user.tenant,
      unitId,
      message: err instanceof Error ? err.message : String(err ?? '')
    });
    return NextResponse.json({ error: 'Kunde inte läsa enhetens data.' }, { status: 500 });
  }

  const regelverk = await loadRegelverk(pb);

  let buffer: Buffer;
  try {
    buffer = await buildForsakranPdf({
      startupName,
      unitNamn: unit.namn,
      orgnrList,
      stod,
      regelverk
    });
  } catch (err) {
    console.error('[de-minimis/forsakran] render failed', {
      tenantId: user.tenant,
      unitId,
      message: err instanceof Error ? err.message : String(err ?? '')
    });
    return NextResponse.json({ error: 'Kunde inte generera försäkran.' }, { status: 500 });
  }

  const filename = safeFilename(`de-minimis-forsakran-${startupName}`, 'pdf');
  const headers = new Headers();
  headers.set('Content-Type', 'application/pdf');
  headers.set('Content-Length', String(buffer.length));
  const asciiName = filename.replace(/[^\x20-\x7e]/g, '_');
  headers.set(
    'Content-Disposition',
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  headers.set('Cache-Control', 'private, no-store');

  return new Response(new Uint8Array(buffer), { status: 200, headers });
}
