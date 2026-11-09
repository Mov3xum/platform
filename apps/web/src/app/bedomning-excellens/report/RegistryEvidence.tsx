'use client';

import type { ExcellenceAssessment } from '@/lib/actions/excellence';
import { formatRegistryCost } from '@/lib/integrations/company-registry/pricing';
import { WARN_TONE, formatOrgNr, sek } from './shared';

/**
 * Underlaget från registret (§ 51.12): kostnad, vad leverantören svarade per
 * bolag, uppslag som inte kunde göras och bokslut per bolag — hopfällt sist
 * i rapporten. Det är här man ser VARFÖR en punkt blev "okänt" (404 = inga
 * uppgifter, 403 = inte i paketet, fält som saknades). PII-fritt. En synlig
 * sammanfattningsrad överst (`EvidenceSummary`) länkar hit.
 */
export function evidenceCounts(a: ExcellenceAssessment) {
  return {
    notes: a.notes.reduce((n, x) => n + x.notes.length, 0),
    warnings: a.lookupWarnings.length,
    financials: Object.values(a.financialsByOrg).filter((rows) => rows.length > 0).length
  };
}

export function EvidenceSummary({ assessment }: { assessment: ExcellenceAssessment }) {
  const c = evidenceCounts(assessment);
  const parts: string[] = [];
  if (assessment.cost) parts.push(`Kostnad hos ${assessment.providerName}: ${assessment.cost.companies} bolag = ${formatRegistryCost(assessment.cost)}`);
  if (c.warnings > 0) parts.push(`${c.warnings} uppslag kunde inte göras`);
  if (c.notes > 0) parts.push(`${c.notes} noteringar från registret`);
  if (c.financials > 0) parts.push(`bokslut för ${c.financials} bolag`);
  if (parts.length === 0) return null;
  const warn = c.warnings > 0 || (assessment.cost && !assessment.cost.complete);
  return (
    <p className={`rounded-xl px-3 py-2 text-[12.5px] mx-tnum ${warn ? WARN_TONE : 'bg-canvas-subtle text-foreground-muted'}`}>
      {parts.join(' · ')}.{' '}
      <a href="#underlag" className="font-semibold text-link hover:underline">
        Visa underlag
      </a>
    </p>
  );
}

export function RegistryEvidence({ assessment }: { assessment: ExcellenceAssessment }) {
  const { result } = assessment;
  const nameOf = (org: string) => result.companies.find((c) => c.orgNr === org)?.name || formatOrgNr(org);
  const hasNotes = assessment.mode === 'register' && assessment.notes.some((n) => n.notes.length > 0);
  return (
    <details id="underlag" className="scroll-mt-24 rounded-2xl border border-default bg-surface px-4 py-3">
      <summary className="cursor-pointer text-[13px] font-semibold text-foreground">Underlag från registret</summary>
      <div className="mt-3 space-y-5">
        {assessment.cost && (
          <p className={`rounded-xl px-3 py-2 text-[12.5px] mx-tnum ${assessment.cost.complete ? 'bg-canvas-subtle text-foreground' : WARN_TONE}`}>
            <span className="font-semibold">Kostnad hos {assessment.providerName} hittills:</span> {assessment.cost.companies} uppslagna bolag ={' '}
            {formatRegistryCost(assessment.cost)}.
          </p>
        )}

        {assessment.lookupWarnings.length > 0 && (
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Uppslag som inte kunde göras</p>
            <ul className={`mt-1 list-disc space-y-0.5 rounded-xl px-3 py-2 pl-7 text-[12.5px] ${WARN_TONE}`}>
              {assessment.lookupWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {hasNotes && (
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Svar från {assessment.providerName ?? 'bolagsregistret'} per bolag</p>
            <div className="mt-2 space-y-3">
              {assessment.notes
                .filter((n) => n.notes.length > 0)
                .map((n) => (
                  <div key={n.orgNr}>
                    <p className="text-[12px] font-semibold text-foreground">
                      {n.name || formatOrgNr(n.orgNr)}
                      <span className="ml-2 font-normal text-foreground-subtle mx-tnum">{formatOrgNr(n.orgNr)}</span>
                    </p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12px] text-foreground-muted">
                      {n.notes.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Bokslut per bolag</p>
          <div className="mt-2 space-y-4">
            {Object.entries(assessment.financialsByOrg).map(([org, rows]) => (
              <div key={org}>
                <p className="text-[12px] font-semibold text-foreground mx-tnum">{nameOf(org)}</p>
                {rows.length === 0 ? (
                  <p className="text-[12px] text-foreground-muted">Inga bokslutsrader.</p>
                ) : (
                  <div className="mt-1 overflow-x-auto rounded-xl border border-default">
                    <table className="w-full text-[12px]">
                      <thead className="bg-canvas-subtle text-left text-foreground-subtle">
                        <tr>
                          <th className="px-3 py-1.5 font-medium">År</th>
                          <th className="px-3 py-1.5 font-medium">Anställda</th>
                          <th className="px-3 py-1.5 font-medium">Omsättning</th>
                          <th className="px-3 py-1.5 font-medium">Resultat</th>
                          <th className="px-3 py-1.5 font-medium">Balansomslutning</th>
                          <th className="px-3 py-1.5 font-medium">Eget kapital</th>
                          <th className="px-3 py-1.5 font-medium">Utdelning</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((f) => (
                          <tr key={f.year} className="border-t border-default mx-tnum">
                            <td className="px-3 py-1.5 font-medium text-foreground">{f.year}</td>
                            <td className="px-3 py-1.5 text-foreground-muted">{f.employees ?? '–'}</td>
                            <td className="px-3 py-1.5 text-foreground-muted">{sek(f.revenue_sek)}</td>
                            <td className="px-3 py-1.5 text-foreground-muted">{sek(f.net_result_sek)}</td>
                            <td className="px-3 py-1.5 text-foreground-muted">{sek(f.balance_sheet_sek)}</td>
                            <td className="px-3 py-1.5 text-foreground-muted">{sek(f.equity_sek)}</td>
                            <td className="px-3 py-1.5 text-foreground-muted">{f.dividend_reported ? sek(f.dividend_sek ?? 0) : '–'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
            {Object.keys(assessment.financialsByOrg).length === 0 && <p className="text-[12px] text-foreground-muted">Inga bokslut i underlaget.</p>}
          </div>
        </div>
      </div>
    </details>
  );
}
