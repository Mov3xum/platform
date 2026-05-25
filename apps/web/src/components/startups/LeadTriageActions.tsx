'use client';

import { useState } from 'react';
import { convertLeadToStartupAction, declineLeadAction } from '@/lib/actions/compass';
import { Icon } from '@/components/proto';

export interface PhaseOption {
  value: string;
  label: string;
}

export interface StaffOption {
  id: string;
  name: string;
}

interface Props {
  leadId: string;
  defaultName: string;
  phases: PhaseOption[];
  defaultPhase: string;
  staff: StaffOption[];
}

const inputCls =
  'w-full rounded-lg border border-default bg-canvas-subtle px-2.5 py-1.5 text-[12.5px] text-foreground outline-none transition focus:border-brand';

export function LeadTriageActions({ leadId, defaultName, phases, defaultPhase, staff }: Props) {
  const [mode, setMode] = useState<'idle' | 'convert' | 'decline'>('idle');

  if (mode === 'convert') {
    return (
      <form action={convertLeadToStartupAction} className="grid gap-2 rounded-xl border border-default bg-canvas-subtle p-3">
        <input type="hidden" name="id" value={leadId} />
        <label className="grid gap-1 text-[11px] font-medium text-foreground-muted">
          Bolagsnamn
          <input name="name" defaultValue={defaultName} className={inputCls} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-[11px] font-medium text-foreground-muted">
            Startfas
            <select name="phase" defaultValue={defaultPhase} className={inputCls}>
              {phases.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[11px] font-medium text-foreground-muted">
            Coach (valfri)
            <select name="coach" defaultValue="" className={inputCls}>
              <option value="">— Ingen —</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-brand-foreground hover:bg-brand-hover"
          >
            <Icon name="sparkle" size={12} /> Skapa bolag
          </button>
          <button
            type="button"
            onClick={() => setMode('idle')}
            className="rounded-lg px-2.5 py-1.5 text-[12px] text-foreground-muted hover:text-foreground"
          >
            Avbryt
          </button>
        </div>
      </form>
    );
  }

  if (mode === 'decline') {
    return (
      <form action={declineLeadAction} className="grid gap-2 rounded-xl border border-default bg-canvas-subtle p-3">
        <input type="hidden" name="id" value={leadId} />
        <label className="grid gap-1 text-[11px] font-medium text-foreground-muted">
          Motivering (valfri, intern)
          <textarea
            name="reason"
            rows={2}
            placeholder="Varför avslås leadet?"
            className={inputCls}
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg bg-movexum-pastell-orange px-3 py-1.5 text-[12px] font-medium text-movexum-morkorange hover:opacity-90"
          >
            <Icon name="close" size={12} /> Bekräfta avslag
          </button>
          <button
            type="button"
            onClick={() => setMode('idle')}
            className="rounded-lg px-2.5 py-1.5 text-[12px] text-foreground-muted hover:text-foreground"
          >
            Avbryt
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setMode('convert')}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-brand-foreground hover:bg-brand-hover"
      >
        <Icon name="arrow-up-right" size={12} /> Konvertera
      </button>
      <button
        type="button"
        onClick={() => setMode('decline')}
        className="inline-flex items-center gap-1.5 rounded-lg border border-default bg-surface px-3 py-1.5 text-[12px] font-medium text-foreground-muted hover:text-foreground"
      >
        <Icon name="close" size={12} /> Avslå
      </button>
    </div>
  );
}
