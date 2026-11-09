'use client';

import { useState, useTransition } from 'react';
import { deleteEventSignupAction } from '@/lib/actions/events';

interface Props {
  signupId: string;
  signupName: string;
}

export function SignupDeleteButton({ signupId, signupName }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteEventSignupAction(signupId);
      if (result.error) setError(result.error);
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        title={`Radera ${signupName}`}
        className="mx-mono mx-t-xs"
        style={{
          color: 'var(--mx-muted)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '2px 6px'
        }}
      >
        ✕
      </button>
    );
  }

  return (
    <span className="mx-flex mx-items-c mx-gap-2">
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        className="mx-mono mx-t-xs"
        style={{
          color: '#4b2718',
          background: '#f1e5df',
          border: 'none',
          borderRadius: 4,
          padding: '2px 6px',
          cursor: 'pointer'
        }}
      >
        {pending ? '…' : 'Ja'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        className="mx-mono mx-t-xs"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--mx-muted)',
          cursor: 'pointer',
          padding: '2px 6px'
        }}
      >
        Avbryt
      </button>
      {error && <span className="mx-mono mx-t-xs" style={{ color: '#4b2718' }}>{error}</span>}
    </span>
  );
}
