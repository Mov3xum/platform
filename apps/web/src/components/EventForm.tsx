'use client';

import { useActionState, useState } from 'react';
import {
  EVENT_TYPES,
  EVENT_TYPE_LABEL,
  SURVEY_STARTER_TEMPLATES,
  defaultEvaluationTemplateRef,
  getSurveyStarterTemplate,
  starterTemplateRef,
  toStockholmDateTimeInputValue,
  type EventStatus,
  type EventType
} from '@platform/shared';
import type { EventActionState } from '@/lib/actions/events';

const TYPE_OPTIONS = EVENT_TYPES.map((value) => ({ value, label: EVENT_TYPE_LABEL[value] }));

const STATUS_OPTIONS: Array<{ value: EventStatus; label: string }> = [
  { value: 'planned', label: 'Planerat' },
  { value: 'live', label: 'Live' },
  { value: 'completed', label: 'Avslutat' },
  { value: 'cancelled', label: 'Inställt' }
];

const ACCENT_OPTIONS = [
  { value: 'cyan', label: 'Blå' },
  { value: 'purple', label: 'Lila' },
  { value: 'green', label: 'Grön' },
  { value: 'copper', label: 'Koppar' },
  { value: 'yellow', label: 'Gul' }
];

export interface EventFormInitial {
  name?: string;
  type?: EventType;
  status?: EventStatus;
  starts_at?: string;
  ends_at?: string;
  location?: string;
  description?: string;
  accent?: string;
}

interface Props {
  action: (state: EventActionState, formData: FormData) => Promise<EventActionState>;
  initial?: EventFormInitial;
  submitLabel?: string;
  /** Årshjulsaktiviteten eventet genomför (§ 53) — skickas som dolt fält och verifieras server-side. */
  wheelItem?: { id: string; title: string; when: string };
  /**
   * Tenantens utvärderingsmallar (§ 53.3). Anges bara när ett event skapas —
   * valet ger ett utkast till utvärdering kopplat till eventet.
   */
  evaluationTemplates?: { id: string; name: string; template_for: EventType[] }[];
}

// Formuläret visar och tar emot SVENSK tid (Europe/Stockholm) oavsett var
// webbläsaren eller servern står — servern tolkar värdet likadant.
function toLocalDateTimeValue(iso?: string): string {
  return toStockholmDateTimeInputValue(iso);
}

export function EventForm({ action, initial, submitLabel = 'Spara', wheelItem, evaluationTemplates }: Props) {
  const [state, formAction, pending] = useActionState(action, {} as EventActionState);
  const [type, setType] = useState<EventType>(initial?.type ?? 'other');
  // Egen mall för typen går före Movexums standardmall (§ 53.3).
  const autoTemplate = evaluationTemplates ? defaultEvaluationTemplateRef(evaluationTemplates, type) : null;
  const autoName =
    getSurveyStarterTemplate(autoTemplate)?.name ?? evaluationTemplates?.find((t) => t.id === autoTemplate)?.name;
  const inputClass =
    'block w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

  return (
    <form action={formAction} className="space-y-5">
      {wheelItem ? (
        <div className="rounded-xl bg-canvas-subtle px-4 py-2.5 text-sm text-foreground-muted">
          <input type="hidden" name="wheel_item" value={wheelItem.id} />
          Genomför årshjulsaktiviteten <strong className="text-foreground">{wheelItem.title}</strong> ({wheelItem.when}).
        </div>
      ) : null}
      <div>
        <label className="block text-sm font-medium text-foreground-muted">Namn</label>
        <input name="name" required defaultValue={initial?.name ?? ''} className={`mt-1 ${inputClass}`} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Typ</label>
          <select
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as EventType)}
            className={`mt-1 ${inputClass}`}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Status</label>
          <select name="status" defaultValue={initial?.status ?? 'planned'} className={`mt-1 ${inputClass}`}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Startar (svensk tid)</label>
          <input
            type="datetime-local"
            name="starts_at"
            required
            defaultValue={toLocalDateTimeValue(initial?.starts_at)}
            className={`mt-1 ${inputClass}`}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Slutar (svensk tid)</label>
          <input
            type="datetime-local"
            name="ends_at"
            defaultValue={toLocalDateTimeValue(initial?.ends_at)}
            className={`mt-1 ${inputClass}`}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-muted">Plats</label>
        <input name="location" defaultValue={initial?.location ?? ''} className={`mt-1 ${inputClass}`} />
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-muted">Beskrivning</label>
        <textarea
          name="description"
          rows={5}
          defaultValue={initial?.description ?? ''}
          className={`mt-1 ${inputClass}`}
        />
      </div>

      {evaluationTemplates ? (
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Utvärdering efter eventet</label>
          <select name="evaluation" defaultValue="auto" className={`mt-1 ${inputClass}`}>
            <option value="auto">{`Mallen för typen (${autoName ?? 'saknas'})`}</option>
            {evaluationTemplates.length > 0 && (
              <optgroup label="Era mallar">
                {evaluationTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Movexums standardmallar">
              {SURVEY_STARTER_TEMPLATES.map((t) => (
                <option key={t.key} value={starterTemplateRef(t.key)}>
                  {t.name}
                </option>
              ))}
            </optgroup>
            <option value="none">Ingen utvärdering</option>
          </select>
          <p className="mt-1 text-xs text-foreground-subtle">
            Utvärderingen skapas som utkast kopplat till eventet. Ni granskar och publicerar den
            själva; den skickas bara till dem som markerats närvarande.
          </p>
        </div>
      ) : null}

      <div>
        <label className="block text-sm font-medium text-foreground-muted">Accent</label>
        <select name="accent" defaultValue={initial?.accent ?? 'cyan'} className={`mt-1 ${inputClass}`}>
          {ACCENT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {state.error ? (
        <p className="rounded-xl bg-error-50 px-4 py-2.5 text-sm text-error-700">{state.error}</p>
      ) : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60"
        >
          {pending ? 'Sparar…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
