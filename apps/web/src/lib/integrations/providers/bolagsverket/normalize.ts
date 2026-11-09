/**
 * Bolagsverket "Värdefulla datamängder" → RegistryCompany — REN modul (ingen
 * IO, inget `server-only`), enhetstestad i `normalize.test.ts`.
 *
 * API:t (POST /organisationer) svarar med `{ organisationer: [ … ] }` där
 * varje organisation har nästlade objekt: organisationsnamn.organisationsnamnLista[],
 * organisationsform{kod,klartext}, organisationsdatum{registreringsdatum},
 * naringsgrenOrganisation.sni[], postadressOrganisation.postadress{postort},
 * avregistreradOrganisation, organisationsstatusar … Namnen läses från en
 * kandidatlista (`pickFirst`) eftersom schemat inte kan verifieras från
 * byggmiljön; saknade fält noteras PII-fritt i `notes` så
 * förhandsgranskningen visar vad som tolkades.
 *
 * Bolagsverket ger INGEN ägarbild och inga bokslutsposter (årsredovisningar
 * levereras som dokument) → `ownership` och `financials` är alltid tomma.
 */
import {
  asIsoDate,
  asString,
  mapBolagStatus,
  pick,
  pickFirst,
  type RegistryCompany,
  type RegistryStartupPatch
} from '../../company-registry/types';

export function firstOrganisation(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const list = (raw as { organisationer?: unknown }).organisationer;
  if (Array.isArray(list)) {
    const first = list[0];
    return first && typeof first === 'object' ? (first as Record<string, unknown>) : undefined;
  }
  return raw as Record<string, unknown>;
}

function organisationName(org: Record<string, unknown>): string | undefined {
  const list = pickFirst(org, ['organisationsnamn.organisationsnamnLista', 'organisationsnamnLista', 'namnLista']);
  if (Array.isArray(list)) {
    // Föredra företagsnamnet före bifirma/särskilt företagsnamn.
    const typed = list.find((n) => {
      const kod = asString(pickFirst(n, ['organisationsnamntyp.kod', 'typ.kod', 'typ']))?.toUpperCase() || '';
      if (/SARSKILT|SÄRSKILT|BIFIRMA|PARALLELL|OVERSATT|ÖVERSATT/.test(kod)) return false;
      return kod.includes('FORETAGSNAMN') || kod.includes('FÖRETAGSNAMN') || kod === 'NAMN';
    });
    const chosen = typed || list[0];
    const namn = asString(pickFirst(chosen, ['namn', 'organisationsnamn', 'name']));
    if (namn) return namn;
  }
  return asString(pickFirst(org, ['organisationsnamn.namn', 'organisationsnamn', 'namn', 'name']));
}

function statusOf(org: Record<string, unknown>, notes: string[]) {
  if (pick(org, 'avregistreradOrganisation') || pick(org, 'organisationsdatum.avregistreringsdatum')) {
    const orsak = asString(
      pickFirst(org, ['avregistreradOrganisation.avregistreringsorsak.klartext', 'avregistreradOrganisation.orsak'])
    );
    if (orsak && /konkurs/i.test(orsak)) return 'konkurs' as const;
    if (orsak && /likvid/i.test(orsak)) return 'likvidering' as const;
    return 'avregistrerat' as const;
  }
  const statusar = pickFirst(org, ['organisationsstatusar.organisationsstatusLista', 'organisationsstatusar', 'statusar']);
  if (Array.isArray(statusar)) {
    for (const s of statusar) {
      const mapped = mapBolagStatus(pickFirst(s, ['klartext', 'kod', 'status']));
      if (mapped && mapped !== 'aktiv') return mapped;
    }
    if (statusar.length > 0) return 'aktiv' as const;
  }
  const direct = mapBolagStatus(pickFirst(org, ['status.klartext', 'status', 'organisationsstatus']));
  if (direct) return direct;
  // Registrerad, ej avregistrerad, inga statusar → aktiv.
  if (pick(org, 'organisationsdatum.registreringsdatum') || pick(org, 'registreringsdatum')) return 'aktiv' as const;
  notes.push('Bolagsverket: bolagsstatus kunde inte tolkas.');
  return undefined;
}

export function normalizeBolagsverketCompany(
  orgNr: string,
  raw: unknown,
  isPersonal: boolean
): RegistryCompany {
  const notes: string[] = [];
  const patch: RegistryStartupPatch = {};
  const org = firstOrganisation(raw);
  if (!org) {
    notes.push('Bolagsverket: ingen organisation i svaret.');
    return { org_nr: orgNr, isPersonal, startup: patch, financials: [], ownership: [], notes };
  }

  const name = organisationName(org);

  const form = asString(
    pickFirst(org, ['organisationsform.klartext', 'organisationsform.kod', 'juridiskForm.klartext', 'organisationsform'])
  );
  if (form) patch.bolagsform = form.slice(0, 100);

  const registered = asIsoDate(
    pickFirst(org, ['organisationsdatum.registreringsdatum', 'registreringsdatum', 'bildatDatum', 'organisationsdatum.bildatDatum'])
  );
  if (registered) patch.company_registered_at = registered;
  else notes.push('Bolagsverket: registreringsdatum saknas i svaret.');

  const sniList = pickFirst(org, ['naringsgrenOrganisation.sni', 'naringsgren.sni', 'sni', 'naringsgrenOrganisation']);
  if (Array.isArray(sniList) && sniList.length > 0) {
    const first = sniList[0];
    const kod = asString(pickFirst(first, ['kod', 'sniKod', 'code']));
    const text = asString(pickFirst(first, ['klartext', 'beskrivning', 'text']));
    if (kod) patch.sni_code = kod.slice(0, 20);
    if (text) {
      patch.sni_description = text.slice(0, 300);
      patch.industri = text.slice(0, 200);
    }
  } else {
    notes.push('Bolagsverket: SNI-kod saknas i svaret.');
  }

  const kommun = asString(
    pickFirst(org, [
      'sate.kommun.klartext',
      'sate.kommun',
      'sateKommun.klartext',
      'postadressOrganisation.postadress.postort',
      'postadress.postort',
      'postort'
    ])
  );
  if (kommun) patch.kommun = kommun.slice(0, 100);

  const status = statusOf(org, notes);
  if (status) patch.bolag_status = status;

  return { org_nr: orgNr, isPersonal, name, startup: patch, financials: [], ownership: [], notes };
}
