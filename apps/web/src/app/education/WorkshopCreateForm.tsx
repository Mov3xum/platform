'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { createWorkshopAction, type WorkshopActionState } from '@/lib/actions/workshops';

const initialState: WorkshopActionState = {};

export function WorkshopCreateForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createWorkshopAction, initialState);

  if (state.workshopId) {
    router.push(`/education/workshops/${state.workshopId}`);
  }

  const inputClass =
    'mt-1 w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
  const labelClass = 'block text-sm font-medium text-foreground-muted';

  return (
    <form action={formAction} className="space-y-5 rounded-3xl border border-default bg-surface p-6">
      <div>
        <label htmlFor="key" className={labelClass}>
          Nyckel *
        </label>
        <input id="key" name="key" required className={inputClass} placeholder="t.ex. workshop_pitch_story" />
      </div>
      <div>
        <label htmlFor="title" className={labelClass}>
          Titel *
        </label>
        <input id="title" name="title" required className={inputClass} />
      </div>
      <div>
        <label htmlFor="goal" className={labelClass}>
          Mål
        </label>
        <textarea id="goal" name="goal" rows={2} className={inputClass} />
      </div>
      <div>
        <label htmlFor="instructions" className={labelClass}>
          Instruktioner
        </label>
        <textarea id="instructions" name="instructions" rows={4} className={inputClass} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="status" className={labelClass}>
            Status
          </label>
          <select id="status" name="status" defaultValue="draft" className={inputClass}>
            <option value="draft">Utkast</option>
            <option value="active">Aktiv</option>
            <option value="archived">Arkiverad</option>
          </select>
        </div>
        <div>
          <label htmlFor="version" className={labelClass}>
            Version
          </label>
          <input id="version" name="version" defaultValue="1.0.0" className={inputClass} />
        </div>
      </div>
      <div>
        <p className={labelClass}>Målgrupp</p>
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-foreground-muted">
          {[
            ['admin', 'Admin'],
            ['incubator_lead', 'Inkubatorledare'],
            ['coach', 'Coach'],
            ['mentor', 'Mentor'],
            ['startup_member', 'Startup-medlem'],
            ['observer', 'Observatör']
          ].map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="checkbox" name="audience_roles" value={value} className="rounded border-default accent-brand" />
              {label}
            </label>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor="ai_system_prompt" className={labelClass}>
          AI system prompt
        </label>
        <textarea id="ai_system_prompt" name="ai_system_prompt" rows={3} className={inputClass} />
      </div>
      <div>
        <label htmlFor="output_requirements" className={labelClass}>
          Outputkrav
        </label>
        <textarea id="output_requirements" name="output_requirements" rows={3} className={inputClass} />
      </div>
      <div>
        <label htmlFor="content_blocks_json" className={labelClass}>
          Content blocks (JSON)
        </label>
        <textarea
          id="content_blocks_json"
          name="content_blocks_json"
          rows={10}
          className={`${inputClass} font-mono text-xs`}
          defaultValue={`[
  {
    "id": "intro",
    "type": "summary",
    "title": "Introduktion",
    "instructions": "Beskriv workshopens mål"
  },
  {
    "id": "exercise_1",
    "type": "exercise",
    "title": "Övning 1",
    "instructions": "Genomför övningen och skriv ert svar",
    "required": true
  },
  {
    "id": "qa_1",
    "type": "question",
    "title": "Reflektionsfråga",
    "instructions": "Vad tar ni med er?",
    "required": true
  },
  {
    "id": "coach_ai",
    "type": "ai_chat",
    "title": "AI-coach",
    "instructions": "Ställ en fråga till AI"
  }
]`}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-foreground-muted">
        <input type="checkbox" name="active" defaultChecked className="rounded border-default accent-brand" />
        Aktiv
      </label>
      {state.error ? (
        <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-sm text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Sparar…' : 'Skapa workshop'}
      </button>
    </form>
  );
}
