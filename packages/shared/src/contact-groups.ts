// Grupper i kontaktboken (CLAUDE.md § 45.8) — ren, IO-fri logik.
//
// En grupp är en namngiven lista som personalen själv skapar ("Frukostgänget",
// "Investerare Gävleborg") utöver de fasta kategorierna. Medlemskapet ligger
// på kontakten (`contacts.groups`, multi-relation), så en kontakt kan finnas i
// flera grupper och en raderad grupp tas bort från kontakterna av PocketBase.
// Gruppen bär inga personuppgifter — bara namn och beskrivning.

/** Max antal grupper per kontakt (relationsfältets maxSelect). */
export const CONTACT_GROUP_MAX_PER_CONTACT = 50;
/** Max antal kontakter som läggs till/tas bort i ett anrop. */
export const CONTACT_GROUP_MAX_BULK = 500;
export const CONTACT_GROUP_NAME_MAX = 80;
export const CONTACT_GROUP_DESCRIPTION_MAX = 300;

const ID = /^[a-zA-Z0-9_-]{1,64}$/;

export function isContactGroupId(v: unknown): v is string {
  return typeof v === 'string' && ID.test(v);
}

/** Jämförelsenyckel för gruppnamn: skiftläge och blanksteg spelar ingen roll. */
export function contactGroupNameKey(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLocaleLowerCase('sv-SE');
}

export type ContactGroupInput = { name: string; description: string };

/**
 * Validerar namn och beskrivning. Namnet måste vara unikt i tenanten
 * (skiftlägesokänsligt) — `existingNames` är de ANDRA gruppernas namn.
 */
export function validateContactGroupInput(
  raw: { name?: unknown; description?: unknown },
  existingNames: readonly string[] = []
): { ok: true; value: ContactGroupInput } | { ok: false; error: string } {
  const name = typeof raw.name === 'string' ? raw.name.replace(/\s+/g, ' ').trim() : '';
  if (!name) return { ok: false, error: 'Ge gruppen ett namn.' };
  if (name.length > CONTACT_GROUP_NAME_MAX) return { ok: false, error: `Namnet får vara högst ${CONTACT_GROUP_NAME_MAX} tecken.` };
  const description = typeof raw.description === 'string' ? raw.description.replace(/\s+/g, ' ').trim() : '';
  if (description.length > CONTACT_GROUP_DESCRIPTION_MAX) {
    return { ok: false, error: `Beskrivningen får vara högst ${CONTACT_GROUP_DESCRIPTION_MAX} tecken.` };
  }
  const key = contactGroupNameKey(name);
  if (existingNames.some((n) => contactGroupNameKey(n) === key)) {
    return { ok: false, error: `Det finns redan en grupp som heter "${name}".` };
  }
  return { ok: true, value: { name, description } };
}

/**
 * En kontakts nya grupplista efter att `add` lagts till och `remove` tagits
 * bort. Behåller ordningen, utan dubbletter; `null` när taket skulle passeras.
 */
export function nextContactGroups(
  current: readonly string[],
  change: { add?: readonly string[]; remove?: readonly string[] }
): string[] | null {
  const remove = new Set(change.remove ?? []);
  const next = current.filter((id) => !remove.has(id));
  for (const id of change.add ?? []) if (!next.includes(id)) next.push(id);
  const unique = [...new Set(next)];
  return unique.length > CONTACT_GROUP_MAX_PER_CONTACT ? null : unique;
}

export function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}
