'use server';

import { revalidatePath } from 'next/cache';
import PocketBase from 'pocketbase';
import { getServerPb, getCurrentUser } from '@/lib/auth.server';
import { getServerPbUrl } from '@/lib/pb-url';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { escFilter } from '@/lib/pb-filter';
import { canManageStartupDeMinimis, loadRegelverk } from '@/lib/de-minimis/data';
import {
  kanBevilja,
  parseDateOnly,
  validateStodInput,
  type DeMinimisStod,
  type DeMinimisStodCalc,
  type DeMinimisUnit,
  type ForordningKod
} from '@platform/shared';

const PB_URL = getServerPbUrl();

export interface DeMinimisActionState {
  ok?: boolean;
  error?: string;
  warnings?: string[];
}

type PbErrorLike = { status?: number };

function statusOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    return (err as PbErrorLike).status;
  }
  return undefined;
}

// Superuser-fallback (samma mönster som lib/actions/education-documents.ts):
// skrivregeln är staff-only, men en länkad bolagsmedlem får hantera sitt eget
// bolags de minimis-data efter att behörigheten verifierats i koden.
async function getSuperuserPb(): Promise<PocketBase | null> {
  const email = process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_SU_EMAIL;
  const password = process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_SU_PASSWORD;
  if (!email || !password) {
    console.error('[de-minimis] superuser credentials missing');
    return null;
  }
  const pb = new PocketBase(PB_URL);
  pb.autoCancellation(false);
  try {
    await pb.collection('_superusers').authWithPassword(email, password);
    return pb;
  } catch {
    console.error('[de-minimis] superuser auth failed');
    return null;
  }
}

/** Kör en skrivning som den inloggade; faller tillbaka till superuser vid
 * 400/403 (rule-eval-quirk eller länkad medlem utan rule-behörighet). */
async function writeWithFallback<T>(
  pb: PocketBase,
  run: (client: PocketBase) => Promise<T>
): Promise<T> {
  try {
    return await run(pb);
  } catch (err) {
    const status = statusOf(err);
    if (status === 400 || status === 403) {
      const su = await getSuperuserPb();
      if (!su) throw err;
      return await run(su);
    }
    throw err;
  }
}

function revalidateFor(startupId: string) {
  revalidatePath('/de-minimis');
  revalidatePath(`/de-minimis/${startupId}`);
  revalidatePath(`/startups/${startupId}`);
}

// ─── Enheter (single undertaking) ────────────────────────────────────────────

export async function createUnitAction(
  startupId: string,
  namn: string
): Promise<DeMinimisActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  if (!startupId) return { error: 'Bolag saknas.' };
  if (!canManageStartupDeMinimis(user, startupId)) return { error: 'Åtkomst nekad.' };

  const trimmed = (namn || '').trim();
  if (!trimmed) return { error: 'Ange ett namn på enheten.' };

  const pb = await getServerPb();
  try {
    const startup = await pb
      .collection('startups')
      .getOne<{ tenant: string }>(startupId);
    if (String(startup.tenant) !== user.tenant) return { error: 'Åtkomst nekad.' };
  } catch {
    return { error: 'Bolaget hittades inte.' };
  }

  try {
    await writeWithFallback(pb, (client) =>
      client.collection(PB_COLLECTIONS.deMinimisUnits).create({
        tenant: user.tenant,
        startup: startupId,
        namn: trimmed.slice(0, 200),
        created_by: user.id
      })
    );
  } catch (err) {
    console.error('[de-minimis] createUnit failed', {
      tenant: user.tenant,
      error: err instanceof Error ? err.message : err
    });
    return { error: 'Kunde inte skapa enheten.' };
  }

  revalidateFor(startupId);
  return { ok: true };
}

export async function renameUnitAction(
  unitId: string,
  namn: string
): Promise<DeMinimisActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  const trimmed = (namn || '').trim();
  if (!trimmed) return { error: 'Ange ett namn på enheten.' };

  const pb = await getServerPb();
  let unit: DeMinimisUnit;
  try {
    unit = await pb.collection(PB_COLLECTIONS.deMinimisUnits).getOne<DeMinimisUnit>(unitId);
  } catch {
    return { error: 'Enheten hittades inte.' };
  }
  if (String(unit.tenant) !== user.tenant) return { error: 'Åtkomst nekad.' };
  if (!canManageStartupDeMinimis(user, String(unit.startup))) return { error: 'Åtkomst nekad.' };

  try {
    await writeWithFallback(pb, (client) =>
      client
        .collection(PB_COLLECTIONS.deMinimisUnits)
        .update(unitId, { namn: trimmed.slice(0, 200) })
    );
  } catch (err) {
    console.error('[de-minimis] renameUnit failed', {
      error: err instanceof Error ? err.message : err
    });
    return { error: 'Kunde inte byta namn.' };
  }

  revalidateFor(String(unit.startup));
  return { ok: true };
}

export async function deleteUnitAction(unitId: string): Promise<DeMinimisActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };

  const pb = await getServerPb();
  let unit: DeMinimisUnit;
  try {
    unit = await pb.collection(PB_COLLECTIONS.deMinimisUnits).getOne<DeMinimisUnit>(unitId);
  } catch {
    return { error: 'Enheten hittades inte.' };
  }
  if (String(unit.tenant) !== user.tenant) return { error: 'Åtkomst nekad.' };
  if (!canManageStartupDeMinimis(user, String(unit.startup))) return { error: 'Åtkomst nekad.' };

  try {
    // Cascade tar bort orgnr + stöd (cascadeDelete på unit-relationerna).
    await writeWithFallback(pb, (client) =>
      client.collection(PB_COLLECTIONS.deMinimisUnits).delete(unitId)
    );
  } catch (err) {
    console.error('[de-minimis] deleteUnit failed', {
      error: err instanceof Error ? err.message : err
    });
    return { error: 'Kunde inte ta bort enheten.' };
  }

  revalidateFor(String(unit.startup));
  return { ok: true };
}

// ─── Org.nr i en enhet ───────────────────────────────────────────────────────

export async function addUnitOrgnrAction(
  unitId: string,
  organisationsnummer: string
): Promise<DeMinimisActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  const orgnr = (organisationsnummer || '').trim();
  if (!orgnr) return { error: 'Ange ett organisationsnummer.' };
  if (orgnr.length > 32) return { error: 'Organisationsnumret är för långt.' };

  const pb = await getServerPb();
  let unit: DeMinimisUnit;
  try {
    unit = await pb.collection(PB_COLLECTIONS.deMinimisUnits).getOne<DeMinimisUnit>(unitId);
  } catch {
    return { error: 'Enheten hittades inte.' };
  }
  if (String(unit.tenant) !== user.tenant) return { error: 'Åtkomst nekad.' };
  if (!canManageStartupDeMinimis(user, String(unit.startup))) return { error: 'Åtkomst nekad.' };

  // Dubblettskydd (unique-index finns men ge ett vänligt fel).
  try {
    const existing = await pb
      .collection(PB_COLLECTIONS.deMinimisUnitOrgnr)
      .getFirstListItem(
        `unit = "${escFilter(unitId)}" && organisationsnummer = "${escFilter(orgnr)}"`
      )
      .catch(() => null);
    if (existing) return { error: 'Organisationsnumret finns redan på enheten.' };

    await writeWithFallback(pb, (client) =>
      client.collection(PB_COLLECTIONS.deMinimisUnitOrgnr).create({
        tenant: user.tenant,
        unit: unitId,
        organisationsnummer: orgnr
      })
    );
  } catch (err) {
    console.error('[de-minimis] addOrgnr failed', {
      error: err instanceof Error ? err.message : err
    });
    return { error: 'Kunde inte lägga till organisationsnumret.' };
  }

  revalidateFor(String(unit.startup));
  return { ok: true };
}

export async function removeUnitOrgnrAction(orgnrId: string): Promise<DeMinimisActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };

  const pb = await getServerPb();
  let row: { tenant: string; unit: string };
  try {
    row = await pb
      .collection(PB_COLLECTIONS.deMinimisUnitOrgnr)
      .getOne<{ tenant: string; unit: string }>(orgnrId);
  } catch {
    return { error: 'Posten hittades inte.' };
  }
  if (String(row.tenant) !== user.tenant) return { error: 'Åtkomst nekad.' };

  let startupId = '';
  try {
    const unit = await pb
      .collection(PB_COLLECTIONS.deMinimisUnits)
      .getOne<DeMinimisUnit>(String(row.unit));
    startupId = String(unit.startup);
    if (!canManageStartupDeMinimis(user, startupId)) return { error: 'Åtkomst nekad.' };
  } catch {
    return { error: 'Enheten hittades inte.' };
  }

  try {
    await writeWithFallback(pb, (client) =>
      client.collection(PB_COLLECTIONS.deMinimisUnitOrgnr).delete(orgnrId)
    );
  } catch (err) {
    console.error('[de-minimis] removeOrgnr failed', {
      error: err instanceof Error ? err.message : err
    });
    return { error: 'Kunde inte ta bort organisationsnumret.' };
  }

  revalidateFor(startupId);
  return { ok: true };
}

// ─── Stöd ────────────────────────────────────────────────────────────────────

function numOrUndef(value: FormDataEntryValue | null): number | undefined {
  if (value === null) return undefined;
  const s = String(value).replace(/\s/g, '').replace(',', '.');
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Registrera ett mottaget de minimis-stöd. Blockerar om posten skulle
 * överskrida förordningens tak eller det samlade taket (300 000 EUR).
 * Bakåtdaterade poster blockeras inte men returneras med varning.
 */
export async function addStodAction(formData: FormData): Promise<DeMinimisActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };

  const unitId = String(formData.get('unitId') || '');
  if (!unitId) return { error: 'Enhet saknas.' };

  const pb = await getServerPb();
  let unit: DeMinimisUnit;
  try {
    unit = await pb.collection(PB_COLLECTIONS.deMinimisUnits).getOne<DeMinimisUnit>(unitId);
  } catch {
    return { error: 'Enheten hittades inte.' };
  }
  if (String(unit.tenant) !== user.tenant) return { error: 'Åtkomst nekad.' };
  const startupId = String(unit.startup);
  if (!canManageStartupDeMinimis(user, startupId)) return { error: 'Åtkomst nekad.' };

  const forordning = String(formData.get('forordning') || '') as ForordningKod;
  const stodgivare = String(formData.get('stodgivare') || '').trim();
  const beslutsdatum = String(formData.get('beslutsdatum') || '').slice(0, 10);
  let belopp_eur = numOrUndef(formData.get('belopp_eur'));
  const belopp_sek = numOrUndef(formData.get('belopp_sek'));
  const valutakurs = numOrUndef(formData.get('valutakurs'));

  // Härled EUR ur SEK + kurs om EUR saknas (EUR förblir sanning).
  if ((belopp_eur === undefined || belopp_eur <= 0) && belopp_sek && valutakurs && valutakurs > 0) {
    belopp_eur = Math.round((belopp_sek / valutakurs) * 100) / 100;
  }

  const syfte = String(formData.get('syfte') || '').slice(0, 500);
  const beslut_referens = String(formData.get('beslut_referens') || '').slice(0, 200);
  const registrerad_i_eair = formData.get('registrerad_i_eair') === 'on' ||
    formData.get('registrerad_i_eair') === 'true';

  // Validering (ren logik).
  const validation = validateStodInput(
    {
      forordning,
      belopp_eur: belopp_eur ?? 0,
      beslutsdatum,
      stodgivare
    },
    {}
  );
  if (!validation.ok) return { error: validation.error };

  // Hämta befintliga stöd + regelverk och pröva mot taken.
  let existing: DeMinimisStod[] = [];
  try {
    existing = await pb
      .collection(PB_COLLECTIONS.deMinimisStod)
      .getFullList<DeMinimisStod>({
        filter: `unit = "${escFilter(unitId)}"`
      });
  } catch (err) {
    console.error('[de-minimis] load existing stöd failed', {
      error: err instanceof Error ? err.message : err
    });
  }

  const regelverk = await loadRegelverk(pb);
  const calcRows: DeMinimisStodCalc[] = existing.map((s) => ({
    forordning: s.forordning,
    belopp_eur: s.belopp_eur,
    beslutsdatum: s.beslutsdatum
  }));
  const beslut = parseDateOnly(beslutsdatum)!;
  const prov = kanBevilja(calcRows, regelverk, forordning, belopp_eur ?? 0, beslut);
  if (!prov.ok) {
    const delar: string[] = [];
    if (prov.overskridsForordningMed > 0) {
      delar.push(
        `förordningstaket (${prov.takForordning.toLocaleString('sv-SE')} EUR) med ` +
          `${prov.overskridsForordningMed.toLocaleString('sv-SE')} EUR`
      );
    }
    if (prov.overskridsSamlatMed > 0) {
      delar.push(
        `det samlade taket (300 000 EUR) med ${prov.overskridsSamlatMed.toLocaleString('sv-SE')} EUR`
      );
    }
    return {
      error: `Posten skulle överskrida ${delar.join(' och ')}. Registrering blockerad.`
    };
  }

  // Bakåtdaterings-varning (informativ).
  const latestExisting = existing
    .map((s) => s.beslutsdatum)
    .sort()
    .at(-1);
  const warnRes = validateStodInput(
    { forordning, belopp_eur: belopp_eur ?? 0, beslutsdatum, stodgivare },
    { latestExistingDate: latestExisting }
  );
  const warnings = warnRes.ok ? warnRes.warnings : [];

  // Bygg payload (inkl. valfri fil → SDK serialiserar till multipart).
  const payload: Record<string, unknown> = {
    tenant: user.tenant,
    startup: startupId,
    unit: unitId,
    forordning,
    stodgivare: stodgivare.slice(0, 200),
    beslutsdatum,
    belopp_eur,
    syfte,
    beslut_referens,
    registrerad_i_eair,
    created_by: user.id
  };
  if (belopp_sek !== undefined) payload.belopp_sek = belopp_sek;
  if (valutakurs !== undefined) payload.valutakurs = valutakurs;
  const dokument = formData.get('dokument');
  if (dokument instanceof File && dokument.size > 0) {
    payload.dokument = dokument;
  }

  try {
    await writeWithFallback(pb, (client) =>
      client.collection(PB_COLLECTIONS.deMinimisStod).create(payload)
    );
  } catch (err) {
    console.error('[de-minimis] addStöd failed', {
      tenant: user.tenant,
      error: err instanceof Error ? err.message : err
    });
    return { error: 'Kunde inte registrera stödet.' };
  }

  revalidateFor(startupId);
  return { ok: true, warnings };
}

export async function deleteStodAction(stodId: string): Promise<DeMinimisActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };

  const pb = await getServerPb();
  let row: DeMinimisStod;
  try {
    row = await pb.collection(PB_COLLECTIONS.deMinimisStod).getOne<DeMinimisStod>(stodId);
  } catch {
    return { error: 'Posten hittades inte.' };
  }
  if (String(row.tenant) !== user.tenant) return { error: 'Åtkomst nekad.' };
  if (!canManageStartupDeMinimis(user, String(row.startup))) return { error: 'Åtkomst nekad.' };

  try {
    await writeWithFallback(pb, (client) =>
      client.collection(PB_COLLECTIONS.deMinimisStod).delete(stodId)
    );
  } catch (err) {
    console.error('[de-minimis] deleteStöd failed', {
      error: err instanceof Error ? err.message : err
    });
    return { error: 'Kunde inte ta bort posten.' };
  }

  revalidateFor(String(row.startup));
  return { ok: true };
}
