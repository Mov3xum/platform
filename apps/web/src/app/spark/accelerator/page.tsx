import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import {
  SPARK_ACCELERATOR_CATEGORIES,
  SPARK_ACCELERATOR_CATEGORY_LABELS,
  SPARK_SUPPORT_NEED_LABELS,
  SPARK_TRL,
  effectiveSparkTrl,
  isSparkAcceleratorCategory,
  sparkAcceleratorEligible,
  suggestSparkAcceleratorCategory
} from '@platform/shared';
import { SPARK_MIGRATION_HINT, loadSparkRegistry } from '@/lib/spark/data';
import { Chip, Notice, Panel, btnGhost } from '@/components/talent/ui';
import { AiNote, AiSuggestAllButton, AiSuggestButton, AssessSolutionForm } from '@/components/spark/controls';
import { TrlReference } from '@/components/spark/TrlReference';
import { AreaChips, Empty, SPARK_TITLE, requireSparkStaff, sparkTabs } from '../_shared';

export const dynamic = 'force-dynamic';

const TONE = { candidate: 'success', early: 'warning', market_ready: 'info', not_relevant: 'neutral' } as const;

/**
 * Acceleratorvyn (§ 61): TRL och kategorisering av lösningar från
 * innovationsaktörer UTANFÖR portföljen. Behovsägare bedöms inte, och
 * portföljbolag bedöms med KTH IRL på bolagskortet.
 */
export default async function SparkAcceleratorPage({ searchParams }: { searchParams: Promise<{ kategori?: string }> }) {
  const { user, pb, canManage } = await requireSparkStaff();
  const { kategori } = await searchParams;
  const reg = await loadSparkRegistry(pb, user.tenant);
  const rows = reg.solutions
    .filter((s) => s.status === 'active')
    .map((s) => ({ s, actor: reg.actorById.get(s.actor) }))
    .filter((r): r is { s: (typeof reg.solutions)[number]; actor: NonNullable<ReturnType<typeof reg.actorById.get>> } => Boolean(r.actor && sparkAcceleratorEligible(r.actor)))
    .map((r) => {
      const trl = effectiveSparkTrl(r.s);
      const suggested = suggestSparkAcceleratorCategory(trl);
      return { ...r, trl, suggested, category: r.s.accelerator_category || '' };
    });
  const filter = kategori === 'ej' ? 'ej' : isSparkAcceleratorCategory(kategori) ? kategori : null;
  const shown = rows
    .filter((r) => (filter === 'ej' ? !r.category : filter ? r.category === filter : true))
    .sort((a, b) => Number(Boolean(a.category)) - Number(Boolean(b.category)) || (b.trl ?? 0) - (a.trl ?? 0));
  const byTrl = SPARK_TRL.map((t) => ({ id: t.id, n: rows.filter((r) => String(r.trl ?? '') === t.id).length }));
  const maxTrl = Math.max(1, ...byTrl.map((b) => b.n));
  const unassessed = rows.filter((r) => !r.category && !r.s.ai_suggested_at && r.s.description.trim().length >= 40).length;
  const chip = (id: string | null, label: string, n: number) => (
    <Link key={label} href={id ? `/spark/accelerator?kategori=${id}` : '/spark/accelerator'} className={`${btnGhost} ${filter === id ? 'border-strong text-foreground' : ''}`}>
      {label} <span className="mx-tnum text-foreground-subtle">{n}</span>
    </Link>
  );

  return (
    <PageShell title={SPARK_TITLE} tabs={sparkTabs(true)} meta={<span className="text-sm text-foreground-subtle mx-tnum">{rows.length} lösningar</span>}>
      <div className="space-y-5">
        {reg.missing ? <Notice kind="warning">{SPARK_MIGRATION_HINT}</Notice> : null}
        {reg.error ? <Notice kind="error">{reg.error}</Notice> : null}
        <p className="text-sm text-foreground-muted">
          Lösningar från innovationsaktörer som kan vara aktuella för acceleratorprogrammet. TRL kommer från intervjun och kan justeras av er. Förslaget till
          kategori bygger på TRL (1–3 tidig, 4–7 kandidat, 8–9 marknadsredo) — ni bekräftar eller ändrar.
        </p>
        {canManage ? (
          <div className="rounded-2xl border border-default bg-canvas-subtle p-4">
            <p className="text-sm text-foreground-muted">
              AI kan läsa lösningens beskrivning och föreslå TRL och kategori med en motivering. Förslaget sparas bredvid er bedömning och ersätter den aldrig.
            </p>
            <div className="mt-3">
              <AiSuggestAllButton count={unassessed} />
            </div>
            <div className="mt-2">
              <AiNote>AI-förslag är beslutsstöd — ni bedömer.</AiNote>
            </div>
          </div>
        ) : null}

        <Panel title="Fördelning per TRL">
          <div className="flex items-end gap-2" role="img" aria-label="Antal lösningar per TRL-nivå">
            {byTrl.map((b) => (
              <div key={b.id} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs font-semibold text-foreground mx-tnum">{b.n || ''}</span>
                <div className="flex h-24 w-full items-end rounded-lg bg-canvas-subtle">
                  <div className={`w-full rounded-lg ${Number(b.id) >= 4 && Number(b.id) <= 7 ? 'bg-brand' : 'bg-canvas-muted'}`} style={{ height: `${Math.round((b.n / maxTrl) * 100)}%`, minHeight: b.n ? 6 : 0 }} />
                </div>
                <span className="text-[11px] text-foreground-subtle mx-tnum">TRL {b.id}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-foreground-subtle">Markerade staplar (TRL 4–7) är nivåerna där test och verifiering ger mest — det acceleratorn och testbäddarna är till för.</p>
        </Panel>

        <TrlReference />

        <div className="flex flex-wrap gap-2 text-xs">
          {chip(null, 'Alla', rows.length)}
          {chip('ej', 'Inte kategoriserade', rows.filter((r) => !r.category).length)}
          {SPARK_ACCELERATOR_CATEGORIES.map((c) => chip(c.id, c.label, rows.filter((r) => r.category === c.id).length))}
        </div>

        {shown.length === 0 ? (
          <Empty>Inga lösningar i urvalet. Lösningar kommer in när intervjuer med innovationsaktörer förs in i registret.</Empty>
        ) : (
          <ul className="space-y-4">
            {shown.map(({ s, actor, trl, suggested, category }) => (
              <li key={s.id} className="rounded-3xl border border-default bg-surface p-5">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="min-w-0 space-y-2">
                    <Link href={`/spark/aktorer/${actor.id}`} className="text-xs font-semibold text-foreground-subtle hover:underline">
                      {actor.name}
                    </Link>
                    <h3 className="font-heading text-base font-semibold text-foreground">{s.name}</h3>
                    <p className="line-clamp-3 text-sm text-foreground-muted">{s.description}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {trl ? <Chip tone="accent">TRL {trl}</Chip> : <Chip>TRL saknas</Chip>}
                      {s.trl && s.trl_assessed && s.trl !== s.trl_assessed ? <span className="text-xs text-foreground-subtle">företaget angav TRL {s.trl}</span> : null}
                      {category ? (
                        <Chip tone={TONE[category as keyof typeof TONE]}>{SPARK_ACCELERATOR_CATEGORY_LABELS[category]}</Chip>
                      ) : suggested ? (
                        <span className="text-xs text-foreground-subtle">Förslag: {SPARK_ACCELERATOR_CATEGORY_LABELS[suggested]}</span>
                      ) : null}
                    </div>
                    <AreaChips areas={s.areas} />
                    {actor.support_needs.length ? <p className="text-xs text-foreground-subtle">Stödbehov: {actor.support_needs.map((n) => SPARK_SUPPORT_NEED_LABELS[n]).join(', ')}</p> : null}
                    {s.accelerator_note ? <p className="text-xs text-foreground-muted">Motivering: {s.accelerator_note}</p> : null}
                    {s.ai_suggested_at ? (
                      <div className="rounded-2xl border border-default bg-canvas-subtle p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Chip tone="accent">AI-förslag</Chip>
                          {s.ai_trl ? <span className="text-xs font-semibold text-foreground">TRL {s.ai_trl}</span> : <span className="text-xs text-foreground-muted">Underlaget räcker inte för en TRL</span>}
                          {s.ai_category ? <span className="text-xs text-foreground-muted">{SPARK_ACCELERATOR_CATEGORY_LABELS[s.ai_category]}</span> : null}
                          {s.ai_confidence < 0.5 ? <Chip tone="warning">Osäkert</Chip> : null}
                          {s.trl_assessed && s.ai_trl && s.trl_assessed !== s.ai_trl ? <span className="text-xs text-foreground-subtle">ni bedömde TRL {s.trl_assessed}</span> : null}
                        </div>
                        {s.ai_rationale ? <p className="mt-1.5 text-xs leading-relaxed text-foreground-muted">{s.ai_rationale}</p> : null}
                        <div className="mt-1.5">
                          <AiNote />
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {canManage ? (
                    <div className="rounded-2xl border border-default bg-canvas-subtle p-4">
                      <AssessSolutionForm
                        key={`${s.id}-${s.ai_suggested_at ?? ''}-${s.ai_trl ?? ''}`}
                        solutionId={s.id}
                        trl={s.trl_assessed ? String(s.trl_assessed) : ''}
                        category={category}
                        note={s.accelerator_note}
                        suggested={suggested}
                        aiTrl={s.ai_trl ? String(s.ai_trl) : ''}
                        aiCategory={s.ai_category}
                      />
                      <div className="mt-3 border-t border-default pt-3">
                        <AiSuggestButton solutionId={s.id} hasSuggestion={Boolean(s.ai_suggested_at)} />
                      </div>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
