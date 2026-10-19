'use client';

import {
  COMPANY_MANUAL_CONDITIONS,
  GROUP_ROLE_LABEL,
  formatSni,
  type CompanyAssessment,
  type CompanyManualCondition,
  type ManualAnswer,
  type ScreeningManualFacts,
  type ScreeningSni
} from '@platform/shared';
import { OwnershipTable } from './OwnershipTable';
import { CONDITION_QUESTION, CheckList, CheckRow, NEUTRAL_TONE, WARN_TONE, formatOrgNr } from './shared';

/** Bolagets SNI-koder ur registret (huvudsaklig först). */
export function SniLine({ sni }: { sni: ScreeningSni[] }) {
  return (
    <p className="mt-0.5 text-[12px] text-foreground-muted">
      <span className="font-semibold text-foreground-subtle">SNI: </span>
      {sni.map((x, i) => (
        <span key={x.code}>
          {i > 0 ? ' · ' : ''}
          <span className="mx-tnum">{formatSni(x)}</span>
          {x.primary && sni.length > 1 ? <span className="text-foreground-subtle"> (huvudsaklig)</span> : null}
        </span>
      ))}
    </p>
  );
}

/**
 * Ett bolag i prövningen: grundförutsättningarna som punkter (alla synliga —
 * Ja/Nej/Okänt ska gå att läsa rakt av, § 51.12), ägarbild och innehav.
 */
export function CompanyBlock({
  c,
  subjectName,
  facts,
  setFacts
}: {
  c: CompanyAssessment;
  subjectName: string;
  facts: ScreeningManualFacts;
  setFacts: (f: (prev: ScreeningManualFacts) => ScreeningManualFacts) => void;
}) {
  const title = c.name || formatOrgNr(c.orgNr) || 'Okänt bolag';
  // Manuella svar bara för bolag med org-nr som ingår i prövningen (startup + anknutna).
  const editable = !!c.orgNr && (c.role === 'subject' || c.role === 'linked');
  const setCondition = (id: CompanyManualCondition, v: ManualAnswer | undefined) =>
    setFacts((f) => {
      const next = { ...(f.companies[c.orgNr] ?? {}) };
      if (v) next[id] = v;
      else delete next[id];
      const companies = { ...f.companies };
      if (Object.keys(next).length > 0) companies[c.orgNr] = next;
      else delete companies[c.orgNr];
      return { ...f, companies };
    });
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-[13.5px] font-semibold text-foreground">
          {c.role === 'subject' ? `Kan ${title} ta emot företagsstöd?` : title}
          {c.orgNr ? <span className="ml-2 text-[12px] font-normal text-foreground-subtle mx-tnum">{formatOrgNr(c.orgNr)}</span> : null}
        </h4>
        {c.basic?.sni && c.basic.sni.length > 0 && <SniLine sni={c.basic.sni} />}
        {c.role !== 'subject' && (
          <p className="text-[12.5px] text-foreground-muted">
            <span className={`mr-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${NEUTRAL_TONE}`}>{c.relationLabel}</span>
            {c.groupRole ? <span className={`mr-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${NEUTRAL_TONE}`}>{GROUP_ROLE_LABEL[c.groupRole]}</span> : null}
            {c.shareLabel} {c.indirect ? '(indirekt) ' : ''}— {c.reason}
            {c.relation === 'linked' && !c.groupRole && !c.transitive && !c.personLink
              ? ` ${title} kontrollerar mer än 50 % och är därmed ett anknutet företag till ${subjectName}.`
              : c.relation === 'linked'
                ? ` Anknutet företag till ${subjectName} — 100 % av uppgifterna räknas in och grundförutsättningarna prövas.`
                : ''}
          </p>
        )}
        {!c.dataFetched && c.role !== 'subject' && (
          <p className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${WARN_TONE}`}>
            Inget uppslag gjort för bolaget — grundförutsättningarna kan inte prövas.
          </p>
        )}
      </div>
      {c.conditions.length > 0 && (
        <CheckList>
          {c.conditions.map((check) => {
            const id = check.id as CompanyManualCondition;
            const meta = editable && COMPANY_MANUAL_CONDITIONS.includes(id) ? CONDITION_QUESTION[id] : undefined;
            return (
              <CheckRow
                key={check.id}
                check={check}
                edit={meta ? { meta, value: facts.companies[c.orgNr]?.[id], onChange: (v) => setCondition(id, v) } : undefined}
              />
            );
          })}
        </CheckList>
      )}
      {(c.dataFetched || c.owners.length > 0) && (
        <OwnershipTable rows={c.owners} caption={c.role === 'subject' ? `Ägarbild: ${title}` : `Ägande: ${title}`} />
      )}
      {c.holdings.length > 0 && <OwnershipTable rows={c.holdings} caption={`${title} äger`} />}
    </div>
  );
}
