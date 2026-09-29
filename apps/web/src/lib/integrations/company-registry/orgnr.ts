/**
 * Organisationsnummer — REN modul (ingen IO, inget `server-only`) så den kan
 * enhetstestas (`orgnr.test.ts`). Delas av alla bolagsregister-providers
 * (Roaring, Bolagsverket, Allabolag-stubben) och av AI-kontextbyggaren.
 *
 * Svenskt organisationsnummer: 10 siffror, valfritt bindestreck före de fyra
 * sista (`559572-8790`). Sista siffran är en Luhn-kontrollsiffra över de nio
 * första. Tredje siffran ≥ 2 för juridiska personer; enskild firma använder
 * innehavarens personnummer (månad 01–12 → tredje siffran 0/1), vilket är
 * anledningen till att `isPersonalOrgNr` finns — org-nr för enskild firma ÄR
 * en personuppgift (CLAUDE.md § 9.3) och får varken loggas i klartext eller
 * nå AI-kontexten.
 */

/** Tar bort bindestreck/mellanslag och ett ev. sekelprefix (16xxxxxxxxxx). */
export function normalizeOrgNr(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/[^0-9]/g, '');
  if (digits.length === 12 && digits.startsWith('16')) digits = digits.slice(2);
  if (digits.length !== 10) return null;
  return digits;
}

/** Luhn-kontroll (mod 10) över de tio siffrorna. */
export function isValidOrgNr(raw: string | null | undefined): boolean {
  const digits = normalizeOrgNr(raw);
  if (!digits) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let n = Number(digits[i]);
    if (i % 2 === 0) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/**
 * Sant när org-nr:et är ett personnummer-derivat (enskild firma). Tredje
 * siffran i ett organisationsnummer för juridisk person är alltid ≥ 2;
 * för fysisk person är den månadens tiotal (0 eller 1).
 */
export function isPersonalOrgNr(raw: string | null | undefined): boolean {
  const digits = normalizeOrgNr(raw);
  if (!digits) return false;
  return Number(digits[2]) < 2;
}

/** `5595728790` → `559572-8790` (visningsform). */
export function formatOrgNr(raw: string | null | undefined): string | null {
  const digits = normalizeOrgNr(raw);
  if (!digits) return null;
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
}
