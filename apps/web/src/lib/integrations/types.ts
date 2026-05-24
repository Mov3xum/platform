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

// Result returned by company_registry-providers (Allabolag and similar).
// They bypass integration_records and write directly to startups +
// startup_financials per CLAUDE.md § 11.7 punkt 3, so the orchestrator
// gets a count summary back instead of NormalizedRecord[].
export interface RegistrySyncResult {
  startupsUpdated: number;
  financialsUpserted: number;
  skipped: number;
  perStartupErrors?: Array<{ startupId: string; error: string }>;
}

// Discriminated union: 'records' providers produce NormalizedRecord[]
// that the orchestrator upserts into integration_records. 'company_registry'
// providers write directly to domain collections and return aggregate counts.
interface BaseIntegrationHandler {
  slug: string;
  credentialFields: CredentialField[];
  // Compliance metadata surfaced in the UI banner.
  residency: string;
  riskClass: 'minimal' | 'limited' | 'high';
  complianceNote: string;
  testConnection(creds: Record<string, string>): Promise<TestConnectionResult>;
}

export interface RecordsHandler extends BaseIntegrationHandler {
  kind?: 'records';
  sync(
    creds: Record<string, string>,
    ctx: SyncContext
  ): Promise<NormalizedRecord[]>;
}

export interface CompanyRegistryHandler extends BaseIntegrationHandler {
  kind: 'company_registry';
  syncRegistry(
    creds: Record<string, string>,
    ctx: SyncContext
  ): Promise<RegistrySyncResult>;
  // Per-startup variant — same provider call, scoped to a single
  // startup id. Used by the "Synka från Allabolag"-knapp on the
  // startup detail page.
  syncSingleStartup(
    creds: Record<string, string>,
    ctx: SyncContext,
    startupId: string
  ): Promise<RegistrySyncResult>;
}

export type IntegrationHandler = RecordsHandler | CompanyRegistryHandler;

export interface SyncResult {
  runId: string;
  status: 'success' | 'failed' | 'partial';
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  errorMessage?: string;
  durationMs: number;
}
