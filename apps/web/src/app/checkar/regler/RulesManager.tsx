'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  SUPPORT_CHECK_RULE_ANCHORS,
  SUPPORT_CHECK_RULE_ANCHOR_LABELS,
  SUPPORT_CHECK_RULE_CONDITIONS,
  SUPPORT_CHECK_RULE_CONDITION_LABELS,
  SUPPORT_CHECK_RULE_REPEATS,
  SUPPORT_CHECK_RULE_REPEAT_LABELS,
  SUPPORT_CHECK_TASK_KINDS,
  type SupportCheckRule
} from '@platform/shared';
import { deleteSupportCheckRuleAction, saveSupportCheckRuleAction, type SupportCheckRuleFormInput } from '@/lib/actions/support-checks';
import { Icon } from '@/components/proto';
import type { FormOption } from '../form-data';
import { Notice, btnGhost, btnPrimary, inputClass, labelClass } from '../ui';

const TASK_KIND_LABELS: Record<string, string> = { followup: 'Uppföljning', meeting: 'Möte', admin: 'Administration', email: 'E-post', call: 'Samtal', prep: 'Förberedelse', other: 'Övrigt' };

const EMPTY: SupportCheckRuleFormInput = { name: '', check_type: null, anchor: 'submitted_at', offset_days: 0, repeat: 'once', condition: 'awaiting_review', applies_to: 'all', task_title: '', task_kind: 'followup', active: true };

/** Uppföljningsregler för stödcheckar (§ 46.6) — tenant-breda eller per checktyp. Ledning sparar. */
export function RulesManager({ rules, types, canManage }: { rules: SupportCheckRule[]; types: FormOption[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<(SupportCheckRuleFormInput & { id: string | null }) | null>(null);
  const [feedback, setFeedback] = useState<{ error?: string; notice?: string }>({});
  const [pending, startTransition] = useTransition();
  const nameOf = (id?: string | null) => types.find((t) => t.id === id)?.label ?? id ?? '';
  const groups = [
    { label: 'Gäller alla checktyper', key: null as string | null, items: rules.filter((r) => !r.check_type) },
    ...types.map((t) => ({ label: `Bara: ${t.label}`, key: t.id as string | null, items: rules.filter((r) => r.check_type === t.id) })).filter((g) => g.items.length > 0)
  ];

  return (
    <div className="space-y-5">
      {feedback.error && <Notice kind="error">{feedback.error}</Notice>}
      {feedback.notice && <Notice kind="notice">{feedback.notice}</Notice>}
      {groups.map((g) => (
        <section key={g.key ?? 'global'} className="rounded-3xl border border-default bg-surface p-5">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-base font-semibold text-foreground">{g.label}</h2>
            <span className="flex-1" />
            {canManage && (
              <button type="button" className={btnGhost} onClick={() => setEditing({ ...EMPTY, id: null, check_type: g.key })}>
                <Icon name="plus" size={12} /> Ny regel
              </button>
            )}
          </div>
          {g.items.length === 0 ? (
            <p className="text-sm text-foreground-subtle">Inga regler.</p>
          ) : (
            <ul className="divide-y divide-default">
              {g.items.map((r) => (
                <li key={r.id} className={`flex flex-wrap items-start gap-3 py-3 text-sm ${r.active ? '' : 'opacity-60'}`}>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground">
                      {r.name}
                      {!r.active && <span className="ml-2 text-xs text-foreground-subtle">(inaktiv)</span>}
                      {r.applies_to === 'excellence' && <span className="ml-2 text-xs text-movexum-morkgul dark:text-movexum-pastell-gul">bara excellens</span>}
                    </div>
                    <div className="text-xs text-foreground-muted">
                      {SUPPORT_CHECK_RULE_ANCHOR_LABELS[r.anchor]} {r.offset_days >= 0 ? `+${r.offset_days}` : r.offset_days} dagar · {SUPPORT_CHECK_RULE_REPEAT_LABELS[r.repeat]} · {SUPPORT_CHECK_RULE_CONDITION_LABELS[r.condition].toLowerCase()}
                    </div>
                    <div className="mt-1 text-xs text-foreground-subtle">→ {TASK_KIND_LABELS[r.task_kind] ?? r.task_kind}: &quot;{r.task_title}&quot;</div>
                  </div>
                  {canManage && (
                    <div className="flex gap-2">
                      <button type="button" className={btnGhost} onClick={() => setEditing({ id: r.id, name: r.name, check_type: r.check_type ?? null, anchor: r.anchor, offset_days: r.offset_days, repeat: r.repeat, condition: r.condition, applies_to: r.applies_to, task_title: r.task_title, task_kind: r.task_kind, active: r.active })}>
                        <Icon name="pencil" size={12} />
                      </button>
                      <button
                        type="button"
                        className={btnGhost}
                        disabled={pending}
                        onClick={() => {
                          if (!confirm(`Ta bort regeln "${r.name}"?`)) return;
                          startTransition(async () => {
                            const res = await deleteSupportCheckRuleAction(r.id);
                            setFeedback({ error: res.error, notice: res.notice });
                            router.refresh();
                          });
                        }}
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {editing && (
        <RuleForm
          value={editing}
          typeLabel={editing.check_type ? nameOf(editing.check_type as string) : null}
          types={types}
          pending={pending}
          onCancel={() => setEditing(null)}
          onSubmit={(v) =>
            startTransition(async () => {
              const res = await saveSupportCheckRuleAction(editing.id, v);
              setFeedback({ error: res.error, notice: res.notice });
              if (res.ok) {
                setEditing(null);
                router.refresh();
              }
            })
          }
        />
      )}
    </div>
  );
}

function RuleForm({ value, typeLabel, types, pending, onCancel, onSubmit }: { value: SupportCheckRuleFormInput & { id: string | null }; typeLabel: string | null; types: FormOption[]; pending: boolean; onCancel: () => void; onSubmit: (v: SupportCheckRuleFormInput) => void }) {
  const uid = useId();
  const [v, setV] = useState<SupportCheckRuleFormInput>(value);
  const set = <K extends keyof SupportCheckRuleFormInput>(k: K, val: SupportCheckRuleFormInput[K]) => setV((s) => ({ ...s, [k]: val }));
  return (
    <form
      className="space-y-3 rounded-3xl border border-default bg-canvas-subtle p-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
    >
      <h3 className="text-sm font-semibold text-foreground">{value.id ? 'Redigera regel' : 'Ny regel'}{typeLabel ? ` — ${typeLabel}` : ''}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${uid}-n`} className={labelClass}>Namn</label>
          <input id={`${uid}-n`} className={inputClass} value={String(v.name ?? '')} onChange={(e) => set('name', e.target.value)} required />
        </div>
        <div>
          <label className={labelClass}>Gäller</label>
          <select className={inputClass} value={String(v.check_type ?? '')} onChange={(e) => set('check_type', e.target.value || null)}>
            <option value="">Alla checktyper</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Ankare</label>
          <select className={inputClass} value={String(v.anchor)} onChange={(e) => set('anchor', e.target.value)}>
            {SUPPORT_CHECK_RULE_ANCHORS.map((a) => (
              <option key={a} value={a}>{SUPPORT_CHECK_RULE_ANCHOR_LABELS[a]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Dagar från ankaret</label>
          <input className={inputClass} inputMode="numeric" value={String(v.offset_days ?? 0)} onChange={(e) => set('offset_days', Number(e.target.value))} />
        </div>
        <div>
          <label className={labelClass}>Upprepning</label>
          <select className={inputClass} value={String(v.repeat)} onChange={(e) => set('repeat', e.target.value)}>
            {SUPPORT_CHECK_RULE_REPEATS.map((r) => (
              <option key={r} value={r}>{SUPPORT_CHECK_RULE_REPEAT_LABELS[r]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Villkor (håller uppgiften öppen)</label>
          <select className={inputClass} value={String(v.condition)} onChange={(e) => set('condition', e.target.value)}>
            {SUPPORT_CHECK_RULE_CONDITIONS.map((c) => (
              <option key={c} value={c}>{SUPPORT_CHECK_RULE_CONDITION_LABELS[c]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Urval</label>
          <select className={inputClass} value={String(v.applies_to)} onChange={(e) => set('applies_to', e.target.value)}>
            <option value="all">Alla</option>
            <option value="excellence">Bara excellens-insatser</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Uppgiftstitel — {'{{title}}'}, {'{{startup}}'}, {'{{check_type}}'}</label>
          <input className={inputClass} value={String(v.task_title ?? '')} onChange={(e) => set('task_title', e.target.value)} required />
        </div>
        <div>
          <label className={labelClass}>Uppgiftstyp</label>
          <select className={inputClass} value={String(v.task_kind)} onChange={(e) => set('task_kind', e.target.value)}>
            {SUPPORT_CHECK_TASK_KINDS.map((k) => (
              <option key={k} value={k}>{TASK_KIND_LABELS[k] ?? k}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 pt-6 text-sm text-foreground"><input type="checkbox" checked={Boolean(v.active)} onChange={(e) => set('active', e.target.checked)} /> Aktiv</label>
      </div>
      <div className="flex gap-2">
        <button type="submit" className={btnPrimary} disabled={pending}>Spara</button>
        <button type="button" className={btnGhost} onClick={onCancel}>Avbryt</button>
      </div>
    </form>
  );
}
