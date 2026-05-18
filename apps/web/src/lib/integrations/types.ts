import 'server-only';

// The shape every provider must produce. Keeping it minimal +
// generic means the UI renders any provider without bespoke code,
// and CLAUDE.md § 10.2 data-minimisation is easy to audit: each
// provider explicitly chooses what (whitelisted) fields go into
// `payload`.
export interface NormalizedRecord {
  externalId: string;
  recordType: string;
  title: string;
  summary: string;
  url: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface CredentialField {
  key: string;
  label: string;
  type: 'password' | 'text';
  help?: string;
  required?: boolean;
}

export interface TestConnectionResult {
  ok: boolean;
  error?: string;
}

export interface SyncContext {
  tenantId: string;
  tenantIntegrationId: string;
}

export interface IntegrationHandler {
  slug: string;
  credentialFields: CredentialField[];
  // Compliance metadata surfaced in the UI banner.
  residency: string;
  riskClass: 'minimal' | 'limited' | 'high';
  complianceNote: string;
  testConnection(creds: Record<string, string>): Promise<TestConnectionResult>;
  sync(
    creds: Record<string, string>,
    ctx: SyncContext
  ): Promise<NormalizedRecord[]>;
}

export interface SyncResult {
  runId: string;
  status: 'success' | 'failed' | 'partial';
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  errorMessage?: string;
  durationMs: number;
}
