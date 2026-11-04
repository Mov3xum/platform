/**
 * Etikettregister för brödsmulorna (klientminne, ren modul).
 *
 * Sidor med dynamiska segment (bolag, ärenden …) registrerar vad sökvägarna
 * heter via `<CrumbLabels>`; topbaren prenumererar med `useSyncExternalStore`.
 * Etiketterna är visningsnamn som sidan redan renderar — ingen ny dataväg.
 */
type Labels = Readonly<Record<string, string>>;

const EMPTY: Labels = Object.freeze({});
const entries = new Map<string, string>();
const listeners = new Set<() => void>();
let snapshot: Labels = EMPTY;

function publish() {
  snapshot = Object.freeze(Object.fromEntries(entries));
  for (const fn of listeners) fn();
}

/** Registrerar etiketter och returnerar en funktion som tar bort exakt dem igen. */
export function registerCrumbLabels(labels: Labels): () => void {
  for (const [href, label] of Object.entries(labels)) entries.set(href, label);
  publish();
  return () => {
    let changed = false;
    for (const [href, label] of Object.entries(labels)) {
      if (entries.get(href) === label) {
        entries.delete(href);
        changed = true;
      }
    }
    if (changed) publish();
  };
}

export function subscribeCrumbLabels(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getCrumbLabels(): Labels {
  return snapshot;
}

export function getServerCrumbLabels(): Labels {
  return EMPTY;
}
