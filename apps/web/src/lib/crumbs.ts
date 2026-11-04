/**
 * Brödsmulor i topbaren (ren modul, enhetstestad).
 *
 * Sökvägen byggs av tre lager: modulens titel (första segmentet), kända
 * undersidor (`routeLabels` — Inställningar-sektioner, fasta sidor som
 * "Nytt bolag"/"Jämförelser") och etiketter som SIDAN registrerat för sina
 * dynamiska segment (`labels`, via `<CrumbLabels>`: bolagsnamn för ett
 * record-id, sidans rubrik för en slug). Ett segment som ser ut som ett
 * PocketBase-id visas ALDRIG rått: utan registrerad etikett visas en
 * platshållare tills sidan hunnit tala om vad posten heter.
 */

export interface Crumb {
  label: string;
  href: string;
  now: boolean;
}

export interface CrumbSources {
  /** Modulregistret: route + titel (och id för moduler som flyttat in under Inställningar). */
  modules: ReadonlyArray<{ id: string; route: string; title: string }>;
  /** Fasta etiketter per sökväg (Inställningar-sektioner, fasta undersidor). */
  routeLabels: Readonly<Record<string, string>>;
  /** Etiketter registrerade av den renderade sidan, per sökväg. */
  labels: Readonly<Record<string, string>>;
}

/** PocketBase-id: exakt 15 tecken a–z/0–9. */
export function looksLikeRecordId(segment: string): boolean {
  return /^[a-z0-9]{15}$/.test(segment);
}

export const ID_PLACEHOLDER = '…';

/** Fasta undersidor som inte är moduler eller Inställningar-sektioner. */
export const STATIC_ROUTE_LABELS: Readonly<Record<string, string>> = {
  '/impactnavigator/ny': 'Nytt bolag',
  '/impactnavigator/jamfor': 'Jämförelser'
};

function humanize(segment: string): string {
  return decodeURIComponent(segment).replace(/[-_]/g, ' ');
}

export function buildCrumbs(pathname: string, sources: CrumbSources): Crumb[] {
  if (pathname === '/' || pathname === '/hem') {
    return [{ label: 'Översikt', href: '/hem', now: true }];
  }
  const seg = pathname.split('/').filter(Boolean);
  const crumbs: Crumb[] = [{ label: 'Översikt', href: '/hem', now: false }];
  // Första segmentet = modulen. Moduler vars route flyttat in under Inställningar
  // (t.ex. integrationer → /installningar/integrationer) matchas på id så
  // detaljsidorna under den gamla adressen behåller sin riktiga titel.
  const mod = sources.modules.find((m) => m.route === '/' + seg[0]) ?? sources.modules.find((m) => m.id === seg[0]);
  if (mod) {
    crumbs.push({ label: mod.title, href: mod.route, now: seg.length === 1 });
  } else {
    crumbs.push({ label: humanize(seg[0]), href: '/' + seg[0], now: seg.length === 1 });
  }
  for (let i = 1; i < seg.length; i++) {
    const href = '/' + seg.slice(0, i + 1).join('/');
    const known =
      sources.labels[href] ??
      sources.routeLabels[href] ??
      sources.modules.find((m) => m.route === href)?.title;
    const label = known ?? (looksLikeRecordId(seg[i]) ? ID_PLACEHOLDER : humanize(seg[i]));
    crumbs.push({ label, href, now: i === seg.length - 1 });
  }
  return crumbs;
}
