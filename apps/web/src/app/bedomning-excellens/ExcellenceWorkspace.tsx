'use client';

import Link from 'next/link';
import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { MAX_RELATED_COMPANIES } from '@platform/shared';
import { assessExcellenceAction, type ExcellenceAssessment, type ExcellenceAssessmentState } from '@/lib/actions/excellence';
import { RegistryPartsPicker, useRegistryPartSelection } from '@/components/integrations/RegistryPartsPicker';
import type { RegistryPartId } from '@/lib/integrations/company-registry/parts';
import type { RegistryPricing } from '@/lib/integrations/company-registry/pricing';
import { AssessmentReport } from './AssessmentReport';
import { ScreeningRequestComposer } from './ScreeningRequestComposer';

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
  /** Kollegor en begäran om komplettering kan gå till (§ 51.6). */
  coaches: Array<{ id: string; name: string }>;
  /** Den inloggades visningsnamn (avsändare i den kopierade texten). */
  senderName?: string;
}

const initialState: ExcellenceAssessmentState = {};

const inputCls =
  'mt-1 block w-full rounded-xl border border-default bg-canvas px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

// "Bedömning excellens" (CLAUDE.md § 51): välj bolag → hämta färskt från
// bolagsregistret för hela koncernen (inget sparas) eller bedöm det som redan
// är sparat → ett underlag i samma ordning som referensbedömningen
// "Bedömning Vinnova Combly".
export function ExcellenceWorkspace({ startups, registries, canLookup, initialStartupId, coaches, senderName }: Props) {
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
          Hämta färskt från bolagsregistret (inget sparas) eller bedöm det som redan är sparat för ett
          portföljbolag. Anknutna och partnerföretag i ägarbilden slås upp automatiskt så att
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
                  hint="Ingen del är förvald — bocka i det som ska begäras ut; varje anrop debiteras och inget sparas. För en komplett bedömning: Koncernstruktur (hittar HELA koncernen: moder-, syster- och dotterbolag), Grunddata (ålder/status/bolagsform — avgör även börsnotering), Bokslut (tröskelvärde, utdelning) och Verklig huvudman (fristående?, indirekt grundarägande)."
                  disabled={pending}
                  pricing={provider.pricing}
                  companies={1}
                  costContext={`För startup-bolaget. Varje bolag i koncernen slås därefter upp med BARA grunddata + bokslut av ditt val (koncernen är redan känd; verklig huvudman bara för moderbolagen), högst ${MAX_RELATED_COMPANIES} bolag. Den faktiska summan visas i resultatet.`}
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
        {current && (
          <AssessmentReport
            assessment={current}
            onUpdated={onUpdated}
            fetchMore={
              current.mode === 'register' && canFetch && provider && current.subject.orgNr
                ? { providerSlug: provider.slug, providerName: provider.name, parts: provider.parts, endpoints: provider.partEndpoints, pricing: provider.pricing }
                : undefined
            }
          />
        )}
        {current && <ScreeningRequestComposer assessment={current} coaches={coaches} senderName={senderName} />}
      </div>
    </div>
  );
}
