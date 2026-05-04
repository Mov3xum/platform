'use client';

import { useActionState, useEffect, useRef } from 'react';
import { createNoteAction, type NoteFormState } from '@/lib/actions/notes';

const initialState: NoteFormState = {};

export function NoteForm({ startupId }: { startupId: string }) {
  const boundAction = createNoteAction.bind(null, startupId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!pending && !state.error && formRef.current) {
      formRef.current.reset();
    }
  }, [state, pending]);

  return (
    <form action={formAction} ref={formRef} className="space-y-3">
      <textarea
        name="body"
        rows={3}
        required
        placeholder="Skriv en anteckning…"
        className="block w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
      />
      <div className="flex items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="confidential" className="h-4 w-4 rounded border-slate-300" />
          Konfidentiell
        </label>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-full bg-slate-950 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
        >
          {pending ? 'Sparar…' : 'Spara anteckning'}
        </button>
      </div>
      {state.error ? (
        <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">{state.error}</p>
      ) : null}
    </form>
  );
}
