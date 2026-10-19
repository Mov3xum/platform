'use client';

import Link from 'next/link';
import { useActionState, useEffect, useMemo, useState } from 'react';
import {
  COMPANY_MANUAL_CONDITIONS,
  GROUP_ROLE_LABEL,
  IRL_AXES,
  MATURITY_PHASES,
  MATURITY_PHASE_LABEL,
  MAX_RELATED_COMPANIES,
  SCREENING_COMMENT_MAX,
  SCREENING_MAX_FOUNDERS,
  SCREENING_NOTE_MAX,
  SNI_MATCH_LABEL,
  STATE_AID_OUTCOME_LABEL,
  VINNOVA_OUTCOME_LABEL,
  describeCompanyAge,
  formatSni,
  type CompanyAssessment,
  type OwnerEngagementView,
  type PersonLinkFact,
  type ScreeningSni,
  type CompanyManualCondition,
  type IrlAxis,
  type ManualAnswer,
  type ScreeningCheck,
  type ScreeningFounderFact,
  type ScreeningManualFacts,
  type ScreeningOwnershipEntry,
  type ScreeningSource,
  type ScreeningVerdict
} from '@platform/shared';
import {
  addGroupCompanyAction,
  applyExcellenceFactsAction,
  fetchGroupCompanyAction,
  type ExcellenceAssessment,
  type ExcellenceAssessmentState
} from '@/lib/actions/excellence';
import { REGISTRY_PART_META, type RegistryPartId } from '@/lib/integrations/company-registry/parts';
import { estimateRegistryCost, formatRegistryCost, registryPartCostLabel, type RegistryPricing } from '@/lib/integrations/company-registry/pricing';
import { logRegistryDiagnostics } from '@/lib/integrations/company-registry/console-diagnostics';

// EN interaktiv rapport (CLAUDE.md § 51.9). Bedömningen visas i samma ordning
// som referensbedömningen "Bedömning Vinnova Combly", och varje punkt som
// registret inte kan avgöra besvaras DIREKT i raden (väljare till höger +
// motivering). Instruktionerna bor i "Så funkar det" överst. Grundarteam, uppskattningar för bolag utan
// bokslut, de minimis-intyg, IRL och kommentaren redigeras på samma sätt, i
// sin egen tabell. Ändringarna samlas i ett enda "Spara och räkna om": samma
// underlag, inga nya debiterade anrop (`applyExcellenceFactsAction`). Ett
// manuellt NEJ väger alltid tyngst; ett JA fyller bara en OKÄNT-punkt.
// Skriv aldrig personuppgifter i motiveringarna (personnummer saneras på
// skrivvägen).

/** Leverantören som fler uppslag ur koncernkartan görs mot (§ 51.7). */
export interface FetchMoreConfig {
  providerSlug: string;
  providerName: string;
  parts: RegistryPartId[];
  endpoints?: Partial<Record<RegistryPartId, string>>;
  pricing: RegistryPricing;
}

interface Props {
  assessment: ExcellenceAssessment;
  fetchMore?: FetchMoreConfig;
  onUpdated: (a: ExcellenceAssessment) => void;
}

const initialState: ExcellenceAssessmentState = {};
const FACTS_FORM_ID = 'excellence-facts-form';

const inputCls =
  'block w-full rounded-lg border border-default bg-canvas px-2.5 py-1 text-[12.5px] text-foreground outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

const VERDICT_LABEL: Record<ScreeningVerdict, string> = { yes: 'Ja', no: 'Nej', unknown: 'Okänt' };
const VERDICT_TONE: Record<ScreeningVerdict, string> = {
  yes: 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron',
  no: 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange',
  unknown: 'bg-canvas-muted text-foreground-muted'
};
const WARN_TONE = 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul';
const SOURCE_LABEL: Record<ScreeningSource, string> = {
  register: 'Bolagsregister',
  platform: 'Plattformen',
  manual: 'Manuell kontroll'
};
const PART_LABEL: Record<'group_structure' | 'beneficial_owners', string> = {
  group_structure: 'Koncernstruktur',
  beneficial_owners: 'Verklig huvudman'
};
const OWNER_KIND_LABEL: Record<string, string> = {
  company: 'Bolag',
  person: 'Fysisk person',
  public_body: 'Offentlig/akademi',
  investor: 'Investerare',
  other: 'Okänd'
};
const IRL_LABEL: Record<IrlAxis, string> = { crl: 'CRL', brl: 'BRL', tmrl: 'TMRL', srl: 'SRL' };
/** Övriga KTH-axlar ur bolagskortets bedömning (§ 52.2) — visas, ändras på bolagskortet. */
const KTH_EXTRA_AXES = [
  { key: 'trl', label: 'TRL', hint: 'Teknik — från bolagskortets KTH-bedömning' },
  { key: 'iprl', label: 'IPRL', hint: 'IPR — från bolagskortets KTH-bedömning' },
  { key: 'frl', label: 'FRL', hint: 'Finansiering — från bolagskortets KTH-bedömning' }
] as const;

/**
 * Frågorna ställs som NATURLIGA frågor med svarsalternativ som säger vad de
 * betyder. Lagrat `verdict` är alltid i VILLKORETS riktning (`yes` = villkoret
 * uppfyllt) — alternativet "Nej — inte börsnoterat" lagras alltså som `yes`.
 * Incident 2026-10-13: med etiketten "Inte börsnoterat" + Ja/Nej svarade
 * controllern "Nej" (= inte noterat) och bedömningen läste det som "ÄR
 * börsnoterat". Därför aldrig ett nakent Ja/Nej.
 */
interface QuestionMeta {
  question: string;
  /** Svarsalternativ som betyder "villkoret uppfyllt" (lagras som `yes`). */
  fulfilled: string;
  /** Svarsalternativ som betyder "villkoret INTE uppfyllt" (lagras som `no`). */
  failed: string;
  hint?: string;
}

const CONDITION_QUESTION: Record<CompanyManualCondition, QuestionMeta> = {
  listed: {
    question: 'Är bolaget börsnoterat?',
    fulfilled: 'Nej — inte börsnoterat',
    failed: 'Ja — aktierna är upptagna till handel',
    hint: 'Avgörs normalt ur registret: ett privat aktiebolag (utan "(publ)" i namnet) kan inte vara noterat. Svara bara för ett publikt bolag.'
  },
  dividend: {
    question: 'Har bolaget beslutat om eller delat ut vinst?',
    fulfilled: 'Nej — ingen utdelning',
    failed: 'Ja — utdelning har beslutats',
    hint: 'Avgörs ur årsredovisningens utdelningspost när bokslutet hämtats; ett intyg fyller bara en okänd punkt.'
  },
  concentration: {
    question: 'Är bolaget bildat genom företagskoncentration (fusion/sammanslagning)?',
    fulfilled: 'Nej',
    failed: 'Ja — bildat genom koncentration'
  },
  takeover: {
    question: 'Har bolaget övertagit ett annat företags verksamhet?',
    fulfilled: 'Nej',
    failed: 'Ja — övertagit verksamhet',
    hint: 'Ombildning av enskild firma till aktiebolag undantas.'
  }
};

const STANDALONE_QUESTION: QuestionMeta = {
  question: 'Är bolaget fristående enligt aktieboken — inget företag äger 25 % eller mer, och bolaget äger inget sådant?',
  fulfilled: 'Ja — fristående (aktieboken kontrollerad)',
  failed: 'Nej — det finns ägare/innehav på 25 % eller mer',
  hint: 'Ett Nej gör bolaget anknutet/partner: lägg till bolagen i koncernkartan så prövas deras grundförutsättningar och tröskelvärden.'
};

const VINNOVA_QUESTION: Partial<Record<string, QuestionMeta>> = {
  not_market_ready: {
    question: 'Är bolaget fortfarande inte marknadsredo?',
    fulfilled: 'Ja — inte marknadsredo',
    failed: 'Nej — bolaget är marknadsredo',
    hint: 'Eget kapital under omkostnaderna kommande 24 mån och affärsmodellen valideras fortfarande (budget + coachens bedömning).'
  },
  innovative: {
    question: 'Är bolaget innovativt?',
    fulfilled: 'Ja — unika egenskaper ger uthålliga konkurrensfördelar',
    failed: 'Nej',
    hint: 'Coachens bedömning av innovationshöjd.'
  },
  other_criteria: {
    question: 'Uppfylls övriga villkor?',
    fulfilled: 'Ja — uppfyllda',
    failed: 'Nej',
    hint: 'Agenda 2030 i SRL-dimensionen, skalbarhet (tydlig från mognadsnivå 2), unika kunskapstillgångar.'
  }
};
type VinnovaManualId = 'not_market_ready' | 'innovative' | 'other_criteria';
const VINNOVA_MANUAL_IDS: VinnovaManualId[] = ['not_market_ready', 'innovative', 'other_criteria'];

const EXCELLENCE_QUESTION: QuestionMeta = {
  question: 'Uppfyller bolaget villkoren för excellent inkubation?',
  fulfilled: 'Ja — villkoren uppfyllda',
  failed: 'Nej — uppfylls inte',
  hint: 'Har något hänt som påverkar rätten att ta emot inkubationsmedel? Beslutet registreras som förut på bolagskortet.'
};

function sek(v?: number) {
  return typeof v === 'number' ? `${v.toLocaleString('sv-SE')} kr` : '–';
}

function pctText(v?: number) {
  return typeof v === 'number' ? `${v.toLocaleString('sv-SE')} %` : '–';
}

function shareText(o: ScreeningOwnershipEntry) {
  if (typeof o.capital_pct === 'number' || typeof o.voting_pct === 'number') return null;
  if (typeof o.pct_min === 'number' || typeof o.pct_max === 'number') return `${o.pct_min ?? 0}–${o.pct_max ?? 100} %`;
  return '–';
}

function formatOrgNr(v?: string) {
  if (!v) return '';
  return /^\d{10}$/.test(v) ? `${v.slice(0, 6)}-${v.slice(6)}` : v;
}

function numberOrUndefined(raw: string): number | undefined {
  const v = raw.replace(/\s/g, '').replace(',', '.');
  if (v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function Verdict({ v }: { v: ScreeningVerdict }) {
  return (
    <span className={`inline-flex min-w-14 justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${VERDICT_TONE[v]}`}>
      {VERDICT_LABEL[v]}
    </span>
  );
}

/** Vad en punkt kan ändras till i rapporten. */
interface Editable {
  meta: QuestionMeta;
  value: ManualAnswer | undefined;
  onChange: (v: ManualAnswer | undefined) => void;
}

/**
 * En punkt i rapporten. Går den att ändra sitter svaret till höger i raden:
 * en väljare med uttydda alternativ (aldrig nakent Ja/Nej) och — när ett svar
 * valts — ett motiveringsfält under. Ingen utfällning, så rapporten förblir
 * smal. `action` = en länk till där punkten ändras (t.ex. grundartabellen).
 */
function CheckRow({ check, edit, action }: { check: ScreeningCheck; edit?: Editable; action?: { label: string; onClick: () => void } }) {
  const decidedByRegister = check.verdict !== 'unknown' && check.source === 'register';
  const value = edit?.value;
  return (
    <li className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-start sm:gap-3">
      <Verdict v={check.verdict} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">{check.label}</p>
        <p className="mt-0.5 text-[12.5px] text-foreground-muted">{check.detail}</p>
      </div>
      <div className="flex shrink-0 flex-col gap-1 sm:w-64 sm:items-end">
        {edit ? (
          <>
            <select
              aria-label={edit.meta.question}
              title={edit.meta.hint ? `${edit.meta.question} ${edit.meta.hint}` : edit.meta.question}
              value={value?.verdict ?? ''}
              onChange={(e) => {
                const v = e.target.value as '' | 'yes' | 'no';
                edit.onChange(v ? { verdict: v, ...(value?.note ? { note: value.note } : {}) } : undefined);
              }}
              className={`${inputCls} ${value ? 'border-brand font-semibold' : 'text-foreground-muted'}`}
            >
              <option value="">{decidedByRegister ? 'Registret gäller' : 'Ej besvarad'}</option>
              <option value="yes">{edit.meta.fulfilled}</option>
              <option value="no">{edit.meta.failed}</option>
            </select>
            {value && (
              <input
                aria-label={`${edit.meta.question} — motivering`}
                value={value.note ?? ''}
                maxLength={SCREENING_NOTE_MAX}
                placeholder="Motivering/källa"
                onChange={(e) => edit.onChange(e.target.value ? { verdict: value.verdict, note: e.target.value } : { verdict: value.verdict })}
                className={inputCls}
              />
            )}
          </>
        ) : action ? (
          <button type="button" onClick={action.onClick} className="text-[12px] font-semibold text-link hover:underline">
            {action.label}
          </button>
        ) : null}
        <span className="text-[11px] text-foreground-subtle">{SOURCE_LABEL[check.source]}</span>
      </div>
    </li>
  );
}

function CheckList({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y divide-default rounded-2xl border border-default bg-surface">{children}</ul>;
}

function OwnershipTable({ rows, caption }: { rows: ScreeningOwnershipEntry[]; caption: string }) {
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
                      o.person_name ? (
                        <>
                          {o.person_name}
                        </>
                      ) : (
                        <span className="text-foreground-muted">Namn saknas i svaret</span>
                      )
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
  const [state, formAction, pending] = useActionState(fetchGroupCompanyAction, initialState);
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

/** Bolagets SNI-koder ur registret (huvudsaklig först). */
function SniLine({ sni }: { sni: ScreeningSni[] }) {
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

/** Redigeringsläge per punkt/tabell — en i taget, så rapporten förblir lugn. */
type EditKey = string | null;

function CompanyBlock({
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
            <span className={`mr-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.relation === 'linked' ? VERDICT_TONE.no : WARN_TONE}`}>
              {c.relationLabel}
            </span>
            {c.groupRole ? <span className="mr-1.5 rounded-full bg-canvas-muted px-2 py-0.5 text-[11px] font-semibold text-foreground-muted">{GROUP_ROLE_LABEL[c.groupRole]}</span> : null}
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

/**
 * Koncernkartan — alla bolag regelträdet räknar med (startup-bolaget, moder-,
 * syster-, dotterbolag, partnerföretag, andra ledet) med plats i koncernen,
 * andel, ålder, status och om ett uppslag gjordes. Det är den här tabellen
 * som visar VARFÖR ett bolag räknas in och var underlaget slutar.
 */
function GroupMap({
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
  const mode = assessment.mode;
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
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.relation === 'linked' ? VERDICT_TONE.no : WARN_TONE}`}>
                      {c.relationLabel}
                    </span>
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
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${VERDICT_TONE.yes}`}>Uppslag gjort</span>
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

const PERSON_LINK_LABEL: Record<OwnerEngagementView['companies'][number]['relation'], string> = {
  linked: 'Anknutet — prövas',
  uncertain: 'Oklart — avgör',
  none: 'Räknas inte'
};

/**
 * Ägarnas andra bolag (§ 51.11) — för varje fysisk ägare de bolag personen
 * äger/kontrollerar utanför koncernen, med SNI-kod. Samma SNI-kod som
 * startup-bolaget ⇒ anknutet via fysisk person (bilaga I art. 3.3 st. 4): båda
 * bolagen ska klara kriterierna. Controllern kan avgöra varje bolag själv
 * (sparas med "Spara och räkna om").
 */
function OwnerEngagements({
  engagements,
  subjectName,
  subjectSni,
  registerMode,
  facts,
  setFacts
}: {
  engagements?: OwnerEngagementView[];
  subjectName: string;
  subjectSni?: ScreeningSni[];
  registerMode: boolean;
  facts: ScreeningManualFacts;
  setFacts: (f: (prev: ScreeningManualFacts) => ScreeningManualFacts) => void;
}) {
  const setLink = (orgNr: string, v: PersonLinkFact | undefined) =>
    setFacts((f) => {
      const next = { ...(f.person_links ?? {}) };
      if (v) next[orgNr] = v;
      else delete next[orgNr];
      return { ...f, person_links: next };
    });
  return (
    <div>
      <h4 className="text-[13.5px] font-semibold text-foreground">Ägarnas andra bolag</h4>
      {!engagements ? (
        <p className="mt-1 text-[12.5px] text-foreground-muted">
          {registerMode
            ? 'Hämtades inte i den här körningen. Välj "Ägarnas andra bolag" vid nästa hämtning så söks varje fysisk ägares övriga bolag med SNI-kod.'
            : 'Söks bara vid hämtning från bolagsregistret (datadelen "Ägarnas andra bolag").'}
        </p>
      ) : engagements.length === 0 ? (
        <p className="mt-1 text-[12.5px] text-foreground-muted">Inga fysiska huvudmän i registret — inga andra bolag att söka.</p>
      ) : (
        <div className="mt-2 space-y-3">
          {!subjectSni?.length && (
            <p className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${WARN_TONE}`}>
              SNI-kod saknas för {subjectName} — bolagen kan inte jämföras på bransch.
            </p>
          )}
          {engagements.map((p, i) => (
            <div key={`${p.person_name ?? 'person'}-${i}`} className="overflow-x-auto rounded-xl border border-default">
              <table className="w-full text-[12.5px]">
                <caption className="bg-canvas-subtle px-3 py-2 text-left text-[12px] font-semibold text-foreground">
                  {p.person_name || 'Huvudman (namn saknas i svaret)'}
                  <span className="ml-2 font-normal text-foreground-muted">
                    äger {p.subjectShareLabel} av {subjectName}
                    {p.status === 'none' ? ' · inga andra bolag i registret' : ''}
                    {p.status === 'no_id' || p.status === 'failed' ? ` · kunde inte sökas: ${p.reason ?? 'okänt fel'}` : ''}
                  </span>
                </caption>
                {p.companies.length > 0 && (
                  <>
                    <thead className="text-left text-[11px] uppercase tracking-wider text-foreground-subtle">
                      <tr className="border-t border-default">
                        <th className="px-3 py-1.5 font-medium">Bolag</th>
                        <th className="px-3 py-1.5 font-medium">Andel</th>
                        <th className="px-3 py-1.5 font-medium">SNI</th>
                        <th className="px-3 py-1.5 font-medium">Bransch</th>
                        <th className="px-3 py-1.5 font-medium">Bedömning</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.companies.map((c) => (
                        <tr key={c.org_nr || c.name} className="border-t border-default align-top">
                          <td className="px-3 py-1.5 text-foreground">
                            {c.name || '–'}
                            {c.org_nr ? <span className="ml-2 text-[11.5px] text-foreground-subtle mx-tnum">{formatOrgNr(c.org_nr)}</span> : null}
                            {c.basic?.registeredAt ? (
                              <span className="block text-[11px] text-foreground-subtle mx-tnum">
                                Registrerat {c.basic.registeredAt.slice(0, 10)}
                                {c.basic.bolagStatus ? ` · ${c.basic.bolagStatus}` : ''}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{c.shareLabel}</td>
                          <td className="px-3 py-1.5 text-foreground-muted">
                            {c.basic?.sni?.length ? (
                              c.basic.sni.map((x) => (
                                <span key={x.code} className="block mx-tnum">
                                  {formatSni(x)}
                                </span>
                              ))
                            ) : (
                              <span className="text-foreground-subtle">{c.note ?? '–'}</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                c.sniMatch === 'same' ? VERDICT_TONE.no : c.sniMatch === 'different' ? VERDICT_TONE.yes : WARN_TONE
                              }`}
                            >
                              {SNI_MATCH_LABEL[c.sniMatch]}
                              {c.matchedCode ? ` ${c.matchedCode}` : ''}
                            </span>
                          </td>
                          <td className="px-3 py-1.5">
                            <p className="text-[11.5px] font-semibold text-foreground">{PERSON_LINK_LABEL[c.relation]}</p>
                            <p className="text-[11.5px] text-foreground-muted">{c.reason}</p>
                            {c.org_nr && (
                              <select
                                aria-label={`Bedömning för ${c.name || c.org_nr}`}
                                className={`${inputCls} mt-1 max-w-[260px]`}
                                value={facts.person_links?.[c.org_nr]?.verdict ?? ''}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setLink(c.org_nr!, v === 'linked' || v === 'not_linked' ? { verdict: v, note: facts.person_links?.[c.org_nr!]?.note } : undefined);
                                }}
                              >
                                <option value="">Systemets bedömning (SNI-kod)</option>
                                <option value="linked">Anknutet — samma eller angränsande marknad</option>
                                <option value="not_linked">Inte anknutet — annan marknad / ingen gemensam kontroll</option>
                              </select>
                            )}
                            {c.org_nr && facts.person_links?.[c.org_nr] && (
                              <input
                                className={`${inputCls} mt-1 max-w-[260px]`}
                                placeholder="Motivering (t.ex. vad bolaget gör)"
                                maxLength={SCREENING_NOTE_MAX}
                                value={facts.person_links[c.org_nr].note ?? ''}
                                onChange={(e) => setLink(c.org_nr!, { verdict: facts.person_links![c.org_nr!].verdict, note: e.target.value || undefined })}
                              />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Vad registret faktiskt svarade om koncernen (§ 51.8) — så en koncernkarta
 * med bara startup-bolaget aldrig läses som "fristående".
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
    <div className="mt-2 rounded-xl border border-default bg-canvas-subtle px-3 py-2 text-[12px] text-foreground-muted">
      <span className="font-semibold text-foreground">Vad registret svarade:</span> koncernstruktur {groupText} · verklig huvudman {boText}
      {info.companyOwners > 0 ? ` · ${info.companyOwners} bolag i ägarbilden` : ''}.
    </div>
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
  const [state, formAction, pending] = useActionState(addGroupCompanyAction, initialState);
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
              <span className="rounded-full bg-canvas-muted px-2 py-0.5 text-[11px] font-semibold text-foreground-muted">Angivet manuellt</span>
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

/** Liten "Ändra"/"Stäng"-knapp för tabeller som redigeras i sin helhet. */
function EditToggle({ editing, onToggle, label }: { editing: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={editing} className="text-[12px] font-semibold text-link hover:underline">
      {editing ? 'Stäng' : label}
    </button>
  );
}

export function AssessmentReport({ assessment, fetchMore, onUpdated }: Props) {
  const [state, formAction, pending] = useActionState(applyExcellenceFactsAction, initialState);
  const [facts, setFacts] = useState<ScreeningManualFacts>(assessment.facts);
  const [editing, setEditing] = useState<EditKey>(null);

  useEffect(() => {
    if (state.assessment) onUpdated(state.assessment);
  }, [state.assessment, onUpdated]);

  // Felsökning mot live: leverantörens svar per bolag i DevTools-konsolen.
  useEffect(() => {
    if (assessment.mode !== 'register') return;
    logRegistryDiagnostics({
      title: `${assessment.providerName ?? 'Bolagsregistret'}: Bedömning excellens — ${assessment.subject.name || assessment.subject.orgNr}`,
      notes: assessment.notes.map((n) => ({ label: `${n.name || ''} ${n.orgNr}`.trim(), notes: n.notes })),
      warnings: assessment.lookupWarnings,
      data: {
        Kostnad: assessment.cost,
        'Ägarnas andra bolag': assessment.result.ownerEngagements,
        'Bolag i bedömningen': assessment.result.companies.map((c) => ({
          bolag: c.name,
          orgNr: c.orgNr,
          relation: c.relationLabel ?? 'startup-bolaget',
          sni: c.basic?.sni?.map((x) => x.code).join(', '),
          uppslag: c.dataFetched
        }))
      }
    });
  }, [assessment]);

  // Ny körning/omräkning ⇒ rapporten följer den och alla redigeringar stängs.
  useEffect(() => {
    setFacts(assessment.facts);
    setEditing(null);
  }, [assessment.context, assessment.facts]);

  const { subject, result } = assessment;
  const subjectName = subject.name || 'Startup-bolaget';
  const dirty = useMemo(() => JSON.stringify(facts) !== JSON.stringify(assessment.facts), [facts, assessment.facts]);
  const toggle = (key: string) => setEditing((k) => (k === key ? null : key));
  const answerEdit = (key: 'standalone' | VinnovaManualId | 'excellence', meta: QuestionMeta): Editable => ({
    meta,
    value: facts[key],
    onChange: (v) => setFacts((f) => ({ ...f, [key]: v }))
  });

  const counts = useMemo(() => {
    const c = { yes: 0, no: 0, unknown: 0 };
    for (const ch of result.checks) c[ch.verdict]++;
    return c;
  }, [result.checks]);
  const stateAidTone =
    result.stateAid.outcome === 'art22_possible'
      ? VERDICT_TONE.yes
      : result.stateAid.outcome === 'undetermined'
        ? VERDICT_TONE.unknown
        : result.stateAid.outcome === 'not_eligible'
          ? VERDICT_TONE.no
          : WARN_TONE;
  const vinnovaTone =
    result.vinnova.outcome === 'in_target_possible'
      ? VERDICT_TONE.yes
      : result.vinnova.outcome === 'not_in_target'
        ? VERDICT_TONE.no
        : VERDICT_TONE.unknown;
  const sekM = (v?: number) => (typeof v === 'number' ? `${(v / 1_000_000).toLocaleString('sv-SE', { maximumFractionDigits: 2 })} Mkr` : '–');

  // Anknutna bolag vars de minimis redan kommer ur plattformen (intyg behövs inte).
  const platformDeMinimis = useMemo(() => {
    const set = new Set<string>();
    try {
      const ctx = JSON.parse(assessment.context) as { input?: { related?: Array<{ orgNr?: string; deMinimis?: { source?: string } }> } };
      for (const r of ctx.input?.related ?? []) if (r.orgNr && r.deMinimis?.source === 'platform') set.add(r.orgNr);
    } catch {
      /* underlaget visas ändå */
    }
    return set;
  }, [assessment.context]);
  const linkedForIntyg = result.companies.filter((c) => c.role === 'linked' && c.orgNr && !platformDeMinimis.has(c.orgNr));
  // Rader i tröskelvärdet utan bokslut — kan fyllas med bolagets egen uppskattning (bilaga I art. 4.3).
  const estimable = (r: { orgNr: string; estimated?: boolean; note?: string; year?: number }) => !!r.orgNr && (r.estimated || (!!r.note && r.year === undefined));

  const irl = result.irl;
  const platformIrl = !!irl && !irl.manualLevels && IRL_AXES.some((ax) => typeof irl[ax] === 'number');
  const founderRows: ScreeningFounderFact[] = facts.founders ?? (assessment.foundersSource === 'platform' ? (assessment.founders ?? []) : []);
  const setFounders = (rows: ScreeningFounderFact[]) => setFacts((f) => ({ ...f, founders: rows.length > 0 ? rows : undefined }));
  const setIrl = (patch: Partial<NonNullable<ScreeningManualFacts['irl']>>) => setFacts((f) => ({ ...f, irl: { ...(f.irl ?? {}), ...patch } }));
  const setEstimate = (orgNr: string, patch: Record<string, number | string | undefined>) =>
    setFacts((f) => {
      const next = { ...(f.estimates[orgNr] ?? {}), ...patch } as Record<string, number | string | undefined>;
      for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '') delete next[k];
      const estimates = { ...f.estimates };
      if (Object.keys(next).length > 0) estimates[orgNr] = next as ScreeningManualFacts['estimates'][string];
      else delete estimates[orgNr];
      return { ...f, estimates };
    });

  const editingFounders = editing === 'founders';
  const editingIrl = editing === 'irl';
  const editingComment = editing === 'comment';
  const editingIntyg = editing === 'de_minimis';

  return (
    <section className="space-y-6">
      {/* Formuläret bär bara de dolda fälten; alla kontroller i rapporten är
          state som serialiseras hit. Så kan koncernkartans egna formulär
          (lägg till / hämta mer) ligga inne i rapporten utan nästlade <form>. */}
      <form id={FACTS_FORM_ID} action={formAction}>
        <input type="hidden" name="context" value={assessment.context} />
        <input type="hidden" name="case_id" value={assessment.caseId ?? ''} />
        <input type="hidden" name="facts" value={JSON.stringify(facts)} />
      </form>

      <header className="border-b border-default pb-3">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
          {assessment.mode === 'register' ? `Färskt från ${assessment.providerName}` : 'Sparade data i plattformen'}
          {assessment.recomputed ? ' · omräknat på sparat underlag' : ''}
          {' · '}
          {new Date(assessment.assessedAt).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })}
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Bedömning {subjectName}</h2>
            <p className="mt-0.5 text-[12.5px] text-foreground-muted mx-tnum">
              {formatOrgNr(subject.orgNr)}
              {subject.bolagsform ? ` · ${subject.bolagsform}` : ''}
              {subject.kommun ? ` · ${subject.kommun}` : ''}
              {subject.industri ? ` · ${subject.industri}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {!assessment.file && assessment.caseId && (
              <a
                href={`/api/bedomning-excellens/${assessment.caseId}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-full border border-strong px-3.5 py-1.5 text-[12.5px] font-semibold text-foreground hover:bg-canvas-subtle"
              >
                Förhandsgranska PDF
              </a>
            )}
            {assessment.file && (
              <a
                href={assessment.file.href}
                className="inline-flex items-center rounded-full bg-brand px-3.5 py-1.5 text-[12.5px] font-semibold text-brand-foreground hover:bg-brand-hover"
              >
                Ladda ned PDF
              </a>
            )}
            {assessment.file && (
              <Link
                href={assessment.file.startupId ? `/filer?vy=bolag&bolag=${assessment.file.startupId}` : '/filer'}
                className="text-[12.5px] font-semibold text-link hover:underline"
              >
                Visa i Filer
              </Link>
            )}
            {subject.startupId && (
              <Link href={`/startups/${subject.startupId}`} className="text-[12.5px] font-semibold text-link hover:underline">
                Öppna bolagskortet →
              </Link>
            )}
          </div>
        </div>
        {assessment.fileError && <p className={`mt-2 inline-block rounded-xl px-3 py-1.5 text-[12.5px] ${WARN_TONE}`}>{assessment.fileError}</p>}
      </header>

      {assessment.cost && (
        <p
          className={`rounded-xl border px-3 py-2 text-[12.5px] mx-tnum ${
            assessment.cost.complete
              ? 'border-default bg-canvas-subtle text-foreground'
              : 'border-movexum-morkgul/40 bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul'
          }`}
        >
          <span className="font-semibold">Kostnad hos {assessment.providerName} hittills:</span> {assessment.cost.companies} uppslagna bolag ={' '}
          {formatRegistryCost(assessment.cost)}.
        </p>
      )}

      {assessment.history?.error && (
        <p className={`rounded-xl px-3 py-2 text-[12.5px] ${WARN_TONE}`}>{assessment.history.error}</p>
      )}

      {assessment.lookupWarnings.length > 0 && (
        <ul className={`rounded-xl px-3 py-2 text-[12.5px] ${WARN_TONE}`}>
          {assessment.lookupWarnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {/* Vad leverantören faktiskt svarade — synligt, inte hopfällt: det är
          här man ser varför en del blev "okänt" (404 = inga uppgifter, 403 =
          inte i paketet, fält som saknades). PII-fritt. */}
      {assessment.mode === 'register' && assessment.notes.some((n) => n.notes.length > 0) && (
        <div className="rounded-2xl border border-default bg-canvas-subtle px-4 py-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
            Svar från {assessment.providerName ?? 'bolagsregistret'} per bolag
          </p>
          <div className="mt-2 space-y-3">
            {assessment.notes.map((n) => (
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

      {/* Review-raden — som i Combly-dokumentet: datum, GBER, Vinnova, kommentar (redigeras här). */}
      <div className="overflow-x-auto rounded-2xl border border-default">
        <table className="w-full text-[12.5px]">
          <thead className="bg-canvas-subtle text-left text-[11px] uppercase tracking-wider text-foreground-subtle">
            <tr>
              <th className="px-3 py-2 font-medium">Datum för review</th>
              <th className="px-3 py-2 font-medium">Uppfyller kraven för statsstöd GBER</th>
              <th className="px-3 py-2 font-medium">Uppfyller kraven Vinnova</th>
              <th className="px-3 py-2 font-medium">Kommentar</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-default align-top">
              <td className="px-3 py-2 text-foreground mx-tnum">{assessment.assessedAt.slice(0, 10)}</td>
              <td className="px-3 py-2">
                <span className={`inline-block rounded-full px-2.5 py-1 text-[12px] font-semibold ${stateAidTone}`}>
                  {STATE_AID_OUTCOME_LABEL[result.stateAid.outcome]}
                </span>
                <p className="mt-1 text-foreground-muted">{result.stateAid.text}</p>
              </td>
              <td className="px-3 py-2">
                <span className={`inline-block rounded-full px-2.5 py-1 text-[12px] font-semibold ${vinnovaTone}`}>
                  {VINNOVA_OUTCOME_LABEL[result.vinnova.outcome]}
                </span>
                <p className="mt-1 text-foreground-muted">{result.vinnova.text}</p>
              </td>
              <td className="px-3 py-2 text-foreground-muted">
                {editingComment ? (
                  <textarea
                    autoFocus
                    aria-label="Controllerns kommentar"
                    value={facts.comment ?? ''}
                    maxLength={SCREENING_COMMENT_MAX}
                    rows={4}
                    onChange={(e) => setFacts((f) => ({ ...f, comment: e.target.value || undefined }))}
                    placeholder="Controllerns sammanfattande kommentar — skrivs i PDF:ns review-rad. Inga personuppgifter."
                    className={inputCls}
                  />
                ) : facts.comment ? (
                  <p className="whitespace-pre-line text-foreground">{facts.comment}</p>
                ) : (
                  <p className="text-foreground-subtle">Ingen kommentar ännu.</p>
                )}
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px]">
                  <EditToggle editing={editingComment} onToggle={() => toggle('comment')} label={facts.comment ? 'Ändra' : 'Skriv kommentar'} />
                  <span>
                    {counts.yes} ja · {counts.no} nej · {counts.unknown} okänt
                  </span>
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Steg 1 */}
      <div className="space-y-5">
        <h3 className="text-[14px] font-semibold text-foreground">Steg 1 — Företagsstöd enligt art. 22 GBER eller de minimis</h3>
        <CompanyBlock c={result.companies[0]} subjectName={subjectName} facts={facts} setFacts={setFacts} />

        <GroupMap companies={result.companies} subjectName={subjectName} assessment={assessment} facts={facts} fetchMore={fetchMore} onUpdated={onUpdated} />

        <OwnerEngagements
          engagements={result.ownerEngagements}
          subjectName={subjectName}
          subjectSni={result.companies[0]?.basic?.sni}
          registerMode={assessment.mode === 'register'}
          facts={facts}
          setFacts={setFacts}
        />

        <div>
          <h4 className="text-[13.5px] font-semibold text-foreground">Fristående företag?</h4>
          <div className="mt-2">
            <CheckList>
              <CheckRow check={result.standalone} edit={answerEdit('standalone', STANDALONE_QUESTION)} />
            </CheckList>
          </div>
        </div>

        {result.companies.slice(1).map((c) => (
          <CompanyBlock key={c.orgNr || c.name} c={c} subjectName={subjectName} facts={facts} setFacts={setFacts} />
        ))}

        <div>
          <h4 className="text-[13.5px] font-semibold text-foreground">Tröskelvärden</h4>
          <div className="mt-2 overflow-x-auto rounded-xl border border-default">
            <table className="w-full text-[12.5px]">
              <thead className="bg-canvas-subtle text-left text-[11px] uppercase tracking-wider text-foreground-subtle">
                <tr>
                  <th className="px-3 py-2 font-medium">Namn</th>
                  <th className="px-3 py-2 font-medium">Andel</th>
                  <th className="px-3 py-2 font-medium">Bokslut</th>
                  <th className="px-3 py-2 font-medium">Sysselsättning</th>
                  <th className="px-3 py-2 font-medium">Årsomsättning</th>
                  <th className="px-3 py-2 font-medium">Balansomslutning</th>
                </tr>
              </thead>
              <tbody>
                {result.thresholds.rows.map((r) => {
                  const est = estimable(r) ? facts.estimates[r.orgNr] : undefined;
                  const canEstimate = estimable(r);
                  const label = r.name || formatOrgNr(r.orgNr);
                  const numCell = (key: 'employees' | 'revenue_sek' | 'balance_sheet_sek', placeholder: string, shown?: number) =>
                    canEstimate ? (
                      <input
                        aria-label={`${label} — ${placeholder} (uppskattning)`}
                        inputMode="decimal"
                        placeholder={placeholder}
                        value={est?.[key] ?? ''}
                        onChange={(e) => setEstimate(r.orgNr, { [key]: numberOrUndefined(e.target.value) })}
                        className={`${inputCls} min-w-24 mx-tnum`}
                      />
                    ) : key === 'employees' ? (
                      (shown ?? '–')
                    ) : (
                      sek(shown)
                    );
                  return (
                    <tr key={r.orgNr || r.name} className="border-t border-default align-top">
                      <td className="px-3 py-1.5 text-foreground">
                        {label}
                        {r.note && !canEstimate ? <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium ${WARN_TONE}`}>{r.note}</span> : null}
                      </td>
                      <td className="px-3 py-1.5 text-foreground-muted mx-tnum">
                        {r.role === 'subject' ? 'Startup' : r.role === 'linked' ? '100 % (anknutet)' : `${Math.round(r.weight * 100)} % (partner)`}
                      </td>
                      <td className="px-3 py-1.5 text-foreground-muted mx-tnum">
                        {canEstimate ? (
                          <input
                            aria-label={`${label} — källa för uppskattningen`}
                            placeholder={r.note ? `${r.note} — källa` : 'Uppskattning — källa'}
                            maxLength={SCREENING_NOTE_MAX}
                            value={est?.note ?? ''}
                            onChange={(e) => setEstimate(r.orgNr, { note: e.target.value })}
                            className={`${inputCls} min-w-36`}
                          />
                        ) : (
                          (r.year ?? '–')
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{numCell('employees', 'Anställda', r.employees)}</td>
                      <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{numCell('revenue_sek', 'Omsättning kr', r.revenue_sek)}</td>
                      <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{numCell('balance_sheet_sek', 'Balansomslutning kr', r.balance_sheet_sek)}</td>
                    </tr>
                  );
                })}
                <tr className="border-t border-strong bg-canvas-subtle font-semibold">
                  <td className="px-3 py-1.5 text-foreground">Sammanlagt{result.thresholds.combined.complete ? '' : ' (ofullständigt)'}</td>
                  <td className="px-3 py-1.5 text-foreground-muted">Tak: 50 · 10 M€ · 10 M€</td>
                  <td className="px-3 py-1.5" />
                  <td className="px-3 py-1.5 text-foreground mx-tnum">{result.thresholds.combined.employees ?? '–'}</td>
                  <td className="px-3 py-1.5 text-foreground mx-tnum">{sekM(result.thresholds.combined.revenue_sek)}</td>
                  <td className="px-3 py-1.5 text-foreground mx-tnum">{sekM(result.thresholds.combined.balance_sheet_sek)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-2">
            <CheckList>
              <CheckRow check={result.thresholds.check} />
              <CheckRow check={result.deMinimis} />
              {linkedForIntyg.length > 0 && (
                <li className="px-4 py-2.5">
                  <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-foreground-muted">
                    <span>
                      De minimis-intyg för anknutna bolag (EUR, innevarande + två år bakåt):{' '}
                      {linkedForIntyg
                        .map((c) => `${c.name || formatOrgNr(c.orgNr)} ${facts.de_minimis_related[c.orgNr] ? `${facts.de_minimis_related[c.orgNr].used_eur.toLocaleString('sv-SE')} €` : '–'}`)
                        .join(' · ')}
                    </span>
                    <EditToggle editing={editingIntyg} onToggle={() => toggle('de_minimis')} label="Ange intyg" />
                  </p>
                  {editingIntyg && (
                    <div className="mt-2 space-y-1.5">
                      {linkedForIntyg.map((c) => {
                        const row = facts.de_minimis_related[c.orgNr];
                        const label = c.name || formatOrgNr(c.orgNr);
                        return (
                          <div key={c.orgNr} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1.4fr)] sm:items-center">
                            <p className="text-[12.5px] font-medium text-foreground">{label}</p>
                            <input
                              aria-label={`${label} — de minimis EUR`}
                              inputMode="numeric"
                              placeholder="EUR"
                              value={row ? String(row.used_eur) : ''}
                              onChange={(e) => {
                                const v = e.target.value.replace(/\s/g, '');
                                setFacts((f) => {
                                  const next = { ...f.de_minimis_related };
                                  if (v === '' || !/^\d+$/.test(v)) delete next[c.orgNr];
                                  else next[c.orgNr] = { ...(next[c.orgNr] ?? { used_eur: 0 }), used_eur: Number(v) };
                                  return { ...f, de_minimis_related: next };
                                });
                              }}
                              className={`${inputCls} mx-tnum`}
                            />
                            <input
                              aria-label={`${label} — intygets referens`}
                              placeholder="Intygets datum/referens"
                              disabled={!row}
                              maxLength={SCREENING_NOTE_MAX}
                              value={row?.note ?? ''}
                              onChange={(e) =>
                                setFacts((f) => ({
                                  ...f,
                                  de_minimis_related: { ...f.de_minimis_related, [c.orgNr]: { used_eur: row?.used_eur ?? 0, note: e.target.value || undefined } }
                                }))
                              }
                              className={`${inputCls} disabled:opacity-50`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </li>
              )}
            </CheckList>
          </div>
        </div>

        <div className="rounded-2xl border border-default bg-canvas-subtle px-4 py-3">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-foreground-subtle">Sammanfattande bedömning av art. 22 GBER</p>
          <p className="mt-1 text-[13px] text-foreground">
            <span className={`mr-2 inline-block rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${stateAidTone}`}>
              {STATE_AID_OUTCOME_LABEL[result.stateAid.outcome]}
            </span>
            {result.stateAid.text}
          </p>
        </div>
      </div>

      {/* Steg 2 */}
      <div className="space-y-4">
        <h3 className="text-[14px] font-semibold text-foreground">Steg 2 — Ingår {subjectName} i målgruppen för Vinnova?</h3>

        <div className="overflow-x-auto rounded-xl border border-default">
          <table className="w-full text-[12.5px]">
            <caption className="bg-canvas-subtle px-3 py-2 text-left text-[12px] font-semibold text-foreground">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Grundarteamet ({facts.founders ? 'manuellt inmatat' : assessment.foundersSource === 'platform' && (assessment.founders?.length ?? 0) > 0 ? 'ur teamet på bolagskortet' : 'inte angivet'})
                  {!editingFounders && facts.maturity_phase ? ` · fas: ${MATURITY_PHASE_LABEL[facts.maturity_phase]}` : ''}
                  {!editingFounders && facts.research_spinoff ? ' · forskningsavknoppning' : ''}
                </span>
                <EditToggle editing={editingFounders} onToggle={() => toggle('founders')} label="Ändra" />
              </span>
            </caption>
            <thead className="text-left text-[11px] uppercase tracking-wider text-foreground-subtle">
              <tr className="border-t border-default">
                <th className="px-3 py-1.5 font-medium">Namn</th>
                <th className="px-3 py-1.5 font-medium">% kapital</th>
                <th className="px-3 py-1.5 font-medium">Engagemang (% av heltid)</th>
                <th className="px-3 py-1.5 font-medium">Forskare</th>
                {editingFounders && <th className="px-3 py-1.5" />}
              </tr>
            </thead>
            <tbody>
              {founderRows.map((f, i) =>
                editingFounders ? (
                  <tr key={i} className="border-t border-default">
                    <td className="px-2 py-1">
                      <input
                        aria-label="Grundarens namn"
                        value={f.name}
                        maxLength={120}
                        onChange={(e) => setFounders(founderRows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                        className={inputCls}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        aria-label="Ägarandel i procent"
                        inputMode="decimal"
                        value={f.equity_pct ?? ''}
                        onChange={(e) => setFounders(founderRows.map((x, j) => (j === i ? { ...x, equity_pct: numberOrUndefined(e.target.value) } : x)))}
                        className={`${inputCls} mx-tnum`}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        aria-label="Engagemang i procent av heltid"
                        inputMode="decimal"
                        value={f.engagement_pct ?? ''}
                        onChange={(e) => setFounders(founderRows.map((x, j) => (j === i ? { ...x, engagement_pct: numberOrUndefined(e.target.value) } : x)))}
                        className={`${inputCls} mx-tnum`}
                      />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <input
                        type="checkbox"
                        aria-label="Forskare"
                        checked={f.researcher === true}
                        onChange={(e) => setFounders(founderRows.map((x, j) => (j === i ? { ...x, researcher: e.target.checked || undefined } : x)))}
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <button type="button" onClick={() => setFounders(founderRows.filter((_, j) => j !== i))} className="text-[11.5px] font-semibold text-foreground-subtle hover:text-foreground">
                        Ta bort
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={i} className="border-t border-default">
                    <td className="px-3 py-1.5 text-foreground">{f.name || <span className="text-foreground-subtle">(namn saknas)</span>}</td>
                    <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{pctText(f.equity_pct)}</td>
                    <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{pctText(f.engagement_pct)}</td>
                    <td className="px-3 py-1.5 text-foreground-muted">{f.researcher ? 'Ja' : ''}</td>
                  </tr>
                )
              )}
              {founderRows.length === 0 && (
                <tr className="border-t border-default">
                  <td colSpan={editingFounders ? 5 : 4} className="px-3 py-2 text-foreground-muted">
                    Inga grundare angivna.
                  </td>
                </tr>
              )}
              {editingFounders && (
                <tr className="border-t border-default bg-canvas-subtle">
                  <td colSpan={5} className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        disabled={founderRows.length >= SCREENING_MAX_FOUNDERS}
                        onClick={() => setFounders([...founderRows, { name: '' }])}
                        className="rounded-full border border-strong px-3 py-1 text-[12px] font-semibold text-foreground hover:bg-canvas-subtle disabled:opacity-50"
                      >
                        + Lägg till grundare
                      </button>
                      {facts.founders && assessment.foundersSource === 'platform' && (
                        <button type="button" onClick={() => setFacts((f) => ({ ...f, founders: undefined }))} className="text-[12px] font-semibold text-link hover:underline">
                          Återgå till teamet på bolagskortet
                        </button>
                      )}
                      <label className="flex items-center gap-2 text-[12.5px] text-foreground">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">Mognadsfas</span>
                        <select
                          value={facts.maturity_phase ?? ''}
                          onChange={(e) => setFacts((f) => ({ ...f, maturity_phase: (e.target.value || undefined) as ScreeningManualFacts['maturity_phase'] }))}
                          className={inputCls}
                        >
                          <option value="">Inte angiven</option>
                          {MATURITY_PHASES.map((p) => (
                            <option key={p} value={p}>
                              {MATURITY_PHASE_LABEL[p]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex items-center gap-2 text-[12.5px] text-foreground">
                        <input type="checkbox" checked={facts.research_spinoff === true} onChange={(e) => setFacts((f) => ({ ...f, research_spinoff: e.target.checked || undefined }))} />
                        Forskningsavknoppning
                      </label>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <CheckList>
          {result.vinnovaChecks.map((check) => {
            const meta = VINNOVA_QUESTION[check.id];
            const id = check.id as VinnovaManualId;
            const isFounderCheck = check.id === 'founders_75' || check.id === 'founder_driven';
            return (
              <CheckRow
                key={check.id}
                check={check}
                edit={meta && VINNOVA_MANUAL_IDS.includes(id) ? answerEdit(id, meta) : undefined}
                action={isFounderCheck ? { label: 'Ändra grundare', onClick: () => setEditing('founders') } : undefined}
              />
            );
          })}
        </CheckList>

        <div className="overflow-x-auto rounded-xl border border-default">
          <table className="w-full text-[12.5px]">
            <caption className="bg-canvas-subtle px-3 py-2 text-left text-[12px] font-semibold text-foreground">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Bedömning IRL{irl?.assessedAt ? ` (senast ${irl.assessedAt})` : ''}
                  {typeof irl?.level === 'number' ? ` · sammanvägd nivå ${irl.level}` : ''}
                  {irl?.manualLevels ? ' · nivåer manuellt angivna' : platformIrl ? ' · från bolagskortet' : ''}
                </span>
                <span className="flex items-center gap-3">
                  {subject.startupId && (
                    <Link href={`/startups/${subject.startupId}/utveckling#irl`} className="text-[12px] font-semibold text-link hover:underline">
                      IRL på bolagskortet
                    </Link>
                  )}
                  <EditToggle editing={editingIrl} onToggle={() => toggle('irl')} label="Ändra" />
                </span>
              </span>
            </caption>
            <thead className="text-left text-[11px] uppercase tracking-wider text-foreground-subtle">
              <tr className="border-t border-default">
                <th className="px-3 py-1.5 font-medium">Kategori</th>
                <th className="px-3 py-1.5 font-medium">Nivå</th>
                <th className="px-3 py-1.5 font-medium">Motivering (metrics)</th>
              </tr>
            </thead>
            <tbody>
              {IRL_AXES.map((ax) => {
                // Resultatet är facit: bolagskortets nivå per axel, annars manuellt angiven.
                const level = irl?.[ax];
                const note = facts.irl?.notes?.[ax] ?? irl?.notes?.[ax];
                return (
                  <tr key={ax} className="border-t border-default">
                    <td className="px-3 py-1.5 font-medium text-foreground">{IRL_LABEL[ax]}</td>
                    <td className="px-3 py-1.5 text-foreground-muted mx-tnum">
                      {editingIrl ? (
                        <input
                          aria-label={`${IRL_LABEL[ax]} nivå`}
                          inputMode="numeric"
                          placeholder={typeof level === 'number' ? String(level) : '1–9'}
                          value={facts.irl?.levels?.[ax] ?? ''}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            const levels = { ...(facts.irl?.levels ?? {}) };
                            if (e.target.value === '' || !Number.isInteger(n)) delete levels[ax];
                            else levels[ax] = n;
                            setIrl({ levels });
                          }}
                          className={`${inputCls} w-20 mx-tnum`}
                        />
                      ) : typeof level === 'number' ? (
                        level
                      ) : (
                        '–'
                      )}
                    </td>
                    <td className={`px-3 py-1.5 ${note ? 'text-foreground' : 'text-foreground-subtle'}`}>
                      {editingIrl ? (
                        <input
                          aria-label={`${IRL_LABEL[ax]} motivering`}
                          placeholder={irl?.notes?.[ax] ?? 'Motivering (metrics)'}
                          maxLength={SCREENING_NOTE_MAX}
                          value={facts.irl?.notes?.[ax] ?? ''}
                          onChange={(e) => {
                            const notes = { ...(facts.irl?.notes ?? {}) };
                            if (e.target.value) notes[ax] = e.target.value;
                            else delete notes[ax];
                            setIrl({ notes });
                          }}
                          className={inputCls}
                        />
                      ) : (
                        (note ?? (platformIrl ? 'Motivering saknas' : 'Ingen readiness-bedömning i plattformen'))
                      )}
                    </td>
                  </tr>
                );
              })}
              {KTH_EXTRA_AXES.filter((k) => typeof irl?.[k.key] === 'number').map((k) => (
                <tr key={k.key} className="border-t border-default">
                  <td className="px-3 py-1.5 font-medium text-foreground">{k.label}</td>
                  <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{irl?.[k.key]}</td>
                  <td className="px-3 py-1.5 text-foreground-subtle">{k.hint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-2xl border border-default bg-canvas-subtle px-4 py-3">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-foreground-subtle">Ingår {subjectName} i målgruppen</p>
          <p className="mt-1 text-[13px] text-foreground">
            <span className={`mr-2 inline-block rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${vinnovaTone}`}>
              {VINNOVA_OUTCOME_LABEL[result.vinnova.outcome]}
            </span>
            {result.vinnova.text}
          </p>
        </div>
      </div>

      {/* Steg 3 */}
      <div className="space-y-3">
        <h3 className="text-[14px] font-semibold text-foreground">Steg 3 — Excellent inkubation</h3>
        <CheckList>
          <CheckRow check={result.excellence} edit={answerEdit('excellence', EXCELLENCE_QUESTION)} />
        </CheckList>
      </div>

      {result.missing.length > 0 && (
        <div className="rounded-2xl border border-default bg-canvas-subtle px-4 py-3">
          <h3 className="text-[13px] font-semibold text-foreground">Saknat underlag</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px] text-foreground-muted">
            {result.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <details className="rounded-2xl border border-default bg-surface px-4 py-3">
        <summary className="cursor-pointer text-[13px] font-semibold text-foreground">Bokslut per bolag</summary>
        <div className="mt-3 space-y-4">
          {Object.entries(assessment.financialsByOrg).map(([org, rows]) => (
            <div key={org}>
              <p className="text-[12px] font-semibold text-foreground mx-tnum">
                {result.companies.find((c) => c.orgNr === org)?.name || formatOrgNr(org)}
              </p>
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
        </div>
      </details>

      {/* Spara — ett enda ställe för alla ändringar i rapporten. Klistrad så den
          alltid är nåbar; ovanför mobilens bottenmeny. */}
      <div
        className="sticky z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-2xl border border-default bg-surface px-4 py-3 shadow-movexum-svart/10 shadow-lg"
        style={{ bottom: 'calc(var(--mx-bnav-total, 0px) + 8px)' }}
      >
        <button
          type="submit"
          form={FACTS_FORM_ID}
          disabled={pending || !dirty}
          className="inline-flex items-center justify-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Räknar om…' : 'Spara och räkna om'}
        </button>
        <span className="text-[12px] text-foreground-muted">
          {dirty ? 'Osparade ändringar' : assessment.subject.startupId ? 'Allt sparat' : 'Bolaget finns inte i plattformen — svaren följer bara med i PDF:n'}
        </span>
        {dirty && (
          <button type="button" onClick={() => setFacts(assessment.facts)} className="text-[12px] font-semibold text-foreground-subtle hover:text-foreground">
            Ångra
          </button>
        )}
        {assessment.factsSchemaMissing && (
          <span className={`rounded-full px-2.5 py-1 text-[12px] ${WARN_TONE}`}>
            Fältet screening_facts saknas i PocketBase (kör migration 1700000190) — svaren vägdes in men sparades inte.
          </span>
        )}
        {assessment.factsSaved === false && !assessment.factsSchemaMissing && (
          <span className={`rounded-full px-2.5 py-1 text-[12px] ${WARN_TONE}`}>Svaren kunde inte sparas på bolagskortet — de följer med i PDF:n.</span>
        )}
        {state.error && (
          <span className="rounded-full bg-movexum-pastell-orange px-2.5 py-1 text-[12px] text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange">
            {state.error}
          </span>
        )}
      </div>
    </section>
  );
}
