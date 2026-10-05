import 'server-only';
import type PocketBase from 'pocketbase';
import { escFilter } from '@/lib/pb-filter';
import { getSuperuserPb } from '../credentials';

/**
 * Katalograder för bolagsregister-providrarna (CLAUDE.md § 11.8) — SPEGEL av
 * migration 1700000173. Katalogen (`integration_providers`) seedas normalt av
 * migrationerna, som bara körs när PB-imagen byggs om; web-appen deployas
 * oftare. En instans där migrationen inte hunnit köras saknar därmed Roaring/
 * Bolagsverket i katalogen fastän handlern finns i koden → kortet syns inte
 * och `connectIntegrationAction` svarar "Leverantören finns inte i katalogen".
 *
 * `ensureRegistryProviderRows` självläker det på samma sätt som årshjulets
 * schema-reparation (§ 30.4 p. 4): saknade rader upsertas via den cachade
 * superusern (createRule är admin-only), idempotent på slug. Ändra texterna
 * HÄR och i migrationen samtidigt.
 */
export interface RegistryProviderSeed {
  slug: string;
  name: string;
  category: 'company_registry';
  placeholder: string;
  tagline: string;
  description: string;
  features: string[];
  availability: 'available';
  sort_order: number;
}

export const REGISTRY_PROVIDER_SEED: readonly RegistryProviderSeed[] = [
  {
    slug: 'roaring',
    name: 'Roaring',
    category: 'company_registry',
    placeholder: 'RO',
    tagline: 'Bolagsdata, ägarbild & årsredovisningar (SE)',
    description:
      'Hämtar grunddata (bolagsform, säte, SNI, status, registreringsdatum), årsredovisningsposter (omsättning, anställda, balansomslutning, eget kapital), koncernstruktur och verklig huvudman för bolag med organisationsnummer. Skriver till bolagskortet, den finansiella historiken och ägarbilden — underlag för screening mot art. 22 GBER / de minimis och Vinnovas målgruppskriterier. Fysiska personer lagras utan namn och personnummer.',
    features: [
      'Grunddata + registreringsdatum till bolagskortet',
      'Årsvis omsättning, anställda, balansomslutning och eget kapital',
      'Ägarbild: bolagsägare med org-nr och andel, fysiska personer bara som andel',
      'Idempotent — ägarbilden ersätts per synk, årsrader upsertas per (bolag, år)',
      'Svensk leverantör, EU-hostat'
    ],
    availability: 'available',
    sort_order: 11
  },
  {
    slug: 'bolagsverket',
    name: 'Bolagsverket',
    category: 'company_registry',
    placeholder: 'BV',
    tagline: 'Värdefulla datamängder — primärkälla (SE)',
    description:
      'Bolagsverkets kostnadsfria API för värdefulla datamängder: officiellt namn, bolagsform, registreringsdatum, SNI-kod, status och säte för alla registrerade företag. Primärkälla för grunddata på bolagskortet. Ägarbild och bokslutssiffror ingår inte (årsredovisningar levereras som dokument, inte som poster).',
    features: [
      'Officiell grunddata direkt från registret',
      'Registreringsdatum för 5-årsregeln (art. 22 GBER)',
      'SNI-kod och bolagsstatus',
      'Kostnadsfritt, OAuth2 client credentials',
      'Svensk myndighet — ingen tredjelandsöverföring'
    ],
    availability: 'available',
    sort_order: 12
  }
];

export interface EnsureRegistryProvidersResult {
  /** Slugs som skapades/aktiverades i det här anropet. */
  created: string[];
  /** Slugs som fortfarande saknas, med PII-fri orsak. */
  missing: Array<{ slug: string; reason: string }>;
}

function statusOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const s = (err as { status?: unknown }).status;
    return typeof s === 'number' ? s : undefined;
  }
  return undefined;
}

function describeFailure(err: unknown): string {
  const status = statusOf(err);
  if (status === 400) {
    return 'PocketBase avvisade raden (troligen saknar category-enumet värdet "company_registry" — kör migration 1700000173 eller "Sync PocketBase").';
  }
  if (status === 403 || status === 404) {
    return 'Superusern fick inte skriva till integration_providers.';
  }
  return 'Kunde inte nå PocketBase.';
}

/**
 * Ser till att katalogen har en aktiv rad per bolagsregister-provider i
 * `wantedSlugs` (default: hela seed-listan). Fail-soft: saknas superuser
 * rapporteras varje saknad slug med orsak, inget kastas. Läser först med den
 * medskickade (RLS-scopade) klienten så att ett friskt system aldrig gör en
 * superuser-inloggning i onödan.
 */
export async function ensureRegistryProviderRows(
  pb: PocketBase,
  wantedSlugs?: readonly string[]
): Promise<EnsureRegistryProvidersResult> {
  const seeds = REGISTRY_PROVIDER_SEED.filter(
    (s) => !wantedSlugs || wantedSlugs.includes(s.slug)
  );
  if (seeds.length === 0) return { created: [], missing: [] };

  const present = new Set<string>();
  try {
    const filter = seeds.map((s) => `slug = "${escFilter(s.slug)}"`).join(' || ');
    const res = await pb
      .collection('integration_providers')
      .getList<{ slug: string; active?: boolean }>(1, seeds.length, {
        filter: `(${filter}) && active = true`,
        fields: 'id,slug,active'
      });
    for (const row of res.items) present.add(row.slug);
  } catch (error) {
    // Ett läsfel får inte trigga en skrivning — rapportera och avbryt.
    console.error('[integrations] failed to read registry providers', { error });
    return {
      created: [],
      missing: seeds.map((s) => ({ slug: s.slug, reason: 'Katalogen kunde inte läsas.' }))
    };
  }

  const toSeed = seeds.filter((s) => !present.has(s.slug));
  if (toSeed.length === 0) return { created: [], missing: [] };

  const su = await getSuperuserPb();
  if (!su.ok) {
    return {
      created: [],
      missing: toSeed.map((s) => ({
        slug: s.slug,
        reason:
          'Katalograden saknas och ingen superuser är konfigurerad (POCKETBASE_SUPERUSER_EMAIL/PASSWORD) — kör migration 1700000173 eller "Sync PocketBase".'
      }))
    };
  }

  const created: string[] = [];
  const missing: EnsureRegistryProvidersResult['missing'] = [];
  for (const seed of toSeed) {
    try {
      let existingId: string | null = null;
      try {
        const row = await su.pb
          .collection('integration_providers')
          .getFirstListItem<{ id: string }>(`slug = "${escFilter(seed.slug)}"`, {
            fields: 'id'
          });
        existingId = row.id;
      } catch {
        existingId = null;
      }
      const payload = { ...seed, active: true };
      if (existingId) {
        await su.pb.collection('integration_providers').update(existingId, payload);
      } else {
        await su.pb.collection('integration_providers').create(payload);
      }
      created.push(seed.slug);
    } catch (error) {
      console.error('[integrations] failed to seed registry provider', {
        slug: seed.slug,
        status: statusOf(error)
      });
      missing.push({ slug: seed.slug, reason: describeFailure(error) });
    }
  }
  return { created, missing };
}
