'use client';

import type { ScreeningOwnershipEntry } from '@platform/shared';
import { OWNER_KIND_LABEL, PART_LABEL, formatOrgNr, pctText, shareText } from './shared';

/** Ägarbild/innehav för ett bolag (§ 51.7: huvudmannens namn visas, aldrig personnummer). */
export function OwnershipTable({ rows, caption }: { rows: ScreeningOwnershipEntry[]; caption: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-default">
      <table className="w-full text-[12.5px]">
        <caption className="bg-canvas-subtle px-3 py-2 text-left text-[12px] font-semibold text-foreground">{caption}</caption>
        <thead className="text-left text-[11px] uppercase tracking-wider text-foreground-subtle">
          <tr className="border-t border-default">
            <th className="px-3 py-1.5 font-medium">Namn, org.nr</th>
            <th className="px-3 py-1.5 font-medium">Typ</th>
            <th className="px-3 py-1.5 font-medium">% kapital</th>
            <th className="px-3 py-1.5 font-medium">% röster</th>
            <th className="px-3 py-1.5 font-medium">Källa</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="border-t border-default">
              <td colSpan={5} className="px-3 py-2 text-foreground-muted">Inga rader i underlaget.</td>
            </tr>
          ) : (
            rows.map((o, i) => {
              const range = shareText(o);
              return (
                <tr key={i} className="border-t border-default">
                  <td className="px-3 py-1.5 text-foreground">
                    {o.owner_kind === 'person' ? (
                      o.person_name ? o.person_name : <span className="text-foreground-muted">Namn saknas i svaret</span>
                    ) : (
                      o.name || '–'
                    )}
                    {o.org_nr && o.owner_kind !== 'person' ? (
                      <span className="ml-2 text-[11.5px] text-foreground-subtle mx-tnum">{formatOrgNr(o.org_nr)}</span>
                    ) : null}
                    {o.indirect ? <span className="ml-2 text-[11px] text-foreground-subtle">indirekt</span> : null}
                  </td>
                  <td className="px-3 py-1.5 text-foreground-muted">{OWNER_KIND_LABEL[o.owner_kind] ?? o.owner_kind}</td>
                  <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{range ?? pctText(o.capital_pct)}</td>
                  <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{range ? '' : pctText(o.voting_pct)}</td>
                  <td className="px-3 py-1.5 text-[11.5px] text-foreground-subtle">{o.part ? PART_LABEL[o.part] : '–'}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
