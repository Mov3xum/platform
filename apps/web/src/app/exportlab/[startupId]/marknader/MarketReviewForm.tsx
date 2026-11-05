'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { approveMarketsAction } from '@/lib/actions/export-lab';
import { exportHref } from '@/lib/export-lab/tabs';
import { AiSubmitButton } from '@/components/impact/AiSubmitButton';
import { Badge, DimensionStatusChip, DistanceChip, MarketCodeBadge, MarketPriorityChip, PathwayChip, PriorityChip, ReadinessLevelBadge } from '@/components/exportlab/chips';
import { btnSecondary, card, inputClass, noticeError, noticeWarn } from '@/components/exportlab/ui';
import {
  EXPORT_CAGE_KEYS,
  EXPORT_CAGE_LABELS,
  EXPORT_CONFIDENCE_LABELS,
  EXPORT_DIMENSION_DESCRIPTIONS,
  EXPORT_DIMENSION_LABELS,
  EXPORT_ENTRY_MODE_LABELS,
  EXPORT_MARKET_PRIORITY_LABELS,
  EXPORT_PATHWAY_DESCRIPTIONS,
  KTH_IRL_AXES,
  regulatoryDomainName,
  type ExportMarket,
  type ExportMarketPriority,
  type ExportProfile
} from '@platform/shared';

/**
 * Marknadsgranskningen (steg 2): bolagsbild + väg + mognad + sex dimensioner
 * (läsning), sedan varje föreslagen marknad med CAGE och prioritet som
 * personalen sätter (Första/Nästa/Senare/Utesluten + kommentar), övervägda
 * marknader som kan lyftas, egen marknad och "Godkänn och fortsätt" — som
 * direkt kör informationsgapanalysen.
 */
export function MarketReviewForm({ startupId, assessmentId, profile, editable }: { startupId: string; assessmentId: string; profile: ExportProfile; editable: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [priorities, setPriorities] = useState<Record<string, ExportMarketPriority>>(() => Object.fromEntries(profile.candidateMarkets.map((m) => [m.code, m.priority])));
  const [promoted, setPromoted] = useState<string[]>([]);
  const promotedSet = new Set(promoted);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editable) return;
    const fd = new FormData(e.currentTarget);
    const decisions = profile.candidateMarkets.map((m) => ({ code: m.code, priority: String(fd.get(`priority-${m.code}`) ?? m.priority), comment: String(fd.get(`comment-${m.code}`) ?? '') }));
    const promotions = profile.consideredButNotPrioritized.filter((m) => promotedSet.has(m.code)).map((m) => ({ code: m.code, comment: String(fd.get(`promote-comment-${m.code}`) ?? '') }));
    const input = { decisions, promotions, summaryComment: String(fd.get('summaryComment') ?? ''), customCountry: String(fd.get('customCountry') ?? ''), customComment: String(fd.get('customComment') ?? '') };
    setError(null);
    start(async () => {
      const res = await approveMarketsAction(startupId, assessmentId, input);
      if (res.error && !res.next) {
        setError(res.error);
        return;
      }
      router.push(res.next ?? exportHref(startupId, 'analys'));
      router.refresh();
    });
  }

  const primaryCount = Object.values(priorities).filter((p) => p === 'PRIMARY').length;

  return (
    <form onSubmit={submit} className="space-y-5">
      <section className={card}>
        <h2 className="font-heading text-lg font-semibold text-foreground">Bolagsbild och internationell ambition</h2>
        <p className="mt-3 whitespace-pre-line leading-7 text-foreground">{profile.companySummary}</p>
        {profile.innovationSummary ? <p className="mt-3 leading-7 text-foreground"><span className="font-medium">Innovationen: </span>{profile.innovationSummary}</p> : null}
        {profile.internationalAmbitionSummary ? <p className="mt-2 leading-7 text-foreground"><span className="font-medium">Ambitionen: </span>{profile.internationalAmbitionSummary}</p> : null}
        {profile.warnings.length ? (
          <ul className={`mt-3 list-disc pl-5 ${noticeWarn}`}>
            {profile.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ) : null}
        {profile.assumptions.length ? (
          <details className="mt-3 text-sm text-foreground-muted">
            <summary className="cursor-pointer font-medium text-foreground">Antaganden ({profile.assumptions.length})</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {profile.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </details>
        ) : null}
        <label className="mt-4 block text-sm font-medium text-foreground">
          Kommentar eller korrigering
          <textarea name="summaryComment" rows={3} disabled={!editable} className={`${inputClass} mt-1`} placeholder="Skriv om något i bolagsbilden behöver förtydligas, korrigeras eller kompletteras." />
        </label>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className={card}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-lg font-semibold text-foreground">Internationaliseringsväg</h2>
            <PathwayChip pathway={profile.pathway.code} />
          </div>
          <p className="mt-2 text-sm text-foreground-muted">{EXPORT_PATHWAY_DESCRIPTIONS[profile.pathway.code]}</p>
          <p className="mt-3 leading-7 text-foreground">{profile.pathway.rationale}</p>
        </section>
        <section className={card}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-lg font-semibold text-foreground">Exportmognad</h2>
            <ReadinessLevelBadge level={profile.readinessLevel.level} />
          </div>
          <p className="mt-3 leading-7 text-foreground">{profile.readinessLevel.rationale}</p>
        </section>
      </div>

      <section className={card}>
        <h2 className="font-heading text-lg font-semibold text-foreground">Mognadsdimensioner kopplade till IRL</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {profile.readinessDimensions.map((d) => (
            <article key={d.key} className="rounded-xl bg-canvas-subtle p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-foreground">{EXPORT_DIMENSION_LABELS[d.key]}</p>
                <DimensionStatusChip status={d.status} />
              </div>
              <p className="mt-1 text-xs text-foreground-subtle">{EXPORT_DIMENSION_DESCRIPTIONS[d.key]}</p>
              <p className="mt-2 text-foreground-muted">{d.rationale}</p>
              <p className="mt-2 text-xs text-foreground-subtle">IRL: {d.irlAxes.map((a) => KTH_IRL_AXES.find((x) => x.key === a)?.short ?? a.toUpperCase()).join(', ')}</p>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-heading text-xl font-semibold text-foreground">Föreslagna marknader</h2>
          {editable ? <p className="text-xs text-foreground-subtle">{primaryCount === 1 ? 'En första marknad vald.' : primaryCount === 0 ? 'Välj en första marknad.' : `${primaryCount} marknader är markerade som första — välj helst en.`}</p> : null}
        </div>
        <div className="grid gap-4">
          {profile.candidateMarkets.map((m) => (
            <MarketCard key={m.code} market={m} priority={priorities[m.code] ?? m.priority} editable={editable} onPriority={(p) => setPriorities((c) => ({ ...c, [m.code]: p }))} />
          ))}
        </div>
      </section>

      {profile.consideredButNotPrioritized.length ? (
        <details className={card} open={promoted.length > 0}>
          <summary className="cursor-pointer font-semibold text-foreground">Övervägda men inte prioriterade marknader ({profile.consideredButNotPrioritized.length})</summary>
          <div className="mt-4 grid gap-3">
            {profile.consideredButNotPrioritized.map((m) => {
              const isPromoted = promotedSet.has(m.code);
              return (
                <article key={m.code} className={`rounded-xl p-4 text-sm ${isPromoted ? 'border border-movexum-bla/40 bg-movexum-pastell-bla/50 dark:bg-movexum-morkbla/30' : 'bg-canvas-subtle'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                        <MarketCodeBadge code={m.code} />
                        <span>{m.country}</span>
                        {isPromoted ? <Badge tone="info">Lyft till planen</Badge> : null}
                      </p>
                      <p className="mt-2 max-w-3xl text-foreground-muted">{m.rationale}</p>
                    </div>
                    {editable ? (
                      <button type="button" onClick={() => setPromoted((c) => (isPromoted ? c.filter((x) => x !== m.code) : [...c, m.code]))} className={btnSecondary}>
                        {isPromoted ? 'Ångra' : 'Lyft till planen'}
                      </button>
                    ) : null}
                  </div>
                  {isPromoted ? (
                    <label className="mt-3 block text-sm font-medium text-foreground">
                      Motivering <span className="font-normal text-foreground-subtle">(valfri)</span>
                      <textarea name={`promote-comment-${m.code}`} rows={2} disabled={!editable} className={`${inputClass} mt-1`} placeholder="Varför ska marknaden ingå? T.ex. befintlig kund, partner eller investerare." />
                    </label>
                  ) : null}
                </article>
              );
            })}
          </div>
        </details>
      ) : null}

      <section className={card}>
        <h2 className="font-heading text-lg font-semibold text-foreground">Lägg till egen marknad</h2>
        <p className="mt-1 text-sm text-foreground-muted">En marknad som saknas i förslaget — den prövas i nästa steg.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <input name="customCountry" placeholder="Land eller region" disabled={!editable} maxLength={120} className={inputClass} aria-label="Land eller region" />
          <input name="customComment" placeholder="Varför? T.ex. kundförfrågan, partner, språk i teamet" disabled={!editable} maxLength={2000} className={inputClass} aria-label="Motivering" />
        </div>
      </section>

      {profile.regulatoryDomains.length || profile.otherRegulations.length ? (
        <section className={card}>
          <h2 className="font-heading text-lg font-semibold text-foreground">Regelverk som sannolikt blir relevanta</h2>
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {profile.regulatoryDomains.map((r) => (
              <li key={r.key} className="rounded-xl bg-canvas-subtle p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-foreground">{r.name}</p>
                  <PriorityChip grade={r.relevance} />
                </div>
                <p className="mt-1 text-foreground-muted">{r.why}</p>
              </li>
            ))}
            {profile.otherRegulations.map((r, i) => (
              <li key={`o-${i}`} className="rounded-xl bg-canvas-subtle p-3 text-sm text-foreground-muted">
                {r}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-foreground-subtle">Vägledande — ingen juridisk bedömning. Verifiera med rådgivare eller myndighet innan inträde.</p>
        </section>
      ) : null}

      {error ? <p role="alert" className={noticeError}>{error}</p> : null}
      {editable ? (
        <AiSubmitButton
          tone="blue"
          pending={pending}
          idleLabel="Godkänn marknaderna och fortsätt"
          pendingLabel="Granskar informationsgap..."
          pendingTitle="Informationsgap granskas"
          pendingDescription="Underlaget prövas per vald marknad och per mognadsdimension. Saknas något viktigt får du en kompletteringsfråga."
          pendingSteps={['Matchar underlaget mot marknaderna', 'Prövar mognadsdimensionerna', 'Identifierar behov av komplettering']}
          fallbackHref={exportHref(startupId, 'analys')}
        />
      ) : null}
    </form>
  );
}

function MarketCard({ market: m, priority, editable, onPriority }: { market: ExportMarket; priority: ExportMarketPriority; editable: boolean; onPriority: (p: ExportMarketPriority) => void }) {
  const excluded = priority === 'EXCLUDED';
  return (
    <article className={`${card} ${excluded ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex flex-wrap items-center gap-2 font-heading text-lg font-semibold text-foreground">
            <MarketCodeBadge code={m.code} />
            <span>{m.country}</span>
            {m.region ? <span className="text-sm font-normal text-foreground-subtle">· {m.region}</span> : null}
            {m.addedByUser ? <Badge tone="info">Tillagd manuellt</Badge> : null}
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <MarketPriorityChip priority={priority} />
            <Badge>Attraktivitet: <PriorityLabel grade={m.attractiveness} /></Badge>
            <Badge>Förmåga att konkurrera: <PriorityLabel grade={m.abilityToCompete} /></Badge>
            <Badge>Säkerhet: {EXPORT_CONFIDENCE_LABELS[m.confidence]}</Badge>
          </div>
        </div>
        <select name={`priority-${m.code}`} value={priority} disabled={!editable} aria-label={`Prioritet för ${m.country}`} onChange={(e) => onPriority(e.target.value as ExportMarketPriority)} className={`${inputClass} w-auto`}>
          {(['PRIMARY', 'SECONDARY', 'LATER', 'EXCLUDED'] as const).map((p) => (
            <option key={p} value={p}>
              {EXPORT_MARKET_PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-4 leading-7 text-foreground">{m.rationale}</p>
      <div className="mt-4">
        <p className="text-sm font-medium text-foreground">CAGE-distans från Sverige</p>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {EXPORT_CAGE_KEYS.map((k) => (
            <li key={k} className="rounded-xl bg-canvas-subtle p-3 text-sm">
              <DistanceChip distance={m.cage[k].distance} label={EXPORT_CAGE_LABELS[k]} />
              {m.cage[k].note ? <p className="mt-1.5 text-foreground-muted">{m.cage[k].note}</p> : null}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-sm font-medium text-foreground">Trolig inträdesform</p>
          <p className="mt-1 text-sm text-foreground-muted">{m.entryModeHint ? EXPORT_ENTRY_MODE_LABELS[m.entryModeHint] : 'Avgörs i planen'}</p>
          {m.regulatoryDomains.length ? (
            <>
              <p className="mt-3 text-sm font-medium text-foreground">Regelverk att hantera</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {m.regulatoryDomains.map((k) => (
                  <li key={k} className="rounded-full bg-canvas-muted px-2 py-0.5 text-xs text-foreground-muted">
                    {regulatoryDomainName(k)}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
        <div>
          {m.culturalNotes.length ? (
            <>
              <p className="text-sm font-medium text-foreground">Kulturella noter</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-foreground-muted">
                {m.culturalNotes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </>
          ) : null}
          {m.networkLeads.length ? (
            <>
              <p className="mt-3 text-sm font-medium text-foreground">Ledtrådar i nätverket</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-foreground-muted">
                {m.networkLeads.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>
      {m.evidence.length ? (
        <details className="mt-3 text-sm text-foreground-muted">
          <summary className="cursor-pointer font-medium text-foreground">Evidens ({m.evidence.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {m.evidence.map((e, i) => (
              <li key={i}>
                {e.documentName ? <span className="font-medium">{e.documentName}: </span> : null}
                {e.note}
                {e.excerpt ? <span className="block italic text-foreground-subtle">”{e.excerpt}”</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {m.uncertaintyNotes.length ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-foreground-muted">
          {m.uncertaintyNotes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
      <label className="mt-4 block text-sm font-medium text-foreground">
        Kommentar eller korrigering
        <textarea name={`comment-${m.code}`} rows={2} disabled={!editable} className={`${inputClass} mt-1`} />
      </label>
    </article>
  );
}

function PriorityLabel({ grade }: { grade: 'LOW' | 'MEDIUM' | 'HIGH' }) {
  return <>{grade === 'HIGH' ? 'hög' : grade === 'MEDIUM' ? 'medel' : 'låg'}</>;
}
