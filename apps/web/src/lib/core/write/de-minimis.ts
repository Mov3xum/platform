import 'server-only';
import type PocketBase from 'pocketbase';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { escFilter } from '@/lib/pb-filter';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { loadRegelverk } from '@/lib/de-minimis/data';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';
import {
  kanBevilja,
  parseDateOnly,
  validateStodInput,
  type DeMinimisStod,
  type DeMinimisStodCalc,
  type DeMinimisUnit,
  type ForordningKod
} from '@platform/shared';
import { canCreateRecord } from './writable-fields';
import { logAgentAction } from './audit';
import { validateNonEmptyText, validateOptionalText } from './validators';
import { getRecordInTenant, writeWithFallback } from './helpers';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * De minimis-registrering via chatten (§ 20, § 33). Samma spärrar som UI:t:
 * `kanBevilja` prövar posten mot förordningens tak OCH det samlade taket
 * (300 000 EUR) INNAN något skrivs — taket kan aldrig rundas via chatten.
 * Enheten ("ett enda företag") skapas lazy per bolag, precis som i det
 * förenklade UI-flödet (`resolveOrCreateUnit` i lib/actions/de-minimis.ts).
 * Chatten är staff-only, så medlems-grenen (`canManageStartupDeMinimis`)
 * behövs inte här — rollkravet ligger i `writable-fields`.
 */

const FORORDNINGAR: ForordningKod[] = ['ALLMAN', 'SGEI', 'JORDBRUK', 'FISKE'];

async function resolveUnit(
  pb: PocketBase,
  actor: Actor,
  startupId: string,
  startupName: string
): Promise<{ unitId: string } | { error: string }> {
  // Befintlig enhet? Läs via användartoken OCH dubbelkolla via superuser
  // (samma grind som UI:ts `resolveOrCreateUnit`): en tyst RLS-miss
  // (PB v0.23.4:s rule-eval-bugg, § 21.3) får ALDRIG ge en duplicerad tom
  // enhet — då skulle takprövningen köras mot tom historik och taket kunna
  // rundas. Tenant är redan verifierad av anroparen.
  const findExisting = async (client: PocketBase): Promise<string | null> => {
    try {
      const existing = await client
        .collection(PB_COLLECTIONS.deMinimisUnits)
        .getFirstListItem<DeMinimisUnit>(`startup = "${escFilter(startupId)}"`, { sort: 'created' })
        .catch(() => null);
      return existing?.id ?? null;
    } catch {
      return null;
    }
  };
  const own = await findExisting(pb);
  if (own) return { unitId: own };
  const su = await getSuperuserPb();
  if (su.ok) {
    const viaSu = await findExisting(su.pb);
    if (viaSu) return { unitId: viaSu };
  }

  try {
    const created = await writeWithFallback(pb, (client) =>
      client.collection(PB_COLLECTIONS.deMinimisUnits).create<DeMinimisUnit>({
        tenant: actor.tenant,
        startup: startupId,
        namn: (startupName || 'De minimis').slice(0, 200),
        created_by: actor.id
      })
    );
    return { unitId: created.id };
  } catch (err) {
    console.error('[write:de-minimis] resolveUnit failed', {
      tenant: actor.tenant,
      error: err instanceof Error ? err.message : 'okänt'
    });
    return { error: 'Kunde inte förbereda de minimis-registret för bolaget.' };
  }
}

export interface RegisterDeMinimisSupportParams {
  startupId: string;
  forordning: string;
  stodgivare: string;
  /** Beslutsdatum (juridisk rätt), ÅÅÅÅ-MM-DD. */
  beslutsdatum: string;
  /** Belopp i EUR (sanningen för taket). Kan härledas ur SEK + kurs. */
  beloppEur?: number | null;
  beloppSek?: number | null;
  valutakurs?: number | null;
  syfte?: string | null;
  beslutReferens?: string | null;
}

export interface RegisteredDeMinimisSupportResult {
  stodId: string;
  stodgivare: string;
  beloppEur: number;
  startupName: string;
  deMinimisPath: string;
  warnings: string[];
}

export async function registerDeMinimisSupport(
  pb: PocketBase,
  actor: Actor,
  params: RegisterDeMinimisSupportParams
): Promise<WriteResult<RegisteredDeMinimisSupportResult>> {
  const policy = canCreateRecord(actor, 'de_minimis_stod');
  if (!policy.ok) {
    return fail(
      actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN',
      policy.reason ?? 'Registrering nekad.'
    );
  }

  const forordning = String(params.forordning || '').trim().toUpperCase() as ForordningKod;
  if (!FORORDNINGAR.includes(forordning)) {
    return fail('INVALID_VALUE', `forordning måste vara en av: ${FORORDNINGAR.join(', ')}.`);
  }

  const stodgivare = validateNonEmptyText(params.stodgivare, 'stodgivare', 200);
  if (!stodgivare.ok) return fail('INVALID_VALUE', stodgivare.error);

  const beslutsdatum = String(params.beslutsdatum || '').slice(0, 10);

  const beloppSek =
    params.beloppSek !== undefined && params.beloppSek !== null ? Number(params.beloppSek) : undefined;
  const valutakurs =
    params.valutakurs !== undefined && params.valutakurs !== null
      ? Number(params.valutakurs)
      : undefined;
  let beloppEur =
    params.beloppEur !== undefined && params.beloppEur !== null ? Number(params.beloppEur) : undefined;

  // Härled EUR ur SEK + kurs om EUR saknas (EUR förblir sanning, § 20.5).
  if ((beloppEur === undefined || !Number.isFinite(beloppEur) || beloppEur <= 0) &&
      beloppSek && valutakurs && valutakurs > 0) {
    beloppEur = Math.round((beloppSek / valutakurs) * 100) / 100;
  }
  if (beloppEur === undefined || !Number.isFinite(beloppEur)) {
    return fail(
      'INVALID_VALUE',
      'Ange beloppet i EUR (belopp_eur), eller i SEK tillsammans med växelkursen (belopp_sek + valutakurs).'
    );
  }

  const syfteRaw = validateOptionalText(params.syfte, 'syfte', 500);
  if (!syfteRaw.ok) return fail('INVALID_VALUE', syfteRaw.error);
  const syfte = syfteRaw.value ? sanitizePersonnummer(syfteRaw.value) : '';
  const beslutReferens = validateOptionalText(params.beslutReferens, 'beslut_referens', 200);
  if (!beslutReferens.ok) return fail('INVALID_VALUE', beslutReferens.error);

  // Grundvalidering (ren, enhetstestad logik — samma som UI:t).
  const validation = validateStodInput(
    { forordning, belopp_eur: beloppEur, beslutsdatum, stodgivare: stodgivare.value },
    {}
  );
  if (!validation.ok) return fail('INVALID_VALUE', validation.error);

  const startup = await getRecordInTenant<{ id: string; tenant?: string; name?: string }>(
    pb,
    actor,
    'startups',
    params.startupId.trim(),
    'id,tenant,name'
  );
  if (!startup) return fail('NOT_FOUND', 'Bolaget hittades inte i din organisation.');
  const startupName = startup.name || 'bolaget';

  const unit = await resolveUnit(pb, actor, startup.id, startupName);
  if ('error' in unit) return fail('DB_ERROR', unit.error);

  // Pröva mot taken INNAN skrivning (kanBevilja, § 20.3). Takunderlaget
  // läses i första hand som superuser: det är en server-side
  // integritetskontroll (raderna når aldrig modellen — bara provet), och en
  // tyst RLS-miss får inte ge tom historik → trivialt godkänt tak.
  // FAIL-CLOSED: kan underlaget inte läsas alls avbryts registreringen —
  // spärren är en legal gräns (§ 20.4), inte en best-effort.
  const loadStod = async (client: PocketBase): Promise<DeMinimisStod[] | null> => {
    try {
      return await client
        .collection(PB_COLLECTIONS.deMinimisStod)
        .getFullList<DeMinimisStod>({ filter: `unit = "${escFilter(unit.unitId)}"` });
    } catch {
      return null;
    }
  };
  let existing: DeMinimisStod[] | null = null;
  const suForStod = await getSuperuserPb();
  if (suForStod.ok) existing = await loadStod(suForStod.pb);
  if (existing === null) existing = await loadStod(pb);
  if (existing === null) {
    console.error('[write:de-minimis] kunde inte läsa takunderlaget', {
      tenant: actor.tenant,
      unitId: unit.unitId
    });
    return fail(
      'DB_ERROR',
      'Kunde inte läsa bolagets befintliga stöd för takprövningen — registreringen avbröts. Försök igen.'
    );
  }

  const regelverk = await loadRegelverk(pb);
  const calcRows: DeMinimisStodCalc[] = existing.map((s) => ({
    forordning: s.forordning,
    belopp_eur: s.belopp_eur,
    beslutsdatum: s.beslutsdatum
  }));
  const beslut = parseDateOnly(beslutsdatum);
  if (!beslut) return fail('INVALID_VALUE', 'beslutsdatum måste vara ett datum (ÅÅÅÅ-MM-DD).');

  const prov = kanBevilja(calcRows, regelverk, forordning, beloppEur, beslut);
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
    return fail(
      'INVALID_VALUE',
      `Posten skulle överskrida ${delar.join(' och ')}. Registrering blockerad — slutlig prövning görs alltid av stödgivaren.`
    );
  }

  // Bakåtdaterings-varning (informativ, blockerar inte).
  const latestExisting = existing.map((s) => s.beslutsdatum).sort().at(-1);
  const warnRes = validateStodInput(
    { forordning, belopp_eur: beloppEur, beslutsdatum, stodgivare: stodgivare.value },
    { latestExistingDate: latestExisting }
  );
  const warnings = warnRes.ok ? warnRes.warnings : [];

  const payload: Record<string, unknown> = {
    tenant: actor.tenant,
    startup: startup.id,
    unit: unit.unitId,
    forordning,
    stodgivare: stodgivare.value,
    beslutsdatum,
    belopp_eur: beloppEur,
    syfte,
    beslut_referens: beslutReferens.value ?? '',
    registrerad_i_eair: false,
    created_by: actor.id
  };
  if (beloppSek !== undefined && Number.isFinite(beloppSek)) payload.belopp_sek = beloppSek;
  if (valutakurs !== undefined && Number.isFinite(valutakurs)) payload.valutakurs = valutakurs;

  let created: { id: string };
  try {
    created = await writeWithFallback(pb, (client) =>
      client.collection(PB_COLLECTIONS.deMinimisStod).create<{ id: string }>(payload)
    );
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'Kunde inte registrera stödet.');
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: 'de_minimis_stod',
    record_id: created.id,
    after_value: {
      startup: startup.id,
      startup_name: startupName,
      forordning,
      stodgivare: stodgivare.value,
      belopp_eur: beloppEur,
      beslutsdatum
    }
  });

  return ok({
    stodId: created.id,
    stodgivare: stodgivare.value,
    beloppEur,
    startupName,
    deMinimisPath: `/de-minimis/${startup.id}`,
    warnings
  });
}

export { FORORDNINGAR };
