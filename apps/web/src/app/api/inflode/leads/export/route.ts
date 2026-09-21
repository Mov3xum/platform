import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { listLeadsForExport, listLeadSources, logSecurity } from '@/lib/compass/store';
import {
  LEAD_STATUS_LABEL,
  LEAD_STATUS_ORDER,
  type Lead,
  type LeadStatus
} from '@/lib/compass/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// CSV-export av leads för uppföljning och rapportering till intressenter/
// ägare. Staff-only (PII lämnar systemet) och varje export audit-loggas med
// `lead_export` (SecurityEventKind fanns redan provisionerad för detta).
// Semikolon-separerad + BOM så svensk Excel öppnar filen korrekt direkt.

const COLUMNS: { header: string; value: (l: Lead) => string | number | undefined }[] = [
  { header: 'Skapad', value: (l) => l.created?.slice(0, 16).replace('T', ' ') },
  { header: 'Namn', value: (l) => l.name },
  { header: 'E-post', value: (l) => l.email },
  { header: 'Telefon', value: (l) => l.phone },
  { header: 'Organisation', value: (l) => l.organization },
  { header: 'Status', value: (l) => LEAD_STATUS_LABEL[l.status] ?? l.status },
  { header: 'AI-poäng', value: (l) => l.score },
  { header: 'Källa', value: (l) => l.source_key },
  { header: 'Modul', value: (l) => l.landing_module },
  { header: 'Kategori', value: (l) => l.idea_category },
  { header: 'Idé', value: (l) => l.idea_summary },
  { header: 'Quizprofil', value: (l) => l.quiz_result_bucket },
  { header: 'Quizpoäng', value: (l) => l.quiz_score },
  { header: 'UTM source', value: (l) => l.utm_source },
  { header: 'UTM medium', value: (l) => l.utm_medium },
  { header: 'UTM kampanj', value: (l) => l.utm_campaign },
  { header: 'Konverterad till bolag', value: (l) => (l.converted_startup ? 'Ja' : '') },
  { header: 'Konverterad', value: (l) => l.converted_at?.slice(0, 10) },
  { header: 'Samtycke', value: (l) => l.consent_at?.slice(0, 10) }
];

/** Escapar en CSV-cell + neutraliserar formel-injection ("=cmd…" i Excel). */
function csvCell(raw: string | number | undefined): string {
  if (raw === undefined || raw === null) return '';
  let s = String(raw).replace(/\r?\n/g, ' ').trim();
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function isLeadStatus(v: unknown): v is LeadStatus {
  return typeof v === 'string' && (LEAD_STATUS_ORDER as readonly string[]).includes(v);
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor'])) {
    return new Response('Forbidden', { status: 403 });
  }

  const url = new URL(req.url);
  const statusRaw = url.searchParams.get('status') || undefined;
  const options = {
    status: isLeadStatus(statusRaw) ? statusRaw : undefined,
    q: url.searchParams.get('q')?.trim().slice(0, 200) || undefined,
    sourceKey: url.searchParams.get('src')?.trim().slice(0, 100) || undefined,
    landingModule: url.searchParams.get('landing')?.trim().slice(0, 100) || undefined,
    // Interna förhandsgranskningar hör inte hemma i intressentrapporter.
    // (Ett explicit src-filter vinner — då kan även previews exporteras.)
    excludePreview: true
  };

  const pb = await getServerPb();
  const [leads, sources] = await Promise.all([
    listLeadsForExport(pb, user.tenant, options),
    listLeadSources(pb)
  ]);
  const sourceLabel = new Map(sources.map((s) => [s.key, s.label]));

  const lines = [COLUMNS.map((c) => csvCell(c.header)).join(';')];
  for (const lead of leads) {
    lines.push(
      COLUMNS.map((c) => {
        if (c.header === 'Källa') {
          return csvCell(sourceLabel.get(lead.source_key) || lead.source_key);
        }
        return csvCell(c.value(lead));
      }).join(';')
    );
  }
  // BOM → svensk Excel tolkar UTF-8 (å/ä/ö) korrekt.
  const csv = `﻿${lines.join('\r\n')}`;

  // Audit: PII lämnar systemet (ISO 27001 A.8.15) — logga vem, hur många och
  // vilket filter. Innehåller inga personuppgifter i sig.
  await logSecurity(pb, user.tenant, {
    actor: user.id,
    kind: 'lead_export',
    meta: {
      count: leads.length,
      status: options.status,
      src: options.sourceKey,
      landing: options.landingModule,
      q: options.q ? '(sökfilter)' : undefined
    }
  });

  const today = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="startupkompassen-leads-${today}.csv"`,
      'Cache-Control': 'no-store'
    }
  });
}
