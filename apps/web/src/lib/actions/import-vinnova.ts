'use server';

import { revalidatePath } from 'next/cache';
import type PocketBase from 'pocketbase';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { escFilter } from '@/lib/pb-filter';
import { parseVinnovaImport, normalizeCompanyName, type VinnovaImportKind } from '@/lib/import/vinnova';

const STAFF: Array<'admin' | 'incubator_lead'> = ['admin', 'incubator_lead'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface VinnovaImportPreview {
  error?: string;
  kind?: VinnovaImportKind;
  matched?: number;
  unmatched?: string[];
  rowCount?: number;
  warnings?: string[];
}

export interface VinnovaImportCommit {
  error?: string;
  kind?: VinnovaImportKind;
  startupsUpdated?: number;
  aidPeriods?: number;
  readiness?: number;
  timeEntries?: number;
  costs?: number;
  skipped?: number;
  warnings?: string[];
}

async function readFile(formData: FormData): Promise<{ buf: Buffer } | { error: string }> {
  const file = formData.get('file');
  if (!(file instanceof File)) return { error: 'Ingen fil uppladdad.' };
  if (file.size > 25 * 1024 * 1024) return { error: 'Filen är för stor (max 25 MB).' };
  const buf = Buffer.from(await file.arrayBuffer());
  return { buf };
}

interface StartupRef {
  id: string;
  name: string;
  org_nr?: string;
}

async function loadStartups(pb: PocketBase, tenant: string): Promise<StartupRef[]> {
  return (await pb.collection('startups').getFullList({
    filter: `tenant = "${escFilter(tenant)}"`,
    fields: 'id,name,org_nr'
  })) as unknown as StartupRef[];
}

function buildMatchers(startups: StartupRef[]) {
  const byOrg = new Map<string, StartupRef>();
  const byName = new Map<string, StartupRef>();
  for (const s of startups) {
    if (s.org_nr) byOrg.set(s.org_nr.replace('-', ''), s);
    byName.set(normalizeCompanyName(s.name), s);
  }
  const match = (name: string, org?: string | null): StartupRef | null => {
    if (org) {
      const hit = byOrg.get(org.replace('-', ''));
      if (hit) return hit;
    }
    return byName.get(normalizeCompanyName(name)) || null;
  };
  return { match };
}

export async function previewVinnovaImportAction(formData: FormData): Promise<VinnovaImportPreview> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF)) return { error: 'Endast inkubatorledning får köra importer.' };

  const file = await readFile(formData);
  if ('error' in file) return { error: file.error };

  let parse;
  try {
    parse = parseVinnovaImport(file.buf);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte läsa filen.' };
  }
  if (parse.kind === 'unknown') return { error: 'Filtypen kändes inte igen.', warnings: parse.warnings };

  const admin = await getSuperuserPb();
  const pb = admin.ok ? admin.pb : null;
  if (!pb) return { error: 'Superuser-credentials saknas på servern.' };

  const startups = await loadStartups(pb, user.tenant);
  const { match } = buildMatchers(startups);

  const names =
    parse.kind === 'lagesredovisning'
      ? parse.startups.map((s) => ({ name: s.name, org: s.org_nr }))
      : parse.kind === 'tid'
        ? parse.timeEntries.map((t) => ({ name: t.name, org: null }))
        : parse.costs.map((c) => ({ name: c.name, org: null }));

  const unmatched: string[] = [];
  let matched = 0;
  for (const n of names) {
    if (match(n.name, n.org)) matched++;
    else unmatched.push(n.name);
  }

  return {
    kind: parse.kind,
    matched,
    unmatched,
    rowCount: names.length,
    warnings: parse.warnings
  };
}

export async function commitVinnovaImportAction(formData: FormData): Promise<VinnovaImportCommit> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF)) return { error: 'Endast inkubatorledning får köra importer.' };

  const file = await readFile(formData);
  if ('error' in file) return { error: file.error };
  const occurredOn = String(formData.get('occurred_on') || '');

  let parse;
  try {
    parse = parseVinnovaImport(file.buf);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte läsa filen.' };
  }
  if (parse.kind === 'unknown') return { error: 'Filtypen kändes inte igen.' };
  if ((parse.kind === 'tid' || parse.kind === 'kostnader') && !DATE_RE.test(occurredOn)) {
    return { error: 'Ange ett giltigt datum (YYYY-MM-DD) för perioden.' };
  }

  const admin = await getSuperuserPb();
  if (!admin.ok) return { error: 'Superuser-credentials saknas på servern.' };
  const pb = admin.pb;

  const startups = await loadStartups(pb, user.tenant);
  const { match } = buildMatchers(startups);
  const tenant = user.tenant;
  const out: VinnovaImportCommit = {
    kind: parse.kind,
    startupsUpdated: 0,
    aidPeriods: 0,
    readiness: 0,
    timeEntries: 0,
    costs: 0,
    skipped: 0,
    warnings: []
  };

  const existsFirst = async (collection: string, filter: string): Promise<boolean> => {
    try {
      await pb.collection(collection).getFirstListItem(filter);
      return true;
    } catch {
      return false;
    }
  };

  if (parse.kind === 'lagesredovisning') {
    for (const s of parse.startups) {
      const hit = match(s.name, s.org_nr);
      if (!hit) {
        out.skipped!++;
        continue;
      }
      // Uppdatera startups-fält (bara de som har värde).
      const patch: Record<string, unknown> = {};
      if (s.vinnova_focus) patch.vinnova_focus = s.vinnova_focus;
      if (s.sni_code) patch.sni_code = s.sni_code;
      if (s.state_aid_start_at) patch.state_aid_start_at = s.state_aid_start_at;
      if (s.funding_end_at) patch.vinnova_funding_end_at = s.funding_end_at;
      if (Object.keys(patch).length > 0) {
        try {
          await pb.collection('startups').update(hit.id, patch);
          out.startupsUpdated!++;
        } catch {
          /* fail-soft */
        }
      }
      // Statsstödsperiod (dedupe på startup+basis+valid_from).
      if (s.basis && s.state_aid_start_at) {
        const f = `tenant = "${escFilter(tenant)}" && startup = "${hit.id}" && basis = "${s.basis}" && valid_from = "${s.state_aid_start_at}"`;
        if (!(await existsFirst('startup_state_aid_periods', f))) {
          try {
            await pb.collection('startup_state_aid_periods').create({
              tenant,
              startup: hit.id,
              basis: s.basis,
              sni_code: s.sni_code || '',
              valid_from: s.state_aid_start_at,
              note: 'Importerad från lägesredovisning'
            });
            out.aidPeriods!++;
          } catch {
            /* fail-soft */
          }
        }
      }
      // Readiness-bedömning (dedupe på startup+assessed_at).
      const hasRl = s.crl != null || s.tmrl != null || s.brl != null || s.srl != null;
      const assessedAt = s.criteria_checked_at || s.state_aid_start_at;
      if (hasRl && assessedAt) {
        const f = `tenant = "${escFilter(tenant)}" && startup = "${hit.id}" && assessed_at = "${assessedAt}"`;
        if (!(await existsFirst('startup_readiness_assessments', f))) {
          try {
            await pb.collection('startup_readiness_assessments').create({
              tenant,
              startup: hit.id,
              assessed_at: assessedAt,
              crl: s.crl,
              tmrl: s.tmrl,
              brl: s.brl,
              srl: s.srl,
              criteria_checked_at: s.criteria_checked_at || null,
              note: 'Importerad från lägesredovisning'
            });
            out.readiness!++;
          } catch {
            /* fail-soft */
          }
        }
      }
    }
  } else if (parse.kind === 'tid') {
    for (const t of parse.timeEntries) {
      const hit = match(t.name, null);
      if (!hit) {
        out.skipped!++;
        continue;
      }
      const f = `tenant = "${escFilter(tenant)}" && startup = "${hit.id}" && occurred_on = "${occurredOn}" && source = "import_excel"`;
      if (await existsFirst('service_time_entries', f)) {
        out.skipped!++;
        continue;
      }
      try {
        await pb.collection('service_time_entries').create({
          tenant,
          startup: hit.id,
          activity_kind: 'incubation',
          hours: t.hours,
          hourly_rate_sek: t.rate && t.rate > 0 ? t.rate : null,
          occurred_on: occurredOn,
          note: 'Importerad inrapporterad tid',
          source: 'import_excel'
        });
        out.timeEntries!++;
      } catch {
        out.skipped!++;
      }
    }
  } else if (parse.kind === 'kostnader') {
    for (const c of parse.costs) {
      const hit = match(c.name, null);
      if (!hit) {
        out.skipped!++;
        continue;
      }
      const f = `tenant = "${escFilter(tenant)}" && startup = "${hit.id}" && incurred_on = "${occurredOn}" && source = "import_excel"`;
      if (await existsFirst('startup_service_costs', f)) {
        out.skipped!++;
        continue;
      }
      try {
        await pb.collection('startup_service_costs').create({
          tenant,
          startup: hit.id,
          cost_type: 'verification',
          amount_sek: c.amount_sek,
          incurred_on: occurredOn,
          allocation_note: 'Externa tjänster (import)',
          source: 'import_excel'
        });
        out.costs!++;
      } catch {
        out.skipped!++;
      }
    }
  }

  revalidatePath('/rapporter', 'layout');
  return out;
}
