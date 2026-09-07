/**
 * Rena hjälpare för PWA-/hemskärmsläget (CLAUDE.md § 35). Inga sidoeffekter
 * utöver läsning av window/navigator — enhetstestbara via injicerade värden.
 */

export const INSTALL_DISMISS_KEY = 'movexum-install-dismissed-at';
/** Hur länge en avfärdad installationshint hålls dold (30 dagar). */
export const INSTALL_DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

export interface StandaloneProbe {
  matchMedia?: (q: string) => { matches: boolean };
  navigator?: object;
}

export function isStandaloneDisplay(win: StandaloneProbe | undefined): boolean {
  if (!win) return false;
  try {
    if (win.matchMedia?.('(display-mode: standalone)').matches) return true;
    if (win.matchMedia?.('(display-mode: fullscreen)').matches) return true;
  } catch {}
  // iOS Safari exponerar inte display-mode före iOS 16 — läs navigator.standalone.
  const nav = win.navigator as { standalone?: boolean } | undefined;
  return nav?.standalone === true;
}

export function isIosSafari(userAgent: string, maxTouchPoints = 0): boolean {
  const ua = userAgent || '';
  const isIosDevice = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
  if (!isIosDevice) return false;
  // Chrome/Firefox/Edge på iOS kör WebKit men saknar "Lägg till på hemskärmen"
  // i delningsmenyn på samma sätt — hinten riktar sig till Safari.
  return !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
}

/** Sann när hinten ska döljas: avfärdad för mindre än INSTALL_DISMISS_MS sedan. */
export function isInstallDismissed(storedValue: string | null | undefined, now: number): boolean {
  if (!storedValue) return false;
  const at = Number(storedValue);
  if (!Number.isFinite(at)) return false;
  return now - at < INSTALL_DISMISS_MS;
}
