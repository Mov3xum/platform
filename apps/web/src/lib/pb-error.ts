/**
 * Läsbara PocketBase-fel (ren modul, inga server-imports — enhetstestad).
 *
 * SDK:ns `err.message` är ALLTID den generiska "Failed to create record." —
 * de användbara detaljerna ligger i `response.data` per fält (t.ex.
 * `{ file: { code: 'validation_invalid_mime_type', message: '…' } }`).
 * Utan den här översättningen blir varje misslyckad skrivning ett
 * odiagnostiserbart "Failed to create record." i UI:t (symtomet på /filer,
 * /arshjul m.fl.). Delas av alla skrivvägar så att ingen divergerande kopia
 * uppstår (§ 16-principen).
 */

interface PbFieldError {
  code?: string;
  message?: string;
}

/** HTTP-status ur ett SDK-fel (ClientResponseError), annars undefined. */
export function pbStatus(err: unknown): number | undefined {
  const s = (err as { status?: unknown })?.status;
  return typeof s === 'number' ? s : undefined;
}

/** Fältnycklar PocketBase klagade på, t.ex. `{ file: 'Invalid mime type.' }`. */
export function pbFieldErrors(err: unknown): Record<string, string> {
  const direct = (err as { response?: { data?: unknown } })?.response?.data as
    | Record<string, PbFieldError>
    | undefined;
  const nested = (err as { data?: { data?: unknown } })?.data?.data as
    | Record<string, PbFieldError>
    | undefined;
  const source = nested ?? direct;
  if (!source || typeof source !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [field, detail] of Object.entries(source)) {
    if (!detail || typeof detail !== 'object') continue;
    const message = typeof detail.message === 'string' ? detail.message : undefined;
    const code = typeof detail.code === 'string' ? detail.code : undefined;
    if (message) out[field] = message;
    else if (code) out[field] = code;
  }
  return out;
}

/** Fältkoder (t.ex. `validation_invalid_mime_type`) per fält. */
export function pbFieldCodes(err: unknown): Record<string, string> {
  const direct = (err as { response?: { data?: unknown } })?.response?.data as
    | Record<string, PbFieldError>
    | undefined;
  const nested = (err as { data?: { data?: unknown } })?.data?.data as
    | Record<string, PbFieldError>
    | undefined;
  const source = nested ?? direct;
  if (!source || typeof source !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [field, detail] of Object.entries(source)) {
    if (detail && typeof detail === 'object' && typeof detail.code === 'string') {
      out[field] = detail.code;
    }
  }
  return out;
}

const GENERIC_SDK_MESSAGE = /^Failed to (create|update|delete|fetch|load) (record|records)\.?$/i;

/**
 * PocketBase-fel som EN läsbar mening: `fallback` (svensk text) när SDK:t bara
 * gav sitt generiska engelska meddelande, plus PB:s fältdetaljer i parentes
 * när de finns — det är fältdetaljerna som faktiskt förklarar felet.
 */
export function describePbError(err: unknown, fallback: string): string {
  const fields = pbFieldErrors(err);
  const parts = Object.entries(fields).map(([field, message]) => `${field}: ${message}`);
  const raw = err instanceof Error && err.message ? err.message : '';
  const generic = !raw || GENERIC_SDK_MESSAGE.test(raw.trim());
  const base = generic ? fallback : raw;
  return parts.length > 0 ? `${base} (${parts.join('; ')})` : base;
}
