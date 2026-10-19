'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { GROUP_ROLE_LABEL, MAX_RELATED_COMPANIES, SNI_MATCH_LABEL, describeCompanyAge, formatSni, type CompanyAssessment, type ScreeningManualFacts } from '@platform/shared';
import { addGroupCompanyAction, fetchGroupCompanyAction, type ExcellenceAssessment } from '@/lib/actions/excellence';
import { REGISTRY_PART_META, type RegistryPartId } from '@/lib/integrations/company-registry/parts';
import { estimateRegistryCost, formatRegistryCost, registryPartCostLabel } from '@/lib/integrations/company-registry/pricing';
import { NEUTRAL_TONE, WARN_TONE, formatOrgNr, initialActionState, inputCls, pctText, type FetchMoreConfig } from './shared';

/**
 * "Hämta mer" för ett koncernbolag (§ 51.7): kryssa i delar, se kostnaden
 * INNAN anropet, hämta — bedömningen räknas om på de manuella svar som står i
 * rapporten just nu (även osparade) och kostnaden summeras på totalen.
 */
function GroupCompanyFetch({
  company,
  assessment,
  facts,
  config,
  onUpdated
}: {
  company: CompanyAssessment;
  assessment: ExcellenceAssessment;
  facts: ScreeningManualFacts;
  config: FetchMoreConfig;
  onUpdated: (a: ExcellenceAssessment) => void;
}) {
  const [state, formAction, pending] = useActionState(fetchGroupCompanyAction, initialActionState);
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<RegistryPartId[]>([]);
  useEffect(() => {
    if (state.assessment) {
      onUpdated(state.assessment);
      setOpen(false);
      setParts([]);
    }
  }, [state.assessment, onUpdated]);
  const estimate = estimateRegistryCost(config.pricing, parts, 1);
  const already: string[] = [];
  if (company.basic) already.push('grunddata');
  if (company.conditions.some((x) => x.id === 'dividend' && x.source === 'register')) already.push('bokslut');
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-full border border-strong px-2.5 py-1 text-[11.5px] font-semibold text-foreground hover:bg-canvas-subtle">
        Hämta mer…
      </button>
    );
  }
  return (
    <form action={formAction} className="min-w-[240px] space-y-1.5 rounded-xl border border-default bg-canvas-subtle px-2.5 py-2">
      <input type="hidden" name="context" value={assessment.context} />
      <input type="hidden" name="case_id" value={assessment.caseId ?? ''} />
      <input type="hidden" name="facts" value={JSON.stringify(facts)} />
      <input type="hidden" name="org_nr" value={company.orgNr} />
      <input type="hidden" name="parts_present" value="1" />
      <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">
        {company.name || formatOrgNr(company.orgNr)} — från {config.providerName}
      </p>
      {already.length > 0 && <p className="text-[11px] text-foreground-subtle">Redan hämtat: {already.join(', ')}.</p>}
      {config.parts.map((id) => (
        <label key={id} className="flex cursor-pointer items-start gap-2 text-[12px] text-foreground">
          <input
            type="checkbox"
            name="parts"
            value={id}
            checked={parts.includes(id)}
            onChange={(e) => setParts((prev) => (e.target.checked ? [...prev, id] : prev.filter((p) => p !== id)))}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-brand"
          />
          <span>
            {REGISTRY_PART_META[id].label}
            <span className="block text-[11px] text-foreground-subtle mx-tnum">{registryPartCostLabel(config.pricing, id)}</span>
          </span>
        </label>
      ))}
      <p className="text-[11.5px] font-semibold text-foreground mx-tnum">
        {parts.length === 0 ? 'Välj minst en del.' : `Kostar: ${formatRegistryCost(estimate)}`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending || parts.length === 0}
          className="rounded-full bg-brand px-3 py-1 text-[12px] font-semibold text-brand-foreground hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Hämtar…' : 'Hämta och räkna om'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-[12px] font-semibold text-foreground-subtle hover:text-foreground">
          Avbryt
        </button>
      </div>
      {state.error && <p className="text-[11.5px] text-movexum-morkorange dark:text-movexum-pastell-orange">{state.error}</p>}
    </form>
  );
}

/**
 * Vad registret faktiskt svarade om koncernen (§ 51.8) — så en koncernkarta
 * med bara startup-bolaget aldrig läses som "fristående". En rad, direkt
 * under kartan.
 */
function GroupCoverageNote({ assessment }: { assessment: ExcellenceAssessment }) {
  const info = useMemo(() => {
    try {
      const ctx = JSON.parse(assessment.context) as {
        input?: {
          subject?: { groupStructureFetched?: boolean; beneficialOwnersFetched?: boolean; groupMembers?: unknown[]; ownership?: Array<{ direction?: string; owner_kind?: string }> };
        };
      };
      const sub = ctx.input?.subject;
      if (!sub) return null;
      const owners = sub.ownership?.filter((o) => o.direction === 'owner') ?? [];
      return {
        groupFetched: sub.groupStructureFetched === true,
        groupMembers: Array.isArray(sub.groupMembers) ? sub.groupMembers.length : undefined,
        boFetched: sub.beneficialOwnersFetched === true,
        companyOwners: owners.filter((o) => o.owner_kind !== 'person').length,
        personOwners: owners.filter((o) => o.owner_kind === 'person').length
      };
    } catch {
      return null;
    }
  }, [assessment.context]);
  if (!info) return null;
  const groupText = !info.groupFetched
    ? 'inte hämtad'
    : info.groupMembers === undefined
      ? 'hämtad (sparad ägarkedja — systerbolag syns inte)'
      : info.groupMembers === 0
        ? 'hämtad — registret bär ingen koncern för bolaget'
        : `hämtad — ${info.groupMembers} bolag i registrets lista`;
  const boText = !info.boFetched ? 'inte hämtad' : `hämtad — ${info.personOwners} fysisk${info.personOwners === 1 ? '' : 'a'} person${info.personOwners === 1 ? '' : 'er'}`;
  return (
    <p className="mt-2 text-[12px] text-foreground-muted">
      <span className="font-semibold text-foreground">Vad registret svarade:</span> koncernstruktur {groupText} · verklig huvudman {boText}
      {info.companyOwners > 0 ? ` · ${info.companyOwners} bolag i ägarbilden` : ''}.
    </p>
  );
}

/**
 * "Lägg till koncernbolag" (§ 51.8): ett bolag registret inte bar (aktieboken)
 * — läggs i bolagets manuella svar, slås upp i registerläget med valda delar
 * (kostnaden visas innan) och koncernen följs vidare. Manuellt angivna rader
 * i kartan kan tas bort här.
 */
function AddGroupCompanyForm({
  assessment,
  facts,
  fetchMore,
  onUpdated
}: {
  assessment: ExcellenceAssessment;
  facts: ScreeningManualFacts;
  fetchMore?: FetchMoreConfig;
  onUpdated: (a: ExcellenceAssessment) => void;
}) {
  const [state, formAction, pending] = useActionState(addGroupCompanyAction, initialActionState);
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<RegistryPartId[]>([]);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (state.assessment) {
      onUpdated(state.assessment);
      setOpen(false);
      setParts([]);
    }
  }, [state.assessment, onUpdated]);
  const manual = facts.group_companies;
  const canLookup = !!fetchMore && assessment.mode === 'register';
  const estimate = fetchMore ? estimateRegistryCost(fetchMore.pricing, parts, 1) : null;
  const followParts = parts.filter((p) => p === 'basic' || p === 'financials');
  const followEstimate = fetchMore && followParts.length > 0 ? estimateRegistryCost(fetchMore.pricing, followParts, 1) : null;
  const factsJson = JSON.stringify(facts);
  return (
    <div className="mt-3">
      {manual.length > 0 && (
        <ul className="mb-2 space-y-1 text-[12px] text-foreground-muted">
          {manual.map((g) => (
            <li key={g.org_nr} className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${NEUTRAL_TONE}`}>Angivet manuellt</span>
              <span className="font-medium text-foreground">{g.name || formatOrgNr(g.org_nr)}</span>
              <span>
                {g.direction === 'owner' ? 'äger startup-bolaget' : 'ägs av startup-bolaget'}
                {typeof g.share_pct === 'number' ? ` ${pctText(g.share_pct)}` : ''} · {g.relation === 'linked' ? 'anknutet' : 'partner'}
                {g.note ? ` · ${g.note}` : ''}
              </span>
              <form action={formAction}>
                <input type="hidden" name="context" value={assessment.context} />
                <input type="hidden" name="case_id" value={assessment.caseId ?? ''} />
                <input type="hidden" name="facts" value={factsJson} />
                <input type="hidden" name="org_nr" value={g.org_nr} />
                <input type="hidden" name="remove" value="1" />
                <button type="submit" disabled={pending} className="text-[11.5px] font-semibold text-foreground-subtle hover:text-foreground">
                  Ta bort
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="rounded-full border border-strong px-3 py-1 text-[12px] font-semibold text-foreground hover:bg-canvas-subtle">
          + Lägg till koncernbolag (aktieboken)
        </button>
      ) : (
        <form action={formAction} className="space-y-2 rounded-xl border border-default bg-canvas-subtle px-3 py-3">
          <input type="hidden" name="context" value={assessment.context} />
          <input type="hidden" name="case_id" value={assessment.caseId ?? ''} />
          <input type="hidden" name="facts" value={factsJson} />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">Lägg till koncernbolag</p>
          <div className="grid gap-2 sm:grid-cols-[140px_minmax(0,1fr)_90px_160px_150px]">
            <input name="org_nr" required placeholder="Org-nr" inputMode="numeric" className={`${inputCls} mx-tnum`} aria-label="Org-nr" />
            <input name="name" placeholder="Bolagsnamn (fylls i från registret om tomt)" maxLength={160} className={inputCls} aria-label="Bolagsnamn" />
            <input name="share_pct" placeholder="Andel %" inputMode="decimal" className={`${inputCls} mx-tnum`} aria-label="Andel i procent" />
            <select name="direction" defaultValue="owner" className={inputCls} aria-label="Riktning">
              <option value="owner">Äger startup-bolaget</option>
              <option value="holding">Ägs av startup-bolaget</option>
            </select>
            <select name="relation" defaultValue="linked" className={inputCls} aria-label="Relation">
              <option value="linked">Anknutet (&gt; 50 % / kontroll)</option>
              <option value="partner">Partner (25–50 %)</option>
            </select>
          </div>
          <input name="note" placeholder="Källa, t.ex. aktieboken 2026-10 (inga personuppgifter)" maxLength={600} className={inputCls} aria-label="Källa" />
          {canLookup && fetchMore && (
            <div className="rounded-xl border border-default bg-canvas px-2.5 py-2">
              <p className="text-[11.5px] font-semibold text-foreground">Slå upp hos {fetchMore.providerName} (valfritt)</p>
              <input type="hidden" name="parts_present" value={parts.length > 0 ? '1' : ''} disabled={parts.length === 0} />
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                {fetchMore.parts.map((id) => (
                  <label key={id} className="flex cursor-pointer items-start gap-2 text-[12px] text-foreground">
                    <input
                      type="checkbox"
                      name="parts"
                      value={id}
                      checked={parts.includes(id)}
                      onChange={(e) => setParts((prev) => (e.target.checked ? [...prev, id] : prev.filter((p) => p !== id)))}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-brand"
                    />
                    <span>
                      {REGISTRY_PART_META[id].label}
                      <span className="block text-[11px] text-foreground-subtle mx-tnum">{registryPartCostLabel(fetchMore.pricing, id)}</span>
                    </span>
                  </label>
                ))}
              </div>
              <label className="mt-1.5 flex cursor-pointer items-start gap-2 text-[12px] text-foreground">
                <input type="checkbox" name="follow" value="1" checked={follow} onChange={(e) => setFollow(e.target.checked)} disabled={parts.length === 0} className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-brand" />
                <span>
                  Följ koncernen vidare (högst {MAX_RELATED_COMPANIES} bolag)
                  {followEstimate ? <span className="block text-[11px] text-foreground-subtle mx-tnum">≈ {formatRegistryCost(followEstimate)} per ytterligare bolag</span> : null}
                </span>
              </label>
              <p className="mt-1 text-[11.5px] font-semibold text-foreground mx-tnum">
                {parts.length === 0 ? 'Inga delar valda — läggs till utan uppslag.' : `Detta bolag kostar: ${estimate ? formatRegistryCost(estimate) : '–'}`}
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending} className="rounded-full bg-brand px-3 py-1 text-[12px] font-semibold text-brand-foreground hover:bg-brand-hover disabled:opacity-60">
              {pending ? 'Lägger till…' : 'Lägg till och räkna om'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-[12px] font-semibold text-foreground-subtle hover:text-foreground">
              Avbryt
            </button>
          </div>
          {state.error && <p className="text-[11.5px] text-movexum-morkorange dark:text-movexum-pastell-orange">{state.error}</p>}
        </form>
      )}
      {state.error && !open && <p className="mt-1 text-[11.5px] text-movexum-morkorange dark:text-movexum-pastell-orange">{state.error}</p>}
    </div>
  );
}

/**
 * Koncernkartan — alla bolag regelträdet räknar med (startup-bolaget, moder-,
 * syster-, dotterbolag, partnerföretag, andra ledet) med plats i koncernen,
 * andel, ålder, status och om ett uppslag gjordes. Det är den här tabellen
 * som visar VARFÖR ett bolag räknas in och var underlaget slutar. Ligger
 * först i sektionen "Koncern & ägare" (§ 51.12).
 */
export function GroupMap({
  companies,
  subjectName,
  assessment,
  facts,
  fetchMore,
  onUpdated
}: {
  companies: CompanyAssessment[];
  subjectName: string;
  assessment: ExcellenceAssessment;
  facts: ScreeningManualFacts;
  fetchMore?: FetchMoreConfig;
  onUpdated: (a: ExcellenceAssessment) => void;
}) {
  const ref = new Date(assessment.assessedAt);
  const ageOf = (c: CompanyAssessment) => {
    const reg = c.basic?.registeredAt;
    if (!reg) return '–';
    const d = new Date(`${reg.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return '–';
    const age = c.conditions.find((x) => x.id === 'age');
    return `${reg.slice(0, 10)} · ${describeCompanyAge(d, ref)}${age?.verdict === 'no' ? ' — över 5 år' : ''}`;
  };
  const placeOf = (c: CompanyAssessment) => {
    if (c.role === 'subject') return 'Startup-bolaget';
    const parts: string[] = [];
    if (c.manualDeclared) parts.push('Angivet manuellt (aktiebok/avtal)');
    else if (c.personLink && !c.groupRole) {
      parts.push(`Ägs av ägaren ${c.personLink.personName ?? ''}`.trim());
      parts.push(c.personLink.manual ? 'bedömt av controllern' : SNI_MATCH_LABEL[c.personLink.sniMatch].toLowerCase());
      return parts.join(' · ');
    } else if (c.groupRole) parts.push(GROUP_ROLE_LABEL[c.groupRole] + (typeof c.level === 'number' ? ` (nivå ${c.level})` : ''));
    else if (c.transitive) parts.push('Andra ledet');
    else parts.push(c.indirect ? 'Indirekt ägare/innehav' : 'Direkt ägare/innehav');
    if (c.via) parts.push(`via ${c.via}`);
    return parts.join(' · ');
  };
  return (
    <div>
      <h4 className="text-[13.5px] font-semibold text-foreground">Koncernkarta — bolag som räknas in för {subjectName}</h4>
      <div className="mt-2 overflow-x-auto rounded-xl border border-default">
        <table className="w-full text-[12.5px]">
          <thead className="bg-canvas-subtle text-left text-[11px] uppercase tracking-wider text-foreground-subtle">
            <tr>
              <th className="px-3 py-2 font-medium">Bolag</th>
              <th className="px-3 py-2 font-medium">Plats i koncernen</th>
              <th className="px-3 py-2 font-medium">Relation</th>
              <th className="px-3 py-2 font-medium">Andel</th>
              <th className="px-3 py-2 font-medium">SNI</th>
              <th className="px-3 py-2 font-medium">Registrerat · ålder</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Underlag</th>
              {fetchMore && <th className="px-3 py-2 font-medium">Hämta mer</th>}
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.orgNr || c.name} className="border-t border-default align-top">
                <td className="px-3 py-1.5 text-foreground">
                  {c.name || '–'}
                  {c.orgNr ? <span className="ml-2 text-[11.5px] text-foreground-subtle mx-tnum">{formatOrgNr(c.orgNr)}</span> : null}
                </td>
                <td className="px-3 py-1.5 text-foreground-muted">{placeOf(c)}</td>
                <td className="px-3 py-1.5">
                  {c.role === 'subject' ? (
                    <span className="text-foreground-muted">—</span>
                  ) : (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${NEUTRAL_TONE}`}>{c.relationLabel}</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{c.role === 'subject' ? '' : c.shareLabel}</td>
                <td className="px-3 py-1.5 text-foreground-muted mx-tnum" title={c.basic?.sni?.map(formatSni).join('\n')}>
                  {c.basic?.sni?.length ? c.basic.sni.map((x) => x.code).join(', ') : '–'}
                </td>
                <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{ageOf(c)}</td>
                <td className="px-3 py-1.5 text-foreground-muted">{c.basic?.bolagStatus ?? '–'}</td>
                <td className="px-3 py-1.5">
                  {c.dataFetched ? (
                    <span className="text-foreground-muted">Uppslag gjort</span>
                  ) : (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${WARN_TONE}`}>Inget uppslag</span>
                  )}
                </td>
                {fetchMore && (
                  <td className="px-3 py-1.5">
                    {c.role === 'subject' ? (
                      <span className="text-foreground-subtle">–</span>
                    ) : c.orgNr ? (
                      <GroupCompanyFetch company={c} assessment={assessment} facts={facts} config={fetchMore} onUpdated={onUpdated} />
                    ) : (
                      <span className="text-[11.5px] text-foreground-subtle">Saknar org-nr</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <GroupCoverageNote assessment={assessment} />
      <AddGroupCompanyForm assessment={assessment} facts={facts} fetchMore={fetchMore} onUpdated={onUpdated} />
    </div>
  );
}
