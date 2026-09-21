import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INSTALL_DISMISS_MS,
  isInstallDismissed,
  isIosSafari,
  isStandaloneDisplay
} from './pwa';

test('isStandaloneDisplay läser display-mode och iOS navigator.standalone', () => {
  assert.equal(isStandaloneDisplay(undefined), false);
  assert.equal(
    isStandaloneDisplay({ matchMedia: () => ({ matches: false }), navigator: {} }),
    false
  );
  assert.equal(
    isStandaloneDisplay({ matchMedia: (q) => ({ matches: q.includes('standalone') }) }),
    true
  );
  assert.equal(
    isStandaloneDisplay({ matchMedia: () => ({ matches: false }), navigator: { standalone: true } }),
    true
  );
});

test('isIosSafari känner igen Safari på iPhone/iPad men inte Chrome på iOS eller Android', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
  assert.equal(isIosSafari(iphone), true);
  assert.equal(isIosSafari(iphone.replace('Safari/604.1', 'CriOS/120 Safari/604.1')), false);
  assert.equal(isIosSafari('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36'), false);
  // iPadOS 13+ maskerar sig som Macintosh — avslöjas av touch-punkterna.
  const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
  assert.equal(isIosSafari(ipad, 5), true);
  assert.equal(isIosSafari(ipad, 0), false);
});

test('isInstallDismissed håller hinten dold i 30 dagar efter avfärdande', () => {
  const now = 1_700_000_000_000;
  assert.equal(isInstallDismissed(null, now), false);
  assert.equal(isInstallDismissed('inte-ett-tal', now), false);
  assert.equal(isInstallDismissed(String(now - 1000), now), true);
  assert.equal(isInstallDismissed(String(now - INSTALL_DISMISS_MS - 1), now), false);
});
