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
  // Resterande compass-kollektioner (intake-design/lookup) — besökar-/intag-
  // data hör aldrig hemma i AI-kontext (§ 9.3, § 23.4).
  'compass_lead_sources',
  'compass_modules',
  'compass_questions',
  'agent_actions',
  'agent_memory',
  'tenant_integrations',
  'user_app_integrations',
  'user_mistral_connectors',
  // Globala referens-/katalogkollektioner utan tenant-scope. De saknar
  // tenant-relation → `composeFilter` skulle inte lägga någon tenant-klausul
  // (cross-tenant-läsning). De innehåller ingen PII men ska inte mata agenten
  // (säkerhetsgranskning 2026-06, M12). Övriga null-tenant-kollektioner blockas
  // dessutom deny-by-default i `schema.ts` (GLOBAL_REFERENCE_ALLOWLIST).
  'web_cache',
  'integration_providers',
  // Personliga/innehållstunga kollektioner — aldrig exponerade för agenter.
  'chat_threads', // privat konversationsinnehåll (1700000083)
  'user_files', // personliga filer, strikt ägaren-bara (1700000085)
  'deep_jobs', // intern orkestrering (1700000084)
  // De minimis-modul (1700000093–095) — fristående efterlevnadsverktyg, inte
  // underlag för AI-resonemang. `de_minimis_unit_orgnr.organisationsnummer`
  // kan motsvara personnummer för enskild firma → hålls helt utanför AI.
  'de_minimis_units',
  'de_minimis_unit_orgnr',
  'de_minimis_stod',
  'de_minimis_regelverk',
  'agreement_signatures' // signeringsbevis: signer_email + ip_hash (1700000094)
]);

/**
 * Globala referenskollektioner UTAN tenant-relation som ändå uttryckligen får
 * exponeras för agenten (deny-by-default-undantag, säkerhetsgranskning 2026-06
 * H2). Tom som default — varje post måste vara medvetet vettad: den får inte
 * innehålla PII och dess innehåll måste vara identiskt för alla tenants.
 */
export const GLOBAL_REFERENCE_ALLOWLIST: ReadonlySet<string> = new Set<string>([]);

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

/** Matchar ett fältnamn ett PII-mönster (case-insensitiv substring)? */
export function fieldNameIsPII(name: string): boolean {
  const lower = name.toLowerCase();
  return PII_FIELD_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Rekursiv PII-maskning över HELA objektträdet (säkerhetsgranskning 2026-06,
 * H1). `maskRecord` tar bara bort topp-nivåfält i den frågade kollektionen,
 * men `query_collection` stödjer `expand` → PocketBase lägger relaterade
 * poster under `item.expand.<relation>`, som annars returneras OMASKERADE.
 * Den här funktionen sveper varje nyckel på varje djup och tar bort de som
 * matchar ett PII-mönster, oavsett nivå. Defense-in-depth ovanpå denylist +
 * `maskRecord`. Returnerar en ny struktur (muterar inte indata).
 */
export function deepMaskPII(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepMaskPII);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (fieldNameIsPII(k)) continue;
      out[k] = deepMaskPII(v);
    }
    return out;
  }
  return value;
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
