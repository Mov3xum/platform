// REN modul (ingen IO): hur ett avvisat token-anrop (OAuth2 client
// credentials, § 11.8) beskrivs för personalen. Leverantörens svar bär en
// OAuth-felkod (`invalid_client`, `invalid_request`, `unsupported_grant_type`
// …) som skiljer "fel nyckelpar" från "fel på begäran" — utan den såg båda
// ut som avvisade nycklar (incident 2026-10-13). Bara KODEN tas med: aldrig
// `error_description` (kan bära klient-id) och aldrig hemligheten.

const OAUTH_ERROR_CODE = /^[a-z][a-z0-9_]{2,39}$/;

/** Plockar OAuth-felkoden ur ett token-svar (`{ error: "invalid_client" }`), annars null. */
export function parseOAuthErrorCode(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const raw = (body as { error?: unknown }).error;
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toLowerCase();
  return OAUTH_ERROR_CODE.test(code) ? code : null;
}

/** Felkoder som betyder att själva nyckelparet är fel (inte begäran). */
const CREDENTIAL_CODES = new Set(['invalid_client', 'unauthorized_client', 'access_denied']);

export interface TokenFailureDescription {
  /** Sant när leverantören avvisade nyckelparet (inte formatet på begäran). */
  credentialsRejected: boolean;
  message: string;
}

const RECHECK_HINT =
  'Kontrollera Client ID och client secret under Inställningar → Integrationer → Byt nycklar — en secret som regenererats i leverantörens portal gör den sparade ogiltig.';

/**
 * Beskriver ett misslyckat token-anrop. 401 (eller 400 med en nyckelparskod
 * som `invalid_client`) = nycklarna avvisades; annat 400 = begäran avvisades
 * (fel grant/scope/format — inte nycklarna); övrigt = HTTP-status.
 */
export function describeTokenFailure(status: number, code: string | null): TokenFailureDescription {
  const suffix = code ? `HTTP ${status}, ${code}` : `HTTP ${status}`;
  if (status === 401 || (status === 400 && code !== null && CREDENTIAL_CODES.has(code))) {
    return {
      credentialsRejected: true,
      message: `Klient-id/klienthemlighet avvisades av leverantören (${suffix}). ${RECHECK_HINT}`
    };
  }
  if (status === 400) {
    return {
      credentialsRejected: false,
      message: `Token-begäran avvisades av leverantören (${suffix}) — leverantören godtog inte begärans format (grant/scope), inte nödvändigtvis nycklarna.`
    };
  }
  if (status === 403) {
    return {
      credentialsRejected: false,
      message: `Token-endpointen nekade åtkomst (${suffix}) — applikationen kan vara blockerad eller sakna prenumeration hos leverantören.`
    };
  }
  return { credentialsRejected: false, message: `Token-endpointen svarade ${suffix}.` };
}
