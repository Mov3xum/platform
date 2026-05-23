'use client';

import { useActionState } from 'react';
import { logMeetingAsTaskAction, type LogMeetingState } from '@/lib/actions/tasks';

const initialState: LogMeetingState = {};

interface Props {
  subject: string;
  startsAt: string;
  endsAt: string;
  startupId: string;
  contactId?: string;
}

export function LogMeetingButton({ subject, startsAt, endsAt, startupId, contactId }: Props) {
  const [state, formAction, pending] = useActionState(logMeetingAsTaskAction, initialState);
  const done = state.summary != null;

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="subject" value={subject} />
      <input type="hidden" name="starts_at" value={startsAt} />
      <input type="hidden" name="ends_at" value={endsAt} />
      <input type="hidden" name="startup_id" value={startupId} />
      {contactId ? <input type="hidden" name="contact_id" value={contactId} /> : null}
      <button
        type="submit"
        disabled={pending || done}
        className="inline-flex items-center justify-center rounded-full border border-default bg-surface px-3 py-1 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle disabled:cursor-default disabled:opacity-70"
      >
        {done ? (state.summary as string) : pending ? 'Loggar…' : 'Logga som uppgift'}
      </button>
      {state.error ? (
        <span className="text-xs text-movexum-morkorange dark:text-movexum-pastell-orange">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
