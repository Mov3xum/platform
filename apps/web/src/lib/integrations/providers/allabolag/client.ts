import 'server-only';

// Allabolag client — leverantörsagnostisk stub.
//
// Allabolag.se saknar officiellt publikt API. Det finns flera vägar
// (Bolagsverket, Roaring, Creditsafe, eller licensierad scrape) som
// alla returnerar samma normaliserade form. Vi väljer leverantör via
// MOVEXUM_ALLABOLAG_PROVIDER-env och plugar in HTTP-klienten i en
// uppföljande PR. Tills dess kastar produktionslägen ett tydligt
// fel — 'mock' returnerar en deterministisk fixture för
// utveckling/staging.

export type AllabolagProvider =
  | 'mock'
  | 'bolagsverket'
  | 'roaring'
  | 'creditsafe';

export interface AllabolagFinancialsYear {
  year: number;
  employees?: number;
  revenue_sek?: number;
  personnel_cost_sek?: number;
  corporate_tax_sek?: number;
}

export interface AllabolagCompany {
  org_nr: string;
  bolagsform?: string;
  kommun?: string;
  industri?: string;
  bolag_status?: string;
  // Sant när org-nr motsvarar enskild firma (personnummer-derivat).
  // Plattformen lagrar fortfarande financials (publik via årsredovisning)
  // men flaggan följer med så framtida features kan respektera den.
  isPersonal: boolean;
  financials: AllabolagFinancialsYear[];
}

export class AllabolagNotImplementedError extends Error {
  code = 'ALLABOLAG_PROVIDER_NOT_CHOSEN';
  constructor(provider: string | undefined) {
    super(
      provider
        ? `Allabolag-leverantör "${provider}" är inte implementerad än.`
        : 'Allabolag-leverantör är inte vald. Sätt MOVEXUM_ALLABOLAG_PROVIDER i Coolify.'
    );
    this.name = 'AllabolagNotImplementedError';
  }
}

function readProvider(): AllabolagProvider | undefined {
  const raw = (process.env.MOVEXUM_ALLABOLAG_PROVIDER || '').trim();
  if (!raw) return undefined;
  if (
    raw === 'mock' ||
    raw === 'bolagsverket' ||
    raw === 'roaring' ||
    raw === 'creditsafe'
  ) {
    return raw;
  }
  return undefined;
}

export function isProviderConfigured(): boolean {
  return readProvider() !== undefined;
}

// Deterministisk hash → siffra. Används i mock-läget för att samma
// org-nr alltid ger samma fixture (idempotens i tester).
function seededInt(seed: string, min: number, max: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  }
  const span = max - min + 1;
  return min + (Math.abs(h) % span);
}

function isPersonalOrgNr(orgNr: string): boolean {
  // Aktiebolag har org-nr som börjar med 55. Enskild firma och andra
  // personnummer-derivat börjar med 19/20 (födelseår). Defense-in-depth
  // — exakt regelverk är mer nyanserat, men 55xxxx-fångar > 99% av
  // ABs och 19/20 fångar personnummer-baserade former.
  const digits = orgNr.replace(/[^0-9]/g, '');
  if (digits.length < 6) return false;
  return digits.startsWith('19') || digits.startsWith('20');
}

function mockFetch(orgNr: string): AllabolagCompany {
  const employees = seededInt(orgNr + 'emp', 1, 25);
  const revenueBase = seededInt(orgNr + 'rev', 500, 50000) * 1000;
  const personnelBase = Math.round(revenueBase * 0.35);
  const tax = Math.round(revenueBase * 0.04);
  const isPersonal = isPersonalOrgNr(orgNr);

  const currentYear = new Date().getFullYear();
  const financials: AllabolagFinancialsYear[] = [];
  for (let i = 0; i < 3; i++) {
    const year = currentYear - 1 - i;
    const factor = 1 - i * 0.1;
    financials.push({
      year,
      employees: Math.max(1, Math.round(employees * factor)),
      revenue_sek: Math.round(revenueBase * factor),
      personnel_cost_sek: Math.round(personnelBase * factor),
      corporate_tax_sek: Math.round(tax * factor)
    });
  }

  const kommuner = ['Gävle', 'Sandviken', 'Hudiksvall', 'Söderhamn', 'Bollnäs'];
  const industrier = [
    'Tjänster',
    'Tillverkning',
    'Handel',
    'IT & telekom',
    'Energi'
  ];

  return {
    org_nr: orgNr,
    bolagsform: isPersonal ? 'enskild_firma' : 'aktiebolag',
    kommun: kommuner[seededInt(orgNr + 'k', 0, kommuner.length - 1)],
    industri: industrier[seededInt(orgNr + 'i', 0, industrier.length - 1)],
    bolag_status: 'aktiv',
    isPersonal,
    financials
  };
}

export async function fetchCompanyByOrgNr(
  orgNr: string,
  _creds: Record<string, string>
): Promise<AllabolagCompany> {
  const cleaned = orgNr.trim();
  if (!cleaned) {
    throw new Error('Tomt organisationsnummer.');
  }

  const provider = readProvider();
  if (!provider) {
    throw new AllabolagNotImplementedError(undefined);
  }
  if (provider === 'mock') {
    return mockFetch(cleaned);
  }
  // bolagsverket/roaring/creditsafe — väntar på leverantörsval.
  throw new AllabolagNotImplementedError(provider);
}
