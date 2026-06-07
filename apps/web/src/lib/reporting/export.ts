import 'server-only';
import type { DocumentSpec, SheetSpec } from '@/lib/documents/types';
import { renderDocument, type RenderedDocument } from '@/lib/documents';
import type { LagesredovisningResult } from '@platform/shared';
import { REPORT_TEMPLATES, VINNOVA_LAGESREDOVISNING, type ReportTemplateDef } from './templates';

/** Bygger ett DocumentSpec (xlsx) ur en mall + ett byggt resultat. */
export function lagesredovisningToSpec(
  result: LagesredovisningResult,
  period: { from: string; to: string },
  template: ReportTemplateDef = VINNOVA_LAGESREDOVISNING
): DocumentSpec {
  const columns = template.columns.map((c) => ({ key: c.key, label: c.label, type: c.type }));
  const rows = result.rows.map((row) => template.columns.map((c) => c.resolve(row)));

  // Summeringsrad: bara på de valutakolumner som har en motsvarande total.
  const totals: Array<string | number> = template.columns.map((c) => {
    switch (c.key) {
      case 'period_inkubator':
        return result.totals.inkubator;
      case 'period_verifiering':
        return result.totals.verifiering;
      case 'period_summa':
        return result.totals.summa;
      case 'acc_inkubator':
        return result.accumulatedTotals.inkubator;
      case 'acc_verifiering':
        return result.accumulatedTotals.verifiering;
      case 'acc_summa':
        return result.accumulatedTotals.summa;
      case 'name':
        return 'TOTALT';
      default:
        return '';
    }
  });

  const sheet: SheetSpec = { name: template.sheetName, columns, rows, totals };

  return {
    kind: 'xlsx',
    title: `${template.title} ${period.from} – ${period.to}`,
    subtitle: 'Vinnova — excellent inkubator. Genererat av Movexum OS — verifiera innan inlämning.',
    sheets: [sheet]
  };
}

export async function renderLagesredovisning(
  result: LagesredovisningResult,
  period: { from: string; to: string },
  templateSlug = VINNOVA_LAGESREDOVISNING.slug
): Promise<RenderedDocument> {
  const template = REPORT_TEMPLATES[templateSlug] || VINNOVA_LAGESREDOVISNING;
  return renderDocument(lagesredovisningToSpec(result, period, template));
}
