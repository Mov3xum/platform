// Pure (React-free, server-free) typer + validering för avtal och in-app
// signering (avancerad elektronisk signatur, eIDAS art. 25–26). Hålls
// dependency-fri så att klient-uppladdningsformuläret och den auktoritativa
// upload-routen delar exakt samma validering.

export type AgreementKind =
  | 'nda'
  | 'incubator_agreement'
  | 'ip_assignment'
  | 'addendum'
  | 'other';

export type AgreementStatus =
  | 'draft'
  | 'sent'
  | 'partially_signed'
  | 'signed'
  | 'expired'
  | 'terminated';

export type AgreementParty = 'company' | 'movexum';
export type SignatureMethod = 'aes' | 'bankid';

export const AGREEMENT_KIND_LABELS: Record<AgreementKind, string> = {
  nda: 'NDA',
  incubator_agreement: 'Inkubatoravtal',
  ip_assignment: 'IP-överlåtelse',
  addendum: 'Tillägg',
  other: 'Övrigt'
};

export const AGREEMENT_STATUS_LABELS: Record<AgreementStatus, string> = {
  draft: 'Utkast',
  sent: 'Skickat för signering',
  partially_signed: 'Delvis signerat',
  signed: 'Signerat',
  expired: 'Utgånget',
  terminated: 'Uppsagt'
};

export const AGREEMENT_PARTY_LABELS: Record<AgreementParty, string> = {
  company: 'Bolaget',
  movexum: 'Movexum'
};

// Avtals-PDF:er får bara vara just PDF (signeringen hashar bytes och vi
// förseglar en signatursida — speglar mimeTypes i migration 1700000010).
export const MAX_AGREEMENT_BYTES = 25 * 1024 * 1024; // 25 MB

export interface AgreementValidationInput {
  type: string;
  size: number;
  name?: string;
}

export type AgreementValidationResult = { ok: true } | { ok: false; error: string };

/** Validerar en uppladdad avtalsfil (PDF, ≤ 25 MB). */
export function validateAgreementFile(
  input: AgreementValidationInput
): AgreementValidationResult {
  const type = (input.type || '').toLowerCase();
  const ext = (() => {
    const n = input.name || '';
    const dot = n.lastIndexOf('.');
    return dot >= 0 ? n.slice(dot + 1).toLowerCase() : '';
  })();
  const isPdf = type === 'application/pdf' || ext === 'pdf';
  if (!isPdf) {
    return { ok: false, error: 'Endast PDF stöds för avtal.' };
  }
  if (input.size <= 0) {
    return { ok: false, error: 'Filen är tom.' };
  }
  if (input.size > MAX_AGREEMENT_BYTES) {
    return {
      ok: false,
      error: `Avtalsfilen får vara högst ${Math.round(MAX_AGREEMENT_BYTES / (1024 * 1024))} MB.`
    };
  }
  return { ok: true };
}

// Den bindande avsiktsförklaringen som signatären bekräftar. Versionera genom
// att lägga till en ny rad (gammalt bevis behåller sin egen text via
// agreement_signatures.intent_text).
export const SIGNATURE_INTENT_TEXT =
  'Jag har läst och godkänner avtalet och avser att binda mig juridiskt till det. ' +
  'Jag bekräftar att detta utgör min elektroniska underskrift.';

export interface AgreementSignature {
  id: string;
  tenant: string;
  agreement: string;
  startup: string;
  signer: string;
  party: AgreementParty;
  signer_name: string;
  signer_email?: string;
  document_hash: string;
  signed_at: string;
  ip_hash?: string;
  user_agent?: string;
  intent_text?: string;
  method: SignatureMethod;
  created?: string;
}

export interface Agreement {
  id: string;
  tenant?: string;
  startup: string;
  title: string;
  kind: AgreementKind;
  status: AgreementStatus;
  kind_label?: string;
  partner?: string;
  signed_at?: string;
  expires_at?: string;
  agreement_date?: string;
  file?: string;
  document_hash?: string;
  assigned_by?: string;
  assigned_to?: string;
  sent_at?: string;
  requires_company_signature?: boolean;
  requires_movexum_signature?: boolean;
  company_signed_at?: string;
  company_signed_by?: string;
  movexum_signed_at?: string;
  movexum_signed_by?: string;
  created?: string;
}
