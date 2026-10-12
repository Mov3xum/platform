'use client';

import Link from 'next/link';
import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MATURITY_PHASE_LABEL,
  STATE_AID_OUTCOME_LABEL,
  VINNOVA_OUTCOME_LABEL,
  type CompanyAssessment,
  type ScreeningCheck,
  type ScreeningOwnershipEntry,
  type ScreeningSource,
  type ScreeningVerdict,
  MAX_RELATED_COMPANIES
} from '@platform/shared';
import {
  assessExcellenceAction,
  type ExcellenceAssessment,
  type ExcellenceAssessmentState
} from '@/lib/actions/excellence';
import {
  RegistryPartsPicker,
  useRegistryPartSelection
} from '@/components/integrations/RegistryPartsPicker';
import { describeRegistryParts, type RegistryPartId } from '@/lib/integrations/company-registry/parts';
import { formatRegistryCost, type RegistryPricing } from '@/lib/integrations/company-registry/pricing';
import { ManualFactsPanel } from './ManualFactsPanel';

interface StartupOption {
  id: string;
  name: string;
  org_nr: string;
}

interface RegistryOption {
  slug: string;
  name: string;
  parts: RegistryPartId[];
  partEndpoints?: Partial<Record<RegistryPartId, string>>;
  /** Prislista (§ 11.8) — kostnaden visas innan uppslagen görs. */
  pricing: RegistryPricing;
}

interface Props {
  startups: StartupOption[];
  registries: RegistryOption[];
  canLookup: boolean;
  initialStartupId?: string;
}

const initialState: ExcellenceAssessmentState = {};

const inputCls =
  'mt-1 block w-full rounded-xl border border-default bg-canvas px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

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

function Verdict({ v }: { v: ScreeningVerdict }) {
  return (
    <span className={`inline-flex min-w-14 justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${VERDICT_TONE[v]}`}>
      {VERDICT_LABEL[v]}
    </span>
  );
}

function CheckList({ checks }: { checks: ScreeningCheck[] }) {
  return (
    <ul className="divide-y divide-default rounded-2xl border border-default bg-surface">
      {checks.map((c) => (
        <li key={c.id} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-start sm:gap-3">
          <Verdict v={c.verdict} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-foreground">{c.label}</p>
            <p className="mt-0.5 text-[12.5px] text-foreground-muted">{c.detail}</p>
            {c.verdict === 'unknown' && c.needs && (
              <p className="mt-0.5 text-[12px] text-foreground-subtle">Behövs: {c.needs}</p>
            )}
          </div>
          <span className="shrink-0 text-[11px] text-foreground-subtle">{SOURCE_LABEL[c.source]}</span>
        </li>
      ))}
    </ul>
  );
}

function OwnershipTable({ rows, caption, emptyText }: { rows: ScreeningOwnershipEntry[]; caption: string; emptyText?: string }) {
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
              <td colSpan={5} className="px-3 py-2 text-foreground-muted">{emptyText ?? 'Inga rader i underlaget.'}</td>
            </tr>
          ) : (
            rows.map((o, i) => {
              const range = shareText(o);
              return (
                <tr key={i} className="border-t border-default">
                  <td className="px-3 py-1.5 text-foreground">
                    {o.owner_kind === 'person' ? 'Fysisk person (namn lagras inte)' : o.name || '–'}
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

// "Bedömning excellens" (CLAUDE.md § 51): välj bolag → hämta färskt från
// bolagsregistret för hela koncernen (det hämtade skrivs till bolagskortet) eller bedöm det som redan
// är sparat → ett underlag i samma ordning som referensbedömningen
// "Bedömning Vinnova Combly".
export function ExcellenceWorkspace({ startups, registries, canLookup, initialStartupId }: Props) {
  const [state, formAction, pending] = useActionState(assessExcellenceAction, initialState);
  const canFetch = canLookup && registries.length > 0;
  const [target, setTarget] = useState<'portfolio' | 'orgnr'>(
    initialStartupId || !canFetch || startups.length > 0 ? 'portfolio' : 'orgnr'
  );
  const [startupId, setStartupId] = useState(initialStartupId ?? startups[0]?.id ?? '');
  const [orgNr, setOrgNr] = useState('');
  const [providerSlug, setProviderSlug] = useState(registries[0]?.slug ?? '');
  const provider = registries.find((r) => r.slug === providerSlug) ?? registries[0];
  const selection = useRegistryPartSelection(provider?.slug ?? 'none', provider?.parts ?? []);
  const resultRef = useRef<HTMLDivElement>(null);
  // Senaste bedömningen — från en körning ELLER en omräkning med manuella svar.
  const [current, setCurrent] = useState<ExcellenceAssessment | undefined>(undefined);
  const onUpdated = useCallback((a: ExcellenceAssessment) => setCurrent(a), []);

  useEffect(() => {
    if (state.assessment) {
      setCurrent(state.assessment);
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [state.assessment]);

  const selectedStartup = startups.find((s) => s.id === startupId);
  const nothingSelected = !!provider && provider.parts.length > 1 && selection.selected.length === 0;
  const canSubmitFetch =
    canFetch && !nothingSelected && (target === 'portfolio' ? !!selectedStartup : orgNr.trim() !== '');

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-default bg-surface px-5 py-5">
        <h2 className="text-[15px] font-semibold text-foreground">Välj bolag</h2>
        <p className="mt-1 text-[12.5px] text-foreground-muted">
          Hämta färskt från bolagsregistret eller bedöm det som redan är sparat för ett portföljbolag.
          Det som hämtas för ett portföljbolag sparas på bolagskortet (grunddata, bokslut, ägarbild —
          samma skrivväg som &quot;Synka från leverantören&quot;), så nästa bedömning kan göras på sparade
          data utan nytt uppslag. Anknutna och partnerföretag i ägarbilden slås upp automatiskt så att
          grundförutsättningarna prövas för hela koncernen. Grundarägande, registrerat de minimis-stöd,
          IRL och excellensflaggan tas från plattformen när bolaget finns här.
        </p>

        <form action={formAction} className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Bolag">
            {(['portfolio', 'orgnr'] as const).map((t) => {
              const disabled = t === 'orgnr' && !canFetch;
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={target === t}
                  disabled={disabled}
                  onClick={() => setTarget(t)}
                  className={`rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition ${
                    target === t
                      ? 'border-brand bg-brand text-brand-foreground'
                      : 'border-default text-foreground-muted hover:bg-canvas-subtle'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {t === 'portfolio' ? 'Portföljbolag' : 'Valfritt org-nr'}
                </button>
              );
            })}
          </div>

          {target === 'portfolio' ? (
            <label className="block max-w-md">
              <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Bolag</span>
              {startups.length === 0 ? (
                <p className="mt-1 text-sm text-foreground-muted">Inga bolag med organisationsnummer i portföljen.</p>
              ) : (
                <select name="startup_id" value={startupId} onChange={(e) => setStartupId(e.target.value)} className={inputCls}>
                  {startups.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.org_nr}
                    </option>
                  ))}
                </select>
              )}
            </label>
          ) : (
            <label className="block max-w-xs">
              <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Organisationsnummer</span>
              <input
                name="org_nr"
                value={orgNr}
                onChange={(e) => setOrgNr(e.target.value)}
                placeholder="559572-8790"
                autoComplete="off"
                className={inputCls}
              />
              <span className="mt-1 block text-[11.5px] text-foreground-subtle">
                Vilket svenskt aktiebolag som helst — behöver inte finnas i plattformen.
              </span>
            </label>
          )}

          {canFetch && provider && (
            <>
              {registries.length > 1 && (
                <label className="block max-w-xs">
                  <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Leverantör</span>
                  <select value={providerSlug} onChange={(e) => setProviderSlug(e.target.value)} className={inputCls}>
                    {registries.map((r) => (
                      <option key={r.slug} value={r.slug}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <input type="hidden" name="provider_slug" value={provider.slug} />
              {provider.parts.length > 1 && (
                <RegistryPartsPicker
                  supported={provider.parts}
                  selected={selection.selected}
                  onToggle={selection.toggle}
                  onSetAll={selection.setAll}
                  endpoints={provider.partEndpoints}
                  providerName={provider.name}
                  hint="Bara de valda API:erna anropas — för startup-bolaget OCH varje anknutet/partnerbolag — och varje anrop debiteras. Det hämtade sparas på bolagskortet för bolag som finns i plattformen. Koncernstruktur krävs för att hitta anknutna bolag; grunddata för deras ålder; bokslut för tröskelvärdet."
                  disabled={pending}
                  pricing={provider.pricing}
                  companies={1}
                  costContext={`Per bolag. Koncernbolag slås upp sparsamt (högst ${MAX_RELATED_COMPANIES} till): först bara ägarbilden; grunddata/bokslut hämtas bara när ägarbolaget har samma ägare som startup-bolaget, och inga koncernbolag alls när bolaget redan faller ur Vinnovas målgrupp. Den faktiska summan visas i resultatet.`}
                  pricingHref={`/integrationer/${provider.slug}#kostnad`}
                />
              )}
            </>
          )}

          {!canFetch && (
            <p className="rounded-xl bg-canvas-subtle px-3 py-2 text-[12.5px] text-foreground-muted">
              {canLookup ? (
                <>
                  Ingen bolagsregister-leverantör är ansluten.{' '}
                  <Link href="/installningar/integrationer" className="font-semibold text-link hover:underline">
                    Anslut Roaring under Inställningar → Integrationer
                  </Link>{' '}
                  för att hämta färsk data. Du kan fortfarande bedöma sparade data.
                </>
              ) : (
                'Färska uppslag hos bolagsregistret görs av inkubatorledningen (de debiteras per anrop). Du kan bedöma det som redan är sparat för ett portföljbolag.'
              )}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {canFetch && provider && (
              <button
                type="submit"
                name="mode"
                value="register"
                disabled={pending || !canSubmitFetch}
                className="inline-flex items-center justify-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? 'Hämtar koncernen…' : `Hämta från ${provider.name} och bedöm`}
              </button>
            )}
            {target === 'portfolio' && selectedStartup && (
              <button
                type="submit"
                name="mode"
                value="saved"
                disabled={pending}
                className="rounded-full border border-strong px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-canvas-subtle disabled:cursor-wait disabled:opacity-60"
              >
                Bedöm sparade data
              </button>
            )}
          </div>
        </form>

        {state.error && (
          <p className="mt-4 rounded-xl bg-movexum-pastell-orange px-3 py-2 text-[12.5px] text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange">
            {state.error}
          </p>
        )}
      </section>

      <div ref={resultRef} className="space-y-6">
        {current && <AssessmentView assessment={current} />}
        {current && <ManualFactsPanel assessment={current} onUpdated={onUpdated} />}
      </div>
    </div>
  );
}

/** Tom ägartabell: skilj "hämtades inte" från "registret visar inga ägare". */
function ownershipEmptyText(c: CompanyAssessment): string {
  const missing = [!c.groupStructureFetched ? 'Koncernstruktur' : null, !c.beneficialOwnersFetched ? 'Verklig huvudman' : null].filter(
    (v): v is string => v !== null
  );
  if (!c.dataFetched) return 'Inget uppslag gjort för bolaget.';
  if (missing.length > 0) return `Ägarbilden hämtades inte — välj ${missing.join(' + ')} vid hämtningen.`;
  return 'Registret visar inga ägare (bara majoritetsrelationer och fysiska personer med ≥ 25 % syns) — kontrollera aktieboken.';
}

function CompanyBlock({ c }: { c: CompanyAssessment }) {
  const title = c.name || formatOrgNr(c.orgNr) || 'Okänt bolag';
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-[13.5px] font-semibold text-foreground">
          {c.role === 'subject' ? `Kan ${title} ta emot företagsstöd?` : title}
          {c.orgNr ? <span className="ml-2 text-[12px] font-normal text-foreground-subtle mx-tnum">{formatOrgNr(c.orgNr)}</span> : null}
        </h4>
        {c.role !== 'subject' && (
          <p className="text-[12.5px] text-foreground-muted">
            <span className={`mr-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.relation === 'linked' ? VERDICT_TONE.no : WARN_TONE}`}>
              {c.relationLabel}
            </span>
            {c.shareLabel} {c.indirect ? '(indirekt) ' : ''}— {c.reason}
          </p>
        )}
        {!c.dataFetched && c.role !== 'subject' && (
          <p className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${WARN_TONE}`}>
            Inget uppslag gjort för bolaget — grundförutsättningarna kan inte prövas.
          </p>
        )}
      </div>
      {c.conditions.length > 0 && <CheckList checks={c.conditions} />}
      {(c.dataFetched || c.owners.length > 0) && (
        <OwnershipTable
          rows={c.owners}
          caption={c.role === 'subject' ? `Ägarbild: ${title}` : `Vem äger ${title}`}
          emptyText={ownershipEmptyText(c)}
        />
      )}
      {c.holdings.length > 0 && <OwnershipTable rows={c.holdings} caption={`${title} äger`} />}
    </div>
  );
}

function AssessmentView({
  assessment
}: {
  assessment: ExcellenceAssessment;
}) {
  const { subject, result } = assessment;
  const subjectName = subject.name || 'Startup-bolaget';
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
  const irl = result.irl;
  const hasIrlDims = !!irl && [irl.crl, irl.brl, irl.tmrl, irl.srl].some((v) => typeof v === 'number');

  return (
    <section className="space-y-6">
      <header className="border-b border-default pb-3">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
          {assessment.mode === 'register'
            ? `Färskt från ${assessment.providerName}${
                assessment.savedToCards && assessment.savedToCards.length > 0
                  ? ' · sparat på bolagskortet'
                  : assessment.subject.startupId
                    ? ' · kunde inte sparas på bolagskortet'
                    : ' · bolaget finns inte i plattformen (inget bolagskort att spara på)'
              }`
            : 'Sparade data i plattformen'}
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
            {assessment.file && (
              <a
                href={assessment.file.href}
                className="inline-flex items-center rounded-full bg-brand px-3.5 py-1.5 text-[12.5px] font-semibold text-brand-foreground hover:bg-brand-hover"
              >
                Ladda ned PDF
              </a>
            )}
            {subject.startupId && (
              <Link href={`/startups/${subject.startupId}`} className="text-[12.5px] font-semibold text-link hover:underline">
                Öppna bolagskortet →
              </Link>
            )}
          </div>
        </div>
        {/* Var bedömningen ligger (§ 51.3): PDF i den inloggades Filer, i
            bolagets mapp när det är ett portföljbolag. Fail-soft: ett
            lagringsfel visas, bedömningen visas ändå. */}
        {/* Registerdata på bolagskortet (§ 51.4): vad som skrevs var —
            samma skrivväg som "Synka från <leverantör>". Fel visas per bolag. */}
        {assessment.savedToCards && assessment.savedToCards.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[12.5px] text-foreground-muted">
            {assessment.savedToCards.map((c) => (
              <li key={c.startupId}>
                {c.errors.length === 0 ? 'Sparat på bolagskortet för ' : 'Delvis sparat på bolagskortet för '}
                <Link href={`/startups/${c.startupId}`} className="font-semibold text-link hover:underline">
                  {c.name || 'bolaget'}
                </Link>
                {c.parts.length > 0 ? `: ${describeRegistryParts(c.parts)}` : ''}
                {c.financialsUpserted > 0 || c.ownershipWritten > 0 ? (
                  <span className="mx-tnum">
                    {' '}
                    ({c.financialsUpserted} årsrader, {c.ownershipWritten} ägarrader)
                  </span>
                ) : null}
                {c.errors.length > 0 && (
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${WARN_TONE}`}>{c.errors.join('; ')}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {assessment.file ? (
          <p className="mt-2 text-[12.5px] text-foreground-muted">
            Sparad som PDF i{' '}
            <Link
              href={assessment.file.startupId ? `/filer?vy=bolag&bolag=${assessment.file.startupId}` : '/filer'}
              className="font-semibold text-link hover:underline"
            >
              Filer{assessment.file.startupId ? ` → Bolag → ${subjectName}` : ' → Rapporter & uppföljning'}
            </Link>{' '}
            (<span className="mx-tnum">{assessment.file.filename}</span>)
            {!assessment.file.startupId && ' — bolaget finns inte i plattformen, så filen ligger utan bolagsmapp.'}
          </p>
        ) : assessment.fileError ? (
          <p className={`mt-2 inline-block rounded-xl px-3 py-1.5 text-[12.5px] ${WARN_TONE}`}>{assessment.fileError}</p>
        ) : null}
      </header>

      {assessment.cost && (
        <p
          className={`rounded-xl border px-3 py-2 text-[12.5px] mx-tnum ${
            assessment.cost.complete
              ? 'border-default bg-canvas-subtle text-foreground'
              : 'border-movexum-morkgul/40 bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul'
          }`}
        >
          <span className="font-semibold">Denna bedömning kostade hos {assessment.providerName}:</span>{' '}
          {assessment.cost.companies} bolag, {assessment.cost.calls} {assessment.cost.calls === 1 ? 'anrop' : 'anrop'} ={' '}
          {formatRegistryCost(assessment.cost)}.{' '}
          <span className="font-normal opacity-90">
            Uppskattning enligt angivna priser (valda delar × uppslagna bolag) — {assessment.providerName}s faktura är facit.
          </span>
        </p>
      )}

      {assessment.lookupWarnings.length > 0 && (
        <ul className={`rounded-xl px-3 py-2 text-[12.5px] ${WARN_TONE}`}>
          {assessment.lookupWarnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {/* Vad leverantören faktiskt svarade — synligt direkt, inte hopfällt:
          det är här man ser varför en del blev "okänt" (404 = inga uppgifter,
          403 = inte i paketet, fält som saknades i svaret). PII-fritt. */}
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

      {/* Review-raden — som i Combly-dokumentet: datum, GBER, Vinnova, kommentar. */}
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
                {result.comment ? <p className="whitespace-pre-line text-foreground">{result.comment}</p> : null}
                <p className={result.comment ? 'mt-1 text-[11.5px]' : ''}>
                  Deterministiskt underlag — {counts.yes} ja, {counts.no} nej, {counts.unknown} okänt. Screening och beslut görs av controllern.
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Steg 1 */}
      <div className="space-y-5">
        <h3 className="text-[14px] font-semibold text-foreground">Steg 1 — Företagsstöd enligt art. 22 GBER eller de minimis</h3>
        <CompanyBlock c={result.companies[0]} />

        <div>
          <h4 className="text-[13.5px] font-semibold text-foreground">Fristående företag?</h4>
          <div className="mt-2">
            <CheckList checks={[result.standalone]} />
          </div>
        </div>

        {result.companies.slice(1).map((c) => (
          <CompanyBlock key={c.orgNr || c.name} c={c} />
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
                {result.thresholds.rows.map((r) => (
                  <tr key={r.orgNr || r.name} className="border-t border-default">
                    <td className="px-3 py-1.5 text-foreground">
                      {r.name || formatOrgNr(r.orgNr)}
                      {r.note ? <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium ${WARN_TONE}`}>{r.note}</span> : null}
                    </td>
                    <td className="px-3 py-1.5 text-foreground-muted mx-tnum">
                      {r.role === 'subject' ? 'Startup' : r.role === 'linked' ? '100 % (anknutet)' : `${Math.round(r.weight * 100)} % (partner)`}
                    </td>
                    <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{r.year ?? '–'}</td>
                    <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{r.employees ?? '–'}</td>
                    <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{sek(r.revenue_sek)}</td>
                    <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{sek(r.balance_sheet_sek)}</td>
                  </tr>
                ))}
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
            <CheckList checks={[result.thresholds.check, result.deMinimis]} />
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
        {assessment.founders && assessment.founders.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-default">
            <table className="w-full text-[12.5px]">
              <caption className="bg-canvas-subtle px-3 py-2 text-left text-[12px] font-semibold text-foreground">
                Grundarteamet ({assessment.foundersSource === 'manual' ? 'manuellt inmatat' : 'ur teamet på bolagskortet'})
                {assessment.facts.maturity_phase ? ` · fas: ${MATURITY_PHASE_LABEL[assessment.facts.maturity_phase]}` : ''}
                {assessment.facts.research_spinoff ? ' · forskningsavknoppning' : ''}
              </caption>
              <thead className="text-left text-[11px] uppercase tracking-wider text-foreground-subtle">
                <tr className="border-t border-default">
                  <th className="px-3 py-1.5 font-medium">Namn</th>
                  <th className="px-3 py-1.5 font-medium">% kapital</th>
                  <th className="px-3 py-1.5 font-medium">Engagemang (% av heltid)</th>
                </tr>
              </thead>
              <tbody>
                {assessment.founders.map((f, i) => (
                  <tr key={i} className="border-t border-default">
                    <td className="px-3 py-1.5 text-foreground">
                      {f.name}
                      {f.researcher ? <span className="ml-1 text-[11px] text-foreground-subtle">(forskare)</span> : null}
                    </td>
                    <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{pctText(f.equity_pct)}</td>
                    <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{pctText(f.engagement_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <CheckList checks={result.vinnovaChecks} />

        <div className="overflow-x-auto rounded-xl border border-default">
          <table className="w-full text-[12.5px]">
            <caption className="bg-canvas-subtle px-3 py-2 text-left text-[12px] font-semibold text-foreground">
              Bedömning IRL{irl?.assessedAt ? ` (senast ${irl.assessedAt})` : ''}
              {typeof irl?.level === 'number' ? ` · sammanvägd nivå ${irl.level}` : ''}
              {irl?.manualLevels ? ' · nivåer manuellt angivna' : ''}
            </caption>
            <thead className="text-left text-[11px] uppercase tracking-wider text-foreground-subtle">
              <tr className="border-t border-default">
                <th className="px-3 py-1.5 font-medium">Kategori</th>
                <th className="px-3 py-1.5 font-medium">Nivå</th>
                <th className="px-3 py-1.5 font-medium">Motivering (metrics)</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['CRL', irl?.crl],
                  ['BRL', irl?.brl],
                  ['TMRL', irl?.tmrl],
                  ['SRL', irl?.srl]
                ] as const
              ).map(([k, v]) => (
                <tr key={k} className="border-t border-default">
                  <td className="px-3 py-1.5 font-medium text-foreground">{k}</td>
                  <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{typeof v === 'number' ? v : '–'}</td>
                  <td className={`px-3 py-1.5 ${irl?.notes?.[k.toLowerCase() as 'crl' | 'brl' | 'tmrl' | 'srl'] ? 'text-foreground' : 'text-foreground-subtle'}`}>
                    {irl?.notes?.[k.toLowerCase() as 'crl' | 'brl' | 'tmrl' | 'srl'] ??
                      (hasIrlDims ? 'Motiveras av coachen (Manuella svar)' : 'Ingen readiness-bedömning i plattformen — nivå och motivering under Manuella svar')}
                  </td>
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
        <CheckList checks={[result.excellence]} />
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
        <summary className="cursor-pointer text-[13px] font-semibold text-foreground">Bokslut per bolag och noteringar från tolkningen</summary>
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
                          <td className="px-3 py-1.5 text-foreground-muted">
                            {f.dividend_reported ? sek(f.dividend_sek ?? 0) : '–'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
          {assessment.notes.map((n) => (
            <div key={n.orgNr}>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                Noteringar — {n.name || formatOrgNr(n.orgNr)}
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12px] text-foreground-muted">
                {n.notes.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
