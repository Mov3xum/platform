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
 * Dataminimering (CLAUDE.md § 11.4): verklig huvudman/styrelse innehåller
 * namn och personnummer. Normaliseraren tar ENBART andel/kontrollintervall
 * och kontrollgrund per person — inget namn, inget födelsedatum, inget
 * personnummer lämnar den här funktionen.
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
  type RegistryFinancialsYear,
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

export function normalizeRoaringOverview(raw: unknown, notes: string[]): {
  name?: string;
  patch: RegistryStartupPatch;
} {
  const rec = firstRecord(raw);
  const patch: RegistryStartupPatch = {};
  if (!rec) {
    notes.push('Roaring overview: tomt svar.');
    return { patch };
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

  return { name, patch };
}

const YEAR_PATHS = ['toDate', 'accountsClosingDate', 'periodEnd', 'period.toDate', 'endDate', 'year', 'fiscalYear'];
// Omsättning: `plSales` = nettoomsättning (det SMF-definitionen/art. 22
// GBER räknar på); `plNetOperatingIncome` = rörelsens intäkter inkl. övriga
// rörelseintäkter (economy-overview 2.1 bär båda, med `plEbit` separat).
// Avviker de noteras det så värdet kan jämföras mot ett facit (Allabolag).
const REVENUE_PATHS = ['plSales', 'plNetOperatingIncome', 'netTurnover', 'netSales', 'turnover', 'revenue', 'plNetSales', 'pl.netOperatingIncome'];
const OPERATING_INCOME_PATHS = ['plNetOperatingIncome', 'pl.netOperatingIncome'];
const EMPLOYEES_PATHS = ['nbrOfEmployees', 'numberOfEmployees', 'employees', 'averageNumberOfEmployees'];
const PERSONNEL_PATHS = ['plPersonnelCosts', 'personnelCosts', 'staffCosts', 'salariesAndRemuneration'];
const TAX_PATHS = ['plTaxOnProfit', 'taxOnProfit', 'incomeTax', 'plTax'];
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
    // Senaste raden per år vinner (Roaring kan ge flera perioder).
    byYear.set(year, { ...(byYear.get(year) || { year }), ...entry });
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
 * ANONYM person-rad: inget namn, inget org-nr — bara andel (GDPR § 5).
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
    return {
      direction,
      owner_kind: 'person',
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
function normalizeFlatGroupStructure(
  root: Record<string, unknown>,
  target: string,
  notes: string[]
): RegistryOwnershipEntry[] | undefined {
  const raw = pickFirst(root, ['groupCompanies']);
  if (!Array.isArray(raw)) return undefined;
  const items = raw.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
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
  const motherOf = (rec: Record<string, unknown>) =>
    graphKey(asString(pickFirst(rec, ['motherCompanyId', 'parentCompanyId', 'motherId', 'parentId'])));
  if (!items.some((x) => motherOf(x))) return undefined;

  const ID_KEYS = ['companyId', 'orgNr', 'organisationNumber', 'organizationNumber'];
  const asNode = (rec: Record<string, unknown>): GroupNode => ({
    id: normalizeOrgNr(asString(pickFirst(rec, ID_KEYS))) || undefined,
    rawId: asString(pickFirst(rec, ID_KEYS)),
    name: asString(pickFirst(rec, ['companyName', 'name', 'legalName'])),
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

const BO_LIST_KEYS = ['beneficialOwners', 'owners', 'alternativeBeneficialOwners', 'persons'];
const BO_CAPITAL_PATHS = ['ownershipPercentInterval', 'extentOfControl', 'extentOfOwnership', 'ownershipInterval', 'ownership', 'extent', 'capital', 'shareOfCapital', 'capitalInterval', 'ownedPercentage'];
const BO_VOTES_PATHS = ['votesPercentInterval', 'extentOfVotes', 'votesInterval', 'votes', 'shareOfVotes', 'votingInterval'];
const BO_CONTROL_PATHS = ['controlTypes', 'controlType', 'controlTypeCodes', 'natureOfControl', 'typeOfControl', 'controlBasis', 'control', 'role'];

/**
 * Intervall kan komma som text ("25-50", ">75") eller som objekt
 * ({ from, to } / { min, max } / { lower, upper }, ev. med en text) —
 * normaliseras till text som `parsePctInterval` förstår.
 */
function intervalText(v: unknown): unknown {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
  const o = v as Record<string, unknown>;
  const lo = asNumber(pickFirst(o, ['from', 'min', 'lower', 'fromPercent', 'minPercent']));
  const hi = asNumber(pickFirst(o, ['to', 'max', 'upper', 'toPercent', 'maxPercent']));
  if (lo !== undefined && hi !== undefined) return `${lo}-${hi}`;
  if (lo !== undefined) return `>${lo}`;
  if (hi !== undefined) return `<${hi}`;
  return pickFirst(o, ['text', 'description', 'code']);
}

/**
 * Kontrollgrund kan vara text, ett objekt eller en lista av koder/objekt
 * (flera grunder). Första igenkännbara texten används — den mappas ändå till
 * fast vokabulär av `controlBasisCategory`.
 */
function controlText(v: unknown): unknown {
  const one = (x: unknown): unknown =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? pickFirst(x, ['text', 'description', 'controlTypeText', 'code', 'controlTypeCode'])
      : x;
  if (Array.isArray(v)) {
    for (const x of v) {
      const t = one(x);
      if (asString(t)) return t;
    }
    return undefined;
  }
  return one(v);
}

/**
 * Verklig huvudman → anonyma person-rader. Läser INTE namn, personnummer,
 * födelsedatum eller adress — bara andel/intervall och kontrollgrund.
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
    const capital = parsePctInterval(intervalText(capitalRaw));
    const votes = parsePctInterval(intervalText(votesRaw));
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

export function normalizeRoaringCompany(
  orgNr: string,
  bundle: RoaringRawBundle,
  opts: { amountMultiplier?: number; isPersonal: boolean }
): RegistryCompany {
  const notes: string[] = [];
  // Grunddata normaliseras bara när den delen hämtades (valbara delar, § 11.8)
  // — annars skulle "tomt svar" noteras för ett API som aldrig anropades.
  const { name, patch } =
    'overview' in bundle ? normalizeRoaringOverview(bundle.overview, notes) : { name: undefined, patch: {} };
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
  return {
    org_nr: orgNr,
    isPersonal: opts.isPersonal,
    name,
    startup: patch,
    financials,
    ownership,
    notes
  };
}
