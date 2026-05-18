'use client';

import { useActionState } from 'react';
import {
  connectIntegrationAction,
  type IntegrationConnectState
} from '@/lib/actions/integrations';

interface FieldSpec {
  key: string;
  label: string;
  type: 'password' | 'text';
  help?: string;
  required?: boolean;
}

interface Props {
  providerSlug: string;
  providerName: string;
  fields: FieldSpec[];
}

const initialState: IntegrationConnectState = {};

export function ConnectForm({ providerSlug, providerName, fields }: Props) {
  const [state, formAction, pending] = useActionState(
    connectIntegrationAction,
    initialState
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="provider_slug" value={providerSlug} />

      {fields.map((field) => (
        <label key={field.key} className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            {field.label}
            {field.required ? ' *' : ''}
          </span>
          <input
            name={field.key}
            type={field.type}
            required={field.required}
            autoComplete="off"
            className="mt-1.5 block w-full rounded-2xl border border-default bg-canvas px-3 py-2 text-sm text-foreground placeholder:text-foreground-subtle focus:border-strong focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
          />
          {field.help && (
            <span className="mt-1 block text-[11.5px] text-foreground-subtle">
              {field.help}
            </span>
          )}
        </label>
      ))}

      {state.error && (
        <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-xs text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="rounded-xl bg-movexum-pastell-gron px-3 py-2 text-xs text-movexum-morkgron dark:bg-movexum-morkgron/30 dark:text-movexum-pastell-gron">
          {providerName} ansluten. Klicka på "Synka nu" för att hämta data.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-2xl bg-brand px-4 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? 'Verifierar…' : `Anslut ${providerName}`}
      </button>
    </form>
  );
}
