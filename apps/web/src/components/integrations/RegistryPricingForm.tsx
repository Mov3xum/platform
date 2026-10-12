'use client';

import { useActionState } from 'react';
import { saveRegistryPricingAction, type RegistryPricingState } from '@/lib/actions/integrations';
import {
  REGISTRY_PART_META,
  type RegistryPartId
} from '@/lib/integrations/company-registry/parts';
import {
  estimateRegistryCost,
  formatRegistryCost,
  formatSek,
  REGISTRY_PRICING_LAYER_LABEL,
  registryPricingEnvKeys,
  type RegistryPricing
} from '@/lib/integrations/company-registry/pricing';

// Kostnad per anrop (CLAUDE.md § 11.8): ledningen anger vad leverantören
// debiterar per API-anrop och datadel (credits) och kronor per credit enligt
// avtalet. Visas sedan vid varje hämtning — kryssrutorna, "Testa mot org-nr",
// portföljsynk, bolagskortet och Bedömning excellens — så controllern ser
// kostnaden INNAN ett uppslag görs. Plattformen gissar aldrig en prislista.

interface Props {
  tenantIntegrationId: string;
  providerSlug: string;
  providerName: string;
  parts: RegistryPartId[];
  pricing: RegistryPricing;
  /** Antal bolag med org-nr i portföljen — för exemplet "en hel portföljsynk". */
  portfolioCompanies?: number;
}

const initialState: RegistryPricingState = {};

const inputCls =
  'mt-1 block w-full rounded-xl border border-default bg-canvas px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila mx-tnum';

const SOURCE_LABEL: Record<RegistryPricing['source'], string> = {
  tenant: 'angivna här',
  env: 'från web-appens miljövariabler (standard)',
  provider: 'leverantörens publicerade listpris',
  mixed: 'från olika nivåer (se per fält nedan)',
  none: 'inte angivna'
};

export function RegistryPricingForm({ tenantIntegrationId, providerSlug, providerName, parts, pricing, portfolioCompanies }: Props) {
  const [state, formAction, pending] = useActionState(saveRegistryPricingAction, initialState);
  const current = state.pricing ?? pricing;
  const envKeys = registryPricingEnvKeys(providerSlug);
  const perCompany = estimateRegistryCost(current, parts, 1);
  const portfolio = portfolioCompanies ? estimateRegistryCost(current, parts, portfolioCompanies) : null;
  const provider = current.provider;
  const layerOf = (part: RegistryPartId) => current.fieldSources?.credits?.[part];
  const sekLayer = current.fieldSources?.sekPerCredit;

  return (
    <section id="kostnad" className="rounded-2xl border border-default bg-surface px-5 py-5">
      <h2 className="text-[14px] font-semibold text-foreground">Kostnad per anrop</h2>
      <p className="mt-1 text-[12px] text-foreground-muted">
        {providerName} debiterar per API-anrop i credits; vad en credit kostar i kronor följer ert
        avtal/paket. Ange värdena här så visas kostnaden vid varje hämtning — innan den görs och
        efteråt i synkloggen. Priserna är just nu <strong>{SOURCE_LABEL[current.source]}</strong>.
        Tomt fält = pris ej angivet (visas som okänt, aldrig som 0 kr).
      </p>
      {provider && (
        <div className="mt-3 rounded-xl border border-default bg-canvas-subtle px-3 py-2 text-[12px] text-foreground-muted">
          <span className="font-semibold text-foreground">Publicerat listpris ({provider.providerName}):</span>{' '}
          {provider.sekPerCredit !== null ? (
            <span className="mx-tnum">{formatSek(provider.sekPerCredit)} per credit</span>
          ) : (
            'kr per credit publiceras inte i text'
          )}
          {Object.keys(provider.creditsPerPart).length === 0 && (
            <> · credits per API publiceras inte i text — {provider.consumptionHint}</>
          )}
          <span className="block text-[11px] text-foreground-subtle">
            Källa: {provider.sourceLabel}, läst {provider.publishedAt}. {provider.tierNote} Ett värde ni anger
            här vinner alltid över listpriset.
          </span>
        </div>
      )}
      <form action={formAction} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="tenant_integration_id" value={tenantIntegrationId} />
        <input type="hidden" name="provider_slug" value={providerSlug} />
        <div className="grid gap-3 sm:grid-cols-2">
          {parts.map((part) => (
            <label key={part} className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                {REGISTRY_PART_META[part].label} — credits per anrop
              </span>
              <input
                name={`credits_${part}`}
                inputMode="decimal"
                defaultValue={current.creditsPerPart[part] ?? ''}
                placeholder="t.ex. 1"
                className={inputCls}
                disabled={pending}
              />
              <span className="mt-0.5 block text-[11px] text-foreground-subtle">
                {provider?.productNames[part] && (
                  <>
                    Hos {provider.providerName}: {provider.productNames[part]}.{' '}
                  </>
                )}
                {layerOf(part) && current.creditsPerPart[part] !== undefined && (
                  <>Nuvarande värde: {REGISTRY_PRICING_LAYER_LABEL[layerOf(part)!]}. </>
                )}
                Miljövariabel: <span className="mx-tnum">{envKeys.credits[part]}</span>
              </span>
            </label>
          ))}
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Kronor per credit</span>
            <input
              name="sek_per_credit"
              inputMode="decimal"
              defaultValue={current.sekPerCredit ?? ''}
              placeholder={provider?.sekPerCredit !== null && provider?.sekPerCredit !== undefined ? `listpris ${provider.sekPerCredit}` : 't.ex. 0,20'}
              className={inputCls}
              disabled={pending}
            />
            <span className="mt-0.5 block text-[11px] text-foreground-subtle">
              {sekLayer && current.sekPerCredit !== null && <>Nuvarande värde: {REGISTRY_PRICING_LAYER_LABEL[sekLayer]}. </>}
              Miljövariabel: <span className="mx-tnum">{envKeys.sekPerCredit}</span>
            </span>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Notering (valfri)</span>
            <input
              name="note"
              defaultValue={current.note ?? ''}
              placeholder="t.ex. Paket 500 credits/mån, avtal 2026"
              maxLength={200}
              className={inputCls}
              disabled={pending}
            />
            <span className="mt-0.5 block text-[11px] text-foreground-subtle">Inga personuppgifter.</span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl border border-strong px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-canvas-subtle disabled:cursor-wait disabled:opacity-60"
          >
            {pending ? 'Sparar…' : 'Spara priser'}
          </button>
          <span className="text-[12px] text-foreground-muted mx-tnum">
            Ett bolag, alla delar: {formatRegistryCost(perCompany)}
            {portfolio ? ` · Hela portföljen (${portfolio.companies} bolag): ${formatRegistryCost(portfolio)}` : ''}
          </span>
        </div>
      </form>
      {state.error && (
        <p className="mt-3 rounded-xl bg-movexum-pastell-orange px-3 py-2 text-xs text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange">
          {state.error}
        </p>
      )}
      {state.warning && (
        <p className="mt-3 rounded-xl bg-movexum-pastell-gul px-3 py-2 text-xs text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul">
          {state.warning}
        </p>
      )}
      {state.success && !state.error && !state.warning && (
        <p className="mt-3 rounded-xl bg-movexum-pastell-gron px-3 py-2 text-xs text-movexum-morkgron dark:bg-movexum-morkgron/30 dark:text-movexum-pastell-gron">
          Priserna är sparade och visas nu vid varje hämtning från {providerName}.
        </p>
      )}
    </section>
  );
}
