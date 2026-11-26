'use client';

import { useActionState, useState } from 'react';
import {
  RECORD_DIRECTIONS,
  RECORD_DIRECTION_LABELS,
  RECORD_HANDLINGS,
  RECORD_HANDLING_LABELS,
  RECORD_RETENTIONS,
  RECORD_RETENTION_LABELS
} from '@platform/shared';
import type { RecordTypeRow } from '@/lib/core/write/register';
import { saveRecordTypeAction, type RegisterActionState } from '@/lib/actions/register';
import { ActionNotice, Chip, Notice, btnGhost, btnPrimary, card, eyebrow, formatRegisterDate, inputClass, labelClass, retentionText } from '@/components/register/ui';

const EMPTY: RecordTypeRow = {
  id: '',
  key: '',
  label: '',
  process: '',
  direction: 'incoming',
  trigger: '',
  handling: 'register',
  secrecy_possible: false,
  secrecy_basis: '',
  retention: 'preserve',
  retention_months: null,
  legal_basis: '',
  storage: '',
  source_collection: '',
  sort_order: 0,
  active: true,
  confirmed: false,
  confirmed_at: '',
  updated: ''
};

function TypeForm({ type, isNew, onClose }: { type: RecordTypeRow; isNew: boolean; onClose: () => void }) {
  const [state, action, pending] = useActionState<RegisterActionState, FormData>(saveRecordTypeAction, {});
  const [retention, setRetention] = useState(type.retention);
  const [secrecy, setSecrecy] = useState(type.secrecy_possible);
  return (
    <form
      action={action}
      onReset={() => {
        setRetention(type.retention);
        setSecrecy(type.secrecy_possible);
      }}
      className="space-y-4 border-t border-default bg-canvas-subtle p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isNew ? (
          <label className="block">
            <span className={labelClass}>Nyckel (ändras inte sedan)</span>
            <input name="key" required pattern="[a-z][a-z0-9_]{1,39}" className={inputClass} placeholder="styrelseprotokoll" />
          </label>
        ) : (
          <input type="hidden" name="key" value={type.key} />
        )}
        <label className="block">
          <span className={labelClass}>Handlingstyp</span>
          <input name="label" required defaultValue={type.label} maxLength={120} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Process</span>
          <input name="process" required defaultValue={type.process} maxLength={80} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Blir allmän som</span>
          <select name="direction" defaultValue={type.direction} className={inputClass}>
            {RECORD_DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {RECORD_DIRECTION_LABELS[d]}
              </option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClass}>Händelsen som gör handlingen allmän</span>
          <input name="trigger" defaultValue={type.trigger} maxLength={300} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Hantering</span>
          <select name="handling" defaultValue={type.handling} className={inputClass}>
            {RECORD_HANDLINGS.map((h) => (
              <option key={h} value={h}>
                {RECORD_HANDLING_LABELS[h]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Bevara eller gallra</span>
          <select name="retention" defaultValue={type.retention} onChange={(e) => setRetention(e.target.value as typeof retention)} className={inputClass}>
            {RECORD_RETENTIONS.map((r) => (
              <option key={r} value={r}>
                {RECORD_RETENTION_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        {retention === 'dispose' && (
          <label className="block">
            <span className={labelClass}>Frist i månader efter avslutat ärende</span>
            <input name="retention_months" type="number" min={1} max={1200} required defaultValue={type.retention_months ?? 24} className={inputClass} />
          </label>
        )}
        <label className="block sm:col-span-2 lg:col-span-3">
          <span className={labelClass}>Grund för bevarande / gallring</span>
          <input name="legal_basis" defaultValue={type.legal_basis} maxLength={400} className={inputClass} />
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" name="secrecy_possible" defaultChecked={type.secrecy_possible} onChange={(e) => setSecrecy(e.target.checked)} />
          Kan innehålla sekretess
        </label>
        {secrecy && (
          <label className="block sm:col-span-2">
            <span className={labelClass}>Lagrum / grund för sekretess</span>
            <input name="secrecy_basis" defaultValue={type.secrecy_basis} maxLength={300} className={inputClass} />
          </label>
        )}
        <label className="block sm:col-span-2 lg:col-span-3">
          <span className={labelClass}>Förvaring</span>
          <input name="storage" defaultValue={type.storage} maxLength={200} className={inputClass} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-5">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <input type="checkbox" name="confirmed" defaultChecked={type.confirmed} />
          Raden är genomgången och bekräftad
        </label>
        {!isNew && (
          <label className="flex items-center gap-2 text-sm text-foreground-muted">
            <input type="checkbox" name="active" value="off" defaultChecked={!type.active} />
            Avstängd (registreras inte)
          </label>
        )}
      </div>
      <ActionNotice state={state} />
      <div className="flex gap-2">
        <button className={btnPrimary} disabled={pending}>
          {pending ? 'Sparar…' : 'Spara'}
        </button>
        <button type="button" className={btnGhost} onClick={onClose}>
          Stäng
        </button>
      </div>
    </form>
  );
}

export function PlanEditor({ types, canManage }: { types: RecordTypeRow[]; canManage: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const processes = Array.from(new Set(types.map((t) => t.process)));
  const unconfirmed = types.filter((t) => t.active && !t.confirmed).length;
  const visible = onlyOpen ? types.filter((t) => t.active && !t.confirmed) : types;
  return (
    <div className="space-y-5">
      {unconfirmed > 0 && (
        <Notice tone="warn">
          {unconfirmed} handlingstyper bär förslagsvärden. Gå igenom sekretessgrund och gallringsfrist med jurist eller arkivmyndighet och bekräfta raden.
        </Notice>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-foreground-muted">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          Visa bara obekräftade
        </label>
        {canManage && open !== '__new' && (
          <button className={btnPrimary} onClick={() => setOpen('__new')}>
            Ny handlingstyp
          </button>
        )}
      </div>
      {open === '__new' && (
        <div className={`${card} overflow-hidden`}>
          <div className="px-5 py-3 text-sm font-semibold text-foreground">Ny handlingstyp</div>
          <TypeForm type={EMPTY} isNew onClose={() => setOpen(null)} />
        </div>
      )}
      {processes.map((process) => {
        const rows = visible.filter((t) => t.process === process);
        if (rows.length === 0) return null;
        return (
          <section key={process} className="space-y-2">
            <h2 className={eyebrow}>{process}</h2>
            <div className={`${card} divide-y divide-default overflow-hidden`}>
              {rows.map((t) => (
                <div key={t.key}>
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-canvas-subtle disabled:cursor-default"
                    onClick={() => setOpen(open === t.key ? null : t.key)}
                    disabled={!canManage}
                    aria-expanded={open === t.key}
                  >
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-medium ${t.active ? 'text-foreground' : 'text-foreground-subtle line-through'}`}>{t.label}</div>
                      <div className="text-xs text-foreground-subtle">
                        {RECORD_DIRECTION_LABELS[t.direction]} · {t.trigger || 'Ingen händelse angiven'}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Chip tone={t.handling === 'register' ? 'info' : 'neutral'}>{RECORD_HANDLING_LABELS[t.handling]}</Chip>
                      <Chip>{retentionText(t.retention, t.retention_months)}</Chip>
                      {t.secrecy_possible && <Chip tone="warn">Sekretess möjlig</Chip>}
                      {t.confirmed ? <Chip tone="good">Bekräftad {formatRegisterDate(t.confirmed_at)}</Chip> : <Chip tone="warn">Förslag</Chip>}
                    </div>
                  </button>
                  {open === t.key && canManage && <TypeForm type={t} isNew={false} onClose={() => setOpen(null)} />}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
