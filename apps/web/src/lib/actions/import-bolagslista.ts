'use server';

import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { revalidatePath } from 'next/cache';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { parseXlsx } from '@/lib/import/xlsx';
import {
  parseBolagslista,
  parseBolagslistaNormalized,
  detectNormalizedSheets,
  type CompanyImport,
  type FinancialRow
} from '@/lib/import/bolagslista';
import { escFilter } from '@/lib/pb-filter';
import { recordActivity } from './record-activity';

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream' // browsers may send this for .xlsx — vi verifierar magic bytes
]);

// Magic bytes för en ZIP-fil (XLSX är en zip).
function isZipMagic(buf: Buffer): boolean {
  return (
    buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05)
  );
}

export interface BolagslistaPreviewSummary {
  totalCompanies: number;
  totalFinancialRows: number;
  yearRange: { min: number; max: number };
  warnings: string[]; // PII-fria, säkert att visa
  // Lättviktig kontrollsumma — låter användaren bekräfta innan commit
  // att rätt data hittats. Beräknas över alla parsade companies.
  checksums: {
    revenue2023Sek: number;
    employees2023: number;
    revenue2022Sek: number;
    employees2022: number;
  };
}

export type PreviewState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'ok'; summary: BolagslistaPreviewSummary };

export type CommitState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'ok';
      summary: BolagslistaPreviewSummary;
      result: {
        startupsCreated: number;
        startupsUpdated: number;
        financialsCreated: number;
        financialsUpdated: number;
        skipped: number;
      };
    };

function checksumForYear(
  companies: CompanyImport[],
  year: number
): { revenue: number; employees: number } {
  let revenue = 0;
  let employees = 0;
  for (const c of companies) {
    for (const f of c.financials) {
      if (f.year === year) {
        if (f.revenue_sek) revenue += f.revenue_sek;
        if (f.employees) employees += f.employees;
      }
    }
  }
  return { revenue, employees };
}

function summarize(parse: ReturnType<typeof parseBolagslista>): BolagslistaPreviewSummary {
  const totalFinancialRows = parse.companies.reduce((acc, c) => acc + c.financials.length, 0);
  const cs2023 = checksumForYear(parse.companies, 2023);
  const cs2022 = checksumForYear(parse.companies, 2022);
  return {
    totalCompanies: parse.companies.length,
    totalFinancialRows,
    yearRange: parse.yearRange,
    warnings: parse.warnings,
    checksums: {
      revenue2023Sek: cs2023.revenue,
      employees2023: cs2023.employees,
      revenue2022Sek: cs2022.revenue,
      employees2022: cs2022.employees
    }
  };
}

async function readUploadedFile(formData: FormData): Promise<
  | { ok: true; buf: Buffer }
  | { ok: false; message: string }
> {
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return { ok: false, message: 'Ingen fil bifogad.' };
  }
  if (file.size === 0) {
    return { ok: false, message: 'Filen är tom.' };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, message: `Filen är större än ${MAX_FILE_BYTES / 1024 / 1024} MB.` };
  }
  if (file.type && !ALLOWED_MIMES.has(file.type)) {
    return {
      ok: false,
      message: `Filtyp "${file.type}" stöds inte. Förväntar .xlsx (OOXML).`
    };
  }
  const ab = await file.arrayBuffer();
  const buf = Buffer.from(ab);
  if (!isZipMagic(buf)) {
    return { ok: false, message: 'Filen ser inte ut som en .xlsx (ZIP-magic saknas).' };
  }
  return { ok: true, buf };
}

function parseUpload(buf: Buffer): {
  parse: ReturnType<typeof parseBolagslista>;
  error?: string;
} {
  let xlsx;
  try {
    xlsx = parseXlsx(buf);
  } catch (err) {
    return {
      parse: { companies: [], warnings: [], yearRange: { min: 0, max: 0 } },
      error: err instanceof Error ? err.message : 'Kunde inte läsa XLSX-filen.'
    };
  }
  // Föredra den normaliserade layouten (Bolag- + Ekonomi per år-flikar).
  // Den bär relationen explicit (org-nr/namn + exakt år per rad), så
  // bolag utan giltigt org-nr (enskilda firmor) följer med via namn och
  // ekonomiraderna behåller sina exakta år — inga flytande öar.
  const normalized = detectNormalizedSheets(xlsx.sheets);
  if (normalized) {
    const parsed = parseBolagslistaNormalized(normalized.bolag, normalized.ekonomi);
    if (parsed.companies.length > 0) {
      return { parse: parsed };
    }
  }

  // Annars: bred/denormaliserad layout. Hitta första sheeten som ser ut
  // som "Bolagslista" — annars använd den flik som ger flest bolag.
  let rows = xlsx.sheets.get('Bolagslista');
  if (!rows) {
    // Försök alla sheets, ta den som ger flest detekterade bolag.
    let best: { name: string; result: ReturnType<typeof parseBolagslista> } | null = null;
    for (const [name, r] of xlsx.sheets) {
      const parsed = parseBolagslista(r);
      if (!best || parsed.companies.length > best.result.companies.length) {
        best = { name, result: parsed };
      }
    }
    if (best && best.result.companies.length > 0) {
      return { parse: best.result };
    }
    return {
      parse: { companies: [], warnings: [], yearRange: { min: 0, max: 0 } },
      error: 'Hittade ingen Bolagslista-flik. Filen verkar inte vara Movexums Bolagslista.'
    };
  }
  const parsed = parseBolagslista(rows);
  if (parsed.companies.length === 0) {
    return {
      parse: parsed,
      error:
        'Hittade headers men kunde inte mappa några bolag. Kontrollera att kolumnerna Bolag / Org.nr / Status finns på rad 3.'
    };
  }
  return { parse: parsed };
}

export async function previewImportBolagslistaAction(
  _prev: PreviewState,
  formData: FormData
): Promise<PreviewState> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    return { status: 'error', message: 'Endast inkubatorledning får köra importer.' };
  }
  const upload = await readUploadedFile(formData);
  if (!upload.ok) return { status: 'error', message: upload.message };
  const { parse, error } = parseUpload(upload.buf);
  if (error) return { status: 'error', message: error };
  return { status: 'ok', summary: summarize(parse) };
}

export async function commitImportBolagslistaAction(
  _prev: CommitState,
  formData: FormData
): Promise<CommitState> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    return { status: 'error', message: 'Endast inkubatorledning får köra importer.' };
  }

  const upload = await readUploadedFile(formData);
  if (!upload.ok) return { status: 'error', message: upload.message };
  const { parse, error } = parseUpload(upload.buf);
  if (error) return { status: 'error', message: error };

  const summary = summarize(parse);

  const adminResult = await getSuperuserPb();
  if (!adminResult.ok) {
    return {
      status: 'error',
      message:
        adminResult.reason === 'missing_credentials'
          ? 'Superuser-credentials saknas på servern.'
          : 'Superuser-autentisering misslyckades.'
    };
  }
  const pb = adminResult.pb;

  let startupsCreated = 0;
  let startupsUpdated = 0;
  let financialsCreated = 0;
  let financialsUpdated = 0;
  let skipped = 0;

  for (const company of parse.companies) {
    const orgNr = company.startup.org_nr;
    const name = company.startup.name;
    if (!orgNr && !name) {
      skipped++;
      continue;
    }

    // Upsert startups-raden. Uppslag på (tenant, org_nr) när org-nr är
    // giltigt; annars på (tenant, namn) för enskilda firmor/bolag utan
    // org-nr — så relationen till financials bevaras i stället för att
    // raden hoppas över. Det partiella unique-indexet på (tenant,
    // org_nr) gäller bara org_nr != '', så tomma org-nr kolliderar inte.
    let startupId: string;
    const filter = orgNr
      ? `tenant = "${escFilter(user.tenant)}" && org_nr = "${escFilter(orgNr)}"`
      : `tenant = "${escFilter(user.tenant)}" && name = "${escFilter(name)}" && org_nr = ""`;
    let existing: { id: string } | null = null;
    try {
      existing = await pb
        .collection('startups')
        .getFirstListItem<{ id: string }>(filter);
    } catch {
      existing = null;
    }

    const startupPayload: Record<string, unknown> = {
      tenant: user.tenant,
      name,
      status: company.startup.status,
      phase: 'idea' // default; ändras manuellt av staff vid behov
    };
    if (orgNr) startupPayload.org_nr = orgNr;
    if (company.startup.kommun) startupPayload.kommun = company.startup.kommun;
    if (company.startup.bolag_status) startupPayload.bolag_status = company.startup.bolag_status;
    if (company.startup.intagsdatum) startupPayload.intagsdatum = company.startup.intagsdatum;
    if (company.startup.avslutsdatum) startupPayload.avslutsdatum = company.startup.avslutsdatum;

    try {
      if (existing) {
        // Bevara fas och status om det redan finns ett kort (staff kan ha satt phase manuellt)
        delete startupPayload.phase;
        delete startupPayload.status;
        await pb.collection('startups').update(existing.id, startupPayload);
        startupId = existing.id;
        startupsUpdated++;
      } else {
        const created = await pb.collection('startups').create(startupPayload);
        startupId = created.id as string;
        startupsCreated++;
      }
    } catch (err) {
      console.error('[bolagslista:import] startup upsert failed', {
        orgNr,
        error: err instanceof Error ? err.message : 'unknown'
      });
      skipped++;
      continue;
    }

    // Upsert startup_financials per (startup, year)
    const syncedAt = new Date().toISOString();
    for (const f of company.financials) {
      const finFilter = `startup = "${startupId}" && year = ${f.year}`;
      let existingFin: { id: string } | null = null;
      try {
        existingFin = await pb
          .collection('startup_financials')
          .getFirstListItem<{ id: string }>(finFilter);
      } catch {
        existingFin = null;
      }
      const finPayload: Record<string, unknown> = {
        tenant: user.tenant,
        startup: startupId,
        year: f.year,
        source: 'import_excel',
        synced_at: syncedAt
      };
      if (f.employees !== null) finPayload.employees = f.employees;
      if (f.revenue_sek !== null) finPayload.revenue_sek = f.revenue_sek;
      if (f.personnel_cost_sek !== null) finPayload.personnel_cost_sek = f.personnel_cost_sek;
      if (f.corporate_tax_sek !== null) finPayload.corporate_tax_sek = f.corporate_tax_sek;

      try {
        if (existingFin) {
          await pb.collection('startup_financials').update(existingFin.id, finPayload);
          financialsUpdated++;
        } else {
          await pb.collection('startup_financials').create(finPayload);
          financialsCreated++;
        }
      } catch (err) {
        console.error('[bolagslista:import] financial upsert failed', {
          startupId,
          year: f.year,
          error: err instanceof Error ? err.message : 'unknown'
        });
        skipped++;
      }
    }
  }

  // Logga som aktivitet för audit-spår (ISO 27001 A.8.15, CLAUDE.md § 10.5.6).
  // PII-fri: ingen e-post eller filnamn, bara aggregerade siffror.
  await recordActivity(pb, {
    tenant: user.tenant,
    kind: 'integration_sync',
    actor: user.id,
    title: 'Bolagslista (Excel) — manuell import',
    meta: `${startupsCreated} bolag skapade, ${startupsUpdated} uppdaterade · ${financialsCreated} financial-rader skapade, ${financialsUpdated} uppdaterade · år ${parse.yearRange.min}–${parse.yearRange.max}${skipped > 0 ? ` · ${skipped} hoppade över` : ''}`
  });

  revalidatePath('/admin/import-bolagslista');
  revalidatePath('/startups');
  revalidatePath('/aktivitet');

  return {
    status: 'ok',
    summary,
    result: {
      startupsCreated,
      startupsUpdated,
      financialsCreated,
      financialsUpdated,
      skipped
    }
  };
}
