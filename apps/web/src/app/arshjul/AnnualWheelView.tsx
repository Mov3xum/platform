'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ANNUAL_WHEEL_CATEGORIES,
  ANNUAL_WHEEL_TRACKS,
  annualWheelCategoryLabel,
  annualWheelTrackLabel,
  annulusSectorPath,
  buildAnnualWheelTable,
  filterAnnualWheelItems,
  groupItemsByMonth,
  monthLongLabel,
  monthShortLabel,
  monthSliceAngles,
  polarPoint,
  quarterForMonth,
  quarterSliceAngles,
  roundedAnnulusSectorPath,
  type AnnualWheelCategory,
  type AnnualWheelItem,
  type AnnualWheelTrack
} from '@platform/shared';
import { Icon } from '@/components/proto/Icon';
import {
  createAnnualWheelItemAction,
  deleteAnnualWheelItemAction,
  updateAnnualWheelItemAction
} from '@/lib/actions/annual-wheel';

type AnnualWheelWritableFieldClient = 'title' | 'month' | 'track' | 'category' | 'notes' | 'year';

// Kategori → Movexum-brand-CSS-variabel (källan av sanning är tokens.css).
const CATEGORY_VAR: Record<AnnualWheelCategory, string> = {
  styrelse: 'var(--movexum-djupbla)',
  ledning: 'var(--movexum-bla)',
  gemensamt: 'var(--movexum-lila)'
};

interface Props {
  items: AnnualWheelItem[];
  canEdit: boolean;
}

interface FormState {
  id?: string;
  year: number;
  title: string;
  month: string; // '' = helår
  track: AnnualWheelTrack;
  category: AnnualWheelCategory;
  notes: string;
}

const CX = 280;
const CY = 280;

export function AnnualWheelView({ items, canEdit }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const years = useMemo(() => {
    const set = new Set<number>(items.map((i) => i.year));
    set.add(new Date().getFullYear());
    return [...set].sort((a, b) => a - b);
  }, [items]);

  const [year, setYear] = useState<number>(() => {
    const now = new Date().getFullYear();
    return years.includes(now) ? now : years[years.length - 1];
  });
  const [category, setCategory] = useState<AnnualWheelCategory | 'all'>('all');
  const [track, setTrack] = useState<AnnualWheelTrack | 'all'>('all');

  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(
    () => filterAnnualWheelItems(items, { year, category, track }),
    [items, year, category, track]
  );
  const byMonth = useMemo(() => groupItemsByMonth(filtered), [filtered]);
  const undated = byMonth[0];
  const tableRows = useMemo(() => buildAnnualWheelTable(filtered), [filtered]);

  function openCreate() {
    setError(null);
    setForm({
      year,
      title: '',
      month: '',
      track: track === 'all' ? 'projekt' : track,
      category: category === 'all' ? 'ledning' : category,
      notes: ''
    });
  }

  function openEdit(item: AnnualWheelItem) {
    setError(null);
    setForm({
      id: item.id,
      year: item.year,
      title: item.title,
      month: item.month ? String(item.month) : '',
      track: item.track,
      category: item.category,
      notes: item.notes ?? ''
    });
  }

  function submitForm() {
    if (!form) return;
    const title = form.title.trim();
    if (!title) {
      setError('Ange en titel.');
      return;
    }
    const monthValue = form.month === '' ? null : Number(form.month);
    setError(null);

    startTransition(async () => {
      if (form.id) {
        // Uppdatera ändrade fält (ett anrop per fält via det delade lagret).
        const original = items.find((i) => i.id === form.id);
        const updates: { field: AnnualWheelWritableFieldClient; value: unknown }[] = [];
        if (!original || original.title !== title) updates.push({ field: 'title', value: title });
        if (!original || (original.month ?? null) !== monthValue)
          updates.push({ field: 'month', value: monthValue });
        if (!original || original.track !== form.track) updates.push({ field: 'track', value: form.track });
        if (!original || original.category !== form.category)
          updates.push({ field: 'category', value: form.category });
        if (!original || (original.notes ?? '') !== form.notes.trim())
          updates.push({ field: 'notes', value: form.notes.trim() });
        if (!original || original.year !== form.year) updates.push({ field: 'year', value: form.year });

        for (const u of updates) {
          const res = await updateAnnualWheelItemAction(form.id, u.field, u.value);
          if (res?.error) {
            setError(res.error);
            return;
          }
        }
      } else {
        const res = await createAnnualWheelItemAction({
          year: form.year,
          title,
          month: monthValue,
          track: form.track,
          category: form.category,
          notes: form.notes.trim() || undefined
        });
        if (res?.error) {
          setError(res.error);
          return;
        }
      }
      setForm(null);
      router.refresh();
    });
  }

  function remove(item: AnnualWheelItem) {
    if (!confirm(`Ta bort "${item.title}" ur årshjulet?`)) return;
    startTransition(async () => {
      const res = await deleteAnnualWheelItemAction(item.id);
      if (res?.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-6 py-6">
      {/* Filterrad */}
      <div className="flex flex-wrap items-center gap-3">
        <FilterSelect
          label="År"
          value={String(year)}
          onChange={(v) => setYear(Number(v))}
          options={years.map((y) => ({ value: String(y), label: String(y) }))}
        />
        <FilterSelect
          label="Kategori"
          value={category}
          onChange={(v) => setCategory(v as AnnualWheelCategory | 'all')}
          options={[
            { value: 'all', label: 'Alla kategorier' },
            ...ANNUAL_WHEEL_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))
          ]}
        />
        <FilterSelect
          label="Spår"
          value={track}
          onChange={(v) => setTrack(v as AnnualWheelTrack | 'all')}
          options={[
            { value: 'all', label: 'Alla spår' },
            ...ANNUAL_WHEEL_TRACKS.map((t) => ({ value: t.id, label: t.label }))
          ]}
        />
        <div className="ml-auto flex items-center gap-3">
          {canEdit ? (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[13px] font-medium text-brand-foreground hover:bg-brand-hover"
            >
              <Icon name="plus" size={14} /> Ny aktivitet
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
        {/* Hjulet */}
        <section className="rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5">
          <Wheel byMonth={byMonth} year={year} onPick={canEdit ? openEdit : undefined} />
          <Legend />
        </section>

        {/* Odaterade + snabböversikt */}
        <section className="flex min-h-0 flex-col gap-4">
          {undated.length > 0 ? (
            <div className="rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5">
              <h3 className="mb-2 font-heading text-[14px] font-semibold text-foreground">
                Helårs- / återkommande aktiviteter
              </h3>
              <ul className="space-y-1.5">
                {undated.map((it) => (
                  <ItemPill key={it.id} item={it} onEdit={canEdit ? openEdit : undefined} onDelete={canEdit ? remove : undefined} />
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5">
            <h3 className="mb-2 font-heading text-[14px] font-semibold text-foreground">
              Per månad
            </h3>
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-foreground-muted">
                Inga aktiviteter matchar filtret för {year}.
              </p>
            ) : (
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {byMonth.slice(1).map((monthItems, idx) =>
                  monthItems.length > 0 ? (
                    <div key={idx} className="rounded-xl border border-default p-2.5">
                      <div className="mb-1 text-[12px] font-semibold text-foreground-muted">
                        {monthLongLabel(idx + 1)}
                      </div>
                      <ul className="space-y-1">
                        {monthItems.map((it) => (
                          <ItemPill key={it.id} item={it} onEdit={canEdit ? openEdit : undefined} onDelete={canEdit ? remove : undefined} />
                        ))}
                      </ul>
                    </div>
                  ) : null
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Tabell (månad × spår) — speglar Excel-vyn */}
      <section className="rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5">
        <h3 className="mb-3 font-heading text-[14px] font-semibold text-foreground">
          Verksamhetstabell {year}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="text-left text-foreground-subtle">
                <th className="sticky left-0 bg-surface px-2 py-1.5 font-medium">Månad</th>
                {ANNUAL_WHEEL_TRACKS.map((t) => (
                  <th key={t.id} className="px-2 py-1.5 font-medium">
                    {t.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.month} className="border-t border-default align-top">
                  <th className="sticky left-0 bg-surface px-2 py-1.5 text-left font-medium text-foreground">
                    {row.monthLabel}
                  </th>
                  {row.cells.map((cell) => (
                    <td key={cell.track} className="px-2 py-1.5">
                      <div className="flex flex-col gap-1">
                        {cell.items.map((it) => (
                          <span
                            key={it.id}
                            className="inline-flex items-center gap-1 text-foreground-muted"
                          >
                            <span
                              className="inline-block h-2 w-2 shrink-0 rounded-full"
                              style={{ background: CATEGORY_VAR[it.category] }}
                              aria-hidden
                            />
                            {it.title}
                          </span>
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {form ? (
        <EditorModal
          form={form}
          setForm={setForm}
          onSubmit={submitForm}
          onClose={() => setForm(null)}
          pending={pending}
          error={error}
        />
      ) : null}
    </div>
  );
}

// ─── Hjulet (SVG) ────────────────────────────────────────────────────────────

interface HoverInfo {
  item: AnnualWheelItem;
  month: number;
  x: number;
  y: number;
}

function Wheel({
  byMonth,
  year,
  onPick
}: {
  byMonth: AnnualWheelItem[][];
  year: number;
  onPick?: (item: AnnualWheelItem) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  function track(item: AnnualWheelItem, month: number, e: React.MouseEvent) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ item, month, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  return (
    <div ref={wrapRef} className="relative" onMouseLeave={() => setHover(null)}>
      <svg
        viewBox="0 0 560 560"
        className="mx-auto block w-full max-w-[520px]"
        role="img"
        aria-label={`Årshjul ${year}`}
      >
        <defs>
          {/* Mjuka radiella gradienter per kategori (saturerad inåt, dämpad utåt). */}
          {ANNUAL_WHEEL_CATEGORIES.map((c) => (
            <radialGradient
              key={c.id}
              id={`mx-aw-grad-${c.id}`}
              cx={CX}
              cy={CY}
              r={250}
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0.5" stopColor={CATEGORY_VAR[c.id]} stopOpacity={0.2} />
              <stop offset="1" stopColor={CATEGORY_VAR[c.id]} stopOpacity={0.06} />
            </radialGradient>
          ))}
          {/* Tonad fyllning vid hover (något starkare). */}
          {ANNUAL_WHEEL_CATEGORIES.map((c) => (
            <radialGradient
              key={`h-${c.id}`}
              id={`mx-aw-grad-${c.id}-hover`}
              cx={CX}
              cy={CY}
              r={250}
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0.5" stopColor={CATEGORY_VAR[c.id]} stopOpacity={0.34} />
              <stop offset="1" stopColor={CATEGORY_VAR[c.id]} stopOpacity={0.14} />
            </radialGradient>
          ))}
          {/* Mitt-disk: subtil ljus gradient. */}
          <radialGradient id="mx-aw-core" cx={CX} cy={CY - 24} r={96} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--color-surface)" />
            <stop offset="1" stopColor="var(--color-canvas-subtle)" />
          </radialGradient>
          {/* Mjuk skugga för aktivitetsbanden. */}
          <filter id="mx-aw-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="2.5" stdDeviation="3.5" floodColor="var(--movexum-svart)" floodOpacity={0.18} />
          </filter>
          {/* Starkare lyft vid hover. */}
          <filter id="mx-aw-shadow-hover" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="var(--movexum-svart)" floodOpacity={0.3} />
          </filter>
        </defs>

        {/* Bakgrundsdisk bakom hela hjulet (mjuk inramning). */}
        <circle cx={CX} cy={CY} r={252} fill="var(--color-canvas-subtle)" opacity={0.4} />

        {/* Kvartalsring */}
        {[1, 2, 3, 4].map((q) => {
          const a = quarterSliceAngles(q);
          const path = annulusSectorPath(CX, CY, 70, 116, a.start, a.end);
          const label = polarPoint(CX, CY, 93, a.mid);
          return (
            <g key={`q${q}`}>
              <path
                d={path}
                fill="var(--color-canvas-muted)"
                stroke="var(--color-surface)"
                strokeWidth={3}
                opacity={0.7}
              />
              <text
                x={label.x}
                y={label.y}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-foreground-muted"
                fontSize={13}
                fontWeight={600}
              >
                Q{q}
              </text>
            </g>
          );
        })}

        {/* Månadsring + aktivitets-yttre band */}
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
          const a = monthSliceAngles(m);
          const monthPath = annulusSectorPath(CX, CY, 116, 170, a.start, a.end);
          const monthItems = byMonth[m];
          const labelPos = polarPoint(CX, CY, 143, a.mid);
          const isEven = m % 2 === 0;
          return (
            <g key={`m${m}`}>
              <path
                d={monthPath}
                fill={isEven ? 'var(--color-canvas-subtle)' : 'var(--color-surface)'}
                stroke="var(--color-canvas-muted)"
                strokeWidth={1}
              />
              <text
                x={labelPos.x}
                y={labelPos.y}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-foreground"
                fontSize={12}
                fontWeight={600}
              >
                {monthShortLabel(m)}
              </text>

              {/* Yttre band: en sub-sektor per aktivitet, färgad per kategori. */}
              {monthItems.map((it, idx) => {
                const span = (a.end - a.start) / Math.max(1, monthItems.length);
                const s = a.start + idx * span;
                const e = s + span;
                const isHovered = hover?.item.id === it.id;
                // Lyft den hovrade aktiviteten en aning utåt.
                const inner = isHovered ? 174 : 172;
                const outer = isHovered ? 256 : 250;
                const d = roundedAnnulusSectorPath(CX, CY, inner, outer, s + 0.9, e - 0.9, 7);
                return (
                  <path
                    key={it.id}
                    d={d}
                    fill={`url(#mx-aw-grad-${it.category}${isHovered ? '-hover' : ''})`}
                    stroke={CATEGORY_VAR[it.category]}
                    strokeWidth={isHovered ? 2.5 : 1.75}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    filter={isHovered ? 'url(#mx-aw-shadow-hover)' : 'url(#mx-aw-shadow)'}
                    className={onPick ? 'cursor-pointer transition-all' : 'transition-all'}
                    style={{ opacity: hover && !isHovered ? 0.4 : 1 }}
                    onClick={onPick ? () => onPick(it) : undefined}
                    onMouseEnter={(ev) => track(it, m, ev)}
                    onMouseMove={(ev) => track(it, m, ev)}
                  />
                );
              })}
            </g>
          );
        })}

        {/* Mitt: år */}
        <circle cx={CX} cy={CY} r={68} fill="url(#mx-aw-core)" stroke="var(--color-canvas-muted)" strokeWidth={1.5} />
        <text
          x={CX}
          y={CY - 8}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground"
          fontSize={26}
          fontWeight={700}
        >
          {year}
        </text>
        <text
          x={CX}
          y={CY + 16}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground-subtle"
          fontSize={11}
        >
          Årshjul
        </text>
      </svg>

      {hover ? <HoverCard hover={hover} /> : null}
    </div>
  );
}

function HoverCard({ hover }: { hover: HoverInfo }) {
  const { item, month } = hover;
  // Placera kortet vid pekaren, men förskjut så det inte skyms av muspekaren
  // och håll det inom hjul-containern.
  const left = Math.max(8, Math.min(hover.x + 16, 520 - 248));
  const top = Math.max(8, hover.y + 16);
  return (
    <div
      className="pointer-events-none absolute z-20 w-60 rounded-2xl border border-default bg-surface/95 p-3.5 shadow-xl shadow-movexum-svart/20 backdrop-blur-sm"
      style={{ left, top }}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: CATEGORY_VAR[item.category] }}
          aria-hidden
        />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          {annualWheelCategoryLabel(item.category)}
        </span>
      </div>
      <p className="font-heading text-[14px] font-semibold leading-snug text-foreground">{item.title}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center rounded-md bg-canvas-subtle px-1.5 py-0.5 text-[11px] font-medium text-foreground-muted">
          {annualWheelTrackLabel(item.track)}
        </span>
        <span className="inline-flex items-center rounded-md bg-canvas-subtle px-1.5 py-0.5 text-[11px] font-medium text-foreground-muted">
          {monthLongLabel(month)} · Q{quarterForMonth(month)}
        </span>
      </div>
      {item.notes ? (
        <p className="mt-2 line-clamp-3 text-[12px] leading-relaxed text-foreground-muted">{item.notes}</p>
      ) : null}
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
      {ANNUAL_WHEEL_CATEGORIES.map((c) => (
        <span key={c.id} className="inline-flex items-center gap-1.5 text-[12px] text-foreground-muted">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: CATEGORY_VAR[c.id] }}
            aria-hidden
          />
          {c.label}
        </span>
      ))}
    </div>
  );
}

function ItemPill({
  item,
  onEdit,
  onDelete
}: {
  item: AnnualWheelItem;
  onEdit?: (item: AnnualWheelItem) => void;
  onDelete?: (item: AnnualWheelItem) => void;
}) {
  return (
    <li className="flex items-center gap-2 text-[12.5px]">
      <span
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: CATEGORY_VAR[item.category] }}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-foreground">{item.title}</span>
      <span className="shrink-0 text-[11px] text-foreground-subtle">
        {annualWheelTrackLabel(item.track)}
        {item.month ? ` · ${monthShortLabel(item.month)}` : ''}
      </span>
      {onEdit ? (
        <button
          type="button"
          onClick={() => onEdit(item)}
          className="shrink-0 text-foreground-subtle hover:text-brand"
          aria-label="Redigera"
        >
          <Icon name="pencil" size={13} />
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          onClick={() => onDelete(item)}
          className="shrink-0 text-foreground-subtle hover:text-movexum-orange"
          aria-label="Ta bort"
        >
          <Icon name="trash" size={13} />
        </button>
      ) : null}
    </li>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-foreground-subtle">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-default bg-surface px-2 py-1.5 text-[13px] text-foreground"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function EditorModal({
  form,
  setForm,
  onSubmit,
  onClose,
  pending,
  error
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  onSubmit: () => void;
  onClose: () => void;
  pending: boolean;
  error: string | null;
}) {
  const yearNow = new Date().getFullYear();
  const yearOptions = [yearNow - 1, yearNow, yearNow + 1, yearNow + 2];
  if (!yearOptions.includes(form.year)) yearOptions.push(form.year);
  yearOptions.sort((a, b) => a - b);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-movexum-svart/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-default bg-surface p-5 shadow-lg shadow-movexum-svart/20"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 font-heading text-[16px] font-semibold text-foreground">
          {form.id ? 'Redigera aktivitet' : 'Ny aktivitet i årshjulet'}
        </h3>

        <div className="space-y-3">
          <Field label="Titel">
            <input
              type="text"
              value={form.title}
              maxLength={200}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full rounded-lg border border-default bg-canvas px-2.5 py-1.5 text-[13px] text-foreground"
              placeholder="t.ex. Bokslut, Styrelsemöte, Strategidagar"
              autoFocus
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="År">
              <select
                value={String(form.year)}
                onChange={(e) => setForm({ ...form, year: Number(e.target.value) })}
                className="w-full rounded-lg border border-default bg-canvas px-2.5 py-1.5 text-[13px] text-foreground"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Månad">
              <select
                value={form.month}
                onChange={(e) => setForm({ ...form, month: e.target.value })}
                className="w-full rounded-lg border border-default bg-canvas px-2.5 py-1.5 text-[13px] text-foreground"
              >
                <option value="">Helår / återkommande</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={String(m)}>
                    {monthLongLabel(m)} (Q{quarterForMonth(m)})
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Kategori">
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as AnnualWheelCategory })}
                className="w-full rounded-lg border border-default bg-canvas px-2.5 py-1.5 text-[13px] text-foreground"
              >
                {ANNUAL_WHEEL_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Spår">
              <select
                value={form.track}
                onChange={(e) => setForm({ ...form, track: e.target.value as AnnualWheelTrack })}
                className="w-full rounded-lg border border-default bg-canvas px-2.5 py-1.5 text-[13px] text-foreground"
              >
                {ANNUAL_WHEEL_TRACKS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Anteckning (valfritt)">
            <textarea
              value={form.notes}
              maxLength={2000}
              rows={2}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full rounded-lg border border-default bg-canvas px-2.5 py-1.5 text-[13px] text-foreground"
            />
          </Field>

          {error ? (
            <p className="rounded-lg bg-movexum-pastell-orange px-2.5 py-1.5 text-[12px] text-movexum-morkorange">
              {error}
            </p>
          ) : null}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg px-3 py-1.5 text-[13px] text-foreground-muted hover:text-foreground"
          >
            Avbryt
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={pending}
            className="rounded-lg bg-brand px-3.5 py-1.5 text-[13px] font-medium text-brand-foreground hover:bg-brand-hover disabled:opacity-60"
          >
            {pending ? 'Sparar…' : 'Spara'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-foreground-subtle">{label}</span>
      {children}
    </label>
  );
}
