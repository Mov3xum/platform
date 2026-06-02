'use client';

import Link from 'next/link';
import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  createOnboardingFlowAction,
  updateOnboardingFlowAction,
  type OnboardingFlowActionState
} from '@/lib/actions/onboarding';
import type { OnboardingFlow, OnboardingModule } from '@platform/shared';
import { OnboardingBlockBuilder } from './OnboardingBlockBuilder';

const initialState: OnboardingFlowActionState = {};

export function OnboardingFlowForm({ flow }: { flow?: OnboardingFlow }) {
  const router = useRouter();
  const isEdit = Boolean(flow);

  const action = isEdit
    ? updateOnboardingFlowAction.bind(null, flow!.id)
    : createOnboardingFlowAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (!isEdit && state.flowId) {
      router.push('/education/onboarding');
    }
    if (isEdit && state.ok) {
      router.push('/education/onboarding');
    }
  }, [isEdit, state.flowId, state.ok, router]);

  const inputClass =
    'mt-1 w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
  const labelClass = 'block text-sm font-medium text-foreground-muted';

  const initialModules = (flow?.modules as OnboardingModule[] | undefined) ?? undefined;

  return (
    <form action={formAction} className="space-y-6">
      <section className="space-y-5 rounded-3xl border border-default bg-surface p-6">
        <h2 className="text-base font-semibold text-foreground">Grundinformation</h2>
        <div>
          <label htmlFor="title" className={labelClass}>
            Titel *
          </label>
          <input
            id="title"
            name="title"
            required
            defaultValue={flow?.title ?? ''}
            className={inputClass}
            placeholder="t.ex. Välkommen till Movexum"
          />
        </div>
        <div>
          <label htmlFor="intro" className={labelClass}>
            Inledande text
          </label>
          <textarea
            id="intro"
            name="intro"
            rows={3}
            defaultValue={flow?.intro ?? ''}
            className={inputClass}
            placeholder="Visas överst när bolaget öppnar onboardingen."
          />
        </div>
        <div>
          <label htmlFor="status" className={labelClass}>
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={flow?.status ?? 'draft'}
            className={inputClass}
          >
            <option value="draft">Utkast</option>
            <option value="active">Aktiv (kan visas för bolag)</option>
            <option value="archived">Arkiverad</option>
          </select>
          <p className="mt-1.5 text-xs text-foreground-subtle">
            Endast ett <strong>aktivt</strong> flöde som är satt till <strong>default</strong> visas
            för nya bolag.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground-muted">
          <input
            type="checkbox"
            name="is_default"
            defaultChecked={flow?.is_default ?? false}
            className="rounded border-default accent-brand"
          />
          Sätt som standard-onboarding för nya bolag
        </label>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Moduler &amp; block</h2>
          <p className="mt-1 text-sm text-foreground-muted">
            Bygg onboardingen med moduler om Movexum och tiden i inkubatorn. Varje modul kan
            innehålla text, film, bild, bekräftelser, frågor och quiz.
          </p>
        </div>
        <OnboardingBlockBuilder initialModules={initialModules} />
      </section>

      {state.error ? (
        <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-sm text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? 'Sparar…' : isEdit ? 'Spara ändringar' : 'Skapa onboarding'}
        </button>
        <Link
          href="/education/onboarding"
          className="text-sm font-medium text-foreground-muted hover:text-foreground"
        >
          Avbryt
        </Link>
      </div>
    </form>
  );
}
