// Återhämtning från ChunkLoadError efter deploy.
//
// Next.js delar appen i hashade JS/CSS-chunks (t.ex.
// `app/filer/page-6e0be63….js`). När en ny version deployas byter
// hasharna namn och de gamla filerna försvinner. En användare som har en
// gammal flik öppen och navigerar (lazy-load av en route) försöker då hämta
// en chunk som inte längre finns → 404 → servern svarar med HTML
// (Next-felsidan) → "Refused to execute script … MIME type 'text/html'" →
// `ChunkLoadError: Loading chunk … failed`.
//
// Fixen: detektera felet och ladda om sidan EN gång (full navigation), så
// browsern hämtar ny HTML med korrekta chunk-referenser. En sessionStorage-
// spärr hindrar oändlig reload-loop om chunken är borta för gott (t.ex.
// rollback) — då faller vi tillbaka på den branded felvyn i stället.

const RELOAD_GUARD_KEY = 'movexum:chunk-reload-at';
// Hur länge efter ett reload-försök vi avstår från att försöka igen.
const RELOAD_COOLDOWN_MS = 10_000;

/**
 * Avgör om ett fel är ett chunk-/asset-laddningsfel som ett reload kan läka.
 * Matchar både Error-objekt (render/import) och rå-strängar (event-meddelanden).
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;

  const name = typeof error === 'object' && error && 'name' in error ? String((error as { name?: unknown }).name ?? '') : '';
  const message =
    typeof error === 'string'
      ? error
      : typeof error === 'object' && error && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : String(error);

  if (name === 'ChunkLoadError') return true;

  return (
    /Loading chunk [^\s]+ failed/i.test(message) ||
    /Loading CSS chunk/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /importing a module script failed/i.test(message) ||
    // MIME-felet som uppstår när en saknad chunk serveras som HTML-felsida.
    /because its MIME type \('text\/html'\)/i.test(message)
  );
}

/**
 * Laddar om sidan en gång för att hämta de nya chunk-filerna. Returnerar
 * `true` om ett reload triggades, `false` om vi nyligen redan försökt (för
 * att inte hamna i en reload-loop när chunken är permanent borta).
 */
export function attemptChunkReload(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const now = Date.now();
    const last = Number(window.sessionStorage.getItem(RELOAD_GUARD_KEY) ?? '0');
    if (Number.isFinite(last) && now - last < RELOAD_COOLDOWN_MS) {
      // Vi laddade nyss om och felet kvarstår → chunken är borta för gott.
      // Avstå så att felgränsen kan visa den branded vyn i stället.
      return false;
    }
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(now));
  } catch {
    // sessionStorage kan vara blockerad (privat läge/iframe) — ladda ändå om,
    // men då utan loop-skydd. Ett enstaka extra reload är acceptabelt.
  }

  window.location.reload();
  return true;
}
