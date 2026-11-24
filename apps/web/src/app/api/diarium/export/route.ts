import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { RECORD_DIRECTION_LABELS, REGISTER_VIA_LABELS, registerCsvCell, type RecordDirection, type RegisterVia } from '@platform/shared';
import { registerFilterExpr } from '@/lib/register/data';

export const dynamic = 'force-dynamic';

const MAX_ROWS = 20_000;

/**
 * Diariet som CSV (CLAUDE.md § 60) — underlag vid granskning och för
 * leverans till e-arkiv. Läser med användarens token (RLS), speglar listans
 * filter. Semikolon + BOM (svensk Excel); formel-injektion neutraliseras.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Inte inloggad.' }, { status: 401 });
  if (!canAccessModuleForUser(user.roles, 'diarium', user.enabledModules)) return NextResponse.json({ error: 'Ingen åtkomst.' }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const pb = await getServerPb();
  const filter = registerFilterExpr(pb, user.tenant, {
    q: sp.get('q') ?? '',
    year: sp.get('ar') ?? '',
    type: sp.get('typ') ?? '',
    direction: sp.get('riktning') ?? '',
    secrecy: sp.get('sekretess') === '1'
  });
  type Row = Record<string, unknown> & { expand?: { register_case?: Record<string, unknown> } };
  const rows: Row[] = [];
  let truncated = false;
  try {
    for (let page = 1; ; page++) {
      const res = await pb.collection('register_entries').getList<Row>(page, 500, { filter, sort: 'designation', expand: 'register_case' });
      rows.push(...res.items);
      if (res.items.length === 0 || rows.length >= res.totalItems) break;
      if (rows.length >= MAX_ROWS) {
        truncated = true;
        break;
      }
    }
  } catch {
    return NextResponse.json({ error: 'Diariet kunde inte läsas.' }, { status: 500 });
  }
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  const header = ['Diarienummer', 'Ärende', 'Ärendemening', 'Registrerad', 'Handlingens datum', 'Riktning', 'Handlingstyp', 'Handling', 'Från/till', 'Sekretess', 'Lagrum', 'Bevara/gallra', 'Frist (mån)', 'Registrerad via', 'Makulerad', 'Kontrollsumma'];
  const lines = [header.map(registerCsvCell).join(';')];
  for (const r of rows) {
    const c = r.expand?.register_case ?? {};
    lines.push(
      [
        s(r.designation),
        s(c.number),
        s(c.title),
        s(r.registered_at).slice(0, 10),
        s(r.document_date).slice(0, 10),
        RECORD_DIRECTION_LABELS[s(r.direction) as RecordDirection] ?? s(r.direction),
        s(r.type_label) || s(r.type_key),
        s(r.title),
        s(r.counterpart),
        r.secrecy === true ? 'Ja' : 'Nej',
        s(r.secrecy_basis),
        s(r.retention) === 'dispose' ? 'Gallras' : 'Bevaras',
        typeof r.retention_months === 'number' && r.retention_months > 0 ? String(r.retention_months) : '',
        REGISTER_VIA_LABELS[s(r.via) as RegisterVia] ?? s(r.via),
        s(r.voided_at) ? `Ja: ${s(r.void_reason)}` : '',
        s(r.content_hash)
      ]
        .map(registerCsvCell)
        .join(';')
    );
  }
  if (truncated) lines.push(registerCsvCell(`OBS: exporten är kapad vid ${MAX_ROWS} rader — filtrera per år.`));
  console.info('[register] export', { tenant: user.tenant, rows: rows.length, truncated });
  return new NextResponse(`﻿${lines.join('\r\n')}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="diarium-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store'
    }
  });
}
