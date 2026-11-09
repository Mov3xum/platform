'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { removeInvitationAction } from '@/lib/actions/invitations';
import { actionErrorMessage } from '@/lib/action-error';

/**
 * Tar bort en inbjudan (CLAUDE.md § 53.5) — ✕ → "Ta bort?" Ja/Avbryt. Svarslänken
 * i mejlet slutar gälla. Servern avgör vilka rader som får tas bort.
 */
export function RemoveInviteButton({ signupId, name }: { signupId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const remove = () => {
    setError(null);
    start(async () => {
      try {
        const res = await removeInvitationAction(signupId);
        if (res.error) {
          setError(res.error);
          return;
        }
        setConfirming(false);
        router.refresh();
      } catch (err) {
        setError(actionErrorMessage(err, 'Inbjudan kunde inte tas bort. Ladda om sidan och försök igen.'));
      }
    });
  };

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        title={`Ta bort inbjudan till ${name}`}
        aria-label={`Ta bort inbjudan till ${name}`}
        className="mx-mono mx-t-xs"
        style={{ color: 'var(--mx-muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
      >
        ✕
      </button>
    );
  }

  return (
    <span className="mx-flex mx-items-c mx-gap-2" style={{ flexWrap: 'wrap' }}>
      <span className="mx-t-xs mx-muted">Ta bort?</span>
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="mx-mono mx-t-xs"
        style={{
          color: 'var(--movexum-morkorange)',
          background: 'var(--movexum-pastell-orange)',
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
        onClick={() => {
          setConfirming(false);
          setError(null);
        }}
        disabled={pending}
        className="mx-mono mx-t-xs"
        style={{ background: 'transparent', border: 'none', color: 'var(--mx-muted)', cursor: 'pointer', padding: '2px 6px' }}
      >
        Avbryt
      </button>
      {error && (
        <span role="alert" className="mx-t-xs" style={{ color: 'var(--movexum-morkorange)' }}>
          {error}
        </span>
      )}
    </span>
  );
}
