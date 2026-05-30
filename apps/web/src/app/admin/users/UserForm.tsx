'use client';

import { useActionState, useRef, useState } from 'react';
import Link from 'next/link';
import { type Role } from '@platform/shared';
import { createUserAction, type CreateUserState } from '@/lib/actions/users';
import { ROLE_LABELS } from '@/lib/users/validate';

export type StartupOption = { id: string; name: string };

const initialState: CreateUserState = { status: 'idle' };

const inputClass =
  'block w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

function generatePassword(): string {
  // Läsbart, tillräckligt långt initiallösenord som staff kan dela ut.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const arr = new Uint32Array(14);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join('');
}

export function UserForm({
  startups,
  assignableRoles
}: {
  startups: StartupOption[];
  assignableRoles: Role[];
}) {
  const [state, formAction, pending] = useActionState(createUserAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const [password, setPassword] = useState('');
  const defaultRole: Role = assignableRoles.includes('startup_member')
    ? 'startup_member'
    : (assignableRoles[0] ?? 'observer');
  const [role, setRole] = useState<Role>(defaultRole);

  // Återställ formuläret efter en lyckad registrering så nästa person kan läggas in.
  if (state.status === 'ok' && formRef.current && password !== '') {
    formRef.current.reset();
    setPassword('');
    setRole(defaultRole);
  }

  const needsStartup = role === 'startup_member';

  return (
    <section className="space-y-4">
      <form
        ref={formRef}
        action={formAction}
        className="space-y-4 rounded-3xl border border-default bg-surface p-6"
      >
        <div>
          <label htmlFor="display_name" className="block text-sm font-medium text-foreground">
            Namn
          </label>
          <input
            id="display_name"
            name="display_name"
            type="text"
            required
            maxLength={200}
            autoComplete="off"
            placeholder="Förnamn Efternamn"
            className={`mt-1 ${inputClass}`}
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-foreground">
            E-post
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="off"
            placeholder="namn@bolag.se"
            className={`mt-1 ${inputClass}`}
          />
          <p className="mt-1 text-xs text-foreground-subtle">
            Används som inloggningsnamn. Kontot skapas verifierat — personen kan
            logga in direkt.
          </p>
        </div>

        <div>
          <label htmlFor="role" className="block text-sm font-medium text-foreground">
            Roll
          </label>
          <select
            id="role"
            name="role"
            required
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className={`mt-1 ${inputClass}`}
          >
            {assignableRoles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-foreground-subtle">
            Rollen styr behörigheter enligt RBAC. Bolag tilldelas bara för{' '}
            <code className="font-mono">Bolagsmedlem</code>.
          </p>
        </div>

        {needsStartup &&
          (startups.length === 0 ? (
            <p className="rounded-2xl bg-movexum-pastell-gul px-4 py-3 text-sm text-movexum-morkgul">
              Det finns inga bolag att tilldela ännu. Skapa ett bolag under{' '}
              <Link href="/startups" className="underline">
                Startups
              </Link>{' '}
              först, eller välj en annan roll.
            </p>
          ) : (
            <div>
              <label htmlFor="startup_id" className="block text-sm font-medium text-foreground">
                Tilldela bolag
              </label>
              <select
                id="startup_id"
                name="startup_id"
                required={needsStartup}
                defaultValue=""
                className={`mt-1 ${inputClass}`}
              >
                <option value="" disabled>
                  Välj bolag…
                </option>
                {startups.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-foreground-subtle">
                Bolagsmedlemmen ser bara sitt bolags miljö.
              </p>
            </div>
          ))}

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-foreground">
            Initialt lösenord
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="password"
              name="password"
              type="text"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minst 8 tecken"
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => setPassword(generatePassword())}
              className="shrink-0 rounded-2xl border border-default bg-canvas-subtle px-4 py-2 text-sm font-medium text-foreground-muted hover:bg-canvas-muted"
            >
              Generera
            </button>
          </div>
          <p className="mt-1 text-xs text-foreground-subtle">
            Dela lösenordet säkert med personen. De kan byta det själva via
            kontoinställningarna efter inloggning.
          </p>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending || (needsStartup && startups.length === 0)}
            className="rounded-2xl bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? 'Skapar…' : 'Skapa användare'}
          </button>
        </div>

        {state.status === 'error' && (
          <p className="rounded-2xl bg-movexum-pastell-orange px-4 py-3 text-sm text-movexum-morkorange">
            {state.message}
          </p>
        )}

        {state.status === 'ok' && (
          <div className="rounded-2xl bg-movexum-pastell-gron px-4 py-3 text-sm text-movexum-morkgron">
            <p className="font-medium">{state.message}</p>
            <p className="mt-1 text-xs">
              Personen kan nu logga in på inloggningssidan med sin e-post och det
              lösenord du angav.
            </p>
          </div>
        )}
      </form>
    </section>
  );
}
