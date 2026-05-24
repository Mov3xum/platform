'use client';

import { useActionState, useEffect, useState } from 'react';
import { updateNoteAction, deleteNoteFormAction, type NoteFormState } from '@/lib/actions/notes';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';

interface Props {
  noteId: string;
  body: string;
  confidential: boolean;
  isAuthor: boolean;
}

export function NoteItem({ noteId, body, confidential, isAuthor }: Props) {
  const [editing, setEditing] = useState(false);
  const boundAction = updateNoteAction.bind(null, noteId);
  const [state, formAction, pending] = useActionState(boundAction, {} as NoteFormState);

  useEffect(() => {
    if (!pending && !state.error && editing) {
      setEditing(false);
    }
  }, [state, pending, editing]);

  if (!editing) {
    return (
      <div className="space-y-2">
        <div className="whitespace-pre-wrap text-sm text-foreground-muted">{body}</div>
        {isAuthor ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-full px-3 py-1 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle"
            >
              Redigera
            </button>
            <ConfirmDeleteButton
              action={deleteNoteFormAction}
              hiddenField={{ name: 'note_id', value: noteId }}
              label="Radera"
              variant="ghost"
              description="Radera anteckningen?"
            />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <textarea
        name="body"
        rows={4}
        required
        defaultValue={body}
        className="block w-full rounded-xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
      />
      <div className="flex items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-foreground-muted">
          <input
            type="checkbox"
            name="confidential"
            defaultChecked={confidential}
            className="h-4 w-4 rounded border-default accent-movexum-lila"
          />
          Konfidentiell
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={pending}
            className="rounded-full border border-default bg-surface px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle disabled:opacity-60"
          >
            Avbryt
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60"
          >
            {pending ? 'Sparar…' : 'Spara'}
          </button>
        </div>
      </div>
      {state.error ? (
        <p className="rounded-xl bg-error-50 px-4 py-2 text-xs text-error-700">{state.error}</p>
      ) : null}
    </form>
  );
}
