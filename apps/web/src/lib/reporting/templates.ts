// Rapportmallar som DATA, inte hårdkodad renderingskod. Varje kolumn pekar
// ut vilket fält i en LagesredovisningRow den hämtar (resolver-token), så nya
// mallar/kolumner = ny rad i denna lista, inte refaktor av UI/renderare.
// Se docs/reporting/vinnova-tillvaxtverket-djupanalys.md §5.1.

import type { CellType } from '@/lib/documents/types';
import type { LagesredovisningRow } from '@platform/shared';

export interface ReportColumnDef {
  key: keyof LagesredovisningRow | string;
  label: string;
  type?: CellType;
  /** Hämtar cellvärdet ur en byggd rad. */
  resolve: (row: LagesredovisningRow) => string | number;
}

export interface ReportTemplateDef {
  slug: string;
  version: number;
  recipient: 'vinnova' | 'tillvaxtverket' | 'region' | 'kommun' | 'other';
  title: string;
  sheetName: string;
  columns: ReportColumnDef[];
}

const num = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

// Vinnovas lägesredovisning aktiebolag (vers. 1 jan 2026). Kolumnordningen
// speglar mallen så exporten kan klistras in direkt.
export const VINNOVA_LAGESREDOVISNING: ReportTemplateDef = {
  slug: 'vinnova_lagesredovisning_ab',
  version: 1,
  recipient: 'vinnova',
  title: 'Lägesredovisning aktiebolag',
  sheetName: 'Lägesredovisning',
  columns: [
    { key: 'state_aid_start_at', label: 'Datum statsstöd start', type: 'date', resolve: (r) => r.state_aid_start_at },
    { key: 'name', label: 'Företagets namn', resolve: (r) => r.name },
    { key: 'org_nr', label: 'Org nr', resolve: (r) => r.org_nr },
    { key: 'vinnova_focus_label', label: 'Affärsinriktning', resolve: (r) => r.vinnova_focus_label },
    { key: 'basis_label', label: 'Statsstödsgrund', resolve: (r) => r.basis_label },
    { key: 'sni_code', label: 'SNI-kod 2025', resolve: (r) => r.sni_code },
    { key: 'period_inkubator', label: 'Inkubatortjänster (period)', type: 'currency', resolve: (r) => num(r.period.inkubator) },
    { key: 'period_verifiering', label: 'Verifieringstjänster (period)', type: 'currency', resolve: (r) => num(r.period.verifiering) },
    { key: 'period_summa', label: 'Summa periodens utfall', type: 'currency', resolve: (r) => num(r.period.summa) },
    { key: 'acc_inkubator', label: 'Inkubatortjänster (ackum.)', type: 'currency', resolve: (r) => num(r.accumulated.inkubator) },
    { key: 'acc_verifiering', label: 'Verifieringstjänster (ackum.)', type: 'currency', resolve: (r) => num(r.accumulated.verifiering) },
    { key: 'acc_summa', label: 'Summa ackumulerat utfall', type: 'currency', resolve: (r) => num(r.accumulated.summa) },
    { key: 'criteria_checked_at', label: 'Senaste målgruppskontroll', type: 'date', resolve: (r) => r.criteria_checked_at },
    { key: 'crl_cell', label: 'CRL', resolve: (r) => r.crl_cell },
    { key: 'tmrl_cell', label: 'TMRL', resolve: (r) => r.tmrl_cell },
    { key: 'brl_cell', label: 'BRL', resolve: (r) => r.brl_cell },
    { key: 'srl_cell', label: 'SRL', resolve: (r) => r.srl_cell },
    { key: 'vinnova_funding_end_at', label: 'Datum finansiering avslutas', type: 'date', resolve: (r) => r.vinnova_funding_end_at }
  ]
};

export const REPORT_TEMPLATES: Record<string, ReportTemplateDef> = {
  [VINNOVA_LAGESREDOVISNING.slug]: VINNOVA_LAGESREDOVISNING
};
