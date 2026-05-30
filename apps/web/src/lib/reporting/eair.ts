import 'server-only';
import type PocketBase from 'pocketbase';
import type { DocumentSpec, RenderedDocument } from '@/lib/documents';
import { renderDocument } from '@/lib/documents';
import { escFilter } from '@/lib/pb-filter';
import { dateOnly, type DeMinimisStod, type Startup } from '@platform/shared';

// e-AidRegister-underlag: fr.o.m. 1 jan 2026 ska beslutade de minimis-stöd
// rapporteras till EU-kommissionens register inom 20 arbetsdagar med
// företagsnamn, orgnr, stödbelopp och SNI-kod. Vi exporterar den datan ur
// de_minimis_stod (§20) + startups (namn/org-nr/SNI). Deterministisk, ingen AI.
// Se docs/reporting/vinnova-tillvaxtverket-djupanalys.md §6.

export interface EAidRow {
  name: string;
  org_nr: string;
  sni_code: string;
  belopp_eur: number;
  belopp_sek: number | '';
  beslutsdatum: string;
  stodgivare: string;
  referens: string;
  forordning: string;
  registrerad: string;
}

export interface EAidDataset {
  rows: EAidRow[];
  from?: string;
  to?: string;
}

/** Bygger e-AidRegister-underlaget tenant-säkert, ev. filtrerat på beslutsdatum. */
export async function buildEAidRegister(
  pb: PocketBase,
  tenant: string,
  opts?: { from?: string; to?: string }
): Promise<EAidDataset> {
  let filter = `tenant = "${escFilter(tenant)}"`;
  if (opts?.from) filter += ` && beslutsdatum >= "${escFilter(opts.from)}"`;
  if (opts?.to) filter += ` && beslutsdatum <= "${escFilter(opts.to)} 23:59:59"`;

  const stod = (await pb.collection('de_minimis_stod').getFullList({
    filter,
    sort: 'beslutsdatum',
    expand: 'startup'
  })) as unknown as Array<DeMinimisStod & { expand?: { startup?: Startup } }>;

  const rows: EAidRow[] = stod.map((s) => {
    const su = s.expand?.startup;
    return {
      name: su?.name || '',
      org_nr: su?.org_nr || '',
      sni_code: su?.sni_code || '',
      belopp_eur: s.belopp_eur || 0,
      belopp_sek: s.belopp_sek ?? '',
      beslutsdatum: dateOnly(s.beslutsdatum) || '',
      stodgivare: s.stodgivare || '',
      referens: s.beslut_referens || '',
      forordning: s.forordning || '',
      registrerad: s.registrerad_i_eair ? 'Ja' : 'Nej'
    };
  });

  return { rows, from: opts?.from, to: opts?.to };
}

export function eAidToSpec(dataset: EAidDataset): DocumentSpec {
  const periodLabel =
    dataset.from || dataset.to ? ` ${dataset.from || '…'} – ${dataset.to || '…'}` : '';
  return {
    kind: 'xlsx',
    title: `e-AidRegister-underlag${periodLabel}`,
    subtitle: 'De minimis-stöd att rapportera till EU-kommissionens register (inom 20 arbetsdagar).',
    sheets: [
      {
        name: 'e-AidRegister',
        columns: [
          { key: 'name', label: 'Företagsnamn' },
          { key: 'org_nr', label: 'Org nr' },
          { key: 'sni_code', label: 'SNI-kod' },
          { key: 'belopp_eur', label: 'Stödbelopp (EUR)', type: 'number' },
          { key: 'belopp_sek', label: 'Stödbelopp (SEK)', type: 'number' },
          { key: 'beslutsdatum', label: 'Beslutsdatum', type: 'date' },
          { key: 'stodgivare', label: 'Stödgivare' },
          { key: 'referens', label: 'Beslutsreferens' },
          { key: 'forordning', label: 'Förordning' },
          { key: 'registrerad', label: 'Registrerad i e-AidRegister' }
        ],
        rows: dataset.rows.map((r) => [
          r.name,
          r.org_nr,
          r.sni_code,
          r.belopp_eur,
          r.belopp_sek,
          r.beslutsdatum,
          r.stodgivare,
          r.referens,
          r.forordning,
          r.registrerad
        ])
      }
    ]
  };
}

export async function renderEAidRegister(dataset: EAidDataset): Promise<RenderedDocument> {
  return renderDocument(eAidToSpec(dataset));
}
