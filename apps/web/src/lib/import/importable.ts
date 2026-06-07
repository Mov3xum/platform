import 'server-only';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { COLLECTION_DENYLIST, autoMaskFields } from '@/lib/ai/redaction';

// Introspekterar PocketBase-schemat och returnerar de kollektioner man får
// importera Excel-data TILL via den generella importsidan (/admin/import-crm).
//
// Policy (CLAUDE.md § 9.3 / § 21): "alla kollektioner UTOM den hårda
// denylistan" (users, secrets, privata trådar m.m.). System-/vy-kollektioner
// kan aldrig skrivas till och utesluts också. Skrivningen sker via superuser
// men varje rad tenant-stämplas (se import-general.ts) så tenant-isoleringen
// bevaras.

export interface ImportField {
  name: string;
  type: string;
  required: boolean;
  /** Giltiga värden för select-fält. */
  values?: string[];
  /** >1 = multi-select / multi-relation. */
  maxSelect?: number;
  /** För relation-fält: målkollektionens namn (om läsbar). */
  relationCollection?: string;
  /** Sant om fältet matchar ett PII-mönster (visas som varning i UI). */
  pii: boolean;
}

export interface ImportCollection {
  name: string;
  /** Mappbara fält (exkl. id, autodate och tenant — tenant stämplas auto). */
  fields: ImportField[];
  /** Sant om kollektionen har en direkt `tenant`-relation som ska stämplas. */
  hasTenant: boolean;
}

interface RawField {
  name: string;
  type: string;
  required?: boolean;
  system?: boolean;
  hidden?: boolean;
  collectionId?: string;
  maxSelect?: number;
  values?: string[];
}
interface RawCollection {
  id: string;
  name: string;
  type: string;
  system: boolean;
  fields?: RawField[];
  schema?: RawField[];
}

function rawFields(c: RawCollection): RawField[] {
  return c.fields ?? c.schema ?? [];
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { collections: ImportCollection[]; expires: number } | null = null;

export async function listImportableCollections(): Promise<ImportCollection[]> {
  const now = Date.now();
  if (cache && cache.expires > now) return cache.collections;

  const su = await getSuperuserPb();
  if (!su.ok) return [];

  let raw: RawCollection[];
  try {
    raw = (await su.pb.collections.getFullList()) as unknown as RawCollection[];
  } catch {
    return [];
  }

  const byId = new Map(raw.map((c) => [c.id, c]));
  const nameOf = (id?: string): string | undefined =>
    id ? byId.get(id)?.name : undefined;

  const out: ImportCollection[] = [];
  for (const c of raw) {
    if (c.system) continue;
    if (c.name.startsWith('_')) continue;
    if (c.type !== 'base') continue; // vyer kan inte skrivas till
    if (COLLECTION_DENYLIST.has(c.name)) continue;

    const fields = rawFields(c);
    const masked = new Set(autoMaskFields(fields));
    let hasTenant = false;
    const mappable: ImportField[] = [];

    for (const f of fields) {
      if (f.name === 'id') continue;
      if (f.system) continue;
      if (f.type === 'autodate') continue; // created/updated — auto-managed
      if (f.type === 'file') continue; // filuppladdning stöds inte via Excel
      if (f.name === 'tenant' && f.type === 'relation') {
        hasTenant = true;
        continue; // tenant stämplas automatiskt, mappas aldrig manuellt
      }
      mappable.push({
        name: f.name,
        type: f.type,
        required: Boolean(f.required),
        ...(Array.isArray(f.values) && f.values.length > 0 ? { values: f.values } : {}),
        ...(typeof f.maxSelect === 'number' ? { maxSelect: f.maxSelect } : {}),
        ...(f.type === 'relation' ? { relationCollection: nameOf(f.collectionId) } : {}),
        pii: masked.has(f.name)
      });
    }

    out.push({ name: c.name, fields: mappable, hasTenant });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  cache = { collections: out, expires: now + CACHE_TTL_MS };
  return out;
}
