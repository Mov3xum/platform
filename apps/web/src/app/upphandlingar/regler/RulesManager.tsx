'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  PROCUREMENT_RULE_ANCHOR_LABELS,
  PROCUREMENT_RULE_CONDITIONS,
  PROCUREMENT_RULE_CONDITION_LABELS,
  PROCUREMENT_RULE_REPEATS,
  PROCUREMENT_RULE_REPEAT_LABELS,
  PROCUREMENT_TASK_KINDS,
  RULE_ANCHORS_BY_SCOPE,
  type ProcurementRule
} from '@platform/shared';
import { deleteRuleAction, saveRuleAction, type RuleFormInput } from '@/lib/actions/procurements';
import { Icon } from '@/components/proto';
import type { FormOption } from '../ProcurementForm';
import { Notice, btnGhost, btnPrimary, inputClass, labelClass } from '../ui';

const TASK_KIND_LABELS: Record<string, string> = {
  followup: 'Uppföljning',
  meeting: 'Möte',
  admin: 'Administration',
  email: 'E-post',
  call: 'Samtal',
  prep: 'Förberedelse',
  other: 'Övrigt'
};

const EMPTY: RuleFormInput = {
  name: '',
  scope: 'calloff',
  anchor: 'milestone_1_due',
  offset_days: -14,
  repeat: 'once',
  condition: 'milestone_1_pending',
  applies_to: 'all',
  task_title: '',
  task_kind: 'followup',
  active: true,
  procurement: null
};

/**
 * Uppföljningsregler (§ 39.2) — tenant-breda eller per upphandling. Bara
 * admin/incubator_lead kan spara (server-actionen är gränsen); övrig staff
 * ser listan.
 */
export function RulesManager({
  rules,
  procurements,
  canManage,
  focusProcurement
}: {
  rules: ProcurementRule[];
  procurements: FormOption[];
  canManage: boolean;
  focusProcurement: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<RuleFormInput & { id: string | null } | null>(null);
  const [feedback, setFeedback] = useState<{ error?: string; warning?: string; notice?: string }>({});
  const [pending, startTransition] = useTransition();
  const nameOf = (id?: string | null) => procurements.find((p) => p.id === id)?.label ?? id ?? '';

  const groups: Array<{ label: string; key: string | null; items: ProcurementRule[] }> = [
    { label: 'Gäller alla upphandlingar', key: null, items: rules.filter((r) => !r.procurement) },
    ...procurements
      .map((p) => ({ label: `Bara: ${p.label}`, key: p.id, items: rules.filter((r) => r.procurement === p.id) }))
      .filter((g) => g.items.length > 0 || g.key === focusProcurement)
  ];

  const startNew = (procurement: string | null) =>
    setEditing({ ...EMPTY, id: null, procurement });
  const startEdit = (r: ProcurementRule) =>
    setEditing({
      id: r.id,
      name: r.name,
      scope: r.scope,
      anchor: r.anchor,
      offset_days: r.offset_days,
      repeat: r.repeat,
      condition: r.condition,
      applies_to: r.applies_to,
      task_title: r.task_title,
      task_kind: r.task_kind,
      active: r.active,
      procurement: r.procurement ?? null
    });

  return (
    <div className="space-y-5">
      {feedback.error && <Notice kind="error">{feedback.error}</Notice>}
      {feedback.warning && <Notice kind="warning">{feedback.warning}</Notice>}
      {feedback.notice && <Notice kind="notice">{feedback.notice}</Notice>}

      {groups.map((g) => (
        <section key={g.key ?? 'global'} className="rounded-3xl border border-default bg-surface p-5">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-base font-semibold text-foreground">{g.label}</h2>
            <span className="flex-1" />
            {canManage && (
              <button type="button" className={btnGhost} onClick={() => startNew(g.key)}>
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
                      {r.applies_to === 'excellence' && <span className="ml-2 text-xs text-movexum-morkgul">bara excellens</span>}
                    </div>
                    <div className="text-xs text-foreground-muted">
                      {r.scope === 'calloff' ? 'Per avrop' : 'Upphandling'} · {PROCUREMENT_RULE_ANCHOR_LABELS[r.anchor]}{' '}
                      {r.offset_days >= 0 ? `+${r.offset_days}` : r.offset_days} dagar · {PROCUREMENT_RULE_REPEAT_LABELS[r.repeat]} ·{' '}
                      {PROCUREMENT_RULE_CONDITION_LABELS[r.condition].toLowerCase()}
                    </div>
                    <div className="mt-1 text-xs text-foreground-subtle">→ {TASK_KIND_LABELS[r.task_kind] ?? r.task_kind}: &quot;{r.task_title}&quot;</div>
                  </div>
                  {canManage && (
                    <div className="flex gap-2">
                      <button type="button" className={btnGhost} onClick={() => startEdit(r)}>
                        <Icon name="pencil" size={12} />
                      </button>
                      <button
                        type="button"
                        className={btnGhost}
                        disabled={pending}
                        onClick={() => {
                          if (!confirm(`Ta bort regeln "${r.name}"? Öppna uppföljningar den skapat auto-stängs.`)) return;
                          startTransition(async () => {
                            const res = await deleteRuleAction(r.id, r.procurement ?? null);
                            setFeedback({ error: res.error, notice: res.notice, warning: res.warning });
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
          procurementLabel={editing.procurement ? nameOf(editing.procurement) : null}
          pending={pending}
          onCancel={() => setEditing(null)}
          onSubmit={(v) =>
            startTransition(async () => {
              const res = await saveRuleAction(editing.id, v);
              setFeedback({ error: res.error, notice: res.notice, warning: res.warning });
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

function RuleForm({
  value,
  procurementLabel,
  pending,
  onCancel,
  onSubmit
}: {
  value: RuleFormInput & { id: string | null };
  procurementLabel: string | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (v: RuleFormInput) => void;
}) {
  const uid = useId();
  const [v, setV] = useState<RuleFormInput>(value);
  const set = <K extends keyof RuleFormInput>(k: K, val: RuleFormInput[K]) => setV((s) => ({ ...s, [k]: val }));
  const anchors = RULE_ANCHORS_BY_SCOPE[v.scope as 'procurement' | 'calloff'] ?? [];
  const conditions = PROCUREMENT_RULE_CONDITIONS.filter((c) =>
    v.scope === 'procurement' ? c === 'always' || c === 'tender_not_awarded' : c !== 'tender_not_awarded'
  );

  return (
    <form
      className="rounded-3xl border border-strong bg-canvas-subtle p-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
    >
      <h3 className="text-sm font-semibold text-foreground">
        {value.id ? 'Redigera regel' : 'Ny regel'}
        {procurementLabel ? ` — bara för "${procurementLabel}"` : ' — alla upphandlingar'}
      </h3>
      <p className="mb-3 text-xs text-foreground-muted">
        &quot;<em>offset</em> dagar från <em>ankaret</em> ska uppgiften finnas, <em>upprepning</em>, så länge <em>villkoret</em> gäller.&quot;
        Platshållare i uppgiftstexten: {'{{title}}'}, {'{{supplier}}'}, {'{{startup}}'}.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <label className={labelClass} htmlFor={`n-${uid}`}>Namn *</label>
          <input id={`n-${uid}`} required maxLength={120} value={v.name} onChange={(e) => set('name', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`sc-${uid}`}>Omfattning</label>
          <select
            id={`sc-${uid}`}
            value={v.scope}
            onChange={(e) => {
              const scope = e.target.value as 'procurement' | 'calloff';
              setV((s) => ({
                ...s,
                scope,
                anchor: RULE_ANCHORS_BY_SCOPE[scope][0],
                condition: scope === 'procurement' ? 'always' : s.condition === 'tender_not_awarded' ? 'always' : s.condition
              }));
            }}
            className={inputClass}
          >
            <option value="calloff">Per avrop (bolag)</option>
            <option value="procurement">Upphandlingen</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`an-${uid}`}>Ankare</label>
          <select id={`an-${uid}`} value={v.anchor} onChange={(e) => set('anchor', e.target.value)} className={inputClass}>
            {anchors.map((a) => (
              <option key={a} value={a}>{PROCUREMENT_RULE_ANCHOR_LABELS[a]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`of-${uid}`}>Dagar (negativt = före)</label>
          <input id={`of-${uid}`} type="number" min={-730} max={730} value={v.offset_days} onChange={(e) => set('offset_days', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`re-${uid}`}>Upprepning</label>
          <select id={`re-${uid}`} value={v.repeat} onChange={(e) => set('repeat', e.target.value)} className={inputClass}>
            {PROCUREMENT_RULE_REPEATS.map((r) => (
              <option key={r} value={r}>{PROCUREMENT_RULE_REPEAT_LABELS[r]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`co-${uid}`}>Villkor</label>
          <select id={`co-${uid}`} value={v.condition} onChange={(e) => set('condition', e.target.value)} className={inputClass}>
            {conditions.map((c) => (
              <option key={c} value={c}>{PROCUREMENT_RULE_CONDITION_LABELS[c]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`ap-${uid}`}>Urval</label>
          <select id={`ap-${uid}`} value={v.applies_to} onChange={(e) => set('applies_to', e.target.value)} className={inputClass}>
            <option value="all">Alla</option>
            <option value="excellence">Bara excellens-insatser</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor={`tt-${uid}`}>Uppgiftstext *</label>
          <input id={`tt-${uid}`} required maxLength={300} value={v.task_title} onChange={(e) => set('task_title', e.target.value)} className={inputClass} placeholder="Stäm av milstolpe 1 med {{startup}} — {{title}}" />
        </div>
        <div>
          <label className={labelClass} htmlFor={`tk-${uid}`}>Uppgiftstyp</label>
          <select id={`tk-${uid}`} value={v.task_kind} onChange={(e) => set('task_kind', e.target.value)} className={inputClass}>
            {PROCUREMENT_TASK_KINDS.map((k) => (
              <option key={k} value={k}>{TASK_KIND_LABELS[k]}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={v.active} onChange={(e) => set('active', e.target.checked)} /> Aktiv
        </label>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className={btnPrimary}>{pending ? 'Sparar…' : 'Spara regel'}</button>
        <button type="button" className={btnGhost} onClick={onCancel}>Avbryt</button>
      </div>
    </form>
  );
}
