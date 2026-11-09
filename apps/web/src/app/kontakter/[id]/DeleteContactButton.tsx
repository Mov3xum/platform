'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteContactAction, type ContactActionState } from '@/lib/actions/contacts';
import { Icon } from '@/components/proto';
import { btnDanger, btnGhost } from '../ui';

const initial: ContactActionState = {};

/** Radering — admin/incubator_lead (server-actionen är gränsen). Två steg så inget råkar försvinna. */
export function DeleteContactButton({ contactId, name }: { contactId: string; name: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [state, action, pending] = useActionState(deleteContactAction, initial);

  useEffect(() => {
    if (state.ok && state.path) router.push(state.path);
  }, [state.ok, state.path, router]);

  if (!confirm) {
    return (
      <button type="button" onClick={() => setConfirm(true)} className={btnGhost} title="Radera kontakten">
        <Icon name="trash" size={13} /> Radera
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={contactId} />
      <span className="text-xs text-foreground-muted">Radera {name} permanent?</span>
      <button type="submit" disabled={pending} className={btnDanger}>
        {pending ? 'Raderar…' : 'Ja, radera'}
      </button>
      <button type="button" onClick={() => setConfirm(false)} className={btnGhost}>
        Avbryt
      </button>
      {state.error && <span className="text-xs text-movexum-morkorange">{state.error}</span>}
    </form>
  );
}
