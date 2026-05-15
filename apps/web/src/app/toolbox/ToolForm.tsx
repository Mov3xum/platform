'use client';

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createToolAction, updateToolAction } from '@/lib/actions/tools';
import type { Tool, ToolCategory, ToolModel, ToolOutputFormat, Role } from '@platform/shared';

const CATEGORIES: Array<{ value: ToolCategory; label: string }> = [
  { value: 'ai_per_startup', label: 'AI per bolag' },
  { value: 'ai_system_wide', label: 'AI portfölj' },
  { value: 'education', label: 'Utbildning' },
  { value: 'template', label: 'Mall' },
  { value: 'checklist', label: 'Checklista' }
];

const MODELS: Array<{ value: ToolModel; label: string }> = [
  { value: 'mistral-large-latest', label: 'Mistral Large (€2/€6 per 1M tokens)' },
  { value: 'mistral-medium-latest', label: 'Mistral Medium (€0.4/€1.2 per 1M tokens)' },
  { value: 'mistral-small-latest', label: 'Mistral Small (€0.1/€0.3 per 1M tokens)' }
];

const OUTPUT_FORMATS: Array<{ value: ToolOutputFormat; label: string }> = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'json', label: 'JSON' },
  { value: 'text', label: 'Text' }
];

const ALL_ROLES: Array<{ value: Role; label: string }> = [
  { value: 'admin', label: 'Admin' },
  { value: 'incubator_lead', label: 'Inkubatorledare' },
  { value: 'coach', label: 'Coach' },
  { value: 'mentor', label: 'Mentor' },
  { value: 'startup_member', label: 'Startup-medlem' },
  { value: 'observer', label: 'Observatör' }
];

interface ToolFormProps {
  mode: 'create' | 'edit';
  tool?: Tool;
  /**
   * Endast admin får redigera systemprompt och modellval. Om false renderas
   * fälten som readonly (eller döljs på create) — defense-in-depth ihop med
   * server-side guards i actions/tools.ts.
   */
  canEditPrompt?: boolean;
}

export function ToolForm({ mode, tool, canEditPrompt = false }: ToolFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      let result;
      if (mode === 'create') {
        result = await createToolAction(null as never, formData);
      } else {
        result = await updateToolAction(tool!.id, null as never, formData);
      }

      if (result.error) {
        setError(result.error);
      } else {
        router.push(mode === 'create' ? `/toolbox/${result.runId}` : `/toolbox/${tool!.id}`);
      }
    });
  };

  const inputClass =
    'w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
  const labelClass = 'block text-sm font-medium text-foreground-muted';

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {mode === 'create' && (
        <div>
          <label htmlFor="key" className={labelClass}>
            Unikt ID *
          </label>
          <input
            id="key"
            name="key"
            type="text"
            required
            defaultValue={tool?.key}
            placeholder="t.ex. ai_quarterly_report"
            pattern="[a-z0-9_]+"
            className={`mt-1 ${inputClass}`}
          />
          <p className="mt-1 text-xs text-foreground-subtle">
            Bara gemener, siffror och understreck.
          </p>
        </div>
      )}

      <div>
        <label htmlFor="name" className={labelClass}>
          Namn *
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={tool?.name}
          placeholder="t.ex. AI: Kvartalsrapport"
          className={`mt-1 ${inputClass}`}
        />
      </div>

      <div>
        <label htmlFor="icon" className={labelClass}>
          Ikon (emoji)
        </label>
        <input
          id="icon"
          name="icon"
          type="text"
          defaultValue={tool?.icon}
          placeholder="📊"
          maxLength={10}
          className={`mt-1 ${inputClass}`}
        />
      </div>

      <div>
        <label htmlFor="category" className={labelClass}>
          Kategori *
        </label>
        <select
          id="category"
          name="category"
          required
          defaultValue={tool?.category}
          className={`mt-1 ${inputClass}`}
        >
          <option value="">-- Välj kategori --</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="model" className={labelClass}>
          AI-modell (lämna tomt för icke-AI-verktyg)
          {!canEditPrompt && (
            <span className="ml-2 inline-block rounded-full bg-movexum-pastell-lila px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-movexum-lila dark:bg-movexum-morklila/40 dark:text-movexum-ljuslila">
              Endast admin
            </span>
          )}
        </label>
        <select
          id="model"
          name="model"
          defaultValue={tool?.model ?? ''}
          disabled={!canEditPrompt}
          className={`mt-1 ${inputClass} ${!canEditPrompt ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          <option value="">-- Ingen (icke-AI) --</option>
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="output_format" className={labelClass}>
          Utdataformat
        </label>
        <select
          id="output_format"
          name="output_format"
          defaultValue={tool?.output_format ?? 'markdown'}
          className={`mt-1 ${inputClass}`}
        >
          {OUTPUT_FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="description" className={labelClass}>
          Beskrivning
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={tool?.description}
          placeholder="Kort beskrivning av vad verktyget gör…"
          className={`mt-1 ${inputClass}`}
        />
      </div>

      <div>
        <label htmlFor="prompt_template" className={labelClass}>
          Systemprompt / Statiskt innehåll
          {!canEditPrompt && (
            <span className="ml-2 inline-block rounded-full bg-movexum-pastell-lila px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-movexum-lila dark:bg-movexum-morklila/40 dark:text-movexum-ljuslila">
              Endast admin
            </span>
          )}
        </label>
        <textarea
          id="prompt_template"
          name="prompt_template"
          rows={8}
          defaultValue={tool?.prompt_template}
          readOnly={!canEditPrompt}
          placeholder={
            canEditPrompt
              ? 'Skriv systempromptmallen här. Använd {{startup.name}}, {{milestones}}, {{portfolio}} etc. för substitution.'
              : 'Endast admin kan redigera systemprompt.'
          }
          className={`mt-1 font-mono text-xs ${inputClass} ${!canEditPrompt ? 'cursor-not-allowed bg-canvas-subtle opacity-70' : ''}`}
        />
        <p className="mt-1 text-xs text-foreground-subtle">
          {canEditPrompt ? (
            <>
              Placeholders: <code>{'{{startup}}'}</code>, <code>{'{{milestones}}'}</code>,{' '}
              <code>{'{{activities}}'}</code>, <code>{'{{notes}}'}</code>,{' '}
              <code>{'{{portfolio}}'}</code>
            </>
          ) : (
            <>
              Systemprompten styr hur AI-agenten beter sig och kan endast ändras av admin för att
              skydda mot prompt injection och bevara modellbeteendet.
            </>
          )}
        </p>
      </div>

      <div>
        <p className={labelClass}>Tillåtna roller</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {ALL_ROLES.map((r) => (
            <label key={r.value} className="flex items-center gap-2 text-sm text-foreground-muted">
              <input
                type="checkbox"
                name="roles_allowed"
                value={r.value}
                defaultChecked={tool?.roles_allowed?.includes(r.value) ?? false}
                className="rounded border-default accent-brand"
              />
              {r.label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-foreground-muted">
          <input
            type="checkbox"
            name="requires_startup"
            defaultChecked={tool?.requires_startup ?? false}
            className="rounded border-default accent-brand"
          />
          Kräver bolag
        </label>

        <label className="flex items-center gap-2 text-sm text-foreground-muted">
          <input
            type="checkbox"
            name="active"
            defaultChecked={tool?.active ?? true}
            className="rounded border-default accent-brand"
          />
          Aktivt
        </label>
      </div>

      {error && (
        <p className="rounded-2xl bg-movexum-pastell-orange px-4 py-3 text-sm text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-50"
        >
          {isPending ? 'Sparar…' : mode === 'create' ? 'Skapa verktyg' : 'Spara ändringar'}
        </button>
        <a
          href="/toolbox"
          className="inline-flex items-center justify-center rounded-full border border-default bg-surface px-6 py-2.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle"
        >
          Avbryt
        </a>
      </div>
    </form>
  );
}
