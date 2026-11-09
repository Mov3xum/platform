'use client';

import { useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  DEFAULT_CALLOFF_TEMPLATE,
  DEFAULT_PROCUREMENT_CRITERIA,
  PROCUREMENT_PROCEDURES,
  PROCUREMENT_PROCEDURE_LABELS,
  PROCUREMENT_RULE_ANCHOR_LABELS,
  PROCUREMENT_RULE_REPEAT_LABELS,
  PROCUREMENT_STATUSES,
  PROCUREMENT_STATUS_LABELS,
  type CalloffTemplate,
  type ProcurementCriterion,
  type ProcurementDraft,
  type ProcurementDraftRule
} from '@platform/shared';
import { createProcurementAction, updateProcurementAction } from '@/lib/actions/procurements';
import { Icon } from '@/components/proto';
import { AiBanner, Notice, btnGhost, btnPrimary, inputClass, labelClass } from './ui';

export interface ProcurementFormValues {
  title: string;
  supplier: string;
  procedure: string;
  diarienummer: string;
  description: string;
  status: string;
  tender_deadline: string;
  contract_start: string;
  contract_end: string;
  extension_option_months: string;
  estimated_value_sek: string;
  estimated_calloffs: string;
  is_excellence_activity: boolean;
  notes: string;
  responsible: string;
  agreement: string;
  evaluation_criteria: ProcurementCriterion[];
  calloff_template: CalloffTemplate;
}

export const EMPTY_VALUES: ProcurementFormValues = {
  title: '',
  supplier: '',
  procedure: 'ramavtal',
  diarienummer: '',
  description: '',
  status: 'planning',
  tender_deadline: '',
  contract_start: '',
  contract_end: '',
  extension_option_months: '',
  estimated_value_sek: '',
  estimated_calloffs: '',
  is_excellence_activity: false,
  notes: '',
  responsible: '',
  agreement: '',
  evaluation_criteria: DEFAULT_PROCUREMENT_CRITERIA.map((c) => ({ ...c })),
  calloff_template: { ...DEFAULT_CALLOFF_TEMPLATE }
};

export interface FormOption {
  id: string;
  label: string;
}

interface UploadResponse {
  id: string;
  filename: string;
  draft: ProcurementDraft | null;
  analysisError?: string | null;
  redacted?: boolean;
  error?: string;
}

function draftToValues(d: ProcurementDraft, base: ProcurementFormValues): ProcurementFormValues {
  return {
    ...base,
    title: d.title || base.title,
    supplier: d.supplier || base.supplier,
    procedure: d.procedure ?? base.procedure,
    diarienummer: d.diarienummer || base.diarienummer,
    description: d.description || base.description,
    status: d.status,
    tender_deadline: d.tender_deadline ?? '',
    contract_start: d.contract_start ?? '',
    contract_end: d.contract_end ?? '',
    extension_option_months: d.extension_option_months === null ? '' : String(d.extension_option_months),
    estimated_value_sek: d.estimated_value_sek === null ? '' : String(d.estimated_value_sek),
    estimated_calloffs: d.estimated_calloffs === null ? '' : String(d.estimated_calloffs),
    is_excellence_activity: d.is_excellence_activity,
    evaluation_criteria: d.evaluation_criteria,
    calloff_template: d.calloff_template
  };
}

/**
 * Skapa/redigera upphandling (§ 39). I skapa-läget kan ett underlag laddas
 * upp först: routen extraherar texten och AI:n förifyller formuläret +
 * föreslår uppföljningsregler. Ingenting sparas förrän människan trycker
 * "Spara" (människa-i-loopen, art. 14); alla fält är redigerbara.
 */
export function ProcurementForm({
  mode,
  procurementId,
  initial,
  people,
  agreements,
  canManageRules
}: {
  mode: 'create' | 'edit';
  procurementId?: string;
  initial?: Partial<ProcurementFormValues>;
  people: FormOption[];
  agreements: FormOption[];
  canManageRules: boolean;
}) {
  const router = useRouter();
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<ProcurementFormValues>({ ...EMPTY_VALUES, ...initial });
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [documentName, setDocumentName] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProcurementDraft | null>(null);
  const [selectedRules, setSelectedRules] = useState<Set<number>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const set = <K extends keyof ProcurementFormValues>(key: K, v: ProcurementFormValues[K]) =>
    setValues((s) => ({ ...s, [key]: v }));

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Välj en fil först.');
      return;
    }
    setError(null);
    setWarning(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (procurementId) fd.append('procurement_id', procurementId);
      const res = await fetch('/api/procurements/documents', { method: 'POST', body: fd });
      const data = (await res.json().catch(() => ({}))) as UploadResponse;
      if (!res.ok) {
        setError(data.error || 'Uppladdningen misslyckades.');
        return;
      }
      setDocumentId(data.id);
      setDocumentName(data.filename);
      if (data.draft) {
        setDraft(data.draft);
        setValues((s) => draftToValues(data.draft as ProcurementDraft, s));
        setSelectedRules(new Set(data.draft.rules.map((_, i) => i)));
        const notes: string[] = [];
        if (data.draft.confidence < 0.5) notes.push('AI:n är osäker på utläsningen — granska varje fält noga.');
        if (data.draft.missing.length > 0) notes.push(`Saknas i underlaget: ${data.draft.missing.join(', ')}.`);
        if (data.redacted) notes.push('Personnummer i underlaget maskerades.');
        setWarning(notes.join(' ') || null);
      } else {
        setWarning(
          `Underlaget sparades men kunde inte läsas ut automatiskt${data.analysisError ? ` (${data.analysisError})` : ''} — fyll i fälten manuellt.`
        );
      }
      if (fileRef.current) fileRef.current.value = '';
    } finally {
      setUploading(false);
    }
  }

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const payload = {
        title: values.title,
        supplier: values.supplier,
        procedure: values.procedure || null,
        diarienummer: values.diarienummer,
        description: values.description,
        status: values.status,
        tender_deadline: values.tender_deadline || null,
        contract_start: values.contract_start || null,
        contract_end: values.contract_end || null,
        extension_option_months: values.extension_option_months || null,
        estimated_value_sek: values.estimated_value_sek || null,
        estimated_calloffs: values.estimated_calloffs || null,
        is_excellence_activity: values.is_excellence_activity,
        notes: values.notes,
        responsible: values.responsible || null,
        agreement: values.agreement || null,
        evaluation_criteria: values.evaluation_criteria,
        calloff_template: values.calloff_template
      };
      const draftRules: ProcurementDraftRule[] = draft ? draft.rules.filter((_, i) => selectedRules.has(i)) : [];
      const res =
        mode === 'create'
          ? await createProcurementAction({ ...payload, documentId, draftRules })
          : await updateProcurementAction(procurementId as string, payload);
      if (!res.ok) {
        setError(res.error ?? 'Kunde inte spara.');
        return;
      }
      const target = res.path ?? `/upphandlingar/${procurementId}`;
      const q = new URLSearchParams();
      if (res.notice) q.set('notice', res.notice);
      if (res.warning) q.set('warning', res.warning);
      router.push(q.size > 0 ? `${target}?${q.toString()}` : target);
      router.refresh();
    });
  };

  const updateCriterion = (i: number, patch: Partial<ProcurementCriterion>) =>
    set(
      'evaluation_criteria',
      values.evaluation_criteria.map((c, idx) => (idx === i ? { ...c, ...patch } : c))
    );

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {mode === 'create' && (
        <section className="rounded-3xl border border-dashed border-strong bg-canvas-subtle p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Icon name="upload" size={16} />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-foreground">Ladda upp underlaget (valfritt)</h2>
              <p className="text-xs text-foreground-muted">
                Förfrågningsunderlag, avtal eller avropsbeskrivning (PDF, Word, PowerPoint, text). Titel,
                leverantör, datum, milstolpar, utvärderingskriterier och uppföljningsregler läses ut och
                förifylls nedan.
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.doc,.docx,.pptx,.xlsx,.txt,.md,application/pdf"
              className="text-sm text-foreground-muted"
            />
            <button type="button" onClick={upload} disabled={uploading} className={btnGhost}>
              {uploading ? 'Läser underlaget…' : 'Läs ut med AI'}
            </button>
            {documentName && (
              <span className="text-xs text-foreground-subtle">
                <Icon name="check" size={12} /> {documentName} kopplas till upphandlingen
              </span>
            )}
          </div>
          <div className="mt-2">
            <AiBanner />
          </div>
        </section>
      )}

      {error && <Notice kind="error">{error}</Notice>}
      {warning && <Notice kind="warning">{warning}</Notice>}

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor={`title-${uid}`}>Titel *</label>
          <input id={`title-${uid}`} required maxLength={200} value={values.title} onChange={(e) => set('title', e.target.value)} className={inputClass} placeholder="t.ex. AI-stött utvecklings- och leveransstöd för inkubatorbolag" />
        </div>
        <div>
          <label className={labelClass} htmlFor={`supplier-${uid}`}>Leverantör (företag)</label>
          <input id={`supplier-${uid}`} maxLength={200} value={values.supplier} onChange={(e) => set('supplier', e.target.value)} className={inputClass} placeholder="Tom tills tilldelning" />
        </div>
        <div>
          <label className={labelClass} htmlFor={`status-${uid}`}>Status</label>
          <select id={`status-${uid}`} value={values.status} onChange={(e) => set('status', e.target.value)} className={inputClass}>
            {PROCUREMENT_STATUSES.map((s) => (
              <option key={s} value={s}>{PROCUREMENT_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`procedure-${uid}`}>Förfarande</label>
          <select id={`procedure-${uid}`} value={values.procedure} onChange={(e) => set('procedure', e.target.value)} className={inputClass}>
            <option value="">–</option>
            {PROCUREMENT_PROCEDURES.map((p) => (
              <option key={p} value={p}>{PROCUREMENT_PROCEDURE_LABELS[p]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`dnr-${uid}`}>Diarienummer</label>
          <input id={`dnr-${uid}`} maxLength={80} value={values.diarienummer} onChange={(e) => set('diarienummer', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`tender-${uid}`}>Sista anbudsdag</label>
          <input id={`tender-${uid}`} type="date" value={values.tender_deadline} onChange={(e) => set('tender_deadline', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`ext-${uid}`}>Förlängningsoption (månader)</label>
          <input id={`ext-${uid}`} type="number" min={0} max={60} value={values.extension_option_months} onChange={(e) => set('extension_option_months', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`cs-${uid}`}>Avtalsstart</label>
          <input id={`cs-${uid}`} type="date" value={values.contract_start} onChange={(e) => set('contract_start', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`ce-${uid}`}>Avtalsslut</label>
          <input id={`ce-${uid}`} type="date" value={values.contract_end} onChange={(e) => set('contract_end', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`val-${uid}`}>Uppskattat värde (kr)</label>
          <input id={`val-${uid}`} type="number" min={0} step="1000" value={values.estimated_value_sek} onChange={(e) => set('estimated_value_sek', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`cnt-${uid}`}>Uppskattat antal avrop</label>
          <input id={`cnt-${uid}`} type="number" min={0} max={1000} value={values.estimated_calloffs} onChange={(e) => set('estimated_calloffs', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`resp-${uid}`}>Ansvarig (får uppföljningarna)</label>
          <select id={`resp-${uid}`} value={values.responsible} onChange={(e) => set('responsible', e.target.value)} className={inputClass}>
            <option value="">– den som skapar –</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`agr-${uid}`}>Kopplat avtal (signering)</label>
          <select id={`agr-${uid}`} value={values.agreement} onChange={(e) => set('agreement', e.target.value)} className={inputClass}>
            <option value="">–</option>
            {agreements.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
          <input type="checkbox" checked={values.is_excellence_activity} onChange={(e) => set('is_excellence_activity', e.target.checked)} />
          Excellens-insats (följs upp som excellensaktivitet, t.ex. Vinnova Excellent incubator)
        </label>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor={`desc-${uid}`}>Beskrivning</label>
          <textarea id={`desc-${uid}`} rows={4} maxLength={5000} value={values.description} onChange={(e) => set('description', e.target.value)} className={inputClass} placeholder="Vad upphandlas, för vem, hur avrop och betalning fungerar." />
        </div>
      </section>

      <section className="rounded-2xl border border-default p-4">
        <h3 className="text-sm font-semibold text-foreground">Avropsmall</h3>
        <p className="mb-3 text-xs text-foreground-muted">
          Förifyller milstolpar och slut när ett avrop registreras (dagar räknat från avropsstart). Lämna tomt för
          &quot;ingen&quot;.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Milstolpe 1 — dagar efter start</label>
            <input type="number" min={0} max={1095} value={values.calloff_template.milestone_1_days ?? ''} onChange={(e) => set('calloff_template', { ...values.calloff_template, milestone_1_days: e.target.value === '' ? null : Number(e.target.value) })} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Avropets längd — dagar (= milstolpe 2)</label>
            <input type="number" min={0} max={1095} value={values.calloff_template.duration_days ?? ''} onChange={(e) => set('calloff_template', { ...values.calloff_template, duration_days: e.target.value === '' ? null : Number(e.target.value) })} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Etikett milstolpe 1</label>
            <input maxLength={120} value={values.calloff_template.milestone_1_label} onChange={(e) => set('calloff_template', { ...values.calloff_template, milestone_1_label: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Etikett milstolpe 2</label>
            <input maxLength={120} value={values.calloff_template.milestone_2_label} onChange={(e) => set('calloff_template', { ...values.calloff_template, milestone_2_label: e.target.value })} className={inputClass} />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-default p-4">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">Utvärderingskriterier (leverantörens leverans per avrop)</h3>
          <span className="flex-1" />
          <button
            type="button"
            className={btnGhost}
            onClick={() => set('evaluation_criteria', [...values.evaluation_criteria, { key: `kriterium_${values.evaluation_criteria.length + 1}`, label: '', weight: 10 }])}
            disabled={values.evaluation_criteria.length >= 12}
          >
            <Icon name="plus" size={12} /> Kriterium
          </button>
        </div>
        <p className="mb-3 text-xs text-foreground-muted">Poängsätts 0–5 per avrop; vikterna normaliseras.</p>
        <div className="space-y-2">
          {values.evaluation_criteria.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input
                aria-label="Kriterium"
                maxLength={80}
                value={c.label}
                onChange={(e) => updateCriterion(i, { label: e.target.value })}
                className={`${inputClass} flex-1`}
                placeholder="t.ex. Leveransens kvalitet"
              />
              <input
                aria-label="Vikt"
                type="number"
                min={1}
                max={100}
                value={c.weight}
                onChange={(e) => updateCriterion(i, { weight: Number(e.target.value) })}
                className={`${inputClass} w-24`}
              />
              <button
                type="button"
                className={btnGhost}
                onClick={() => set('evaluation_criteria', values.evaluation_criteria.filter((_, idx) => idx !== i))}
                aria-label="Ta bort kriterium"
              >
                <Icon name="trash" size={12} />
              </button>
            </div>
          ))}
        </div>
      </section>

      {mode === 'create' && draft && draft.rules.length > 0 && (
        <section className="rounded-2xl border border-default p-4">
          <h3 className="text-sm font-semibold text-foreground">Uppföljningsregler ur underlaget</h3>
          <p className="mb-3 text-xs text-foreground-muted">
            Förslag som lästs ut ur dokumentet. Ibockade regler sparas som regler för just den här upphandlingen
            och genererar uppgifter automatiskt. Tenantens standardregler gäller dessutom.
            {!canManageRules && ' (Bara admin/incubator_lead kan spara regler — förslagen visas men sparas inte.)'}
          </p>
          <ul className="space-y-2">
            {draft.rules.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selectedRules.has(i)}
                  disabled={!canManageRules}
                  onChange={(e) =>
                    setSelectedRules((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(i);
                      else n.delete(i);
                      return n;
                    })
                  }
                />
                <div>
                  <div className="font-medium text-foreground">{r.name}</div>
                  <div className="text-xs text-foreground-muted">
                    {r.scope === 'calloff' ? 'Per avrop' : 'Upphandling'} · {PROCUREMENT_RULE_ANCHOR_LABELS[r.anchor]}{' '}
                    {r.offset_days >= 0 ? `+${r.offset_days}` : r.offset_days} dagar · {PROCUREMENT_RULE_REPEAT_LABELS[r.repeat]} → &quot;{r.task_title}&quot;
                    {r.source_note ? ` · ${r.source_note}` : ''}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div>
        <label className={labelClass} htmlFor={`notes-${uid}`}>Interna anteckningar</label>
        <textarea id={`notes-${uid}`} rows={3} maxLength={5000} value={values.notes} onChange={(e) => set('notes', e.target.value)} className={inputClass} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={isPending || uploading} className={btnPrimary}>
          {isPending ? 'Sparar…' : mode === 'create' ? 'Spara upphandling' : 'Spara ändringar'}
        </button>
        <button type="button" className={btnGhost} onClick={() => router.back()}>
          Avbryt
        </button>
      </div>
    </form>
  );
}
