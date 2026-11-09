'use client';

import { useState } from 'react';
import {
  SCREENING_NOTE_MAX,
  type CompanyManualCondition,
  type IrlAxis,
  type ManualAnswer,
  type ScreeningCheck,
  type ScreeningOwnershipEntry,
  type ScreeningSource,
  type ScreeningVerdict
} from '@platform/shared';
import type { ExcellenceAssessmentState } from '@/lib/actions/excellence';
import type { RegistryPartId } from '@/lib/integrations/company-registry/parts';
import type { RegistryPricing } from '@/lib/integrations/company-registry/pricing';

// Delade byggstenar för rapporten i Bedömning excellens (CLAUDE.md § 51.9,
// § 51.12): toner, etiketter, frågetexter och raden `CheckRow`. Färgen är
// reserverad för UTFALL (grön = ja, orange = nej, gul = varning); relationer,
// källor och "uppslag gjort" ritas neutralt så färgen fortsätter betyda
// något.

/** Leverantören som fler uppslag ur koncernkartan görs mot (§ 51.7). */
export interface FetchMoreConfig {
  providerSlug: string;
  providerName: string;
  parts: RegistryPartId[];
  endpoints?: Partial<Record<RegistryPartId, string>>;
  pricing: RegistryPricing;
}

export const initialActionState: ExcellenceAssessmentState = {};
export const FACTS_FORM_ID = 'excellence-facts-form';

export const inputCls =
  'block w-full rounded-lg border border-default bg-canvas px-2.5 py-1 text-[12.5px] text-foreground outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

export const VERDICT_LABEL: Record<ScreeningVerdict, string> = { yes: 'Ja', no: 'Nej', unknown: 'Okänt' };
export const VERDICT_TONE: Record<ScreeningVerdict, string> = {
  yes: 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron',
  no: 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange',
  unknown: 'bg-canvas-muted text-foreground-muted'
};
export const WARN_TONE = 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul';
export const ERROR_TONE = 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange';
/** Neutral chip — relationer, roller, "uppslag gjort": information, inte utfall. */
export const NEUTRAL_TONE = 'bg-canvas-muted text-foreground-muted';
export const NEUTRAL_STRONG_TONE = 'bg-canvas-muted text-foreground';

export const SOURCE_LABEL: Record<ScreeningSource, string> = {
  register: 'Bolagsregister',
  platform: 'Plattformen',
  manual: 'Manuell kontroll'
};
export const PART_LABEL: Record<'group_structure' | 'beneficial_owners', string> = {
  group_structure: 'Koncernstruktur',
  beneficial_owners: 'Verklig huvudman'
};
export const OWNER_KIND_LABEL: Record<string, string> = {
  company: 'Bolag',
  person: 'Fysisk person',
  public_body: 'Offentlig/akademi',
  investor: 'Investerare',
  other: 'Okänd'
};
export const IRL_LABEL: Record<IrlAxis, string> = { crl: 'CRL', brl: 'BRL', tmrl: 'TMRL', srl: 'SRL' };
/** Övriga KTH-axlar ur bolagskortets bedömning (§ 52.2) — visas, ändras på bolagskortet. */
export const KTH_EXTRA_AXES = [
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
export interface QuestionMeta {
  question: string;
  /** Svarsalternativ som betyder "villkoret uppfyllt" (lagras som `yes`). */
  fulfilled: string;
  /** Svarsalternativ som betyder "villkoret INTE uppfyllt" (lagras som `no`). */
  failed: string;
  hint?: string;
}

export const CONDITION_QUESTION: Record<CompanyManualCondition, QuestionMeta> = {
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

export const STANDALONE_QUESTION: QuestionMeta = {
  question: 'Är bolaget fristående enligt aktieboken — inget företag äger 25 % eller mer, och bolaget äger inget sådant?',
  fulfilled: 'Ja — fristående (aktieboken kontrollerad)',
  failed: 'Nej — det finns ägare/innehav på 25 % eller mer',
  hint: 'Ett Nej gör bolaget anknutet/partner: lägg till bolagen i koncernkartan så prövas deras grundförutsättningar och tröskelvärden.'
};

export const VINNOVA_QUESTION: Partial<Record<string, QuestionMeta>> = {
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
export type VinnovaManualId = 'not_market_ready' | 'innovative' | 'other_criteria';
export const VINNOVA_MANUAL_IDS: VinnovaManualId[] = ['not_market_ready', 'innovative', 'other_criteria'];

export const EXCELLENCE_QUESTION: QuestionMeta = {
  question: 'Uppfyller bolaget villkoren för excellent inkubation?',
  fulfilled: 'Ja — villkoren uppfyllda',
  failed: 'Nej — uppfylls inte',
  hint: 'Har något hänt som påverkar rätten att ta emot inkubationsmedel? Beslutet registreras som förut på bolagskortet.'
};

export function sek(v?: number) {
  return typeof v === 'number' ? `${v.toLocaleString('sv-SE')} kr` : '–';
}

export function sekM(v?: number) {
  return typeof v === 'number' ? `${(v / 1_000_000).toLocaleString('sv-SE', { maximumFractionDigits: 2 })} Mkr` : '–';
}

export function pctText(v?: number) {
  return typeof v === 'number' ? `${v.toLocaleString('sv-SE')} %` : '–';
}

export function shareText(o: ScreeningOwnershipEntry) {
  if (typeof o.capital_pct === 'number' || typeof o.voting_pct === 'number') return null;
  if (typeof o.pct_min === 'number' || typeof o.pct_max === 'number') return `${o.pct_min ?? 0}–${o.pct_max ?? 100} %`;
  return '–';
}

export function formatOrgNr(v?: string) {
  if (!v) return '';
  return /^\d{10}$/.test(v) ? `${v.slice(0, 6)}-${v.slice(6)}` : v;
}

export function numberOrUndefined(raw: string): number | undefined {
  const v = raw.replace(/\s/g, '').replace(',', '.');
  if (v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function Verdict({ v }: { v: ScreeningVerdict }) {
  return (
    <span className={`inline-flex min-w-14 justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${VERDICT_TONE[v]}`}>
      {VERDICT_LABEL[v]}
    </span>
  );
}

/** Vad en punkt kan ändras till i rapporten. */
export interface Editable {
  meta: QuestionMeta;
  value: ManualAnswer | undefined;
  onChange: (v: ManualAnswer | undefined) => void;
}

/**
 * En punkt i rapporten. Utfallet (Ja/Nej/Okänt) står alltid till vänster.
 * Går punkten att ändra sitter svaret till höger i raden: en väljare med
 * uttydda alternativ (aldrig nakent Ja/Nej) och — när ett svar valts — ett
 * motiveringsfält under. Väljaren visas direkt när punkten är OKÄNT eller
 * redan manuellt besvarad; en punkt registret/plattformen avgjort visar
 * "Registret gäller · Ändra" och tar fram väljaren på samma plats vid klick
 * (§ 51.12). Ingen utfällning under raden. `action` = en länk till där
 * punkten ändras (t.ex. grundartabellen).
 */
export function CheckRow({ check, edit, action }: { check: ScreeningCheck; edit?: Editable; action?: { label: string; onClick: () => void } }) {
  const [revealed, setRevealed] = useState(false);
  const decided = check.verdict !== 'unknown' && check.source !== 'manual';
  const value = edit?.value;
  const showSelect = !!edit && (!decided || !!value || revealed);
  return (
    <li className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-start sm:gap-3">
      <Verdict v={check.verdict} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">{check.label}</p>
        <p className="mt-0.5 text-[12.5px] text-foreground-muted">{check.detail}</p>
      </div>
      <div className="flex shrink-0 flex-col gap-1 sm:w-64 sm:items-end">
        {edit && showSelect ? (
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
              <option value="">{decided ? `${SOURCE_LABEL[check.source]} gäller` : 'Ej besvarad'}</option>
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
        ) : edit ? (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            title={edit.meta.hint ? `${edit.meta.question} ${edit.meta.hint}` : edit.meta.question}
            className="text-[12px] font-semibold text-link hover:underline"
          >
            Ändra
          </button>
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

export function CheckList({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y divide-default rounded-2xl border border-default bg-surface">{children}</ul>;
}

/** Liten "Ändra"/"Stäng"-knapp för tabeller som redigeras i sin helhet. */
export function EditToggle({ editing, onToggle, label }: { editing: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={editing} className="text-[12px] font-semibold text-link hover:underline">
      {editing ? 'Stäng' : label}
    </button>
  );
}

/** Rubrikrad för en numrerad sektion i rapporten (hopp-navets mål). */
export function ReportSection({
  id,
  number,
  title,
  aside,
  children
}: {
  id: string;
  number?: string;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-default pb-1.5">
        <h3 className="text-[14px] font-semibold text-foreground">
          {number ? <span className="mr-2 text-foreground-subtle mx-tnum">{number}</span> : null}
          {title}
        </h3>
        {aside ? <div className="text-[12px] text-foreground-muted">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}
