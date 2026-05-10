'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';

interface Props {
  integrationName: string;
  providerPlaceholder: string;
  accentClass: string;
}

const STEPS = [
  {
    title: 'Autentisera',
    description: 'Logga in med ert konto hos leverantören och ge Movexum-plattformen åtkomst.'
  },
  {
    title: 'Välj behörigheter',
    description: 'Bestäm exakt vilken data som synkroniseras — ni behåller full kontroll.'
  },
  {
    title: 'Aktivera & konfigurera',
    description: 'Välj vilka startups och team som integrationen gäller för och starta synken.'
  }
];

export function IntegrationActivateButton({ integrationName, providerPlaceholder, accentClass }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="inline-flex w-full items-center justify-center rounded-2xl bg-brand px-4 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila"
        >
          Aktivera
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
                {/* Header */}
                <div className={`relative overflow-hidden rounded-t-3xl ${accentClass} px-6 pb-5 pt-6`}>
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-default bg-surface text-xs font-semibold tracking-[0.08em] text-foreground-muted">
                      {providerPlaceholder}
                    </div>
                    <div>
                      <Dialog.Title className="text-base font-semibold text-foreground">
                        Aktivera {integrationName}
                      </Dialog.Title>
                      <Dialog.Description className="mt-0.5 text-xs text-foreground-muted">
                        Tre enkla steg för att ansluta din organisation
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

                {/* Steps */}
                <div className="px-6 py-5">
                  <ol className="space-y-4">
                    {STEPS.map((step, idx) => {
                      return (
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
                            <p className="mt-0.5 text-sm text-foreground-muted">{step.description}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>

                  {/* Coming soon notice */}
                  <div className="mt-2 rounded-2xl border border-movexum-gul/40 bg-movexum-pastell-gul px-4 py-3 dark:border-movexum-morkgul/50 dark:bg-movexum-morkgul/20">
                    <div className="flex items-start gap-2">
                      <div aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-movexum-morkgul/50 bg-movexum-pastell-gul dark:border-movexum-gul/60 dark:bg-movexum-morkgul/30" />
                      <p className="text-xs text-movexum-morkgul dark:text-movexum-pastell-gul">
                        <span className="font-semibold">Kommer snart.</span>{' '}
                        Integrationer är under aktiv utveckling. Anmäl ert intresse så prioriterar vi er konfiguration.
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-5 flex gap-3">
                    <button
                      type="button"
                      disabled
                      className="flex-1 cursor-not-allowed rounded-2xl bg-brand/40 px-4 py-2.5 text-sm font-semibold text-brand-foreground/60"
                    >
                      Anslut konto
                    </button>
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="rounded-2xl border border-default px-4 py-2.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle hover:text-foreground"
                      >
                        Stäng
                      </button>
                    </Dialog.Close>
                  </div>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
