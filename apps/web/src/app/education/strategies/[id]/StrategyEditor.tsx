'use client';

import { useState, useTransition } from 'react';
import { updateStrategyAction } from '@/lib/actions/internationalization';
import type { Strategy } from '@platform/shared';

interface StrategyEditorProps {
  strategy: Strategy & Record<string, unknown>;
  isStaff: boolean;
}

const BAND_OPTIONS = [
  {
    value: 'wait',
    label: '⏸ Vänta',
    desc: 'Fokusera på hemmamarknaden och sätt konkreta triggers för nästa beslut'
  },
  {
    value: 'discovery',
    label: '🔍 Discovery-sprint',
    desc: '4 veckors marknadsvalidering med definierat go/no-go kriterium'
  },
  {
    value: 'execution',
    label: '🚀 Execution',
    desc: 'Beachhead-strategi med kvartalsmilstolpar och kill criteria'
  }
] as const;

const textareaClass =
  'mt-1.5 w-full rounded-2xl border border-default bg-canvas px-4 py-3 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

export function StrategyEditor({ strategy, isStaff }: StrategyEditorProps) {
  const [editing, setEditing] = useState(false);

  const [band, setBand] = useState<'wait' | 'discovery' | 'execution'>(
    (strategy.recommended_band as 'wait' | 'discovery' | 'execution') ?? 'wait'
  );
  const [positionAssessment, setPositionAssessment] = useState(
    String(strategy.position_assessment ?? '')
  );
  const [recommendation, setRecommendation] = useState(
    String(strategy.recommendation ?? '')
  );
  const [milestones, setMilestones] = useState(
    String(strategy.quarterly_milestones ?? '')
  );
  const [killCriteria, setKillCriteria] = useState(
    String(strategy.kill_criteria ?? '')
  );
  const [coachNotes, setCoachNotes] = useState(String(strategy.coach_notes ?? ''));
  const [changeSummary, setChangeSummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleSave = () => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updateStrategyAction(String(strategy.id), {
        recommended_band: band,
        position_assessment: positionAssessment,
        recommendation,
        quarterly_milestones: milestones,
        kill_criteria: killCriteria,
        ...(isStaff ? { coach_notes: coachNotes } : {}),
        change_summary: changeSummary || 'Manuell revidering'
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setSaved(true);
      setEditing(false);
      setChangeSummary('');
    });
  };

  const handleCancel = () => {
    // Reset to original values
    setBand((strategy.recommended_band as 'wait' | 'discovery' | 'execution') ?? 'wait');
    setPositionAssessment(String(strategy.position_assessment ?? ''));
    setRecommendation(String(strategy.recommendation ?? ''));
    setMilestones(String(strategy.quarterly_milestones ?? ''));
    setKillCriteria(String(strategy.kill_criteria ?? ''));
    setCoachNotes(String(strategy.coach_notes ?? ''));
    setChangeSummary('');
    setError(null);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="space-y-6">
        {saved && (
          <p className="rounded-xl bg-movexum-pastell-gron px-3 py-2 text-sm text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
            ✓ Strategi uppdaterad och revision skapad.
          </p>
        )}

        {/* 1. Position idag */}
        <section className="rounded-3xl border border-default bg-surface p-6">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-xl font-semibold text-foreground">Position idag</h2>
          </div>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed text-foreground-muted">
            {positionAssessment || 'Inga data.'}
          </pre>
        </section>

        {/* 2. Rekommenderad bana */}
        <section className="rounded-3xl border border-default bg-surface p-6">
          <h2 className="mb-3 text-xl font-semibold text-foreground">Rekommenderad bana</h2>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed text-foreground-muted">
            {recommendation || 'Inga data.'}
          </pre>
        </section>

        {/* 3. Kvartalsmilstolpar & kill criteria */}
        <section className="rounded-3xl border border-default bg-surface p-6">
          <h2 className="mb-3 text-xl font-semibold text-foreground">
            Kvartalsmilstolpar &amp; kill criteria
          </h2>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed text-foreground-muted">
            {milestones || 'Inga data.'}
          </pre>
          {killCriteria && (
            <>
              <h3 className="mt-4 text-sm font-semibold text-foreground-muted">Kill criteria</h3>
              <pre className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground-muted">
                {killCriteria}
              </pre>
            </>
          )}
        </section>

        {/* Coach notes */}
        {(isStaff || coachNotes) && coachNotes && (
          <section className="rounded-3xl border border-movexum-lila/30 bg-movexum-pastell-lila/30 p-6 dark:border-movexum-morklila/30 dark:bg-movexum-morklila/10">
            <h2 className="mb-2 text-base font-semibold text-movexum-lila dark:text-movexum-ljuslila">
              Coach-anteckningar
            </h2>
            <p className="whitespace-pre-line text-sm text-foreground-muted">{coachNotes}</p>
          </section>
        )}

        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-2 rounded-full border border-brand/40 bg-movexum-pastell-lila/40 px-5 py-2.5 text-sm font-semibold text-brand transition hover:bg-movexum-pastell-lila dark:border-movexum-morklila/40 dark:bg-movexum-morklila/10 dark:text-movexum-ljuslila dark:hover:bg-movexum-morklila/20"
        >
          ✏️ Redigera strategi
        </button>
      </div>
    );
  }

  // Edit mode
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 rounded-2xl border border-brand/30 bg-movexum-pastell-lila/30 px-4 py-3 dark:border-movexum-morklila/30 dark:bg-movexum-morklila/10">
        <span className="text-sm font-medium text-brand dark:text-movexum-ljuslila">
          ✏️ Redigeringsläge
        </span>
        <span className="text-xs text-foreground-subtle">
          Alla ändringar sparas med ett revisionsspår.
        </span>
      </div>

      {/* Band selector */}
      <section className="rounded-3xl border border-default bg-surface p-6">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Vald bana</h2>
        <div className="space-y-2">
          {BAND_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${
                band === opt.value
                  ? 'border-brand bg-movexum-pastell-lila/40 dark:border-movexum-morklila dark:bg-movexum-morklila/20'
                  : 'border-default hover:bg-canvas-subtle'
              }`}
            >
              <input
                type="radio"
                name="band"
                value={opt.value}
                checked={band === opt.value}
                onChange={() => setBand(opt.value)}
                className="mt-0.5 accent-brand"
              />
              <div>
                <span className="text-sm font-semibold text-foreground">{opt.label}</span>
                <p className="text-xs text-foreground-muted">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </section>

      {/* Position assessment */}
      <section className="rounded-3xl border border-default bg-surface p-6">
        <h2 className="mb-1 text-lg font-semibold text-foreground">Position idag</h2>
        <p className="mb-2 text-xs text-foreground-subtle">
          Uppdatera med aktuella data och insikter. Var specifik.
        </p>
        <textarea
          value={positionAssessment}
          onChange={(e) => setPositionAssessment(e.target.value)}
          rows={8}
          className={textareaClass}
        />
      </section>

      {/* Recommendation */}
      <section className="rounded-3xl border border-default bg-surface p-6">
        <h2 className="mb-1 text-lg font-semibold text-foreground">Rekommendation &amp; resonemang</h2>
        <p className="mb-2 text-xs text-foreground-subtle">
          Beskriv varför ni valt denna bana. Resonemang ska alltid vara synligt.
        </p>
        <textarea
          value={recommendation}
          onChange={(e) => setRecommendation(e.target.value)}
          rows={10}
          className={textareaClass}
        />
      </section>

      {/* Quarterly milestones */}
      <section className="rounded-3xl border border-default bg-surface p-6">
        <h2 className="mb-1 text-lg font-semibold text-foreground">Kvartalsmilstolpar</h2>
        <p className="mb-2 text-xs text-foreground-subtle">
          Specifika, mätbara mål per kvartal. Uppdatera löpande med faktiska utfall.
        </p>
        <textarea
          value={milestones}
          onChange={(e) => setMilestones(e.target.value)}
          rows={8}
          className={textareaClass}
        />
      </section>

      {/* Kill criteria */}
      <section className="rounded-3xl border border-default bg-surface p-6">
        <h2 className="mb-1 text-lg font-semibold text-foreground">Kill criteria</h2>
        <p className="mb-2 text-xs text-foreground-subtle">
          Vad specifikt gör att ni stoppar och omvärderar? Vara konkret.
        </p>
        <textarea
          value={killCriteria}
          onChange={(e) => setKillCriteria(e.target.value)}
          rows={4}
          className={textareaClass}
        />
      </section>

      {/* Coach notes (staff only) */}
      {isStaff && (
        <section className="rounded-3xl border border-movexum-lila/30 bg-movexum-pastell-lila/20 p-6 dark:border-movexum-morklila/30 dark:bg-movexum-morklila/10">
          <h2 className="mb-1 text-lg font-semibold text-movexum-lila dark:text-movexum-ljuslila">
            Coach-anteckningar
          </h2>
          <textarea
            value={coachNotes}
            onChange={(e) => setCoachNotes(e.target.value)}
            rows={4}
            placeholder="Anteckningar och utmaningar från coach till bolaget…"
            className={textareaClass}
          />
        </section>
      )}

      {/* Change summary */}
      <div>
        <label className="block text-xs font-medium text-foreground-muted">
          Kort beskrivning av ändringen (sparas i revisionsspåret)
        </label>
        <input
          type="text"
          value={changeSummary}
          onChange={(e) => setChangeSummary(e.target.value)}
          placeholder="t.ex. Uppdaterade milstolpar efter Q1-review"
          className="mt-1.5 w-full rounded-2xl border border-default bg-canvas px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
        />
      </div>

      {error && (
        <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-sm text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={handleSave}
          className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? 'Sparar…' : 'Spara ändringar'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={handleCancel}
          className="inline-flex items-center justify-center rounded-full border border-default bg-surface px-6 py-2.5 text-sm font-semibold text-foreground-muted transition hover:bg-canvas-subtle"
        >
          Avbryt
        </button>
      </div>
    </div>
  );
}
