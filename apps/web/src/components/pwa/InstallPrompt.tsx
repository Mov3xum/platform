'use client';

// "Lägg till på hemskärmen"-hint (CLAUDE.md § 35). Visas bara på mobila
// bredder, aldrig när appen redan körs i standalone-läge, och kan avfärdas
// (30 dagar, localStorage). Chrome/Android: fångar `beforeinstallprompt`
// och installerar med ett klick. iOS Safari: saknar prompt-API → visar
// instruktionen "Dela → Lägg till på hemskärmen".
import { useEffect, useState } from 'react';
import { Icon } from '@/components/proto/Icon';
import {
  INSTALL_DISMISS_KEY,
  isInstallDismissed,
  isIosSafari,
  isStandaloneDisplay
} from '@/lib/pwa';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Mode = 'hidden' | 'native' | 'ios';

export function InstallPrompt() {
  const [mode, setMode] = useState<Mode>('hidden');
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isStandaloneDisplay(window)) return;
    if (!window.matchMedia('(max-width: 1024px)').matches) return;
    let dismissed = false;
    try {
      dismissed = isInstallDismissed(localStorage.getItem(INSTALL_DISMISS_KEY), Date.now());
    } catch {}
    if (dismissed) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setMode('native');
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    if (isIosSafari(navigator.userAgent, navigator.maxTouchPoints)) {
      setMode('ios');
    }

    const onInstalled = () => setMode('hidden');
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (mode === 'hidden') return null;

  function dismiss() {
    try {
      localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
    } catch {}
    setMode('hidden');
  }

  async function install() {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === 'accepted') setMode('hidden');
    } catch {}
    setDeferred(null);
  }

  return (
    <div className="mx-install-hint" role="region" aria-label="Lägg till på hemskärmen">
      <span className="mx-install-icon" aria-hidden>
        <span className="mx-install-glyph">m</span>
      </span>
      <div className="mx-install-text">
        <strong>Använd Movexum som app</strong>
        {mode === 'native' ? (
          <span>Lägg till på hemskärmen för snabb åtkomst och helskärm.</span>
        ) : (
          <span>
            Tryck på <Icon name="upload" size={12} className="mx-install-inline-ico" /> Dela och sedan
            &ldquo;Lägg till på hemskärmen&rdquo;.
          </span>
        )}
      </div>
      {mode === 'native' && (
        <button type="button" className="mx-btn mx-primary mx-sm" onClick={install}>
          Installera
        </button>
      )}
      <button type="button" className="mx-install-close" onClick={dismiss} aria-label="Dölj">
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
