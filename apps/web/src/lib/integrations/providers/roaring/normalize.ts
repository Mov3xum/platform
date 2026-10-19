/**
 * Roaring → RegistryCompany — REN modul (ingen IO, inget `server-only`),
 * enhetstestad i `normalize.test.ts`.
 *
 * Roarings svar är inte tillgängliga att verifiera från byggmiljön, och
 * fältnamnen varierar mellan API-versioner (overview 1.1/2.0, economy-
 * overview vs financial-record, group-structure, beneficial-owner). Därför
 * läser varje fält från en LISTA av kandidatnamn (`pickFirst`) och rapporterar
 * PII-fritt i `notes` vad som saknades, så att förhandsgranskningen på
 * /integrationer/roaring ("Testa mot org-nr") visar exakt vad som tolkades
 * innan portföljen synkas. Okända fält ignoreras — vi skriver hellre inget än
 * fel.
 *
 * Dataminimering (CLAUDE.md § 11.4, § 51.11): verklig huvudman innehåller
 * namn och personnummer. Normaliseraren tar namn, andel/kontrollintervall och
 * kontrollgrund per person — ägarbilden ska gå att läsa. Födelsedatum och
 * adress läses aldrig. Personnumret läses BARA av
 * `roaringBeneficialOwnerPersons`, som handlern använder för att söka
 * personens andra bolag; det lämnar aldrig handlern (aldrig i
 * RegistryCompany, noter, loggar eller databas).
 */
import { isPersonalOrgNr, isValidOrgNr, normalizeOrgNr } from '../../company-registry/orgnr';
import {
  asIsoDate,
  asNumber,
  asPct,
  asString,
  controlBasisCategory,
  dedupeOwnership,
  inferOwnerKindFromName,
  mapBolagStatus,
  parsePctInterval,
  pickFirst,
  type RegistryCompany,
  type RegistryEngagementCompany,
  type RegistryFinancialsYear,
  type RegistrySni,
  type RegistryGroupMember,
  type RegistryOwnershipEntry,
  type RegistryStartupPatch
} from '../../company-registry/types';

export interface RoaringRawBundle {
  overview?: unknown;
  financials?: unknown;
  groupStructure?: unknown;
  beneficialOwners?: unknown;
}

/** Roaring svarar oftast `{ records: [ … ] }`; tolerera även ett naket objekt. */
export function firstRecord(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const records = (raw as { records?: unknown }).records;
  if (Array.isArray(records)) {
    const first = records[0];
    return first && typeof first === 'object' ? (first as Record<string, unknown>) : undefined;
  }
  return raw as Record<string, unknown>;
}

/**
 * Sant när Roarings svarskuvert uttryckligen säger att inga poster finns
 * ("records not found", HTTP 200). Bara kuvertets egna fält läses —
 * `status` i en POST är bolagets status och tolkas aldrig här — och bara när
 * svaret inte bär några poster. Text, inte kod: koderna skiljer sig mellan
 * API:er, medan texten är densamma.
 */
export function roaringReportsNoRecords(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.records) && r.records.length > 0) return false;
  // Kuvertet enligt Roarings OpenAPI-specar (2026-10-12): `status.code` 0 =
  // found, 1 = not found — exakt, oavsett text.
  const status = r.status;
  if (status && typeof status === 'object' && (status as Record<string, unknown>).code === 1) return true;
  for (const key of ['responseInfo', 'status']) {
    const env = r[key];
    if (!env || typeof env !== 'object') continue;
    const text = asString(pickFirst(env, ['text', 'statusText', 'message', 'description']));
    if (text && /records? not found|no records/i.test(text)) return true;
  }
  return false;
}

/**
 * Env-lista av endpoint-kandidater ("/a/1.0, /b/2.0"). Tom/whitespace →
 * fallback. Bara absoluta sökvägar (börjar med "/") behålls — en felskriven
 * env får aldrig bli en relativ URL mot en annan värd.
 */
export function parseRoaringPathList(raw: string | undefined, fallback: string[]): string[] {
  const list = (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('/'))
    .map((s) => s.replace(/\/$/, ''));
  return list.length > 0 ? list : fallback;
}

/**
 * Fältnycklar (ALDRIG värden) på första posten i ett Roaring-svar, för
 * förhandsgranskningens "vad svarade API:t"-not. Nycklar är schemainformation,
 * inte personuppgifter — värden når aldrig noten. Nästlade objekt/listor visas
 * som `key{…}`/`key[…]` med sina egna första-nivå-nycklar, cappat.
 */
export function describeRecordKeys(raw: unknown, max = 40): string[] {
  const rec = firstRecord(raw);
  if (!rec) return [];
  const out: string[] = [];
  for (const key of Object.keys(rec)) {
    if (out.length >= max) break;
    out.push(describeShape(key, rec[key], 2));
  }
  return out;
}

/**
 * `key`, `key{a,b}`, `key[a,b{c,d}]` — nycklar ner till `depth` nivåer, så
 * förhandsgranskningen visar FORMEN på t.ex. `extentOfControl` inuti
 * `beneficialOwners[]` (sträng, objekt eller lista) utan att något värde
 * lämnar servern. Primitiver skrivs bara som sitt namn.
 */
export function describeShape(key: string, v: unknown, depth: number): string {
  if (Array.isArray(v)) {
    const first = v.find((x) => x && typeof x === 'object');
    if (!first) return `${key}[]`;
    if (depth <= 0) return `${key}[…]`;
    return `${key}[${describeKeys(first as Record<string, unknown>, depth - 1)}]`;
  }
  if (v && typeof v === 'object') {
    if (depth <= 0) return `${key}{…}`;
    return `${key}{${describeKeys(v as Record<string, unknown>, depth - 1)}}`;
  }
  return key;
}

function describeKeys(obj: Record<string, unknown>, depth: number): string {
  return Object.keys(obj)
    .slice(0, 12)
    .map((k) => describeShape(k, obj[k], depth))
    .join(',');
}

function allRecords(raw: unknown): Record<string, unknown>[] {
  if (!raw || typeof raw !== 'object') return [];
  const records = (raw as { records?: unknown }).records;
  if (Array.isArray(records)) {
    return records.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
  }
  return [raw as Record<string, unknown>];
}

const SNI_LIST_KEYS = ['industries', 'industryCodes', 'sniCodes', 'sni', 'naceCodes', 'allIndustries', 'secondaryIndustries', 'otherIndustries', 'businessIndustries'];
const SNI_CODE_KEYS = ['code', 'industryCode', 'sniCode', 'naceCode', 'id', 'value'];
const SNI_TEXT_KEYS = ['text', 'industryText', 'sniText', 'description', 'name', 'label'];

/**
 * Bolagets SNI-koder: huvudsaklig (`industryCode`/`industryText`) först, sedan
 * varje kod i en lista (`industries[]` m.fl. — som objekt `{ code, text }`
 * eller som strängar). Dubbletter slås ihop; "00000" (uppgift saknas) och
 * annat som inte är en kod släpps.
 */
export function normalizeRoaringSni(rec: Record<string, unknown>): RegistrySni[] {
  const out: RegistrySni[] = [];
  const push = (codeRaw: unknown, textRaw: unknown, primary: boolean) => {
    const code = asString(codeRaw)?.replace(/[^0-9]/g, '');
    if (!code || code.length < 2 || code.length > 5 || /^0+$/.test(code)) return;
    const text = asString(textRaw)?.slice(0, 200);
    const prev = out.find((x) => x.code === code);
    if (prev) {
      if (!prev.text && text) prev.text = text;
      if (primary) prev.primary = true;
      return;
    }
    out.push({ code, ...(text ? { text } : {}), ...(primary ? { primary: true } : {}) });
  };
  push(
    pickFirst(rec, ['industryCode', 'sniCode', 'industry.code', 'primaryIndustryCode', 'primaryIndustry.code']),
    pickFirst(rec, ['industryText', 'sniText', 'industry.text', 'primaryIndustryText', 'primaryIndustry.text']),
    true
  );
  for (const key of SNI_LIST_KEYS) {
    const v = rec[key];
    if (!Array.isArray(v)) continue;
    for (const item of v.slice(0, 20)) {
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const primaryFlag = pickFirst(o, ['primary', 'isPrimary', 'main', 'isMain']);
        push(pickFirst(o, SNI_CODE_KEYS), pickFirst(o, SNI_TEXT_KEYS), primaryFlag === true || primaryFlag === 'true');
      } else push(item, undefined, false);
    }
  }
  // Huvudsaklig först.
  return out.sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
}

export function normalizeRoaringOverview(raw: unknown, notes: string[]): {
  name?: string;
  patch: RegistryStartupPatch;
  sni: RegistrySni[];
} {
  const rec = firstRecord(raw);
  const patch: RegistryStartupPatch = {};
  if (!rec) {
    notes.push('Roaring overview: tomt svar.');
    return { patch, sni: [] };
  }

  const name = asString(pickFirst(rec, ['companyName', 'name', 'legalName']));

  const form = asString(
    pickFirst(rec, ['legalGroupText', 'legalGroupCode', 'legalForm.text', 'legalForm', 'companyForm'])
  );
  if (form) patch.bolagsform = form;

  const kommun = asString(
    pickFirst(rec, [
      'commune',
      'communeName',
      'municipality',
      'municipalityName',
      'postalAddress.commune',
      'postalAddress.town',
      'visitingAddress.town',
      'town'
    ])
  );
  if (kommun) patch.kommun = kommun;

  const sni = asString(pickFirst(rec, ['industryCode', 'sniCode', 'industry.code', 'primaryIndustryCode']));
  const sniText = asString(
    pickFirst(rec, ['industryText', 'sniText', 'industry.text', 'primaryIndustryText'])
  );
  if (sni) patch.sni_code = sni.slice(0, 20);
  if (sniText) {
    patch.sni_description = sniText.slice(0, 300);
    patch.industri = sniText.slice(0, 200);
  }

  const status = mapBolagStatus(
    pickFirst(rec, ['statusTextHigh', 'statusTextDetailed', 'statusText', 'status', 'statusCode'])
  );
  if (status) patch.bolag_status = status;
  else notes.push('Roaring overview: bolagsstatus kunde inte tolkas.');

  const registered = asIsoDate(
    pickFirst(rec, ['companyRegistrationDate', 'registrationDate', 'registeredDate', 'foundedDate'])
  );
  if (registered) patch.company_registered_at = registered;
  else notes.push('Roaring overview: registreringsdatum saknas.');

  const sniList = normalizeRoaringSni(rec);
  if (sniList.length === 0) notes.push('Roaring overview: SNI-kod saknas i svaret.');
  return { name, patch, sni: sniList };
}

const YEAR_PATHS = ['toDate', 'accountsClosingDate', 'periodEnd', 'period.toDate', 'endDate', 'year', 'fiscalYear'];
// Omsättning: `plSales` = nettoomsättning (det SMF-definitionen/art. 22
// GBER räknar på); `plNetOperatingIncome` = rörelsens intäkter inkl. övriga
// rörelseintäkter (economy-overview 2.1 bär båda, med `plEbit` separat).
// Avviker de noteras det så värdet kan jämföras mot ett facit (Allabolag).
const REVENUE_PATHS = ['plSales', 'plNetOperatingIncome', 'netTurnover', 'netSales', 'turnover', 'revenue', 'plNetSales', 'pl.netOperatingIncome'];
const OPERATING_INCOME_PATHS = ['plNetOperatingIncome', 'pl.netOperatingIncome'];
const EMPLOYEES_PATHS = ['nbrOfEmployees', 'numberOfEmployees', 'employees', 'averageNumberOfEmployees'];
// economy-overview 2.1 /extended (OpenAPI 2026-10-12): `plPersonalCosts` =
// Personnel costs, `plTaxes` = Tax, `dividend` = Dividend (beslutad utdelning
// för räkenskapsåret). De nakna /{companyId}-svaren saknar dem.
const PERSONNEL_PATHS = ['plPersonalCosts', 'plPersonnelCosts', 'personnelCosts', 'staffCosts', 'salariesAndRemuneration'];
const TAX_PATHS = ['plTaxes', 'plTaxOnProfit', 'taxOnProfit', 'incomeTax', 'plTax'];
const DIVIDEND_PATHS = ['dividend'];
// Balansomslutning = summa tillgångar = summa eget kapital och skulder.
// economy-overview 2.1 bär bara skuldsidan (`bsTotalEquityAndLiabilities`),
// som per definition är samma belopp (incident 2026-10-12: noten
// "balansomslutning saknas" trots att fältet fanns i svaret).
const ASSETS_PATHS = [
  'bsTotalAssets',
  'bsTotalEquityAndLiabilities',
  'totalAssets',
  'balanceSheetTotal',
  'bs.totalAssets',
  'bs.totalEquityAndLiabilities',
  'sumAssets',
  'sumEquityAndLiabilities'
];
const EQUITY_PATHS = ['bsTotalEquity', 'totalEquity', 'equity', 'bs.totalEquity', 'sumEquity'];
const RESULT_PATHS = ['plNetProfitLoss', 'netProfit', 'netIncome', 'profitLossForTheYear', 'plNetIncome', 'plProfitLossForTheYear'];

function yearOf(row: Record<string, unknown>): number | undefined {
  for (const p of YEAR_PATHS) {
    const v = pickFirst(row, [p]);
    if (v === undefined) continue;
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1980 && v <= 2100) return v;
    const iso = asIsoDate(v);
    if (iso) return Number(iso.slice(0, 4));
    const n = asNumber(v);
    if (n !== undefined && Number.isInteger(n) && n >= 1980 && n <= 2100) return n;
  }
  return undefined;
}

/**
 * Roaring anger vissa belopp i TSEK. Multiplikatorn kommer från handlern
 * (default 1). Vi loggar alltid enheten i notes så förhandsgranskningen visar
 * vad vi antog.
 */
export function normalizeRoaringFinancials(
  raw: unknown,
  notes: string[],
  amountMultiplier = 1
): RegistryFinancialsYear[] {
  const rows: Record<string, unknown>[] = [];
  for (const rec of allRecords(raw)) {
    const nested = pickFirst(rec, ['companyAccounts', 'accounts', 'financialRecords', 'financialStatements', 'years']);
    if (Array.isArray(nested)) {
      for (const n of nested) if (n && typeof n === 'object') rows.push(n as Record<string, unknown>);
    } else {
      rows.push(rec);
    }
  }
  if (rows.length === 0) {
    notes.push('Roaring bokslut: inga årsrader i svaret.');
    return [];
  }

  const byYear = new Map<number, RegistryFinancialsYear>();
  const mul = (v: unknown) => {
    const n = asNumber(v);
    return n === undefined ? undefined : Math.round(n * amountMultiplier);
  };
  let missingAssets = 0;
  let missingDividend = 0;
  let salesDiffers = 0;
  for (const row of rows) {
    const year = yearOf(row);
    if (!year) continue;
    const entry: RegistryFinancialsYear = { year };
    const employees = asNumber(pickFirst(row, EMPLOYEES_PATHS));
    if (employees !== undefined && employees >= 0) entry.employees = Math.round(employees);
    const revenue = mul(pickFirst(row, REVENUE_PATHS));
    if (revenue !== undefined) entry.revenue_sek = revenue;
    if (pickFirst(row, ['plSales']) !== undefined) {
      const operating = mul(pickFirst(row, OPERATING_INCOME_PATHS));
      if (operating !== undefined && revenue !== undefined && operating !== revenue) salesDiffers++;
    }
    const personnel = mul(pickFirst(row, PERSONNEL_PATHS));
    if (personnel !== undefined) entry.personnel_cost_sek = Math.abs(personnel);
    const tax = mul(pickFirst(row, TAX_PATHS));
    if (tax !== undefined) entry.corporate_tax_sek = Math.abs(tax);
    const assets = mul(pickFirst(row, ASSETS_PATHS));
    if (assets !== undefined) entry.balance_sheet_sek = assets;
    else missingAssets++;
    const equity = mul(pickFirst(row, EQUITY_PATHS));
    if (equity !== undefined) entry.equity_sek = equity;
    const result = mul(pickFirst(row, RESULT_PATHS));
    if (result !== undefined) entry.net_result_sek = result;
    // Beslutad utdelning: nyckeln finns bara i /extended-svaret. Ett tal (även
    // 0) är ett svar ⇒ `dividend_reported`; saknad nyckel lämnar utdelningen
    // OKÄND (§ 51 — aldrig tyst 0 kr).
    const dividend = mul(pickFirst(row, DIVIDEND_PATHS));
    if (dividend !== undefined) {
      entry.dividend_sek = Math.abs(dividend);
      entry.dividend_reported = true;
    } else missingDividend++;
    // Senaste raden per år vinner (Roaring kan ge flera perioder).
    byYear.set(year, { ...(byYear.get(year) || { year }), ...entry });
  }
  if (missingDividend > 0) {
    notes.push(
      `Roaring bokslut: utdelningsposten (dividend) saknas för ${missingDividend} årsrad(er) — utdelningen lämnas OKÄND, aldrig 0 (bara /extended-svaret bär fältet).`
    );
  }
  if (missingAssets > 0) {
    notes.push(`Roaring bokslut: balansomslutning saknas för ${missingAssets} årsrad(er) — kontrollera fältmappningen.`);
  }
  if (salesDiffers > 0) {
    notes.push(
      `Roaring bokslut: omsättning läses ur plSales (nettoomsättning); plNetOperatingIncome (rörelsens intäkter) avvek för ${salesDiffers} årsrad(er) — jämför mot ett facit om fel post valts.`
    );
  }
  if (amountMultiplier !== 1) {
    notes.push(`Roaring bokslut: belopp multiplicerade med ${amountMultiplier} (TSEK → SEK).`);
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

const CHILD_KEYS = ['groupCompanies', 'subsidiaries', 'children', 'daughterCompanies', 'ownedCompanies', 'companies'];
const PARENT_KEYS = ['owners', 'ownerCompanies', 'parents', 'parentCompanies', 'motherCompanies'];
const PCT_PATHS = ['ownedPercentage', 'ownershipPercentage', 'percentOwned', 'ownerShare', 'ownedShare', 'share', 'percentage', 'capitalPercentage', 'capitalShare', 'shareOfCapital'];
const VOTES_PATHS = ['votesPercentage', 'votingPercentage', 'votingShare', 'shareOfVotes', 'votes'];

interface GroupNode {
  id?: string;
  /** Leverantörens id som det kom (för diagnos av okänt format — aldrig i noter). */
  rawId?: string;
  name?: string;
  pct?: number;
  votes?: number;
  children: GroupNode[];
  parents: GroupNode[];
}

function toNode(raw: unknown, depth = 0): GroupNode | undefined {
  if (!raw || typeof raw !== 'object' || depth > 8) return undefined;
  const rec = raw as Record<string, unknown>;
  const rawId = asString(pickFirst(rec, ['companyId', 'orgNr', 'organisationNumber', 'registrationNumber', 'organizationNumber', 'id']));
  const node: GroupNode = {
    id: normalizeOrgNr(rawId) || undefined,
    rawId,
    name: asString(pickFirst(rec, ['companyName', 'name', 'legalName'])),
    pct: asPct(pickFirst(rec, PCT_PATHS)),
    votes: asPct(pickFirst(rec, VOTES_PATHS)),
    children: [],
    parents: []
  };
  for (const key of CHILD_KEYS) {
    const arr = rec[key];
    if (Array.isArray(arr)) {
      for (const c of arr) {
        const n = toNode(c, depth + 1);
        if (n) node.children.push(n);
      }
    }
  }
  for (const key of PARENT_KEYS) {
    const arr = rec[key];
    if (Array.isArray(arr)) {
      for (const p of arr) {
        const n = toNode(p, depth + 1);
        if (n) node.parents.push(n);
      }
    }
  }
  return node;
}

function findPath(node: GroupNode, orgNr: string, trail: GroupNode[]): GroupNode[] | undefined {
  if (node.id === orgNr) return [...trail, node];
  for (const c of node.children) {
    const hit = findPath(c, orgNr, [...trail, node]);
    if (hit) return hit;
  }
  return undefined;
}

/** Sant bara för ett giltigt org-nr som tillhör en JURIDISK person. */
export function isLegalEntityOrgNr(id: string | undefined): id is string {
  return !!id && isValidOrgNr(id) && !isPersonalOrgNr(id);
}

/**
 * Sant när namnet bär en bolagsform (AB, HB, KB, Ltd, GmbH …). Används för
 * att INTE anonymisera ett bolag vars id Roaring levererar i ett format vi
 * inte känner igen — ett bolagsnamn är ingen personuppgift, men utan org-nr
 * kan bolaget inte slås upp vidare (noteras). Ett personnummer-derivat
 * (enskild firma) anonymiseras ALLTID, oavsett namn.
 */
export function looksLikeCompanyName(name: string | undefined): boolean {
  if (!name) return false;
  return /(^|[\s,(])(AB|HB|KB|AKTIEBOLAG|LTD|LIMITED|PLC|ASA|OYJ|OY|GMBH|AG|INC|LLC|BV|NV|SARL|APS|A\/S|EK\.? ?FÖR\.?|EKONOMISK FÖRENING)(\s|$|\)|,|\.)/i.test(
    name.trim()
  );
}

/** Beskriver ett id:s FORM (aldrig värdet) för diagnosnoten. */
function describeIdShape(raw: string | undefined): string {
  if (!raw) return 'saknas';
  const digits = raw.replace(/[^0-9]/g, '').length;
  const letters = /[A-Za-z]/.test(raw);
  return `${raw.length} tecken, ${digits} siffror${letters ? ', bokstäver' : ''}`;
}

/**
 * En nod utan giltigt org-nr för juridisk person (saknat id, ogiltigt id,
 * eller ett personnummer-derivat = enskild firma/fysisk person) blir en
 * person-rad med namn men utan org-nr (personnumret lämnar aldrig
 * normaliseraren, § 51.11).
 */
function companyEntry(
  n: GroupNode,
  direction: 'owner' | 'holding',
  indirect: boolean,
  notes?: string[]
): RegistryOwnershipEntry | undefined {
  if (!n.id && !n.name) return undefined;
  if (!isLegalEntityOrgNr(n.id)) {
    const personal = !!n.id && isPersonalOrgNr(n.id);
    if (!personal && looksLikeCompanyName(n.name)) {
      // Bolagsnamn men okänt id-format: behåll som bolag UTAN org-nr i
      // stället för att tyst göra det till en anonym person (det gjorde att
      // ett moderbolag försvann ur screeningen). Formen noteras så
      // mappningen kan rättas (`companyId`-kandidaterna).
      notes?.push(
        `Roaring koncernstruktur: ${direction === 'owner' ? 'ägare' : 'innehav'} med bolagsnamn men id i okänt format (${describeIdShape(n.rawId)}) — behölls som bolag utan org-nr.`
      );
      return {
        direction,
        owner_kind: inferOwnerKindFromName(n.name, 'company'),
        name: n.name,
        capital_pct: n.pct,
        voting_pct: n.votes,
        indirect: indirect || undefined
      };
    }
    // Fysisk person (eller enskild firma): namnet följer med för visning
    // (§ 51.11) — personnummer/org-nr aldrig.
    const personName = n.name ? n.name.replace(/\d[\d\s-]*\d/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    return {
      direction,
      owner_kind: 'person',
      ...(personName ? { person_name: personName } : {}),
      capital_pct: n.pct,
      voting_pct: n.votes,
      indirect: indirect || undefined
    };
  }
  return {
    direction,
    owner_kind: inferOwnerKindFromName(n.name, 'company'),
    name: n.name,
    org_nr: n.id,
    capital_pct: n.pct,
    voting_pct: n.votes,
    indirect: indirect || undefined
  };
}

/**
 * Roarings svenska koncernstruktur (se-company-group-structure-1.0) är en
 * PLATT lista: `groupCompanies[]` där varje bolag bär `motherCompanyId`
 * (vem som äger det), `ownedPercentage` (moderns andel av bolaget) och
 * `companyLevel`. Listan kan innehålla moderbolag och syskon — de är varken
 * ägare eller innehav och får aldrig klassas som bolagets innehav.
 *
 * Ägare = kedjan av `motherCompanyId` uppåt från bolaget (närmast = direkt,
 * högre led = indirekt). Innehav = bolag vars `motherCompanyId` är bolaget.
 * Returnerar undefined när svaret inte är i platt form (äldre/nästlade
 * format hanteras av trädtolkningen nedan).
 */
/**
 * Nycklar som tolereras i den platta koncernlistan. Katalogen säger
 * `groupCompanies[]` med `companyId`/`motherCompanyId`, men svaret har inte
 * kunnat verifieras mot roaring.io från byggmiljön, så listan, bolags-id:t
 * och moder-id:t läses ur en kandidatlista — ett avvikande namn får aldrig
 * tyst ge "ingen koncern" (incident 2026-10-13: koncernkartan visade bara
 * startup-bolaget). Listan får också ligga ett steg ned (`groupStructure{…}`).
 */
const GROUP_LIST_KEYS = ['groupCompanies', 'companies', 'groupMembers', 'members', 'subsidiaries', 'group', 'groupStructure', 'structure'];
const GROUP_MOTHER_KEYS = ['motherCompanyId', 'parentCompanyId', 'groupMotherCompanyId', 'motherId', 'parentId', 'ownerCompanyId', 'motherCompanyRegistrationNumber', 'parentCompanyRegistrationNumber'];
const GROUP_ID_KEYS = ['companyId', 'orgNr', 'organisationNumber', 'organizationNumber', 'companyRegistrationNumber', 'registrationNumber', 'organisationsnummer'];
const GROUP_NAME_KEYS = ['companyName', 'name', 'legalName', 'companyNameLegal'];

/** Den platta koncernlistan ur svaret — direkt under posten eller ett steg ned. */
export function roaringGroupList(root: Record<string, unknown>): Record<string, unknown>[] | undefined {
  const isRecordList = (v: unknown): v is Record<string, unknown>[] =>
    Array.isArray(v) && v.some((x) => !!x && typeof x === 'object' && !Array.isArray(x));
  for (const key of GROUP_LIST_KEYS) {
    const v = root[key];
    if (isRecordList(v)) return v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const inner of GROUP_LIST_KEYS) {
        const w = (v as Record<string, unknown>)[inner];
        if (isRecordList(w)) return w.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
      }
    }
  }
  return undefined;
}

function normalizeFlatGroupStructure(
  root: Record<string, unknown>,
  target: string,
  notes: string[]
): RegistryOwnershipEntry[] | undefined {
  const items = roaringGroupList(root);
  if (!items) return undefined;
  // Grafnyckel: org-nr när id:t går att tolka, annars leverantörens råa id
  // (trimmat). Moder-kedjan följs på nyckeln, så ett bolag vars id Roaring
  // levererar i ett format vi inte känner igen fortfarande hittas i listan —
  // tidigare kastades hela den platta strukturen när motherCompanyId inte
  // var ett org-nr, och modern blev "fysisk person" (incident 2026-10).
  const graphKey = (raw: string | undefined) => {
    const trimmed = raw?.trim();
    if (!trimmed) return undefined;
    return normalizeOrgNr(trimmed) || trimmed;
  };
  const motherOf = (rec: Record<string, unknown>) => graphKey(asString(pickFirst(rec, GROUP_MOTHER_KEYS)));
  if (!items.some((x) => motherOf(x))) return undefined;

  const ID_KEYS = GROUP_ID_KEYS;
  const asNode = (rec: Record<string, unknown>): GroupNode => ({
    id: normalizeOrgNr(asString(pickFirst(rec, ID_KEYS))) || undefined,
    rawId: asString(pickFirst(rec, ID_KEYS)),
    name: asString(pickFirst(rec, GROUP_NAME_KEYS)),
    pct: asPct(pickFirst(rec, PCT_PATHS)),
    votes: asPct(pickFirst(rec, VOTES_PATHS)),
    children: [],
    parents: []
  });
  // Kuvertet (det frågade bolaget) först; listans post för samma bolag
  // vinner, eftersom den bär moder + andel.
  const byId = new Map<string, { node: GroupNode; mother?: string }>();
  for (const rec of [root, ...items]) {
    const node = asNode(rec);
    const key = graphKey(node.rawId);
    if (!key) continue;
    const prev = byId.get(key);
    byId.set(key, { node, mother: motherOf(rec) ?? prev?.mother });
  }

  const out: RegistryOwnershipEntry[] = [];
  const self = byId.get(target);
  const seen = new Set<string>([target]);
  let motherId = self?.mother;
  let direct = true;
  while (motherId && !seen.has(motherId)) {
    seen.add(motherId);
    const mother = byId.get(motherId)?.node ?? {
      id: normalizeOrgNr(motherId) || undefined,
      rawId: motherId,
      children: [],
      parents: []
    };
    const entry = companyEntry({ ...mother, pct: undefined, votes: undefined }, 'owner', !direct, notes);
    if (entry) {
      // Moderns andel av bolaget står på BOLAGETS egen post.
      if (direct) {
        entry.capital_pct = self?.node.pct;
        entry.voting_pct = self?.node.votes;
      }
      out.push(entry);
    }
    motherId = byId.get(motherId)?.mother;
    direct = false;
  }
  for (const rec of items) {
    if (motherOf(rec) !== target) continue;
    const entry = companyEntry(asNode(rec), 'holding', false, notes);
    if (entry) out.push(entry);
  }
  if (!self && !items.some((x) => motherOf(x) === target)) {
    notes.push('Roaring koncernstruktur: bolaget hittades inte i koncernlistan.');
  }
  if (out.length === 0) notes.push('Roaring koncernstruktur: inga ägare eller innehav (fristående bolag, eller fält som inte kändes igen).');
  return out;
}

/**
 * HELA koncernen ur den platta listan — varje bolag med moder och andel —
 * för bedömningen (§ 51): anknutna företag enligt bilaga I är alla bolag i
 * koncernen (moder, moderns moder, syskon, dotter), inte bara ägarkedjan.
 * Fysiska personer (personnummer-derivat) utelämnas; ett bolag med namn men
 * id i okänt format behålls utan org-nr (kan inte slås upp vidare).
 * `undefined` när svaret inte är i platt form.
 */
export function normalizeRoaringGroupMembers(raw: unknown, startupOrgNr: string): RegistryGroupMember[] | undefined {
  const root = firstRecord(raw);
  if (!root) return undefined;
  const items = roaringGroupList(root);
  if (!items) return undefined;
  const idOf = (rec: Record<string, unknown>) => asString(pickFirst(rec, GROUP_ID_KEYS));
  const nameOf = (rec: Record<string, unknown>) => asString(pickFirst(rec, GROUP_NAME_KEYS));
  const nameByRawId = new Map<string, string>();
  for (const rec of [root, ...items]) {
    const id = idOf(rec)?.trim();
    const name = nameOf(rec);
    if (id && name) nameByRawId.set(id, name);
  }
  const target = normalizeOrgNr(startupOrgNr) || startupOrgNr;
  const out: RegistryGroupMember[] = [];
  const seen = new Set<string>();
  // Kuvertet är det frågade bolaget — det får sin moder från listans post.
  const all = [...items];
  if (!items.some((r) => (normalizeOrgNr(idOf(r)) || idOf(r)) === target)) all.unshift(root);
  for (const rec of all) {
    const rawId = idOf(rec)?.trim();
    const orgNr = normalizeOrgNr(rawId) || undefined;
    if (orgNr && isPersonalOrgNr(orgNr)) continue;
    const name = nameOf(rec);
    if (!orgNr && !looksLikeCompanyName(name)) continue;
    const key = orgNr || `name:${(name || '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const motherRaw = asString(pickFirst(rec, GROUP_MOTHER_KEYS))?.trim();
    const motherOrg = normalizeOrgNr(motherRaw) || undefined;
    const member: RegistryGroupMember = {};
    if (isLegalEntityOrgNr(orgNr)) member.org_nr = orgNr;
    if (name) member.name = name;
    const level = asNumber(pickFirst(rec, ['companyLevel', 'level']));
    if (level !== undefined && Number.isInteger(level) && level >= 0 && level <= 20) member.level = level;
    if (motherOrg && isLegalEntityOrgNr(motherOrg) && !isPersonalOrgNr(motherOrg)) member.mother_org_nr = motherOrg;
    const motherName = motherRaw ? nameByRawId.get(motherRaw) : undefined;
    if (motherName && (!motherOrg || !isPersonalOrgNr(motherOrg))) member.mother_name = motherName;
    const pct = asPct(pickFirst(rec, PCT_PATHS));
    if (pct !== undefined) member.owned_pct = pct;
    out.push(member);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Koncernträdet → ägare (över startup-bolaget) och innehav (under). Hittas
 * bolaget i trädet är dess direkta förälder direkt ägare, högre led indirekta;
 * bolagets barn är innehav. Hittas det inte används rotens `owners`/`children`.
 */
export function normalizeRoaringGroupStructure(
  raw: unknown,
  startupOrgNr: string,
  notes: string[]
): RegistryOwnershipEntry[] {
  const root = toNode(firstRecord(raw));
  if (!root) {
    notes.push('Roaring koncernstruktur: tomt svar.');
    return [];
  }
  const target = normalizeOrgNr(startupOrgNr) || startupOrgNr;
  const rootRec = firstRecord(raw);
  const flat = rootRec ? normalizeFlatGroupStructure(rootRec, target, notes) : undefined;
  if (flat) return flat;

  const out: RegistryOwnershipEntry[] = [];
  const path = findPath(root, target, []);

  if (path) {
    const self = path[path.length - 1];
    const ancestors = path.slice(0, -1);
    ancestors.forEach((anc, idx) => {
      const isDirect = idx === ancestors.length - 1;
      // Andelen på ägaren = hur mycket ägaren äger av barnet (självt) — den
      // ligger på barnets nod i de flesta trädformat. Direkt ägare får därför
      // bolagets egen procent.
      const entry = companyEntry(anc, 'owner', !isDirect, notes);
      if (entry) {
        if (isDirect && self.pct !== undefined) entry.capital_pct = self.pct;
        if (isDirect && self.votes !== undefined) entry.voting_pct = self.votes;
        out.push(entry);
      }
    });
    for (const p of self.parents) {
      const e = companyEntry(p, 'owner', false, notes);
      if (e) out.push(e);
    }
    for (const c of self.children) {
      const e = companyEntry(c, 'holding', false, notes);
      if (e) out.push(e);
    }
  } else {
    // Roten är sannolikt bolaget självt eller dess yttersta moder.
    if (root.id && root.id !== target) {
      const e = companyEntry(root, 'owner', false, notes);
      if (e) out.push(e);
      notes.push('Roaring koncernstruktur: bolaget hittades inte i trädet — roten tolkad som ägare.');
    }
    for (const p of root.parents) {
      const e = companyEntry(p, 'owner', false, notes);
      if (e) out.push(e);
    }
    for (const c of root.children) {
      const e = companyEntry(c, root.id === target ? 'holding' : 'owner', false, notes);
      if (e) out.push(e);
    }
  }
  if (out.length === 0) notes.push('Roaring koncernstruktur: inga ägare eller innehav (fristående bolag, eller fält som inte kändes igen).');
  return out;
}

const BO_LIST_KEYS = ['beneficialOwners', 'owners', 'alternativeBeneficialOwners', 'persons', 'beneficialOwnerList'];
const BO_CAPITAL_PATHS = [
  'ownershipPercentInterval',
  'extentOfControl',
  'extentOfOwnership',
  'scopeOfControl',
  'controlExtent',
  'ownershipInterval',
  'ownershipShare',
  'ownership',
  'extent',
  'capital',
  'shareOfCapital',
  'capitalInterval',
  'ownedPercentage',
  'percentage',
  'share'
];
const BO_VOTES_PATHS = [
  'votesPercentInterval',
  'extentOfVotes',
  'extentOfVotingRights',
  'votingRights',
  'votesInterval',
  'votes',
  'shareOfVotes',
  'votingInterval'
];
const BO_CONTROL_PATHS = [
  'controlTypes',
  'controlType',
  'controlTypeCodes',
  'typesOfControl',
  'natureOfControl',
  'typeOfControl',
  'controlBasis',
  'control',
  'role'
];

const INTERVAL_LO_KEYS = ['from', 'min', 'lower', 'low', 'start', 'minimum', 'lowerLimit', 'fromPercent', 'minPercent', 'percentFrom', 'gte', 'gt'];
const INTERVAL_HI_KEYS = ['to', 'max', 'upper', 'high', 'end', 'maximum', 'upperLimit', 'toPercent', 'maxPercent', 'percentTo', 'lte', 'lt'];
const INTERVAL_TEXT_KEYS = ['text', 'description', 'desc', 'label', 'name', 'value', 'code', 'key', 'id', 'extent', 'interval', 'range', 'percent', 'percentage', 'share', 'ownership', 'control', 'type'];

/**
 * Tolkar ett kontrollintervall ur VILKEN rimlig form som helst: text ("25-50",
 * ">75", "Mer än 25 men inte mer än 50 procent"), kod ("MORE_THAN_75",
 * "MER_AN_25_MEN_INTE_MER_AN_50"), tal, objekt med gränser ({ from, to },
 * { percentFrom, percentTo }, { low, high } …), objekt med text/kod
 * ({ code, description }) eller ett nästlat objekt ({ interval: { … } }).
 * Kända nycklar provas först, därefter varje primitivt värde i objektet
 * (datum/id:n avvisas av parsern). Första tolkbara värdet vinner. Värden
 * lämnar aldrig funktionen — bara det tolkade intervallet.
 */
export function parseControlInterval(v: unknown, depth = 0): { min: number; max: number } | undefined {
  if (v === undefined || v === null || depth > 3) return undefined;
  if (Array.isArray(v)) {
    for (const x of v) {
      const r = parseControlInterval(x, depth + 1);
      if (r) return r;
    }
    return undefined;
  }
  if (typeof v !== 'object') return parsePctInterval(v);
  const o = v as Record<string, unknown>;
  const lo = asNumber(pickFirst(o, INTERVAL_LO_KEYS));
  const hi = asNumber(pickFirst(o, INTERVAL_HI_KEYS));
  if (lo !== undefined && hi !== undefined) return parsePctInterval(`${lo}-${hi}`);
  if (lo !== undefined) return parsePctInterval(`>${lo}`);
  if (hi !== undefined) return parsePctInterval(`<${hi}`);
  for (const key of INTERVAL_TEXT_KEYS) {
    const r = parseControlInterval(o[key], depth + 1);
    if (r) return r;
  }
  for (const key of Object.keys(o)) {
    if (INTERVAL_TEXT_KEYS.includes(key)) continue;
    const r = parseControlInterval(o[key], depth + 1);
    if (r) return r;
  }
  return undefined;
}

/**
 * Kontrollgrund kan vara text, kod, ett objekt ({ code, description }), en
 * lista av koder/objekt (flera grunder) eller ett objekt som bär listan
 * ({ types: [ … ] }). Första texten som ger en känd kategori vinner, annars
 * första text alls — den mappas ändå till fast vokabulär av
 * `controlBasisCategory` (leverantörens fritext når aldrig databasen).
 */
function controlText(v: unknown, depth = 0): unknown {
  if (v === undefined || v === null || depth > 3) return undefined;
  if (Array.isArray(v)) {
    let fallback: unknown;
    for (const x of v) {
      const t = controlText(x, depth + 1);
      if (!asString(t)) continue;
      if (controlBasisCategory(t) !== 'other') return t;
      fallback ??= t;
    }
    return fallback;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    let fallback: unknown;
    for (const key of ['text', 'description', 'desc', 'label', 'name', 'controlTypeText', 'code', 'controlTypeCode', 'type', 'value', 'key']) {
      const t = controlText(o[key], depth + 1);
      if (!asString(t)) continue;
      if (controlBasisCategory(t) !== 'other') return t;
      fallback ??= t;
    }
    // Objekt som bär listan under en okänd nyckel ({ types: [ … ] }).
    for (const key of Object.keys(o)) {
      if (Array.isArray(o[key]) || (o[key] && typeof o[key] === 'object')) {
        const t = controlText(o[key], depth + 1);
        if (asString(t) && controlBasisCategory(t) !== 'other') return t;
        fallback ??= t;
      }
    }
    return fallback;
  }
  return v;
}

/** Namnfält för en fysisk huvudman (2.1: `person{firstName,lastName}`; äldre: toppnivå). ALDRIG personnummer/födelsedatum. */
// OpenAPI se-beneficialowner 2.1 (mottagen 2026-10-19): `PersonDetails` =
// `firstNames[]` (LISTA), `middleName`, `surName`, `personalNumber`,
// `coordinationNumber`, `birthDate` (läses aldrig), `citizenship`, `countryResidence`.
const BO_FIRST_NAME_PATHS = ['person.firstNames', 'person.firstName', 'person.givenName', 'firstNames', 'firstName', 'givenName'];
const BO_MIDDLE_NAME_PATHS = ['person.middleName', 'middleName'];
const BO_LAST_NAME_PATHS = ['person.lastName', 'person.surName', 'person.surname', 'person.familyName', 'lastName', 'surName', 'surname', 'familyName'];
const BO_FULL_NAME_PATHS = ['person.name', 'person.fullName', 'fullName', 'name'];

/** För- och efternamn ur huvudmannens post — bara namnet, cappat, utan siffror (ett personnummer i namnfältet strippas). */
export function beneficialOwnerName(o: Record<string, unknown>): string | undefined {
  // Förnamn kan komma som lista (2.1: `firstNames: ["Anna", "Maria"]`).
  const names = (v: unknown): string | undefined =>
    Array.isArray(v) ? v.map((x) => asString(x)).filter(Boolean).join(' ') || undefined : asString(v);
  const first = names(pickFirst(o, BO_FIRST_NAME_PATHS));
  const middle = names(pickFirst(o, BO_MIDDLE_NAME_PATHS));
  const last = asString(pickFirst(o, BO_LAST_NAME_PATHS));
  const full = first || last ? [first, middle, last].filter(Boolean).join(' ') : asString(pickFirst(o, BO_FULL_NAME_PATHS));
  if (!full) return undefined;
  const cleaned = full.replace(/\d[\d\s-]*\d/g, '').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 120) : undefined;
}

/**
 * Verklig huvudman → person-rader med namn, andel/intervall och
 * kontrollgrund. Namnet (för-/efternamn) visas i förhandsgranskningen och i
 * Bedömning excellens (§ 51.11) — aldrig i `startup_ownership` eller AI.
 * Personnummer, födelsedatum och adress läses aldrig här.
 */
export function normalizeRoaringBeneficialOwners(raw: unknown, notes: string[]): RegistryOwnershipEntry[] {
  const rec = firstRecord(raw);
  if (!rec) {
    notes.push('Roaring verklig huvudman: tomt svar.');
    return [];
  }
  let list: unknown[] = [];
  for (const key of BO_LIST_KEYS) {
    const v = rec[key];
    if (Array.isArray(v)) {
      list = v;
      break;
    }
  }
  if (list.length === 0 && Array.isArray((raw as { records?: unknown[] })?.records)) {
    // Vissa versioner returnerar en post per huvudman direkt i records[].
    const recs = allRecords(raw);
    if (recs.length > 1 || (recs[0] && !BO_LIST_KEYS.some((k) => k in recs[0]))) list = recs;
  }
  if (list.length === 0) {
    const flag = pickFirst(rec, ['hasBeneficialOwners']);
    notes.push(
      flag === false
        ? 'Roaring verklig huvudman: bolaget har inga registrerade huvudmän (hasBeneficialOwners=false).'
        : 'Roaring verklig huvudman: inga registrerade huvudmän (eller fält som inte kändes igen).'
    );
    return [];
  }
  const out: RegistryOwnershipEntry[] = [];
  let unparsedIntervals = 0;
  let unparsedControl = 0;
  const shapes = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    // Juridisk person som huvudman (ovanligt men förekommer) — behåll org-nr/
    // namn BARA när org-nr:et är giltigt och inte ett personnummer-derivat.
    const rawId = asString(pickFirst(o, ['companyId', 'organisationNumber', 'orgNr', 'organizationNumber']));
    const candidateOrgNr = normalizeOrgNr(rawId);
    const legalOrgNr = isLegalEntityOrgNr(candidateOrgNr || undefined) ? candidateOrgNr : null;
    const companyName = asString(pickFirst(o, ['companyName', 'legalName']));
    // Bolagsnamn men okänt id-format (inte personnummer): behåll som bolag
    // utan org-nr — en huvudman som är juridisk person får inte försvinna.
    const namedCompany =
      !legalOrgNr && !!companyName && !(candidateOrgNr && isPersonalOrgNr(candidateOrgNr)) && looksLikeCompanyName(companyName);
    if (namedCompany) {
      notes.push(`Roaring verklig huvudman: juridisk person med id i okänt format (${describeIdShape(rawId)}) — behölls som bolag utan org-nr.`);
    }
    const capitalRaw = pickFirst(o, BO_CAPITAL_PATHS);
    const votesRaw = pickFirst(o, BO_VOTES_PATHS);
    const capital = parseControlInterval(capitalRaw);
    const votes = parseControlInterval(votesRaw);
    // Kontrollgrund mappas till fast vokabulär — leverantörens fritext når
    // aldrig databasen (kan bära namn).
    const controlRaw = pickFirst(o, BO_CONTROL_PATHS);
    const control = controlBasisCategory(controlText(controlRaw));
    if (capitalRaw !== undefined && !capital) {
      unparsedIntervals++;
      shapes.add(describeShape('extentOfControl', capitalRaw, 2));
    }
    if (controlRaw !== undefined && !control) {
      unparsedControl++;
      shapes.add(describeShape('controlTypes', controlRaw, 2));
    }
    const entry: RegistryOwnershipEntry = {
      direction: 'owner',
      owner_kind: legalOrgNr || namedCompany ? inferOwnerKindFromName(companyName, 'company') : 'person',
      control_basis: control
    };
    if (legalOrgNr) {
      entry.org_nr = legalOrgNr;
      entry.name = companyName;
    } else if (namedCompany) {
      entry.name = companyName;
    } else {
      const personName = beneficialOwnerName(o);
      if (personName) entry.person_name = personName;
    }
    if (capital) {
      if (capital.min === capital.max) entry.capital_pct = capital.min;
      entry.pct_min = capital.min;
      entry.pct_max = capital.max;
    }
    if (votes && votes.min === votes.max) entry.voting_pct = votes.min;
    out.push(entry);
  }
  // Fältet fanns men kunde inte tolkas: säg det, med FORMEN (nycklar, aldrig
  // värden) så kandidatlistan kan rättas — annars står huvudmannen tyst
  // utan intervall och screeningen (§ 51) tror att andelen är okänd.
  if (unparsedIntervals > 0) {
    notes.push(
      `Roaring verklig huvudman: kontrollintervall kunde inte tolkas för ${unparsedIntervals} huvudman/-män (form: ${[...shapes].join(', ')}) — kontrollera fältmappningen.`
    );
  } else if (unparsedControl > 0) {
    notes.push(
      `Roaring verklig huvudman: kontrollgrund kunde inte tolkas för ${unparsedControl} huvudman/-män (form: ${[...shapes].join(', ')}).`
    );
  }
  return out;
}

// ─── Ägarnas andra bolag (§ 51.11) ─────────────────────────────────────────

/** Fältnamn för en huvudmans personnummer (2.1: `person{…}`; äldre: toppnivå). */
const PNR_PATHS = [
  'person.personalNumber',
  'person.personalIdentityNumber',
  'person.personalIdNumber',
  'person.personNumber',
  'person.nationalIdentityNumber',
  'person.nationalId',
  'person.socialSecurityNumber',
  'person.identityNumber',
  'person.idNumber',
  'person.coordinationNumber',
  'personalNumber',
  'coordinationNumber',
  'personalIdentityNumber',
  'personNumber',
  'nationalIdentityNumber',
  'socialSecurityNumber'
];

/**
 * Personnummer eller samordningsnummer (10 eller 12 siffror, Luhn över de tio
 * sista) → siffrorna som de kom (12 behålls — Roaring tar båda). Allt annat ⇒ null.
 */
export function normalizePersonalNumber(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  const digits = s.replace(/[^0-9]/g, '');
  const ten = digits.length === 12 ? digits.slice(2) : digits.length === 10 ? digits : null;
  if (!ten) return null;
  const mm = Number(ten.slice(2, 4));
  const dd = Number(ten.slice(4, 6));
  if (mm < 1 || mm > 12) return null;
  if (!((dd >= 1 && dd <= 31) || (dd >= 61 && dd <= 91))) return null;
  return isValidOrgNr(ten) ? digits : null;
}

/**
 * En fysisk huvudman med det som behövs för att söka personens andra bolag.
 * `personalNumber` är TRANSIENT: bara Roaring-handlern läser den, för
 * uppslaget — den får aldrig hamna i RegistryCompany, noter, loggar eller DB.
 */
export interface RoaringBeneficialOwnerPerson {
  personalNumber?: string;
  name?: string;
  capital_pct?: number;
  pct_min?: number;
  pct_max?: number;
  control_basis?: string;
  /** Formen på posten (nycklar, aldrig värden) när personnumret saknas — för diagnosnoten. */
  shape?: string;
}

function beneficialOwnerItems(raw: unknown): Record<string, unknown>[] {
  const rec = firstRecord(raw);
  if (!rec) return [];
  for (const key of BO_LIST_KEYS) {
    const v = rec[key];
    if (Array.isArray(v)) return v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
  }
  const recs = allRecords(raw);
  if (recs.length > 1 || (recs[0] && !BO_LIST_KEYS.some((k) => k in recs[0]))) return recs;
  return [];
}

/** Fysiska huvudmän ur ett verklig huvudman-svar (juridiska personer utelämnas). */
export function roaringBeneficialOwnerPersons(raw: unknown): RoaringBeneficialOwnerPerson[] {
  const out: RoaringBeneficialOwnerPerson[] = [];
  for (const o of beneficialOwnerItems(raw)) {
    const rawId = asString(pickFirst(o, ['companyId', 'organisationNumber', 'orgNr', 'organizationNumber']));
    const org = normalizeOrgNr(rawId);
    if (isLegalEntityOrgNr(org || undefined)) continue;
    if (looksLikeCompanyName(asString(pickFirst(o, ['companyName', 'legalName'])))) continue;
    const capital = parseControlInterval(pickFirst(o, BO_CAPITAL_PATHS));
    const person: RoaringBeneficialOwnerPerson = {
      name: beneficialOwnerName(o),
      control_basis: controlBasisCategory(controlText(pickFirst(o, BO_CONTROL_PATHS)))
    };
    if (capital) {
      if (capital.min === capital.max) person.capital_pct = capital.min;
      person.pct_min = capital.min;
      person.pct_max = capital.max;
    }
    const pnr = normalizePersonalNumber(pickFirst(o, PNR_PATHS));
    if (pnr) person.personalNumber = pnr;
    else person.shape = 'person' in o ? describeShape('person', o.person, 1) : Object.keys(o).slice(0, 12).join(',');
    out.push(person);
  }
  return out;
}

const ENGAGEMENT_LIST_KEYS = [
  'beneficialOwnerships',
  'beneficialOwnerOf',
  'beneficialOwnerIn',
  'ownerships',
  'engagements',
  'companyEngagements',
  'companies',
  'legalEntities',
  'controls'
];
// OpenAPI 2.1 `/person/{personalNumber}` (2026-10-19): `records[]` med EN
// post per bolag: `association{companyId, companyName, type}` + `person{namn}`.
// Svaret bär INGEN andel/kontrollgrund — bara att personen är verklig
// huvudman (> 25 % eller kontroll på annat sätt).
const ENGAGEMENT_ID_PATHS = [
  'association.companyId',
  'legalEntity.companyId',
  'legalEntity.organisationNumber',
  'legalEntity.organizationNumber',
  'legalEntity.orgNr',
  'company.companyId',
  'company.organisationNumber',
  'companyId',
  'organisationNumber',
  'organizationNumber',
  'orgNr'
];
const ENGAGEMENT_NAME_PATHS = ['association.companyName', 'legalEntity.companyName', 'legalEntity.name', 'company.companyName', 'company.name', 'companyName', 'legalName'];

function hasEngagementCompany(o: Record<string, unknown>): boolean {
  return (
    pickFirst(o, ENGAGEMENT_ID_PATHS) !== undefined ||
    (!!o.legalEntity && typeof o.legalEntity === 'object') ||
    (!!o.association && typeof o.association === 'object')
  );
}

function sameTen(a: string, b: string): boolean {
  return a.slice(-10) === b.slice(-10);
}

/**
 * Verklig huvudman PER PERSON (`/se/beneficialowner/2.1/person/{personnummer}`)
 * → bolagen personen är huvudman för, med personens andel. Formen kan inte
 * verifieras från byggmiljön, så både "en post per bolag" (`legalEntity` +
 * `extentOfControl`, eller bolagets `beneficialOwners[]` där personen slås
 * upp på personnumret) och "en post per person med en lista bolag"
 * (`beneficialOwnerships[]` m.fl.) tolkas. Enskilda firmor (org-nr =
 * personnummer) och poster utan org-nr/bolagsnamn hoppas över.
 */
export function normalizeRoaringPersonEngagements(
  raw: unknown,
  personalNumber: string | undefined,
  notes: string[]
): RegistryEngagementCompany[] {
  const items: Record<string, unknown>[] = [];
  for (const rec of allRecords(raw)) {
    if (hasEngagementCompany(rec)) {
      items.push(rec);
      continue;
    }
    for (const key of ENGAGEMENT_LIST_KEYS) {
      const v = rec[key];
      if (!Array.isArray(v)) continue;
      for (const x of v) if (x && typeof x === 'object') items.push(x as Record<string, unknown>);
    }
  }
  const out: RegistryEngagementCompany[] = [];
  const seen = new Set<string>();
  let personal = 0;
  let unparsed = 0;
  for (const item of items) {
    const rawId = asString(pickFirst(item, ENGAGEMENT_ID_PATHS));
    const org = normalizeOrgNr(rawId) || undefined;
    if (org && isPersonalOrgNr(org)) {
      personal++;
      continue;
    }
    const name = asString(pickFirst(item, ENGAGEMENT_NAME_PATHS));
    const legal = isLegalEntityOrgNr(org) ? org : undefined;
    if (!legal && !looksLikeCompanyName(name)) {
      unparsed++;
      continue;
    }
    const key = legal ?? `name:${(name ?? '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Personens andel: på posten själv, annars i bolagets huvudmannalista
    // (matchad på personnumret, eller den enda raden).
    let source: Record<string, unknown> = item;
    if (pickFirst(item, BO_CAPITAL_PATHS) === undefined) {
      const list = BO_LIST_KEYS.map((k) => item[k]).find((v) => Array.isArray(v)) as unknown[] | undefined;
      const owners = (list ?? []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
      const match =
        (personalNumber
          ? owners.find((x) => {
              const p = normalizePersonalNumber(pickFirst(x, PNR_PATHS));
              return !!p && sameTen(p, personalNumber);
            })
          : undefined) ?? (owners.length === 1 ? owners[0] : undefined);
      if (match) source = match;
    }
    const capital = parseControlInterval(pickFirst(source, BO_CAPITAL_PATHS));
    const entry: RegistryEngagementCompany = {
      ...(legal ? { org_nr: legal } : {}),
      ...(name ? { name } : {}),
      control_basis: controlBasisCategory(controlText(pickFirst(source, BO_CONTROL_PATHS)))
    };
    if (capital) {
      if (capital.min === capital.max) entry.capital_pct = capital.min;
      entry.pct_min = capital.min;
      entry.pct_max = capital.max;
    }
    out.push(entry);
  }
  if (personal > 0) notes.push(`Roaring ägarnas andra bolag: ${personal} enskild(a) firma(or) hoppades över (org-nr = personnummer).`);
  if (unparsed > 0) notes.push(`Roaring ägarnas andra bolag: ${unparsed} post(er) utan org-nr/bolagsnamn kunde inte tolkas.`);
  return out;
}

export function normalizeRoaringCompany(
  orgNr: string,
  bundle: RoaringRawBundle,
  opts: { amountMultiplier?: number; isPersonal: boolean }
): RegistryCompany {
  const notes: string[] = [];
  // Grunddata normaliseras bara när den delen hämtades (valbara delar, § 11.8)
  // — annars skulle "tomt svar" noteras för ett API som aldrig anropades.
  const { name, patch, sni } =
    'overview' in bundle ? normalizeRoaringOverview(bundle.overview, notes) : { name: undefined, patch: {}, sni: [] as RegistrySni[] };
  const financials = bundle.financials
    ? normalizeRoaringFinancials(bundle.financials, notes, opts.amountMultiplier ?? 1)
    : [];
  const ownership = opts.isPersonal
    ? []
    : dedupeOwnership([
        ...(bundle.groupStructure
          ? normalizeRoaringGroupStructure(bundle.groupStructure, orgNr, notes).map((e) => ({
              ...e,
              part: 'group_structure' as const
            }))
          : []),
        ...(bundle.beneficialOwners
          ? normalizeRoaringBeneficialOwners(bundle.beneficialOwners, notes).map((e) => ({
              ...e,
              part: 'beneficial_owners' as const
            }))
          : [])
      ]);
  const group = !opts.isPersonal && bundle.groupStructure ? normalizeRoaringGroupMembers(bundle.groupStructure, orgNr) : undefined;
  return {
    org_nr: orgNr,
    isPersonal: opts.isPersonal,
    name,
    startup: patch,
    financials,
    ownership,
    group,
    ...(sni.length > 0 ? { sni } : {}),
    notes
  };
}
