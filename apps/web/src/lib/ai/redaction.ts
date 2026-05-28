/**
 * Ren, IO-fri PII-/åtkomstpolicy för AI-chattens generiska query-verktyg.
 *
 * Den här modulen är medvetet fri från `server-only`, PocketBase och
 * `@/`-importer så att policyn kan ENHETSTESTAS (CLAUDE.md § 9.3, § 10.2).
 * `lib/ai/schema.ts` återanvänder den — beteendet är oförändrat, men
 * regressioner i denylistan/maskningen fångas nu av `redaction.test.ts`
 * i stället för att upptäckas manuellt.
 *
 * Defense-in-depth: speglar svartlistan i `lib/ai/context.ts` så att
 * `query_collection`/`count_collection` aldrig kan kringgå den.
 */

/**
 * Kollektioner som ALDRIG exponeras för agentens generiska query-verktyg.
 * Auth-/token-tabeller, extern-PII (`contacts`), compass-besökardata,
 * mutations-/säkerhetsaudit, agent-minne, krypterade credentials samt
 * personliga innehållsytor (trådar, filer, djupjobb). Se § 9.3.
 */
export const COLLECTION_DENYLIST: ReadonlySet<string> = new Set<string>([
  'users',
  'tenants',
  'verification_tokens',
  'pending_signups',
  'contacts',
  'compass_leads',
  'compass_conversations',
  'compass_messages',
  'compass_responses',
  'compass_security_events',
  'agent_actions',
  'agent_memory',
  'tenant_integrations',
  'user_app_integrations',
  'user_mistral_connectors',
  // Personliga/innehållstunga kollektioner — aldrig exponerade för agenter.
  'chat_threads', // privat konversationsinnehåll (1700000083)
  'user_files', // personliga filer, strikt ägaren-bara (1700000085)
  'deep_jobs' // intern orkestrering (1700000084)
]);

/**
 * Fältnamn som auto-maskas i ALLA kollektioner (case-insensitiv substring).
 * Direkt-PII (e-post, telefon, personnummer), GDPR art. 9 särskild kategori
 * (gender/identifies_as), adress-PII (enskild firma), org-nr och visitor-
 * ip-hash. Speglar svartlistan i `lib/ai/context.ts` (§ 9.3, § 10.2).
 */
export const PII_FIELD_PATTERNS: readonly string[] = [
  'password',
  'tokenkey',
  'token_key',
  'email',
  'person_nr',
  'personnummer',
  'ssn',
  'phone',
  'telefon',
  'mobil',
  'avatar',
  // GDPR art. 9 — särskild kategori
  'gender',
  'identifies_as',
  // PII för enskild firma / pseudonymiserad PII
  'street_address',
  'postal_code',
  'org_nr',
  'ip_hash'
];

/** Är kollektionen helt utestängd från agentens query-verktyg? */
export function isDeniedCollection(name: string): boolean {
  return COLLECTION_DENYLIST.has(name);
}

/** Returnerar de fältnamn som ska maskas (matchar ett PII-mönster). */
export function autoMaskFields(fields: { name: string }[]): string[] {
  const masked: string[] = [];
  for (const f of fields) {
    const lower = f.name.toLowerCase();
    if (PII_FIELD_PATTERNS.some((p) => lower.includes(p))) {
      masked.push(f.name);
    }
  }
  return masked;
}

/**
 * Tar bort maskade fält ur en post innan den når modellen. Behåller
 * referensidentitet (samma objekt) när inget ska maskas — billigt no-op.
 */
export function maskRecord(
  record: Record<string, unknown>,
  collection: { maskedFields: readonly string[] }
): Record<string, unknown> {
  if (collection.maskedFields.length === 0) return record;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (collection.maskedFields.includes(k)) continue;
    out[k] = v;
  }
  return out;
}
