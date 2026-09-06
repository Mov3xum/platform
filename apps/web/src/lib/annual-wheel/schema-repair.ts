import 'server-only';
import type PocketBase from 'pocketbase';
import { ANNUAL_WHEEL_TAG_IDS } from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';

/**
 * Självreparation av årshjulets schema (CLAUDE.md § 30).
 *
 * Bakgrund: web-appen deployas oftare än PocketBase-containern, och
 * migrationerna 1700000138–1700000141 (day, tags, responsible, kategori som
 * text, end_month/end_day) körs BARA när PB-imagen byggs om. Däremellan
 * släpper PocketBase okända fält tyst (datumet "sparas" men försvinner) och
 * avvisar nya kategorier ("category: Invalid value projekt") eftersom fältet
 * fortfarande är ett select. Samma mönster som workshops-bildfältet
 * (`ensureImageFieldExists` i lib/actions/workshops.ts): hellre reparera via
 * superuser — idempotent och byte-för-byte lika migrationerna — än att be
 * användaren omdistribuera backenden mitt i arbetet.
 *
 * Reparationen är:
 *   • idempotent (kör om utan effekt när schemat redan stämmer),
 *   • datasäker: kategori-konverteringen snapshottar värdena, byter fält och
 *     skriver tillbaka dem rad för rad (REST kan inte byta fälttyp in-place →
 *     drop+add, precis som migrationens skyddsnät),
 *   • cachad i processen (10 min) så normala sparningar inte kostar en extra
 *     rundtur,
 *   • fail-soft: saknas superuser-credentials rapporteras driften i stället.
 *
 * Riskklass n/a — ingen AI, ingen PII (schemat, inte innehållet).
 */

const COLLECTION = 'annual_wheel_items';
const HEALTHY_TTL_MS = 10 * 60 * 1000;

const TAG_VALUES = [...ANNUAL_WHEEL_TAG_IDS];

interface PbField {
  id?: string;
  name?: string;
  type?: string;
  required?: boolean;
  values?: string[];
  maxSelect?: number;
  [key: string]: unknown;
}

interface PbCollection {
  id: string;
  name: string;
  fields?: PbField[];
}

export interface AnnualWheelSchemaDrift {
  /** Fält som saknas helt (day, end_month, end_day, tags, responsible). */
  missingFields: string[];
  /** Deprecerade `track` är fortfarande obligatoriskt → varje create 400:ar. */
  trackRequired: boolean;
  /** `category` är fortfarande select → nya kategorier avvisas. */
  categoryIsSelect: boolean;
  /** Taggvärden som saknas i select-listan (marknadskanalerna). */
  missingTagValues: string[];
}

export function hasAnnualWheelSchemaDrift(d: AnnualWheelSchemaDrift): boolean {
  return (
    d.missingFields.length > 0 ||
    d.trackRequired ||
    d.categoryIsSelect ||
    d.missingTagValues.length > 0
  );
}

/** Läsbar sammanfattning av driften (PII-fri). */
export function describeAnnualWheelDrift(d: AnnualWheelSchemaDrift): string {
  const parts: string[] = [];
  if (d.missingFields.length > 0) parts.push(`saknar fälten ${d.missingFields.join(', ')}`);
  if (d.trackRequired) parts.push('deprecerade "track" är fortfarande obligatoriskt');
  if (d.categoryIsSelect) parts.push('"category" är fortfarande en fast lista (select)');
  if (d.missingTagValues.length > 0) parts.push(`saknar taggarna ${d.missingTagValues.join(', ')}`);
  return parts.join('; ');
}

const REQUIRED_FIELD_SPECS = (usersCollectionId: string): PbField[] => [
  { name: 'day', type: 'number', required: false, onlyInt: true, min: 1, max: 31 },
  { name: 'end_month', type: 'number', required: false, onlyInt: true, min: 1, max: 12 },
  { name: 'end_day', type: 'number', required: false, onlyInt: true, min: 1, max: 31 },
  { name: 'tags', type: 'select', required: false, maxSelect: TAG_VALUES.length, values: TAG_VALUES },
  {
    name: 'responsible',
    type: 'relation',
    required: false,
    collectionId: usersCollectionId,
    cascadeDelete: false,
    minSelect: 0,
    maxSelect: 1
  }
];

function inspectFields(fields: PbField[]): AnnualWheelSchemaDrift {
  const byName = new Map(fields.map((f) => [f.name, f]));
  const wanted = ['day', 'end_month', 'end_day', 'tags', 'responsible'];
  const track = byName.get('track');
  const category = byName.get('category');
  const tags = byName.get('tags');
  const present = new Set(Array.isArray(tags?.values) ? tags!.values : []);
  return {
    missingFields: wanted.filter((f) => !byName.has(f)),
    trackRequired: !!track && !!track.required,
    categoryIsSelect: !!category && category.type === 'select',
    missingTagValues: tags ? TAG_VALUES.filter((v) => !present.has(v)) : []
  };
}

/** Läser schemat (superuser) och rapporterar driften. null = kollektionen saknas/oåtkomlig. */
export async function inspectAnnualWheelSchema(
  su: PocketBase
): Promise<AnnualWheelSchemaDrift | null> {
  try {
    const coll = (await su.collections.getOne(COLLECTION)) as unknown as PbCollection;
    return inspectFields(Array.isArray(coll.fields) ? coll.fields : []);
  } catch {
    return null;
  }
}

export interface AnnualWheelSchemaRepairResult {
  ok: boolean;
  /** Vad som faktiskt ändrades (tomt = inget behövde göras). */
  repaired: string[];
  /** Kategorier som skrevs tillbaka efter select→text-konverteringen. */
  restoredCategories: number;
  /** Rader vars kategori inte kunde återställas (visas som fallback i UI:t). */
  failedCategories: number;
  error?: string;
}

/**
 * Reparerar schemat till migrationernas facit. Returnerar vad som ändrades.
 * Anropas bara efter att `inspectAnnualWheelSchema` visat drift.
 */
export async function repairAnnualWheelSchema(
  su: PocketBase
): Promise<AnnualWheelSchemaRepairResult> {
  const repaired: string[] = [];
  let restoredCategories = 0;
  let failedCategories = 0;

  let coll: PbCollection;
  try {
    coll = (await su.collections.getOne(COLLECTION)) as unknown as PbCollection;
  } catch (err) {
    return {
      ok: false,
      repaired,
      restoredCategories,
      failedCategories,
      error: `Kollektionen ${COLLECTION} kunde inte läsas: ${errMessage(err)}`
    };
  }
  const drift = inspectFields(Array.isArray(coll.fields) ? coll.fields : []);
  if (!hasAnnualWheelSchemaDrift(drift)) {
    return { ok: true, repaired, restoredCategories, failedCategories };
  }

  let usersId = '';
  if (drift.missingFields.includes('responsible')) {
    try {
      usersId = (await su.collections.getOne('users')).id;
    } catch {
      /* relation-fältet hoppas över nedan om users inte kan slås upp */
    }
  }

  const fields: PbField[] = [...(coll.fields ?? [])];

  // 1) Saknade fält (byte-för-byte som migrationerna/setup-via-api).
  for (const spec of REQUIRED_FIELD_SPECS(usersId)) {
    if (!drift.missingFields.includes(spec.name as string)) continue;
    if (spec.name === 'responsible' && !usersId) continue;
    fields.push({ ...spec });
    repaired.push(`+${spec.name}`);
  }

  // 2) track valfritt.
  const track = fields.find((f) => f.name === 'track');
  if (track && track.required) {
    track.required = false;
    repaired.push('track valfritt');
  }

  // 3) Taggvärden = union (aldrig ersätt — befintliga rader måste förbli giltiga).
  const tags = fields.find((f) => f.name === 'tags');
  if (tags && drift.missingTagValues.length > 0) {
    const merged = [...(tags.values ?? [])];
    for (const v of TAG_VALUES) if (!merged.includes(v)) merged.push(v);
    tags.values = merged;
    tags.maxSelect = merged.length;
    repaired.push(`tags +${drift.missingTagValues.join(',')}`);
  }

  // 4) category select → text. REST kan inte byta typ in-place
  //    (validation_field_type_change), så: snapshot → drop+add → återställ.
  let categorySnapshot: { id: string; category: string }[] = [];
  const categoryIdx = fields.findIndex((f) => f.name === 'category');
  if (drift.categoryIsSelect && categoryIdx !== -1) {
    try {
      const rows = await su
        .collection(COLLECTION)
        .getFullList<{ id: string; category?: string }>({ fields: 'id,category', batch: 500 });
      categorySnapshot = rows
        .filter((r) => typeof r.category === 'string' && r.category)
        .map((r) => ({ id: r.id, category: r.category as string }));
    } catch (err) {
      return {
        ok: false,
        repaired,
        restoredCategories,
        failedCategories,
        error: `Kunde inte snapshotta kategorier före konvertering: ${errMessage(err)}`
      };
    }
    // Nytt fält utan id → drop+add. Samma definition som migration 1700000140.
    fields.splice(categoryIdx, 1, {
      name: 'category',
      type: 'text',
      required: true,
      min: 1,
      max: 40
    });
    repaired.push('category → text');
  }

  try {
    await su.collections.update(coll.id, { fields });
  } catch (err) {
    return {
      ok: false,
      repaired: [],
      restoredCategories,
      failedCategories,
      error: `Schemauppdateringen avvisades av PocketBase: ${errMessage(err)}`
    };
  }

  // 5) Skriv tillbaka kategorierna rad för rad.
  for (const snap of categorySnapshot) {
    try {
      await su.collection(COLLECTION).update(snap.id, { category: snap.category });
      restoredCategories++;
    } catch {
      failedCategories++;
    }
  }

  console.warn('[arshjul] schema repaired via superuser (stale deploy)', {
    repaired,
    restoredCategories,
    failedCategories
  });
  healthyUntil = Date.now() + HEALTHY_TTL_MS;
  return { ok: true, repaired, restoredCategories, failedCategories };
}

let healthyUntil = 0;

export type EnsureSchemaOutcome =
  | { status: 'healthy' }
  | { status: 'repaired'; result: AnnualWheelSchemaRepairResult }
  | { status: 'drift_unrepairable'; drift: AnnualWheelSchemaDrift; reason: string }
  | { status: 'unknown' };

/**
 * Säkerställer att schemat är friskt: inspekterar (cachat 10 min när friskt)
 * och reparerar vid drift. Utan superuser-credentials returneras driften så
 * anroparen kan visa en tydlig instruktion i stället.
 */
export async function ensureAnnualWheelSchema(options: { force?: boolean } = {}): Promise<EnsureSchemaOutcome> {
  if (!options.force && Date.now() < healthyUntil) return { status: 'healthy' };
  const su = await getSuperuserPb();
  if (!su.ok) return { status: 'unknown' };

  const drift = await inspectAnnualWheelSchema(su.pb);
  if (!drift) return { status: 'unknown' };
  if (!hasAnnualWheelSchemaDrift(drift)) {
    healthyUntil = Date.now() + HEALTHY_TTL_MS;
    return { status: 'healthy' };
  }
  const result = await repairAnnualWheelSchema(su.pb);
  if (!result.ok) {
    return {
      status: 'drift_unrepairable',
      drift,
      reason: result.error ?? 'okänt fel'
    };
  }
  return { status: 'repaired', result };
}

/** Text till UI:t när driften inte kunde repareras automatiskt. */
export function unrepairableDriftMessage(drift: AnnualWheelSchemaDrift, reason: string): string {
  return (
    `Databasschemat för årshjulet är inte uppdaterat (${describeAnnualWheelDrift(drift)}) ` +
    `och kunde inte repareras automatiskt: ${reason}. Kör migrationerna (omdistribuera ` +
    'PocketBase) eller `node backend/pocketbase-schema/scripts/setup-via-api.mjs`.'
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err ?? 'okänt fel');
}
