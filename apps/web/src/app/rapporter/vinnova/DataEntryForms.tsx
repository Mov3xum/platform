'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  logServiceTimeAction,
  logServiceCostAction,
  upsertReadinessAssessmentAction,
  upsertStateAidPeriodAction,
  type ReportingActionState
} from '@/lib/actions/vinnova-reports';

// Förifyllningsvärden hämtade direkt ur systemet (speglar StartupPrefill i
// lib/reporting/dataset). Lokalt definierad för att hålla klient-bundlen fri
// från den server-only modulen.
type Startup = {
  id: string;
  name: string;
  irl_level: number | null;
  vinnova_focus: string | null;
  sni_code: string | null;
  approved_state_aid_art22: boolean;
  approved_de_minimis: boolean;
  state_aid_start_at: string | null;
};

const inputCls =
  'w-full rounded-lg border border-default bg-canvas px-2 py-1.5 text-[12.5px] text-foreground';
const labelCls = 'block font-mono text-[10px] uppercase tracking-[0.12em] text-foreground-subtle';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

function num(v: FormDataEntryValue | null): number | undefined {
  const s = String(v ?? '').replace(',', '.').trim();
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function rl(v: FormDataEntryValue | null): number | null {
  const n = num(v);
  return n == null ? null : n;
}

/**
 * Inline-formulär i Vinnova-rapporten: mata in tid, kostnad, readiness och
 * statsstödsgrund per bolag. Fälten FÖRIFYLLS från befintlig systemdata
 * (irl_level → readiness, approved_*-flaggor → statsstödsgrund, sni/datum) så
 * att rapporten i princip kan auto-genereras. Vid OK uppdateras tabellen.
 */
export function DataEntryForms({
  startups,
  defaultDate
}: {
  startups: Startup[];
  defaultDate: string;
}) {
  const router = useRouter();
  const [startupId, setStartupId] = useState(startups[0]?.id || '');
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => startups.find((s) => s.id === startupId) || startups[0],
    [startups, startupId]
  );

  if (startups.length === 0) {
    return (
      <div className="rounded-2xl border border-default bg-surface p-4 text-[12.5px] text-foreground-muted">
        Inga aktiva bolag att registrera data på ännu.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-default bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
          Registrera underlag (förifylls från systemet · tid · kostnad · readiness · statsstöd)
        </span>
        <span className="font-mono text-[11px] text-foreground-subtle">{open ? 'Dölj' : 'Visa'}</span>
      </button>

      {open && selected && (
        <div className="space-y-4 border-t border-default p-4">
          <Field label="Bolag (gäller alla formulär nedan)">
            <select className={inputCls} value={startupId} onChange={(e) => setStartupId(e.target.value)}>
              {startups.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <TimeForm selected={selected} defaultDate={defaultDate} onSaved={() => router.refresh()} />
            <CostForm selected={selected} defaultDate={defaultDate} onSaved={() => router.refresh()} />
            <ReadinessForm selected={selected} defaultDate={defaultDate} onSaved={() => router.refresh()} />
            <StateAidForm selected={selected} defaultDate={defaultDate} onSaved={() => router.refresh()} />
          </div>
        </div>
      )}
    </div>
  );
}

function MiniForm({
  title,
  hint,
  formKey,
  children,
  onSubmit
}: {
  title: string;
  hint?: string;
  formKey: string;
  children: React.ReactNode;
  onSubmit: (fd: FormData) => Promise<ReportingActionState>;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok?: boolean; error?: string } | null>(null);

  function handle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setMsg(null);
    startTransition(async () => {
      const res = await onSubmit(fd);
      if (res.error) setMsg({ error: res.error });
      else setMsg({ ok: true });
    });
  }

  return (
    // key → remounta vid bolagsbyte så förifyllda defaultValues uppdateras.
    <form
      key={formKey}
      onSubmit={handle}
      className="space-y-3 rounded-xl border border-default bg-canvas-subtle p-3"
    >
      <div>
        <div className="text-[12px] font-semibold text-foreground">{title}</div>
        {hint && <div className="text-[10.5px] text-foreground-subtle">{hint}</div>}
      </div>
      {children}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-brand-foreground hover:bg-brand-hover disabled:opacity-60"
        >
          {pending ? 'Sparar…' : 'Spara'}
        </button>
        {msg?.ok && <span className="text-[12px] text-movexum-morkgron">Sparat ✓</span>}
        {msg?.error && <span className="text-[12px] text-movexum-morkorange">{msg.error}</span>}
      </div>
    </form>
  );
}

interface FormProps {
  selected: Startup;
  defaultDate: string;
  onSaved: () => void;
}

function TimeForm({ selected, defaultDate, onSaved }: FormProps) {
  return (
    <MiniForm
      title="Tid (inkubatortjänster)"
      formKey={selected.id}
      onSubmit={async (fd) => {
        const res = await logServiceTimeAction({
          startup: selected.id,
          activity_kind: (fd.get('activity_kind') as 'incubation' | 'verification' | 'admin') || 'incubation',
          hours: num(fd.get('hours')) ?? 0,
          hourly_rate_sek: num(fd.get('hourly_rate_sek')),
          occurred_on: String(fd.get('occurred_on') || ''),
          note: String(fd.get('note') || '')
        });
        if (res.ok) onSaved();
        return res;
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="Insats">
          <select name="activity_kind" className={inputCls} defaultValue="incubation">
            <option value="incubation">Inkubatortjänst</option>
            <option value="verification">Verifiering</option>
            <option value="admin">Admin (räknas ej)</option>
          </select>
        </Field>
        <Field label="Timmar">
          <input name="hours" type="number" step="0.5" min="0" className={inputCls} required />
        </Field>
        <Field label="Timpris (kr, valfritt)">
          <input name="hourly_rate_sek" type="number" step="1" min="0" className={inputCls} placeholder="tenant-default" />
        </Field>
        <Field label="Datum">
          <input name="occurred_on" type="date" defaultValue={defaultDate} className={inputCls} required />
        </Field>
      </div>
      <Field label="Notering (valfri)">
        <input name="note" type="text" className={inputCls} />
      </Field>
    </MiniForm>
  );
}

function CostForm({ selected, defaultDate, onSaved }: FormProps) {
  return (
    <MiniForm
      title="Kostnad (externa tjänster / verifiering)"
      formKey={selected.id}
      onSubmit={async (fd) => {
        const res = await logServiceCostAction({
          startup: selected.id,
          cost_type: (fd.get('cost_type') as 'verification' | 'external_service' | 'other') || 'verification',
          amount_sek: num(fd.get('amount_sek')) ?? 0,
          supplier: String(fd.get('supplier') || ''),
          invoice_ref: String(fd.get('invoice_ref') || ''),
          incurred_on: String(fd.get('incurred_on') || ''),
          allocation_note: String(fd.get('allocation_note') || '')
        });
        if (res.ok) onSaved();
        return res;
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="Typ">
          <select name="cost_type" className={inputCls} defaultValue="verification">
            <option value="verification">Verifieringstjänst</option>
            <option value="external_service">Extern inkubatortjänst</option>
            <option value="other">Övrigt (räknas ej)</option>
          </select>
        </Field>
        <Field label="Belopp (kr)">
          <input name="amount_sek" type="number" step="1" min="0" className={inputCls} required />
        </Field>
        <Field label="Leverantör">
          <input name="supplier" type="text" className={inputCls} placeholder="t.ex. PRV, Barzey" />
        </Field>
        <Field label="Fakturareferens">
          <input name="invoice_ref" type="text" className={inputCls} />
        </Field>
        <Field label="Datum">
          <input name="incurred_on" type="date" defaultValue={defaultDate} className={inputCls} required />
        </Field>
        <Field label="Fördelningsnot">
          <input name="allocation_note" type="text" className={inputCls} />
        </Field>
      </div>
    </MiniForm>
  );
}

function ReadinessForm({ selected, defaultDate, onSaved }: FormProps) {
  // Förifyll alla axlar med bolagets generiska IRL-nivå (kan justeras per axel).
  const irl = selected.irl_level != null ? String(selected.irl_level) : '';
  return (
    <MiniForm
      title="Readiness (CRL / TMRL / BRL / SRL)"
      hint={irl ? `Förifyllt från bolagets IRL-nivå (${irl}) — justera per axel.` : undefined}
      formKey={selected.id}
      onSubmit={async (fd) => {
        const res = await upsertReadinessAssessmentAction({
          startup: selected.id,
          assessed_at: String(fd.get('assessed_at') || ''),
          crl: rl(fd.get('crl')),
          tmrl: rl(fd.get('tmrl')),
          brl: rl(fd.get('brl')),
          srl: rl(fd.get('srl')),
          criteria_checked_at: String(fd.get('criteria_checked_at') || ''),
          note: String(fd.get('note') || '')
        });
        if (res.ok) onSaved();
        return res;
      }}
    >
      <div className="grid grid-cols-4 gap-2">
        {(['crl', 'tmrl', 'brl', 'srl'] as const).map((axis) => (
          <Field key={axis} label={axis.toUpperCase()}>
            <input name={axis} type="number" min="1" max="9" step="1" defaultValue={irl} className={inputCls} />
          </Field>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Bedömt datum">
          <input name="assessed_at" type="date" defaultValue={defaultDate} className={inputCls} required />
        </Field>
        <Field label="Målgruppskontroll">
          <input name="criteria_checked_at" type="date" defaultValue={defaultDate} className={inputCls} />
        </Field>
      </div>
      <Field label="Notering (valfri)">
        <input name="note" type="text" className={inputCls} />
      </Field>
    </MiniForm>
  );
}

function StateAidForm({ selected, defaultDate, onSaved }: FormProps) {
  // Förifyll grund ur approved_*-flaggorna, SNI och startdatum ur systemet.
  const basisDefault = selected.approved_de_minimis ? 'de_minimis' : 'art22';
  const fromDefault = selected.state_aid_start_at || defaultDate;
  const hint =
    selected.approved_de_minimis || selected.approved_state_aid_art22
      ? `Förifyllt från bolagets statsstödsflaggor.`
      : undefined;
  return (
    <MiniForm
      title="Statsstödsgrund"
      hint={hint}
      formKey={selected.id}
      onSubmit={async (fd) => {
        const res = await upsertStateAidPeriodAction({
          startup: selected.id,
          basis: (fd.get('basis') as 'art22' | 'de_minimis') || 'art22',
          sni_code: String(fd.get('sni_code') || ''),
          valid_from: String(fd.get('valid_from') || ''),
          valid_to: String(fd.get('valid_to') || ''),
          note: String(fd.get('note') || '')
        });
        if (res.ok) onSaved();
        return res;
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="Grund">
          <select name="basis" className={inputCls} defaultValue={basisDefault}>
            <option value="art22">Artikel 22</option>
            <option value="de_minimis">Stöd av mindre betydelse</option>
          </select>
        </Field>
        <Field label="SNI-kod (krävs vid de minimis)">
          <input name="sni_code" type="text" defaultValue={selected.sni_code || ''} className={inputCls} placeholder="t.ex. F.42.21" />
        </Field>
        <Field label="Giltig fr.o.m.">
          <input name="valid_from" type="date" defaultValue={fromDefault} className={inputCls} required />
        </Field>
        <Field label="Giltig t.o.m. (valfritt)">
          <input name="valid_to" type="date" className={inputCls} />
        </Field>
      </div>
      <Field label="Notering (valfri)">
        <input name="note" type="text" className={inputCls} />
      </Field>
    </MiniForm>
  );
}
