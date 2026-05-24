'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import {
  requestIntegrationPilotAction,
  type IntegrationPilotState
} from '@/lib/actions/integrations';

type Availability = 'planned' | 'beta' | 'available';
type TenantStatus = 'available' | 'pilot_requested' | 'connected' | 'disabled';

interface Props {
  providerId: string;
  providerSlug: string;
  integrationName: string;
  providerPlaceholder: string;
  availability: Availability;
  tenantStatus: TenantStatus;
  canRequest: boolean;
  hasHandler: boolean;
  accentClass: string;
}

const STEPS = [
  {
    title: 'Berätta vad ni vill uppnå',
    description:
      'Beskriv kort vilka flöden eller team som integrationen ska stödja — ju mer konkret, desto snabbare pilot.'
  },
  {
    title: 'Movexum hör av sig',
    description:
      'Vi kontaktar er inom ett par arbetsdagar för att gå igenom behörigheter och datastrategi.'
  },
  {
    title: 'Pilot & aktivering',
    description:
      'Vi konfigurerar integrationen tillsammans, kör pilot med ett eller två bolag och rullar ut brett när allt är stabilt.'
  }
];

const initialState: IntegrationPilotState = {};

export function IntegrationActivateButton({
  providerId,
  providerSlug,
  integrationName,
  providerPlaceholder,
  availability,
  tenantStatus,
  canRequest,
  hasHandler,
  accentClass
}: Props) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    requestIntegrationPilotAction,
    initialState
  );

  useEffect(() => {
    if (!open) return;
    if (state.success) {
      // Keep dialog open briefly so user sees the confirmation; close on next interaction.
    }
  }, [state, open]);

  const isConnected = tenantStatus === 'connected';
  const isRequested = tenantStatus === 'pilot_requested';

  // Providers with a real sync handler skip the pilot-request flow
  // entirely and link to the detail page where credentials are
  // configured and "Sync now" lives.
  if (hasHandler) {
    return (
      <Link
        href={`/integrationer/${providerSlug}`}
        className={`inline-flex w-full items-center justify-center rounded-2xl px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila ${
          isConnected
            ? 'bg-movexum-pastell-gron text-movexum-morkgron hover:bg-movexum-pastell-gron/80 dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron'
            : 'bg-brand text-brand-foreground hover:bg-brand-hover'
        }`}
      >
        {isConnected ? 'Hantera koppling' : 'Konfigurera'}
      </Link>
    );
  }

  let buttonLabel = 'Begär pilot';
  if (isConnected) buttonLabel = 'Ansluten';
  else if (isRequested) buttonLabel = 'Pilot begärd — uppdatera';
  else if (availability === 'beta') buttonLabel = 'Begär beta-pilot';

  if (!canRequest) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex w-full cursor-not-allowed items-center justify-center rounded-2xl border border-default bg-canvas-subtle px-4 py-2.5 text-sm font-semibold text-foreground-muted"
        title="Endast inkubatorledning kan begära pilot"
      >
        {isConnected ? 'Ansluten' : 'Endast admin kan begära pilot'}
      </button>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          disabled={isConnected}
          className={`inline-flex w-full items-center justify-center rounded-2xl px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila ${
            isConnected
              ? 'cursor-default bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron'
              : 'bg-brand text-brand-foreground hover:bg-brand-hover'
          }`}
        >
          {buttonLabel}
        </button>
      </Dialog.Trigger>

      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                key="overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-40 bg-movexum-svart/50 backdrop-blur-sm"
              />
            </Dialog.Overlay>

            <Dialog.Content asChild>
              <motion.div
                key="content"
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-md -translate-y-1/2 rounded-3xl border border-default bg-surface shadow-2xl shadow-movexum-svart/20 focus:outline-none"
              >
                <div className={`relative overflow-hidden rounded-t-3xl ${accentClass} px-6 pb-5 pt-6`}>
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-default bg-surface text-xs font-semibold tracking-[0.08em] text-foreground-muted">
                      {providerPlaceholder}
                    </div>
                    <div>
                      <Dialog.Title className="text-base font-semibold text-foreground">
                        Pilot för {integrationName}
                      </Dialog.Title>
                      <Dialog.Description className="mt-0.5 text-xs text-foreground-muted">
                        {availability === 'beta'
                          ? 'Beta — vi tar in pilotorganisationer löpande.'
                          : 'På roadmap — anmäl intresse så prioriterar vi det.'}
                      </Dialog.Description>
                    </div>
                  </div>

                  <Dialog.Close asChild>
                    <button
                      type="button"
                      aria-label="Stäng dialog"
                      className="absolute right-4 top-4 inline-flex items-center justify-center rounded-xl border border-default bg-surface/80 px-2.5 py-1.5 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle hover:text-foreground"
                    >
                      Stäng
                    </button>
                  </Dialog.Close>
                </div>

                <div className="px-6 py-5">
                  <ol className="space-y-4">
                    {STEPS.map((step, idx) => (
                      <li key={step.title} className="flex gap-4">
                        <div className="flex flex-col items-center">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-default bg-canvas-subtle text-xs font-semibold text-brand">
                            {idx + 1}
                          </div>
                          {idx < STEPS.length - 1 && (
                            <div className="mt-1 h-full w-px bg-default" />
                          )}
                        </div>
                        <div className="pb-4">
                          <p className="text-sm font-semibold text-foreground">
                            {idx + 1}. {step.title}
                          </p>
                          <p className="mt-0.5 text-sm text-foreground-muted">
                            {step.description}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>

                  {state.success ? (
                    <div className="mt-2 rounded-2xl border border-movexum-ljusgron/40 bg-movexum-pastell-gron px-4 py-3 dark:border-movexum-gron/50 dark:bg-movexum-morkgron/30">
                      <p className="text-xs text-movexum-morkgron dark:text-movexum-pastell-gron">
                        <span className="font-semibold">Tack!</span> Er förfrågan är
                        registrerad. Movexum hör av sig inom ett par arbetsdagar.
                      </p>
                    </div>
                  ) : (
                    <form action={formAction} className="space-y-3">
                      <input type="hidden" name="provider_id" value={providerId} />
                      <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                          Vad vill ni uppnå? (valfritt)
                        </span>
                        <textarea
                          name="message"
                          rows={3}
                          maxLength={2000}
                          placeholder="T.ex. synka kalendrar för coachmöten, eller skicka milstolpenotiser till #portfolio-kanalen."
                          className="mt-1.5 block w-full rounded-2xl border border-default bg-canvas px-3 py-2 text-sm text-foreground placeholder:text-foreground-subtle focus:border-strong focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
                        />
                      </label>

                      {state.error && (
                        <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-xs text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange">
                          {state.error}
                        </p>
                      )}

                      <div className="flex gap-3 pt-1">
                        <button
                          type="submit"
                          disabled={pending}
                          className="flex-1 rounded-2xl bg-brand px-4 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60"
                        >
                          {pending
                            ? 'Skickar…'
                            : isRequested
                              ? 'Uppdatera förfrågan'
                              : 'Skicka förfrågan'}
                        </button>
                        <Dialog.Close asChild>
                          <button
                            type="button"
                            className="rounded-2xl border border-default px-4 py-2.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle hover:text-foreground"
                          >
                            Avbryt
                          </button>
                        </Dialog.Close>
                      </div>
                    </form>
                  )}
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
