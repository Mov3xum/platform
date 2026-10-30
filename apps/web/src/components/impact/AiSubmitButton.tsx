'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/proto/Icon';
import { btnPrimary, noticeError, noticeWarn } from './ui';

const CLIENT_ANALYSIS_TIMEOUT_MS = 305_000;
const SLOW_ANALYSIS_NOTICE_SECONDS = 180;
const DEFAULT_PENDING_STEPS: readonly [string, string, string] = [
  'Läser in bolagets underlag',
  'Väger risker, möjligheter och osäkerheter',
  'Formulerar coachande slutsatser'
];

/**
 * Knappen som startar ett AI-steg (originalets AiSubmitButton): visar en
 * överlagring med tre steg medan analysen körs, en "tar längre tid än
 * väntat"-not efter tre minuter med länk till målsidan, och ett tydligt fel
 * om inget svar kommit på fem minuter. `pending` styrs av föräldern
 * (useTransition) eftersom plattformens formulär anropar server actions
 * direkt i stället för via <form action>.
 */
export function AiSubmitButton({
  idleLabel,
  pendingLabel = 'Analyserar...',
  pendingTitle,
  pendingDescription,
  pendingSteps = DEFAULT_PENDING_STEPS,
  fallbackHref,
  pending,
  disabled,
  className,
  type = 'submit',
  onClick
}: {
  idleLabel: string;
  pendingLabel?: string;
  pendingTitle: string;
  pendingDescription: string;
  pendingSteps?: readonly [string, string, string];
  fallbackHref?: string;
  pending: boolean;
  disabled?: boolean;
  className?: string;
  type?: 'submit' | 'button';
  onClick?: () => void;
}) {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!pending) return;
    setTimedOut(false);
    const timeout = window.setTimeout(() => setTimedOut(true), CLIENT_ANALYSIS_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [pending]);

  const showPending = pending && !timedOut;

  return (
    <>
      <button type={type} onClick={onClick} disabled={showPending || disabled} aria-busy={showPending} className={`${btnPrimary} ${className ?? ''}`}>
        <Icon name={showPending ? 'hourglass' : 'send'} size={15} />
        {showPending ? pendingLabel : idleLabel}
      </button>
      {showPending ? <AiAnalysisOverlay title={pendingTitle} description={pendingDescription} steps={pendingSteps} fallbackHref={fallbackHref} /> : null}
      {timedOut && pending ? (
        <div role="alert" className={`mt-3 max-w-xl ${noticeError}`}>
          <p className="font-medium">Analysen fick inget svar inom fem minuter.</p>
          <p className="mt-1 font-normal">Ladda om sidan innan du försöker igen. Om analysen hann sparas visas resultatet efter omladdningen.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {fallbackHref ? (
              <Link href={fallbackHref} className="rounded-lg bg-movexum-morkorange px-3 py-2 text-xs font-medium text-movexum-vit">
                Öppna resultat
              </Link>
            ) : null}
            <button type="button" onClick={() => window.location.reload()} className="rounded-lg border border-movexum-orange/40 px-3 py-2 text-xs font-medium">
              Ladda om
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function AiAnalysisOverlay({ title, description, steps, fallbackHref }: { title: string; description: string; steps: readonly [string, string, string]; fallbackHref?: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed((c) => c + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const showFallback = elapsed >= SLOW_ANALYSIS_NOTICE_SECONDS;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-movexum-svart/30 p-4 backdrop-blur-sm" role="status" aria-live="polite">
      <div className="w-full max-w-lg rounded-2xl border border-default bg-surface p-6 shadow-lg shadow-movexum-svart/10">
        <div className="flex items-start gap-4">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-foreground">
            <span className="absolute h-14 w-14 animate-ping rounded-xl bg-brand/30" />
            <Icon name="search" size={26} />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-foreground-subtle">Analys pågår</p>
            <h2 className="mt-1 text-xl font-semibold text-foreground">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-foreground-muted">{description}</p>
          </div>
        </div>
        <div className="mt-6 space-y-3">
          {steps.map((label, i) => (
            <div key={label} className="flex items-center gap-3 rounded-xl border border-default bg-canvas-subtle px-3 py-2">
              <span className={`h-2.5 w-2.5 animate-pulse rounded-full bg-brand ${i === 1 ? 'delay-150' : i === 2 ? 'delay-300' : ''}`} />
              <span className="text-sm text-foreground">{label}</span>
            </div>
          ))}
        </div>
        <p className="mt-5 rounded-xl bg-canvas-subtle p-3 text-xs leading-5 text-foreground-subtle">
          Behåll fliken öppen medan bedömningen tas fram. Det kan ta upp till några minuter beroende på underlagets omfattning. AI-verktyg drivs av Mistral (Frankrike, EU).
        </p>
        {showFallback ? (
          <div className={`mt-4 ${noticeWarn}`}>
            <p className="font-medium">Det här tar längre tid än väntat.</p>
            <p className="mt-1">Ibland hinner servern spara analysen men webbläsaren väntar kvar på sidbytet. Kontrollera om resultatet finns genom att öppna målsidan eller ladda om sidan.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {fallbackHref ? (
                <Link href={fallbackHref} className="rounded-lg bg-movexum-morkgul px-3 py-2 text-xs font-medium text-movexum-vit">
                  Öppna resultat
                </Link>
              ) : null}
              <button type="button" onClick={() => window.location.reload()} className="rounded-lg border border-movexum-gul/50 px-3 py-2 text-xs font-medium">
                Ladda om
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
