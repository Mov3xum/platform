'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ANNUAL_WHEEL_TAGS,
  ANNUAL_WHEEL_CATEGORY_LABEL_MAX,
  ANNUAL_WHEEL_COLOR_TOKENS,
  annualWheelCategoryColorVar,
  annualWheelCategoryLabel,
  annualWheelColorVar,
  annualWheelDateLabel,
  annualWheelRangeLabel,
  annualWheelShortDateLabel,
  annualWheelShortRangeLabel,
  annualWheelTagsInUse,
  annualWheelTagsInGroup,
  isAnnualWheelPeriod,
  packAnnualWheelArcs,
  expandAnnualWheelSeries,
  ANNUAL_WHEEL_REPEATS,
  ANNUAL_WHEEL_TAG_GROUP_LABELS,
  annualWheelTagLabel,
  annulusSectorPath,
  buildAnnualWheelTable,
  countItemsByTag,
  dateAngleInYear,
  daysInMonth,
  filterAnnualWheelItems,
  groupItemsByMonth,
  monthLongLabel,
  monthShortLabel,
  monthSliceAngles,
  nextUpcomingItem,
  polarPoint,
  quarterForMonth,
  quarterSliceAngles,
  roundedAnnulusSectorPath,
  slugifyAnnualWheelCategoryKey,
  type AnnualWheelCategory,
  type AnnualWheelCategoryDef,
  type AnnualWheelColorToken,
  type AnnualWheelItem,
  type AnnualWheelRepeat,
  type AnnualWheelTag,
  type NextAnnualWheelItem
} from '@platform/shared';
import { Icon } from '@/components/proto/Icon';
import { NextCaption, Wheel } from './Wheel';
import type { AssignableResource } from '@/lib/assignments/types';
import {
  createAnnualWheelCategoryAction,
  createAnnualWheelItemAction,
  deleteAnnualWheelCategoryAction,
  deleteAnnualWheelItemAction,
  repairAnnualWheelSchemaAction,
  updateAnnualWheelCategoryAction,
  updateAnnualWheelItemAction
} from '@/lib/actions/annual-wheel';

type AnnualWheelWritableFieldClient =
  | 'title'
  | 'month'
  | 'day'
  | 'end_month'
  | 'end_day'
  | 'tags'
  | 'category'
  | 'responsible'
  | 'notes'
  | 'year';

interface Props {
  items: AnnualWheelItem[];
  /** Tenantens kategorier (legend, filter, färg). */
  categories: AnnualWheelCategoryDef[];
  canEdit: boolean;
  /** Movexum-resurser som kan sättas som ansvariga (id + visningsnamn). */
  people: AssignableResource[];
  /** Bara superadmin (`admin`) får lägga till/ta bort kategorier. */
  canManageCategories: boolean;
  /** Schemadrift som inte kunde repareras automatiskt (server-side check). */
  schemaNotice?: string | null;
}

interface FormState {
  id?: string;
  year: number;
  title: string;
  month: string; // '' = helår
  day: string; // '' = hela månaden
  endMonth: string; // '' = punktaktivitet (ingen period)
  endDay: string; // '' = slutmånadens sista dag
  tags: AnnualWheelTag[]; // valfria, flera tillåtna
  category: AnnualWheelCategory;
  responsible: string; // '' = ingen ansvarig
  notes: string;
  repeat: AnnualWheelRepeat; // 'none' = engångsaktivitet
  repeatUntilMonth: string; // '' = december
}

/** Hur många aktiviteter en serie skulle skapa (för förhandsbeskedet i UI:t). */
function seriesPreviewCount(form: FormState): number {
  if (form.month === '') return 1;
  return Math.max(
    1,
    expandAnnualWheelSeries(
      {
        year: form.year,
        month: Number(form.month),
        day: form.day === '' ? null : Number(form.day),
        end_month: form.endMonth === '' ? null : Number(form.endMonth),
        end_day: form.endDay === '' ? null : Number(form.endDay)
      },
      form.repeat,
      form.repeatUntilMonth === '' ? 12 : Number(form.repeatUntilMonth)
    ).length
  );
}

/** Ordnings-okänslig jämförelse av två tagguppsättningar. */
function sameTags(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

export function AnnualWheelView({
  items,
  categories,
  canEdit,
  people,
  canManageCategories,
  schemaNotice = null
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Kategorier som används av poster men inte längre finns i listan (raderade)
  // — de visas i legenden som "okänd" så inget band blir oförklarat.
  const orphanCategories = useMemo(() => {
    const known = new Set(categories.map((c) => c.id));
    return [...new Set(items.map((i) => i.category).filter((c) => c && !known.has(c)))];
  }, [items, categories]);

  const colorVar = (id: string) => annualWheelCategoryColorVar(id, categories);

  const [manageCategories, setManageCategories] = useState(false);

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
  const [tag, setTag] = useState<AnnualWheelTag | 'all' | 'none'>('all');
  const [responsible, setResponsible] = useState<string>('all');
  const [monthFocus, setMonthFocus] = useState<number | null>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Icke-blockerande varning från servern (t.ex. schemat saknar datumfältet).
  const [warning, setWarning] = useState<string | null>(null);
  // Positiv kvittens (t.ex. "12 aktiviteter lades till").
  const [notice, setNotice] = useState<string | null>(null);
  // Schemadrift från servern kan repareras manuellt av admin/incubator_lead.
  const [schemaWarning, setSchemaWarning] = useState<string | null>(schemaNotice);
  const [repairing, setRepairing] = useState(false);

  function repairSchema() {
    setRepairing(true);
    startTransition(async () => {
      const res = await repairAnnualWheelSchemaAction();
      setRepairing(false);
      if (res?.error) {
        setSchemaWarning(res.error);
        return;
      }
      setSchemaWarning(null);
      if (res?.notice) setNotice(res.notice);
      router.refresh();
    });
  }

  const filtered = useMemo(
    () => filterAnnualWheelItems(items, { year, category, tag, responsible }),
    [items, year, category, tag, responsible]
  );
  const byMonth = useMemo(() => groupItemsByMonth(filtered), [filtered]);
  const undated = byMonth[0];
  // Bara taggar som faktiskt används blir kolumner — annars blir tabellen en
  // vägg av tomma kolumner när man jobbar med t.ex. bara marknadsaktiviteter.
  const tableTags = useMemo(() => annualWheelTagsInUse(filtered), [filtered]);
  const tableRows = useMemo(
    () => buildAnnualWheelTable(filtered, tableTags),
    [filtered, tableTags]
  );
  // Uppföljning per tagg — räknas på årets poster (före tagg-filtret) så
  // chipsen fungerar som en översikt man kan filtrera med.
  const tagCounts = useMemo(
    () => countItemsByTag(filterAnnualWheelItems(items, { year, category, responsible })),
    [items, year, category, responsible]
  );

  // "Idag"-visare + nedräkning (bara meningsfullt för innevarande år).
  const today = useMemo(() => new Date(), []);
  const todayAngle = useMemo(() => dateAngleInYear(today, year), [today, year]);
  const currentMonth = today.getFullYear() === year ? today.getMonth() + 1 : null;
  const next = useMemo(() => nextUpcomingItem(filtered, today), [filtered, today]);

  function toggleMonthFocus(m: number) {
    setMonthFocus((cur) => (cur === m ? null : m));
  }

  function openCreate() {
    setError(null);
    setForm({
      year,
      title: '',
      month: '',
      day: '',
      endMonth: '',
      endDay: '',
      repeat: 'none',
      repeatUntilMonth: '',
      // Taggar är valfria — förifyll bara den man redan filtrerar på.
      tags: tag !== 'all' && tag !== 'none' ? [tag] : [],
      category: category === 'all' ? (categories[0]?.id ?? 'ledning') : category,
      responsible: responsible !== 'all' && responsible !== 'none' ? responsible : '',
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
      day: item.day ? String(item.day) : '',
      endMonth: item.end_month ? String(item.end_month) : '',
      endDay: item.end_day ? String(item.end_day) : '',
      // Serier expanderas vid skapandet — en befintlig post redigeras enskilt.
      repeat: 'none',
      repeatUntilMonth: '',
      tags: [...(item.tags ?? [])],
      category: item.category,
      responsible: item.responsible ?? '',
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
    if (!form.category) {
      setError('Välj en kategori.');
      return;
    }
    const monthValue = form.month === '' ? null : Number(form.month);
    // En dag utan månad är meningslös → nollställ.
    const dayValue = monthValue === null || form.day === '' ? null : Number(form.day);
    // Slutdatum bara relevant när aktiviteten har en startmånad (= period).
    const endMonthValue = monthValue === null || form.endMonth === '' ? null : Number(form.endMonth);
    const endDayValue = endMonthValue === null || form.endDay === '' ? null : Number(form.endDay);
    if (endMonthValue !== null && monthValue !== null && endMonthValue < monthValue) {
      setError('Periodens slut måste ligga efter starten.');
      return;
    }
    setError(null);
    setWarning(null);
    setNotice(null);

    startTransition(async () => {
      if (form.id) {
        // Uppdatera ändrade fält (ett anrop per fält via det delade lagret).
        const original = items.find((i) => i.id === form.id);
        const updates: { field: AnnualWheelWritableFieldClient; value: unknown }[] = [];
        if (!original || original.title !== title) updates.push({ field: 'title', value: title });
        if (!original || (original.month ?? null) !== monthValue)
          updates.push({ field: 'month', value: monthValue });
        if (!original || (original.day ?? null) !== dayValue)
          updates.push({ field: 'day', value: dayValue });
        if (!original || (original.end_month ?? null) !== endMonthValue)
          updates.push({ field: 'end_month', value: endMonthValue });
        if (!original || (original.end_day ?? null) !== endDayValue)
          updates.push({ field: 'end_day', value: endDayValue });
        if (!original || !sameTags(original.tags ?? [], form.tags))
          updates.push({ field: 'tags', value: form.tags });
        if (!original || original.category !== form.category)
          updates.push({ field: 'category', value: form.category });
        if (!original || (original.responsible ?? '') !== form.responsible)
          updates.push({ field: 'responsible', value: form.responsible || null });
        if (!original || (original.notes ?? '') !== form.notes.trim())
          updates.push({ field: 'notes', value: form.notes.trim() });
        if (!original || original.year !== form.year) updates.push({ field: 'year', value: form.year });

        for (const u of updates) {
          const res = await updateAnnualWheelItemAction(form.id, u.field, u.value);
          if (res?.error) {
            setError(res.error);
            return;
          }
          if (res?.warning) setWarning(res.warning);
          if (res?.notice) setNotice(res.notice);
        }
      } else {
        const res = await createAnnualWheelItemAction({
          year: form.year,
          title,
          month: monthValue,
          day: dayValue,
          end_month: endMonthValue,
          end_day: endDayValue,
          tags: form.tags,
          category: form.category,
          responsible: form.responsible || null,
          notes: form.notes.trim() || undefined,
          repeat: form.repeat,
          repeatUntilMonth: form.repeatUntilMonth === '' ? null : Number(form.repeatUntilMonth)
        });
        if (res?.error) {
          setError(res.error);
          return;
        }
        if (res?.warning) setWarning(res.warning);
        const parts: string[] = [];
        if ((res?.created ?? 1) > 1) parts.push(`${res!.created} aktiviteter lades till i årshjulet.`);
        if (res?.notice) parts.push(res.notice);
        if (parts.length > 0) setNotice(parts.join(' '));
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
      {schemaWarning ? (
        <div className="flex items-start gap-2 rounded-xl bg-movexum-pastell-gul px-3 py-2 text-[12.5px] text-movexum-morkgul">
          <Icon name="alert" size={14} />
          <span className="flex-1">{schemaWarning}</span>
          {canManageCategories || canEdit ? (
            <button
              type="button"
              onClick={repairSchema}
              disabled={repairing}
              className="shrink-0 rounded-md bg-movexum-morkgul/15 px-2 py-0.5 text-[12px] font-medium hover:bg-movexum-morkgul/25 disabled:opacity-60"
            >
              {repairing ? 'Reparerar…' : 'Försök reparera'}
            </button>
          ) : null}
        </div>
      ) : null}
      {notice ? (
        <div className="flex items-start gap-2 rounded-xl bg-movexum-pastell-gron px-3 py-2 text-[12.5px] text-movexum-morkgron">
          <Icon name="check" size={14} />
          <span className="flex-1">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="shrink-0 opacity-70 hover:opacity-100"
            aria-label="Stäng"
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      ) : null}
      {warning ? (
        <div className="flex items-start gap-2 rounded-xl bg-movexum-pastell-gul px-3 py-2 text-[12.5px] text-movexum-morkgul">
          <Icon name="alert" size={14} />
          <span className="flex-1">{warning}</span>
          <button
            type="button"
            onClick={() => setWarning(null)}
            className="shrink-0 opacity-70 hover:opacity-100"
            aria-label="Stäng"
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      ) : null}
      {error && !form ? (
        <div className="flex items-start gap-2 rounded-xl bg-movexum-pastell-orange px-3 py-2 text-[12.5px] text-movexum-morkorange">
          <Icon name="alert" size={14} />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 opacity-70 hover:opacity-100"
            aria-label="Stäng"
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      ) : null}

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
            ...categories.map((c) => ({ value: c.id, label: c.label })),
            ...orphanCategories.map((c) => ({ value: c, label: `${c} (borttagen)` }))
          ]}
        />
        <FilterSelect
          label="Tagg"
          value={tag}
          onChange={(v) => setTag(v as AnnualWheelTag | 'all' | 'none')}
          options={[
            { value: 'all', label: 'Alla taggar' },
            ...ANNUAL_WHEEL_TAGS.map((t) => ({ value: t.id, label: t.label })),
            { value: 'none', label: 'Utan tagg' }
          ]}
        />
        <FilterSelect
          label="Ansvarig"
          value={responsible}
          onChange={setResponsible}
          options={[
            { value: 'all', label: 'Alla ansvariga' },
            ...people.map((p) => ({ value: p.id, label: p.name })),
            { value: 'none', label: 'Utan ansvarig' }
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          {canManageCategories ? (
            <button
              type="button"
              onClick={() => setManageCategories(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-default px-3 py-1.5 text-[13px] font-medium text-foreground-muted hover:border-strong hover:text-foreground"
            >
              <Icon name="filter" size={14} /> Kategorier
            </button>
          ) : null}
          <Link
            href="/arshjul/presentation"
            className="inline-flex items-center gap-1.5 rounded-lg border border-default px-3 py-1.5 text-[13px] font-medium text-foreground-muted hover:border-strong hover:text-foreground"
            title="Helskärmsläge för måndagsgenomgången"
          >
            <Icon name="external" size={14} /> Presentera
          </Link>
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

      {/* Uppföljning per tagg — klicka för att filtrera hjul, listor och tabell. */}
      {tagCounts.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {tagCounts.map(({ tag: t, count }) => {
            const value = t ?? 'none';
            const active = tag === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setTag(active ? 'all' : (value as AnnualWheelTag | 'none'))}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                  active
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-default text-foreground-muted hover:border-strong hover:text-foreground'
                }`}
              >
                {t ? annualWheelTagLabel(t) : 'Utan tagg'}
                <span className="mx-tnum text-[11px] text-foreground-subtle">{count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
        {/* Hjulet */}
        <section className="rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5">
          <Wheel
            items={filtered}
            year={year}
            categories={categories}
            onPick={canEdit ? openEdit : undefined}
            todayAngle={todayAngle}
            currentMonth={currentMonth}
            monthFocus={monthFocus}
            onFocusMonth={toggleMonthFocus}
            next={next}
          />
          {next ? <NextCaption next={next} /> : null}
          <Legend categories={categories} orphans={orphanCategories} />
        </section>

        {/* Odaterade + snabböversikt */}
        <section className="space-y-4">
          {undated.length > 0 ? (
            <div className="rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5">
              <h3 className="mb-2 font-heading text-[14px] font-semibold text-foreground">
                Helårs- / återkommande aktiviteter
              </h3>
              <ul className="space-y-0.5">
                {undated.map((it) => (
                  <ItemPill
                    key={it.id}
                    item={it}
                    categories={categories}
                    onEdit={canEdit ? openEdit : undefined}
                    onDelete={canEdit ? remove : undefined}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          <div className="rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-heading text-[14px] font-semibold text-foreground">Per månad</h3>
              {monthFocus ? (
                <button
                  type="button"
                  onClick={() => setMonthFocus(null)}
                  className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand hover:bg-brand/15"
                >
                  {monthLongLabel(monthFocus)}
                  <Icon name="x" size={11} />
                </button>
              ) : null}
            </div>
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-foreground-muted">
                Inga aktiviteter matchar filtret för {year}.
              </p>
            ) : (
              <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
                {byMonth
                  .slice(1)
                  .map((monthItems, idx) => ({ monthItems, m: idx + 1 }))
                  .filter(({ m }) => (monthFocus ? m === monthFocus : true))
                  .map(({ monthItems, m }) =>
                    monthItems.length > 0 ? (
                      <div key={m} className="rounded-xl border border-default bg-surface p-2">
                        <div className="mb-1 flex items-baseline justify-between gap-2 px-1.5 pt-0.5">
                          <span className="font-heading text-[12.5px] font-semibold text-foreground">
                            {monthLongLabel(m)}
                          </span>
                          <span className="mx-tnum shrink-0 text-[11px] text-foreground-subtle">
                            Q{quarterForMonth(m)} · {monthItems.length}{' '}
                            {monthItems.length === 1 ? 'aktivitet' : 'aktiviteter'}
                          </span>
                        </div>
                        <ul className="space-y-0.5">
                          {monthItems.map((it) => (
                            <ItemPill
                              key={it.id}
                              item={it}
                              categories={categories}
                              onEdit={canEdit ? openEdit : undefined}
                              onDelete={canEdit ? remove : undefined}
                            />
                          ))}
                        </ul>
                      </div>
                    ) : monthFocus ? (
                      <p key={m} className="py-4 text-center text-[12.5px] text-foreground-muted">
                        Inga aktiviteter i {monthLongLabel(m)}.
                      </p>
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
                {tableTags.map((t) => (
                  <th key={t} className="px-2 py-1.5 font-medium">
                    {annualWheelTagLabel(t)}
                  </th>
                ))}
                <th className="px-2 py-1.5 font-medium">Utan tagg</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.month} className="border-t border-default align-top">
                  <th className="sticky left-0 bg-surface px-2 py-1.5 text-left font-medium text-foreground">
                    {row.monthLabel}
                  </th>
                  {row.cells.map((cell) => (
                    <td key={cell.tag ?? '__untagged'} className="px-2 py-1.5">
                      <div className="flex flex-col gap-1">
                        {cell.items.map((it) => (
                          <span
                            key={it.id}
                            className="inline-flex items-center gap-1 text-foreground-muted"
                          >
                            <span
                              className="inline-block h-2 w-2 shrink-0 rounded-full"
                              style={{ background: colorVar(it.category) }}
                              aria-hidden
                            />
                            {it.day || isAnnualWheelPeriod(it) ? (
                              <span className="mx-tnum shrink-0 font-medium text-foreground-subtle">
                                {annualWheelShortRangeLabel(it)}
                              </span>
                            ) : null}
                            {it.title}
                            {it.day ? (
                              <span className="mx-tnum text-foreground-subtle">
                                · {it.day}/{row.month}
                              </span>
                            ) : null}
                            {it.responsible_name ? (
                              <span className="text-foreground-subtle">· {it.responsible_name}</span>
                            ) : null}
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
          categories={categories}
          setForm={setForm}
          onSubmit={submitForm}
          onClose={() => setForm(null)}
          pending={pending}
          error={error}
          people={people}
        />
      ) : null}

      {manageCategories && canManageCategories ? (
        <CategoryManagerModal
          categories={categories}
          items={items}
          onClose={() => setManageCategories(false)}
        />
      ) : null}
    </div>
  );
}

function Legend({
  categories,
  orphans
}: {
  categories: AnnualWheelCategoryDef[];
  orphans: string[];
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
      {categories.map((c) => (
        <span key={c.id} className="inline-flex items-center gap-1.5 text-[12px] text-foreground-muted">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: annualWheelColorVar(c.token) }}
            aria-hidden
          />
          {c.label}
        </span>
      ))}
      {/* Poster vars kategori har raderats — visas så inget band blir oförklarat. */}
      {orphans.map((key) => (
        <span
          key={key}
          className="inline-flex items-center gap-1.5 text-[12px] text-foreground-subtle"
          title="Kategorin har tagits bort — välj en ny på aktiviteten."
        >
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: annualWheelColorVar(undefined) }}
            aria-hidden
          />
          {key} (borttagen)
        </span>
      ))}
    </div>
  );
}

/**
 * Liten datumbricka (mini-kalenderblad) per aktivitet: dag + månad när ett
 * specifikt datum är satt, bara månad för månadsaktiviteter, och en
 * kalenderikon för helårs-/återkommande poster.
 */
function DateBadge({ item }: { item: AnnualWheelItem }) {
  const month = item.month ?? null;
  const day = item.day ?? null;
  if (isAnnualWheelPeriod(item)) {
    // Kampanj: "JAN → FEB" i stället för en enskild dag.
    return (
      <span
        className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg border border-default bg-canvas-subtle leading-none"
        aria-hidden
      >
        <span className="text-[8.5px] font-semibold uppercase tracking-wide text-foreground">
          {monthShortLabel(month)}
        </span>
        <span className="my-0.5 text-[8px] text-foreground-subtle">→</span>
        <span className="text-[8.5px] font-semibold uppercase tracking-wide text-foreground">
          {monthShortLabel(item.end_month ?? null)}
        </span>
      </span>
    );
  }
  return (
    <span
      className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg border border-default bg-canvas-subtle leading-none"
      aria-hidden
    >
      {month === null ? (
        <Icon name="calendar" size={14} className="text-foreground-subtle" />
      ) : day ? (
        <>
          <span className="mx-tnum text-[13px] font-semibold text-foreground">{day}</span>
          <span className="mt-0.5 text-[8px] font-semibold uppercase tracking-wide text-foreground-subtle">
            {monthShortLabel(month)}
          </span>
        </>
      ) : (
        <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
          {monthShortLabel(month)}
        </span>
      )}
    </span>
  );
}

function ItemPill({
  item,
  categories,
  onEdit,
  onDelete
}: {
  item: AnnualWheelItem;
  categories: AnnualWheelCategoryDef[];
  onEdit?: (item: AnnualWheelItem) => void;
  onDelete?: (item: AnnualWheelItem) => void;
}) {
  const tagText = (item.tags ?? []).map((t) => annualWheelTagLabel(t)).join(' · ');
  return (
    <li className="group flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 transition-colors hover:bg-canvas-subtle">
      <DateBadge item={item} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[13px] leading-snug">
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ background: annualWheelCategoryColorVar(item.category, categories) }}
            aria-hidden
          />
          <span className="min-w-0 truncate font-medium text-foreground">{item.title}</span>
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 pl-3.5 text-[11px] text-foreground-subtle">
          <span
            className="mx-tnum shrink-0 rounded-md bg-canvas-subtle px-1.5 py-0.5 font-medium text-foreground-muted"
            title={annualWheelRangeLabel(item)}
          >
            {annualWheelShortRangeLabel(item)}
          </span>
          {item.responsible_name ? (
            <span className="truncate" title={`Ansvarig: ${item.responsible_name}`}>
              {item.responsible_name}
            </span>
          ) : null}
          {tagText ? <span className="truncate">{tagText}</span> : null}
        </div>
      </div>
      {onEdit ? (
        <button
          type="button"
          onClick={() => onEdit(item)}
          className="shrink-0 rounded-md p-1 text-foreground-subtle transition-colors hover:bg-canvas-muted hover:text-brand"
          aria-label="Redigera"
        >
          <Icon name="pencil" size={13} />
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          onClick={() => onDelete(item)}
          className="shrink-0 rounded-md p-1 text-foreground-subtle transition-colors hover:bg-canvas-muted hover:text-movexum-orange"
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

export function EditorModal({
  form,
  categories,
  setForm,
  onSubmit,
  onClose,
  pending,
  error,
  people
}: {
  form: FormState;
  categories: AnnualWheelCategoryDef[];
  setForm: (f: FormState) => void;
  onSubmit: () => void;
  onClose: () => void;
  pending: boolean;
  error: string | null;
  people: AssignableResource[];
}) {
  const yearNow = new Date().getFullYear();
  const yearOptions = [yearNow - 1, yearNow, yearNow + 1, yearNow + 2];
  if (!yearOptions.includes(form.year)) yearOptions.push(form.year);
  yearOptions.sort((a, b) => a - b);

  // Period och upprepning är avancerade val — hopfällda tills man slår på
  // dem, så dialogen inte känns som ett formulär för allt på en gång.
  const [periodOpen, setPeriodOpen] = useState(form.endMonth !== '');
  const [repeatOpen, setRepeatOpen] = useState(form.repeat !== 'none');
  const hasMonth = form.month !== '';

  // Nollställ dagen om den inte finns i den nya månaden/året (t.ex. 31 → april).
  function clampedDay(year: number, month: string, day: string): string {
    if (month === '' || day === '') return month === '' ? '' : day;
    return Number(day) > daysInMonth(year, Number(month)) ? '' : day;
  }

  function togglePeriod(on: boolean) {
    setPeriodOpen(on);
    if (!on) setForm({ ...form, endMonth: '', endDay: '' });
  }

  function toggleRepeat(on: boolean) {
    setRepeatOpen(on);
    setForm({ ...form, repeat: on ? 'monthly' : 'none', repeatUntilMonth: on ? form.repeatUntilMonth : '' });
  }

  const inputCls =
    'w-full rounded-lg border border-default bg-canvas px-2.5 py-1.5 text-[13px] text-foreground disabled:opacity-50';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-movexum-svart/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[calc(100vh-3rem)] w-full max-w-xl overflow-y-auto rounded-2xl border border-default bg-surface shadow-lg shadow-movexum-svart/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-default bg-surface/95 px-5 py-3.5 backdrop-blur-sm">
          <div>
            <h3 className="font-heading text-[16px] font-semibold text-foreground">
              {form.id ? 'Redigera aktivitet' : 'Ny aktivitet'}
            </h3>
            <p className="mt-0.5 text-[12px] text-foreground-subtle">
              {form.id
                ? 'Ändringarna sparas fält för fält och loggas.'
                : 'Titel, kategori och när — resten är valfritt.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-foreground-subtle hover:bg-canvas-subtle hover:text-foreground"
            aria-label="Stäng"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {/* ── Vad ─────────────────────────────────────────────────────── */}
          <section className="space-y-3">
            <Field label="Titel">
              <input
                type="text"
                value={form.title}
                maxLength={200}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className={`${inputCls} text-[14px]`}
                placeholder="t.ex. LinkedIn-kampanj, Styrelsemöte, Strategidagar"
                autoFocus
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kategori">
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className={inputCls}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                  {/* Posten kan peka på en raderad kategori — visa den så den inte
                      byts tyst, men uppmuntra ett aktivt val. */}
                  {form.category && !categories.some((c) => c.id === form.category) ? (
                    <option value={form.category}>{form.category} (borttagen)</option>
                  ) : null}
                </select>
              </Field>
              <Field label="Ansvarig">
                <select
                  value={form.responsible}
                  onChange={(e) => setForm({ ...form, responsible: e.target.value })}
                  className={inputCls}
                >
                  <option value="">Ingen ansvarig</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </section>

          {/* ── När ─────────────────────────────────────────────────────── */}
          <section className="space-y-3">
            <SectionHeading icon="calendar" label="När" />
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
              <Field label="År">
                <select
                  value={String(form.year)}
                  onChange={(e) => {
                    const year = Number(e.target.value);
                    setForm({ ...form, year, day: clampedDay(year, form.month, form.day) });
                  }}
                  className={inputCls}
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
                  onChange={(e) => {
                    const month = e.target.value;
                    setForm({
                      ...form,
                      month,
                      day: clampedDay(form.year, month, form.day),
                      // Utan månad finns varken period eller serie.
                      ...(month === '' ? { endMonth: '', endDay: '', repeat: 'none' as AnnualWheelRepeat } : {})
                    });
                    if (month === '') {
                      setPeriodOpen(false);
                      setRepeatOpen(false);
                    }
                  }}
                  className={inputCls}
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

            {hasMonth ? (
              <DayCalendar
                year={form.year}
                month={Number(form.month)}
                selected={form.day === '' ? null : Number(form.day)}
                onSelect={(d) => setForm({ ...form, day: d === null ? '' : String(d) })}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-default bg-canvas-subtle px-3 py-2.5 text-[12px] text-foreground-muted">
                Utan månad gäller aktiviteten hela året. Välj en månad för att sätta datum,
                period eller upprepning.
              </p>
            )}

            {/* Period */}
            <ToggleRow
              icon="target"
              label="Pågår över tid"
              hint={
                periodOpen && form.endMonth !== ''
                  ? `Till ${form.endDay !== '' ? `${form.endDay} ` : ''}${monthLongLabel(Number(form.endMonth)).toLowerCase()}`
                  : 'Kampanj eller projekt med start och slut'
              }
              checked={periodOpen}
              disabled={!hasMonth}
              onChange={togglePeriod}
            >
              <div className="grid grid-cols-2 gap-3">
                <Field label="Slutmånad">
                  <select
                    value={form.endMonth}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        endMonth: e.target.value,
                        endDay: e.target.value === '' ? '' : form.endDay
                      })
                    }
                    className={inputCls}
                  >
                    <option value="">Välj slutmånad…</option>
                    {Array.from({ length: 12 }, (_, i) => i + 1)
                      .filter((m) => m >= Number(form.month))
                      .map((m) => (
                        <option key={m} value={String(m)}>
                          {monthLongLabel(m)}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Slutdag">
                  <select
                    value={form.endDay}
                    disabled={form.endMonth === ''}
                    onChange={(e) => setForm({ ...form, endDay: e.target.value })}
                    className={inputCls}
                  >
                    <option value="">Månadens sista dag</option>
                    {form.endMonth !== ''
                      ? Array.from(
                          { length: daysInMonth(form.year, Number(form.endMonth)) },
                          (_, i) => i + 1
                        ).map((d) => (
                          <option key={d} value={String(d)}>
                            {d} {monthLongLabel(Number(form.endMonth)).toLowerCase()}
                          </option>
                        ))
                      : null}
                  </select>
                </Field>
              </div>
            </ToggleRow>

            {/* Upprepning (bara vid nyskapande — serien expanderas då). */}
            {!form.id ? (
              <ToggleRow
                icon="copy"
                label="Upprepa"
                hint={
                  repeatOpen && form.repeat !== 'none'
                    ? `Skapar ${seriesPreviewCount(form)} aktiviteter — en per förekomst`
                    : 'Varje månad, varannan eller varje kvartal'
                }
                checked={repeatOpen}
                disabled={!hasMonth}
                onChange={toggleRepeat}
              >
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Hur ofta">
                    <select
                      value={form.repeat}
                      onChange={(e) => setForm({ ...form, repeat: e.target.value as AnnualWheelRepeat })}
                      className={inputCls}
                    >
                      {ANNUAL_WHEEL_REPEATS.filter((r) => r.id !== 'none').map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="T.o.m.">
                    <select
                      value={form.repeatUntilMonth}
                      onChange={(e) => setForm({ ...form, repeatUntilMonth: e.target.value })}
                      className={inputCls}
                    >
                      <option value="">December</option>
                      {Array.from({ length: 12 }, (_, i) => i + 1)
                        .filter((m) => m >= Number(form.month))
                        .map((m) => (
                          <option key={m} value={String(m)}>
                            {monthLongLabel(m)}
                          </option>
                        ))}
                    </select>
                  </Field>
                </div>
              </ToggleRow>
            ) : null}
          </section>

          {/* ── Taggar ──────────────────────────────────────────────────── */}
          <section className="space-y-2">
            <SectionHeading icon="filter" label="Taggar" hint="valfritt — för uppföljning" />
            {(['marknad', 'verksamhet'] as const).map((group) => (
              <div key={group} className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 w-[86px] shrink-0 text-[11px] font-medium text-foreground-subtle">
                  {ANNUAL_WHEEL_TAG_GROUP_LABELS[group]}
                </span>
                {annualWheelTagsInGroup(group).map((t) => {
                  const active = form.tags.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setForm({
                          ...form,
                          tags: active ? form.tags.filter((x) => x !== t.id) : [...form.tags, t.id]
                        })
                      }
                      className={`rounded-full border px-2.5 py-0.5 text-[12px] transition-colors ${
                        active
                          ? 'border-brand bg-brand/10 font-medium text-brand'
                          : 'border-default text-foreground-muted hover:border-strong hover:text-foreground'
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </section>

          {/* ── Anteckning ──────────────────────────────────────────────── */}
          <Field label="Anteckning (valfritt)">
            <textarea
              value={form.notes}
              maxLength={2000}
              rows={2}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className={inputCls}
            />
          </Field>

          {error ? (
            <p className="flex items-start gap-2 rounded-lg bg-movexum-pastell-orange px-3 py-2 text-[12.5px] text-movexum-morkorange">
              <Icon name="alert" size={14} />
              <span>{error}</span>
            </p>
          ) : null}
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-default bg-surface/95 px-5 py-3 backdrop-blur-sm">
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
            className="rounded-lg bg-brand px-4 py-1.5 text-[13px] font-medium text-brand-foreground hover:bg-brand-hover disabled:opacity-60"
          >
            {pending ? 'Sparar…' : form.id ? 'Spara ändringar' : 'Lägg till'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ icon, label, hint }: { icon: 'calendar' | 'filter'; label: string; hint?: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
      <Icon name={icon} size={12} />
      {label}
      {hint ? <span className="font-normal normal-case tracking-normal">· {hint}</span> : null}
    </div>
  );
}

/**
 * Hopfällbar rad med en switch: stängd = en lugn rad med förklaring, öppen =
 * fälten visas under. Håller dialogen kort utan att gömma funktionerna.
 */
function ToggleRow({
  icon,
  label,
  hint,
  checked,
  disabled,
  onChange,
  children
}: {
  icon: 'target' | 'copy';
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border transition-colors ${
        checked ? 'border-brand/40 bg-brand/[0.03]' : 'border-default'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
        <Icon name={icon} size={14} className="shrink-0 text-foreground-subtle" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-foreground">{label}</span>
          <span className="block truncate text-[11.5px] text-foreground-subtle">{hint}</span>
        </span>
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          aria-hidden
          className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${
            checked ? 'bg-brand' : 'bg-canvas-muted'
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-sm shadow-movexum-svart/20 transition-transform ${
              checked ? 'translate-x-[18px]' : 'translate-x-0.5'
            }`}
          />
        </span>
      </label>
      {checked ? <div className="border-t border-default/60 px-3 py-3">{children}</div> : null}
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

// ─── Kalender (datumval i editorn) ───────────────────────────────────────────

/** Veckodagsrubriker, måndagsstartad vecka (svensk standard). */
const WEEKDAYS_SV = ['Må', 'Ti', 'On', 'To', 'Fr', 'Lö', 'Sö'] as const;

/**
 * Mini-kalender för "Specifikt datum": ett klick väljer dagen, ett klick på
 * den valda dagen (eller "Hela månaden") rensar valet. Dagens datum ringas in
 * när den visade månaden är innevarande månad.
 */
function DayCalendar({
  year,
  month,
  selected,
  onSelect
}: {
  year: number;
  month: number;
  selected: number | null;
  onSelect: (day: number | null) => void;
}) {
  const dim = daysInMonth(year, month);
  // getDay() har söndag = 0 → skifta till måndagsstartat index (0 = måndag).
  const leading = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const now = new Date();
  const todayDay =
    now.getFullYear() === year && now.getMonth() + 1 === month ? now.getDate() : null;

  return (
    <div className="rounded-xl border border-default bg-canvas p-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
          <Icon name="calendar" size={13} className="text-foreground-subtle" />
          {monthLongLabel(month)} {year}
        </span>
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-pressed={selected === null}
          className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
            selected === null
              ? 'border-brand bg-brand/10 font-medium text-brand'
              : 'border-default text-foreground-muted hover:border-strong hover:text-foreground'
          }`}
        >
          Hela månaden
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAYS_SV.map((d, i) => (
          <span
            key={`wd-${i}`}
            className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle"
          >
            {d}
          </span>
        ))}
        {Array.from({ length: leading }, (_, i) => (
          <span key={`blank-${i}`} aria-hidden />
        ))}
        {Array.from({ length: dim }, (_, i) => i + 1).map((d) => {
          const isSelected = selected === d;
          const isToday = todayDay === d;
          return (
            <button
              key={d}
              type="button"
              onClick={() => onSelect(isSelected ? null : d)}
              aria-pressed={isSelected}
              aria-label={`${d} ${monthLongLabel(month).toLowerCase()} ${year}`}
              className={`mx-tnum h-8 rounded-lg text-[12.5px] transition-colors ${
                isSelected
                  ? 'bg-brand font-semibold text-brand-foreground shadow-sm shadow-movexum-svart/10'
                  : isToday
                    ? 'font-semibold text-brand ring-1 ring-inset ring-brand/35 hover:bg-brand/10'
                    : 'text-foreground hover:bg-canvas-subtle'
              }`}
            >
              {d}
            </button>
          );
        })}
      </div>
      <p className="mt-2 border-t border-default pt-2 text-[11px] text-foreground-subtle">
        {selected !== null
          ? `Valt datum: ${annualWheelDateLabel(month, selected, year)}`
          : 'Ingen specifik dag vald — aktiviteten gäller hela månaden.'}
      </p>
    </div>
  );
}

// ─── Kategori-hantering (superadmin) ─────────────────────────────────────────
//
// Bara superadmin (`admin`) når denna modal — behörigheten enforce:as i
// server-actionerna (säkerhetsgränsen) och i PB:s update/delete-regler; UI:t
// är bara en bekvämlighet. Färgerna är låsta till Movexums brand-tokens (§ 2.2).

function CategoryManagerModal({
  categories,
  items,
  onClose
}: {
  categories: AnnualWheelCategoryDef[];
  items: AnnualWheelItem[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newToken, setNewToken] = useState<AnnualWheelColorToken>(
    ANNUAL_WHEEL_COLOR_TOKENS[0].id
  );

  // Hur många aktiviteter använder respektive kategori (styr radera-knappen).
  const usage = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of items) map.set(it.category, (map.get(it.category) ?? 0) + 1);
    return map;
  }, [items]);

  const previewKey = slugifyAnnualWheelCategoryKey(newLabel);

  function run(action: () => Promise<{ ok?: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res?.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function add() {
    const label = newLabel.trim();
    if (!label) {
      setError('Ange ett namn på kategorin.');
      return;
    }
    if (!previewKey) {
      setError('Namnet måste innehålla minst en bokstav eller siffra.');
      return;
    }
    run(async () => {
      const res = await createAnnualWheelCategoryAction({ label, token: newToken });
      if (!res?.error) setNewLabel('');
      return res;
    });
  }

  function rename(cat: AnnualWheelCategoryDef, label: string) {
    const next = label.trim();
    if (!cat.recordId || !next || next === cat.label) return;
    run(() => updateAnnualWheelCategoryAction(cat.recordId!, { label: next }));
  }

  function recolor(cat: AnnualWheelCategoryDef, token: string) {
    if (!cat.recordId || token === cat.token) return;
    run(() => updateAnnualWheelCategoryAction(cat.recordId!, { token }));
  }

  function remove(cat: AnnualWheelCategoryDef) {
    if (!cat.recordId) return;
    if (!confirm(`Ta bort kategorin "${cat.label}"?`)) return;
    run(() => deleteAnnualWheelCategoryAction(cat.recordId!));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-movexum-svart/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-default bg-surface p-5 shadow-lg shadow-movexum-svart/20"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-heading text-[16px] font-semibold text-foreground">
          Årshjulets kategorier
        </h3>
        <p className="mt-1 text-[12px] text-foreground-muted">
          Kategorierna styr hjulets legend och färg. Bara superadmin kan lägga till eller ta bort
          dem. En kategori som används av aktiviteter måste tömmas först.
        </p>

        <ul className="mt-4 space-y-2">
          {categories.map((c) => {
            const used = usage.get(c.id) ?? 0;
            const persisted = !!c.recordId;
            return (
              <li key={c.id} className="flex items-center gap-2 rounded-xl border border-default p-2">
                <span
                  className="inline-block h-4 w-4 shrink-0 rounded-sm"
                  style={{ background: annualWheelColorVar(c.token) }}
                  aria-hidden
                />
                <input
                  type="text"
                  defaultValue={c.label}
                  maxLength={ANNUAL_WHEEL_CATEGORY_LABEL_MAX}
                  disabled={pending || !persisted}
                  onBlur={(e) => rename(c, e.target.value)}
                  aria-label={`Namn på kategorin ${c.label}`}
                  className="min-w-0 flex-1 rounded-lg border border-default bg-canvas px-2 py-1 text-[13px] text-foreground disabled:opacity-60"
                />
                <select
                  value={c.token}
                  disabled={pending || !persisted}
                  onChange={(e) => recolor(c, e.target.value)}
                  aria-label={`Färg för kategorin ${c.label}`}
                  className="rounded-lg border border-default bg-canvas px-2 py-1 text-[12px] text-foreground disabled:opacity-60"
                >
                  {ANNUAL_WHEEL_COLOR_TOKENS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <span
                  className="w-16 shrink-0 text-right text-[11px] text-foreground-subtle"
                  title="Antal aktiviteter i kategorin"
                >
                  {used} st
                </span>
                <button
                  type="button"
                  onClick={() => remove(c)}
                  disabled={pending || !persisted || used > 0 || categories.length <= 1}
                  className="shrink-0 text-foreground-subtle hover:text-movexum-orange disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={`Ta bort kategorin ${c.label}`}
                  title={
                    used > 0
                      ? 'Kategorin används av aktiviteter — flytta dem först.'
                      : categories.length <= 1
                        ? 'Årshjulet måste ha minst en kategori.'
                        : 'Ta bort kategorin'
                  }
                >
                  <Icon name="trash" size={14} />
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-4 rounded-xl border border-default bg-canvas-subtle p-3">
          <span className="mb-1.5 block text-[11px] font-medium text-foreground-subtle">
            Ny kategori
          </span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newLabel}
              maxLength={ANNUAL_WHEEL_CATEGORY_LABEL_MAX}
              placeholder="t.ex. Ägarmöten"
              onChange={(e) => setNewLabel(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-default bg-canvas px-2.5 py-1.5 text-[13px] text-foreground"
            />
            <select
              value={newToken}
              onChange={(e) => setNewToken(e.target.value as AnnualWheelColorToken)}
              aria-label="Färg för den nya kategorin"
              className="rounded-lg border border-default bg-canvas px-2 py-1.5 text-[12px] text-foreground"
            >
              {ANNUAL_WHEEL_COLOR_TOKENS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={add}
              disabled={pending}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[13px] font-medium text-brand-foreground hover:bg-brand-hover disabled:opacity-60"
            >
              <Icon name="plus" size={14} /> Lägg till
            </button>
          </div>
          {previewKey ? (
            <p className="mt-1.5 text-[11px] text-foreground-subtle">
              Nyckel: <span className="mx-tnum">{previewKey}</span> (kan inte ändras senare)
            </p>
          ) : null}
        </div>

        {error ? (
          <p className="mt-3 rounded-lg bg-movexum-pastell-orange px-2.5 py-1.5 text-[12px] text-movexum-morkorange">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[13px] text-foreground-muted hover:text-foreground"
          >
            Stäng
          </button>
        </div>
      </div>
    </div>
  );
}
