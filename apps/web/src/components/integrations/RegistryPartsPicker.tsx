'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  REGISTRY_PART_META,
  type RegistryPartId
} from '@/lib/integrations/company-registry/parts';

// Kryssrutor för vilka datadelar som hämtas från ett bolagsregister
// (CLAUDE.md § 11.8). Varje del motsvarar ett API-anrop hos leverantören;
// endpointen visas så personalen ser exakt vad som anropas. Valet skickas som
// `parts` + markören `parts_present` och valideras server-side mot providerns
// deklarerade delar. Senaste val sparas per leverantör i webbläsaren
// (bekvämlighet, ingen datakälla).

const STORAGE_PREFIX = 'movexum-registry-parts-';

function readStored(slug: string, supported: RegistryPartId[]): RegistryPartId[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + slug);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const picked = supported.filter((p) => parsed.includes(p));
    return picked.length > 0 ? picked : null;
  } catch {
    return null;
  }
}

/** Valet av delar för en leverantör — alla delar förvalda, senaste val återställs. */
export function useRegistryPartSelection(providerSlug: string, supported: RegistryPartId[]) {
  const [selected, setSelected] = useState<RegistryPartId[]>(supported);
  const key = supported.join(',');

  useEffect(() => {
    const stored = readStored(providerSlug, key.split(',') as RegistryPartId[]);
    if (stored) setSelected(stored);
  }, [providerSlug, key]);

  const persist = useCallback(
    (next: RegistryPartId[]) => {
      setSelected(next);
      try {
        window.localStorage.setItem(STORAGE_PREFIX + providerSlug, JSON.stringify(next));
      } catch {
        // privat läge / blockerad lagring — valet gäller ändå för sidan
      }
    },
    [providerSlug]
  );

  const toggle = useCallback(
    (id: RegistryPartId) => {
      const has = selected.includes(id);
      persist(supported.filter((p) => (p === id ? !has : selected.includes(p))));
    },
    [persist, selected, supported]
  );

  const setAll = useCallback((on: boolean) => persist(on ? [...supported] : []), [persist, supported]);

  return { selected, toggle, setAll };
}

interface Props {
  supported: RegistryPartId[];
  selected: RegistryPartId[];
  onToggle(id: RegistryPartId): void;
  onSetAll(on: boolean): void;
  endpoints?: Partial<Record<RegistryPartId, string>>;
  providerName: string;
  /** Förklaring under rubriken (t.ex. att inget sparas i förhandsgranskningen). */
  hint?: string;
  disabled?: boolean;
}

export function RegistryPartsPicker({
  supported,
  selected,
  onToggle,
  onSetAll,
  endpoints,
  providerName,
  hint,
  disabled
}: Props) {
  const allOn = selected.length === supported.length;
  return (
    <fieldset className="rounded-xl border border-default bg-canvas-subtle px-3 py-3" disabled={disabled}>
      <input type="hidden" name="parts_present" value="1" />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <legend className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
          Vad ska hämtas från {providerName}?
        </legend>
        <button
          type="button"
          onClick={() => onSetAll(!allOn)}
          className="text-[12px] font-semibold text-link hover:underline"
        >
          {allOn ? 'Avmarkera alla' : 'Markera alla'}
        </button>
      </div>
      {hint && <p className="mt-1 text-[12px] text-foreground-muted">{hint}</p>}
      <ul className="mt-2 space-y-2">
        {supported.map((id) => {
          const meta = REGISTRY_PART_META[id];
          const endpoint = endpoints?.[id];
          return (
            <li key={id}>
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  name="parts"
                  value={id}
                  checked={selected.includes(id)}
                  onChange={() => onToggle(id)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-foreground">{meta.label}</span>
                  <span className="block text-[12px] text-foreground-muted">{meta.description}</span>
                  {endpoint && (
                    <span className="mx-tnum block break-all text-[11px] text-foreground-subtle">
                      GET {endpoint}
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {selected.length === 0 && (
        <p className="mt-2 text-[12px] text-movexum-morkorange dark:text-movexum-pastell-orange">
          Välj minst en del att hämta.
        </p>
      )}
    </fieldset>
  );
}
