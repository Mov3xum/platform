'use client';

import Link from 'next/link';
import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import {
  assessExcellenceAction,
  completeScreeningCaseAction,
  reopenScreeningCaseAction,
  type ExcellenceAssessment,
  type ExcellenceAssessmentState
} from '@/lib/actions/excellence';
import { RegistryPartsPicker, useRegistryPartSelection } from '@/components/integrations/RegistryPartsPicker';
import { syncableParts, type RegistryPartId } from '@/lib/integrations/company-registry/parts';
import type { RegistryPricing } from '@/lib/integrations/company-registry/pricing';
import { logRegistryDiagnostics } from '@/lib/integrations/company-registry/console-diagnostics';
import { AssessmentReport } from './AssessmentReport';

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

/** Ärendet som visas (§ 51.10). */
export interface CaseInfo {
  id: string;
  status: 'open' | 'done';
  name?: string;
  orgNr: string;
  startupId?: string;
  lastAssessedAt?: string;
  lastAssessedByName?: string;
  createdByName?: string;
  completedAt?: string;
  completedByName?: string;
}

interface Props {
  startups: StartupOption[];
  registries: RegistryOption[];
  canLookup: boolean;
  /** Modulens roller — klarmarkerar och öppnar ärenden. */
  canManage: boolean;
  initialStartupId?: string;
  /** Ett sparat ärende som fortsätts (underlaget räknat utan nya registeranrop). */
  initialCase?: CaseInfo;
  initialAssessment?: ExcellenceAssessment;
  /** Pågående ärenden per org-nr — tips om att fortsätta i stället för att hämta igen. */
  openCasesByOrg: Record<string, { id: string; name?: string }>;
  /** Kollegor en begäran om komplettering kan gå till (§ 51.6). */
  coaches: Array<{ id: string; name: string }>;
  /** Den inloggades visningsnamn (avsändare i den kopierade texten). */
  senderName?: string;
}

const initialState: ExcellenceAssessmentState = {};

const inputCls =
  'mt-1 block w-full rounded-xl border border-default bg-canvas px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

const orgDigits = (v: string) => v.replace(/\D/g, '').slice(-10);

function dateText(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'medium', timeStyle: 'short' });
}

// "Bedömning excellens" (CLAUDE.md § 51): välj bolag → hämta färskt från
// bolagsregistret för hela koncernen (inget sparas på bolagskortet) eller
// bedöm det som redan är sparat → ett underlag i samma ordning som
// referensbedömningen "Bedömning Vinnova Combly". Varje körning sparas i ett
// ärende (§ 51.10) som fortsätts utan nya registeranrop.
//
// Layout (§ 51.12): ETT huvud (`AssessmentHeader`) bär bolag, status, var
// underlaget kommer ifrån och ALLA knappar (klarmarkera, hämta på nytt, PDF,
// Filer, bolagskortet). Hämtningsformuläret fälls ut under huvudet i samma
// kort; rapporten ritar inget eget huvud.
export function ExcellenceWorkspace({
  startups,
  registries,
  canLookup,
  canManage,
  initialStartupId,
  initialCase,
  initialAssessment,
  openCasesByOrg,
  coaches,
  senderName
}: Props) {
  const [state, formAction, pending] = useActionState(assessExcellenceAction, initialState);
  // Ett uppslag som fallerade helt (t.ex. grunddata avvisades) syns även i DevTools-konsolen.
  useEffect(() => {
    if (state.error) logRegistryDiagnostics({ title: 'Bedömning excellens', error: state.error });
  }, [state.error]);
  const canFetch = canLookup && registries.length > 0;
  const caseStartup = initialCase?.startupId && startups.some((s) => s.id === initialCase.startupId) ? initialCase.startupId : undefined;
  const [target, setTarget] = useState<'portfolio' | 'orgnr'>(
    initialCase ? (caseStartup || !canFetch ? 'portfolio' : 'orgnr') : initialStartupId || !canFetch || startups.length > 0 ? 'portfolio' : 'orgnr'
  );
  const [startupId, setStartupId] = useState(caseStartup ?? initialStartupId ?? startups[0]?.id ?? '');
  const [orgNr, setOrgNr] = useState(initialCase && !caseStartup ? initialCase.orgNr : '');
  const [caseInfo, setCaseInfo] = useState<CaseInfo | undefined>(initialCase);
  // Bolagsvalet visas när ett nytt ärende skapas, när ärendet saknar
  // underlag eller när controllern uttryckligen vill hämta på nytt.
  const [showPicker, setShowPicker] = useState(!initialCase || !initialAssessment);
  const [providerSlug, setProviderSlug] = useState(registries[0]?.slug ?? '');
  const provider = registries.find((r) => r.slug === providerSlug) ?? registries[0];
  const selection = useRegistryPartSelection(provider?.slug ?? 'none', provider?.parts ?? []);
  const resultRef = useRef<HTMLDivElement>(null);
  // Senaste bedömningen — från en körning, en omräkning med manuella svar
  // eller ett sparat ärende som öppnats.
  const [current, setCurrent] = useState<ExcellenceAssessment | undefined>(initialAssessment);
  const syncCase = useCallback((a: ExcellenceAssessment) => {
    if (!a.caseId) return;
    setCaseInfo((prev) =>
      prev && prev.id === a.caseId
        ? { ...prev, lastAssessedAt: a.assessedAt, lastAssessedByName: a.assessedBy ?? prev.lastAssessedByName }
        : {
            id: a.caseId!,
            status: a.caseStatus ?? 'open',
            name: a.subject.name,
            orgNr: a.subject.orgNr,
            startupId: a.subject.startupId,
            lastAssessedAt: a.assessedAt,
            lastAssessedByName: a.assessedBy
          }
    );
    // Adressen pekar på ärendet så en omladdning fortsätter där vi är.
    const url = `/bedomning-excellens?arende=${a.caseId}`;
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, '', url);
  }, []);
  const onUpdated = useCallback(
    (a: ExcellenceAssessment) => {
      setCurrent(a);
      syncCase(a);
    },
    [syncCase]
  );

  useEffect(() => {
    if (state.assessment) {
      setCurrent(state.assessment);
      syncCase(state.assessment);
      setShowPicker(false);
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [state.assessment, syncCase]);

  const selectedStartup = startups.find((s) => s.id === startupId);
  const nothingSelected = !!provider && provider.parts.length > 1 && selection.selected.length === 0;
  const canSubmitFetch =
    canFetch && !nothingSelected && (target === 'portfolio' ? !!selectedStartup : orgNr.trim() !== '');
  const chosenDigits = orgDigits(target === 'portfolio' ? selectedStartup?.org_nr ?? '' : orgNr);
  const existingCase = !caseInfo && chosenDigits.length === 10 ? openCasesByOrg[chosenDigits] : undefined;

  const headerShown = !!(caseInfo || current);
  const picker = showPicker && (
    <div className={headerShown ? 'mt-4 border-t border-default pt-4' : ''}>
      <h2 className="text-[15px] font-semibold text-foreground">{caseInfo ? 'Hämta på nytt' : 'Nytt ärende — välj bolag'}</h2>
      <form action={formAction} className="mt-4 flex flex-col gap-4">
        {caseInfo && <input type="hidden" name="case_id" value={caseInfo.id} />}
        {/* Ett ärende gäller ett bolag — valet är låst (en disabled select skickas inte). */}
        {caseInfo && target === 'portfolio' && <input type="hidden" name="startup_id" value={startupId} />}
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Bolag">
          {(['portfolio', 'orgnr'] as const).map((t) => {
            const disabled = (t === 'orgnr' && !canFetch) || !!caseInfo;
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
              <select
                name={caseInfo ? undefined : 'startup_id'}
                value={startupId}
                onChange={(e) => setStartupId(e.target.value)}
                disabled={!!caseInfo}
                className={inputCls}
              >
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
              readOnly={!!caseInfo}
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
                disabled={pending}
                pricing={provider.pricing}
                companies={1}
                showCost={false}
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

      {existingCase && (
        <p className="mt-4 rounded-xl bg-canvas-subtle px-3 py-2 text-[12.5px] text-foreground-muted">
          Det finns ett pågående ärende för {existingCase.name || 'bolaget'}.{' '}
          <Link href={`/bedomning-excellens?arende=${existingCase.id}`} className="font-semibold text-link hover:underline">
            Fortsätt ärendet
          </Link>{' '}
          utan ny hämtning — en ny körning fyller på det.
        </p>
      )}

      {state.error && (
        <p className="mt-4 rounded-xl bg-movexum-pastell-orange px-3 py-2 text-[12.5px] text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange">
          {state.error}
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {headerShown ? (
        <AssessmentHeader
          info={caseInfo}
          assessment={current}
          canManage={canManage}
          canRefetch={canFetch || startups.some((s) => s.id === (caseInfo?.startupId ?? current?.subject.startupId))}
          pickerOpen={showPicker}
          onTogglePicker={() => setShowPicker((v) => !v)}
        >
          {picker}
        </AssessmentHeader>
      ) : (
        <section className="rounded-2xl border border-default bg-surface px-5 py-5">{picker}</section>
      )}

      <div ref={resultRef} className="space-y-6">
        {current && (
          <AssessmentReport
            assessment={current}
            onUpdated={onUpdated}
            coaches={coaches}
            senderName={senderName}
            fetchMore={
              current.mode === 'register' && canFetch && provider && current.subject.orgNr
                ? {
                    providerSlug: provider.slug,
                    providerName: provider.name,
                    // Ägarnas andra bolag söks bara för startup-bolaget (§ 51.11).
                    parts: syncableParts(provider.parts),
                    endpoints: provider.partEndpoints,
                    pricing: provider.pricing
                  }
                : undefined
            }
          />
        )}
      </div>
    </div>
  );
}

/**
 * Rapportens och ärendets huvud i ETT (§ 51.12): bolag, org-nr, status,
 * varifrån underlaget kommer, senast sparad — och alla knappar på en rad.
 * Hämtningsformuläret (`children`) fälls ut i samma kort.
 */
function AssessmentHeader({
  info,
  assessment,
  canManage,
  canRefetch,
  pickerOpen,
  onTogglePicker,
  children
}: {
  info?: CaseInfo;
  assessment?: ExcellenceAssessment;
  canManage: boolean;
  canRefetch: boolean;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  children?: React.ReactNode;
}) {
  const done = info?.status === 'done';
  const subject = assessment?.subject;
  const rawOrg = info?.orgNr ?? subject?.orgNr ?? '';
  const org = rawOrg.length === 10 ? `${rawOrg.slice(0, 6)}-${rawOrg.slice(6)}` : rawOrg;
  const name = info?.name || subject?.name || org;
  const startupId = info?.startupId ?? subject?.startupId;
  const eyebrow = [
    assessment ? (assessment.mode === 'register' ? `Färskt från ${assessment.providerName}` : 'Sparade data i plattformen') : null,
    assessment?.recomputed ? 'omräknat på sparat underlag' : null,
    assessment ? dateText(assessment.assessedAt) : null
  ]
    .filter(Boolean)
    .join(' · ');
  const sub = [org, subject?.bolagsform, subject?.kommun, subject?.industri].filter(Boolean).join(' · ');
  const saved = info?.lastAssessedAt ? `Senast sparad ${dateText(info.lastAssessedAt)}${info.lastAssessedByName ? ` av ${info.lastAssessedByName}` : ''}` : '';
  const completed = done && info?.completedAt ? `Klarmarkerat ${dateText(info.completedAt)}${info.completedByName ? ` av ${info.completedByName}` : ''}` : '';
  const SECONDARY = 'inline-flex items-center rounded-full border border-strong px-3 py-1.5 text-[12.5px] font-semibold text-foreground transition hover:bg-canvas-subtle';
  const PRIMARY = 'inline-flex items-center rounded-full bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-brand-foreground transition hover:bg-brand-hover';
  const LINK = 'text-[12.5px] font-semibold text-link hover:underline';
  return (
    <section className="rounded-2xl border border-default bg-surface px-5 py-4">
      {eyebrow && <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">{eyebrow}</p>}
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-foreground">{name}</h2>
            {info && (
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  done
                    ? 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron'
                    : 'bg-canvas-muted text-foreground-muted'
                }`}
              >
                {done ? 'Klarmarkerat' : 'Pågående ärende'}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12.5px] text-foreground-muted mx-tnum">{sub}</p>
          {(saved || completed) && (
            <p className="mt-0.5 text-[12px] text-foreground-subtle mx-tnum">
              {saved}
              {saved && completed ? ' · ' : ''}
              {completed}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {startupId && (
            <Link href={`/startups/${startupId}`} className={LINK}>
              Bolagskortet
            </Link>
          )}
          {assessment?.file && (
            <Link href={assessment.file.startupId ? `/filer?vy=bolag&bolag=${assessment.file.startupId}` : '/filer'} className={LINK}>
              Visa i Filer
            </Link>
          )}
          {assessment && !assessment.file && assessment.caseId && (
            <a href={`/api/bedomning-excellens/${assessment.caseId}/pdf`} target="_blank" rel="noopener noreferrer" className={SECONDARY}>
              Förhandsgranska PDF
            </a>
          )}
          {assessment?.file && (
            <a href={assessment.file.href} className={SECONDARY}>
              Ladda ned PDF
            </a>
          )}
          {canRefetch && (
            <button type="button" onClick={onTogglePicker} aria-expanded={pickerOpen} className={SECONDARY}>
              {pickerOpen ? 'Stäng' : 'Hämta på nytt'}
            </button>
          )}
          {canManage && info && (
            <form action={done ? reopenScreeningCaseAction : completeScreeningCaseAction}>
              <input type="hidden" name="case_id" value={info.id} />
              <button type="submit" className={PRIMARY}>
                {done ? 'Öppna igen' : 'Klarmarkera ärende'}
              </button>
            </form>
          )}
        </div>
      </div>
      {assessment?.caseError && (
        <p className="mt-3 rounded-xl bg-movexum-pastell-orange px-3 py-2 text-[12.5px] text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange">
          {assessment.caseError}
        </p>
      )}
      {assessment?.fileError && (
        <p className="mt-3 inline-block rounded-xl bg-movexum-pastell-gul px-3 py-1.5 text-[12.5px] text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul">
          {assessment.fileError}
        </p>
      )}
      {children}
    </section>
  );
}
