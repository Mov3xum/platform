'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type FormEvent } from 'react';
import { addImpactNoteAction } from '@/lib/actions/impact';
import { btnPrimary, card, hintClass, inputClass, noticeError } from '@/components/impact/ui';

export function NoteForm({ startupId }: { startupId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = String(new FormData(e.currentTarget).get('body') ?? '');
    setError(null);
    start(async () => {
      const res = await addImpactNoteAction(startupId, { body });
      if (res.error) {
        setError(res.error);
        return;
      }
      formRef.current?.reset();
      router.refresh();
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} className={card}>
      <textarea name="body" rows={4} maxLength={20000} placeholder="Skriv intern anteckning..." className={inputClass} required />
      <p className={`mt-2 ${hintClass}`}>Anteckningen sparas på bolagskortet (ej konfidentiell). Skriv inte personuppgifter.</p>
      {error ? <p role="alert" className={`mt-2 ${noticeError}`}>{error}</p> : null}
      <button type="submit" disabled={pending} className={`mt-3 ${btnPrimary}`}>
        {pending ? 'Sparar …' : 'Spara anteckning'}
      </button>
    </form>
  );
}
