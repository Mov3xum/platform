'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CONTACT_CATEGORIES, CONTACT_CATEGORY_LABELS } from '@platform/shared';
import { createContactAction, updateContactAction, type ContactActionState } from '@/lib/actions/contacts';
import { GdprBanner, Notice, btnGhost, btnPrimary, inputClass, labelClass } from './ui';

export interface ContactFormValues {
  id?: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  organization: string;
  primary_role: string;
  category: string;
  kommun: string;
  skills: string;
  info: string;
  owners: string[];
  gender?: string;
}

export interface OwnerOption {
  id: string;
  name: string;
}

const initialState: ContactActionState = {};

/**
 * Skapa/redigera kontakt (§ 41.2). Ägare väljs bland Movexum-personal; minst
 * en krävs (default = du). GDPR-samtycke krävs vid skapande (§ 15.4).
 */
export function ContactForm({
  mode,
  initial,
  owners,
  meId,
  canSetGender
}: {
  mode: 'create' | 'edit';
  initial?: Partial<ContactFormValues>;
  owners: OwnerOption[];
  meId: string;
  canSetGender: boolean;
}) {
  const router = useRouter();
  const action = mode === 'create' ? createContactAction : updateContactAction;
  const [state, formAction, pending] = useActionState(action, initialState);
  const v: ContactFormValues = {
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    organization: '',
    primary_role: '',
    category: '',
    kommun: '',
    skills: '',
    info: '',
    owners: [meId],
    ...initial
  };

  useEffect(() => {
    if (state.ok && state.path) router.push(state.path);
  }, [state.ok, state.path, router]);

  return (
    <form action={formAction} className="space-y-5">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      {state.error && <Notice kind="error">{state.error}</Notice>}
      {state.warning && <Notice kind="warning">{state.warning}</Notice>}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="first_name">
            Förnamn *
          </label>
          <input id="first_name" name="first_name" required defaultValue={v.first_name} className={inputClass} maxLength={100} />
        </div>
        <div>
          <label className={labelClass} htmlFor="last_name">
            Efternamn
          </label>
          <input id="last_name" name="last_name" defaultValue={v.last_name} className={inputClass} maxLength={100} />
        </div>
        <div>
          <label className={labelClass} htmlFor="organization">
            Organisation
          </label>
          <input id="organization" name="organization" defaultValue={v.organization} className={inputClass} maxLength={200} placeholder="t.ex. Vinnova, Almi Invest, Högskolan i Gävle" />
        </div>
        <div>
          <label className={labelClass} htmlFor="primary_role">
            Titel / roll
          </label>
          <input id="primary_role" name="primary_role" defaultValue={v.primary_role} className={inputClass} maxLength={100} placeholder="t.ex. Handläggare, Investment manager" />
        </div>
        <div>
          <label className={labelClass} htmlFor="email">
            E-post
          </label>
          <input id="email" name="email" type="email" defaultValue={v.email} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="phone">
            Telefon
          </label>
          <input id="phone" name="phone" defaultValue={v.phone} className={inputClass} maxLength={30} />
        </div>
        <div>
          <label className={labelClass} htmlFor="category">
            Kategori
          </label>
          <select id="category" name="category" defaultValue={v.category} className={inputClass}>
            <option value="">— Välj —</option>
            {CONTACT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CONTACT_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="kommun">
            Kommun / ort
          </label>
          <input id="kommun" name="kommun" defaultValue={v.kommun} className={inputClass} maxLength={100} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="skills">
            Kompetenser / områden
          </label>
          <input id="skills" name="skills" defaultValue={v.skills} className={inputClass} maxLength={1000} placeholder="Kommaseparerat, t.ex. IP-strategi, life science, offentlig finansiering" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="info">
            Info
          </label>
          <textarea id="info" name="info" defaultValue={v.info} className={`${inputClass} min-h-[96px]`} maxLength={4000} placeholder="Hur känner vi personen, vad kan hen hjälpa med? Inga personnummer eller känsliga uppgifter." />
        </div>
        {canSetGender && (
          <div>
            <label className={labelClass} htmlFor="gender">
              Kön (frivilligt, Vinnova-statistik)
            </label>
            <select id="gender" name="gender" defaultValue={v.gender ?? ''} className={inputClass}>
              <option value="">— Ej angivet —</option>
              <option value="kvinna">Kvinna</option>
              <option value="man">Man</option>
              <option value="icke_binar">Icke-binär</option>
              <option value="uppger_ej">Uppger ej</option>
            </select>
          </div>
        )}
      </div>

      <fieldset className="rounded-2xl border border-default p-4">
        <legend className="px-1 text-xs font-semibold text-foreground-muted">Ägare (minst en)</legend>
        <p className="mb-3 text-xs text-foreground-subtle">
          Ägaren är den kollega som har relationen och som godkänner när någon annan vill använda kontakten.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {owners.map((o) => (
            <label key={o.id} className="flex items-center gap-2 rounded-xl border border-default bg-canvas-subtle px-3 py-2 text-sm text-foreground">
              <input type="checkbox" name="owners" value={o.id} defaultChecked={v.owners.includes(o.id)} className="accent-[var(--color-brand)]" />
              <span className="truncate">
                {o.name}
                {o.id === meId ? ' (du)' : ''}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === 'create' && (
        <label className="flex items-start gap-2 rounded-2xl border border-default bg-canvas-subtle px-4 py-3 text-sm text-foreground">
          <input type="checkbox" name="gdpr_consent" required className="mt-0.5 accent-[var(--color-brand)]" />
          <span>
            Personen har informerats om att Movexum lagrar kontaktuppgifterna för inkubatorverksamheten (GDPR, berättigat
            intresse) och kan begära rättelse eller radering.
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? 'Sparar…' : mode === 'create' ? 'Spara kontakt' : 'Spara ändringar'}
        </button>
        <button type="button" onClick={() => router.back()} className={btnGhost}>
          Avbryt
        </button>
      </div>
      <GdprBanner />
    </form>
  );
}
