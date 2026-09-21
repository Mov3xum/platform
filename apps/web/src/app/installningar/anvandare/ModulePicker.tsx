'use client';

import { RAIL_GROUPS, MEMBER_RAIL } from '@platform/shared';
import type { ToggleableModule } from '@/lib/users/validate';

/**
 * Kryssrutor för vilka moduler som visas i sidofältet för en person
 * (CLAUDE.md § 36.3). Grupperas som railen ("Översikt", "Portfölj" …) så
 * staff känner igen sig. Ren presentation — säkerhetsgränsen är rollen +
 * `validateEnabledModules` server-side.
 */
export function ModulePicker({
  modules,
  selected,
  defaults,
  onChange,
  disabled = false
}: {
  /** Moduler som rollen/rollerna tillåter (togglebara). */
  modules: ToggleableModule[];
  selected: string[];
  /** Rollens standard — visas som chip och används av "Återställ". */
  defaults: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const toggle = (id: string, on: boolean) =>
    onChange(on ? Array.from(new Set([...selected, id])) : selected.filter((x) => x !== id));

  const byId = new Map(modules.map((m) => [m.id, m]));
  const memberIds = new Set(MEMBER_RAIL.map((m) => m.id));
  const groups: { label: string; ids: string[] }[] = RAIL_GROUPS.map((g) => ({
    label: g.label,
    ids: g.modules.filter((id) => byId.has(id))
  }));
  // Medlemsmoduler som inte redan ligger i en rail-grupp (t.ex. mina_aktiviteter).
  const placed = new Set(groups.flatMap((g) => g.ids));
  const memberOnly = modules.map((m) => m.id).filter((id) => !placed.has(id) && memberIds.has(id));
  const rest = modules.map((m) => m.id).filter((id) => !placed.has(id) && !memberIds.has(id));
  if (memberOnly.length > 0) groups.push({ label: 'Bolagsmedlem', ids: memberOnly });
  if (rest.length > 0) groups.push({ label: 'Övrigt', ids: rest });

  const isDefault =
    selected.length === defaults.length && defaults.every((id) => selected.includes(id));

  if (modules.length === 0) {
    return (
      <p className="text-[12px] text-foreground-subtle">
        Rollen har inga valbara moduler.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-foreground-subtle">
          {selected.length} av {modules.length} moduler visas i sidofältet.
          {isDefault ? ' Rollens standard.' : ''}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="mx-btn mx-sm"
            disabled={disabled || isDefault}
            onClick={() => onChange([...defaults])}
          >
            Återställ till rollens standard
          </button>
          <button
            type="button"
            className="mx-btn mx-sm"
            disabled={disabled || selected.length === modules.length}
            onClick={() => onChange(modules.map((m) => m.id))}
          >
            Välj alla
          </button>
        </div>
      </div>

      {groups
        .filter((g) => g.ids.length > 0)
        .map((g) => (
          <div key={g.label}>
            <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-foreground-subtle">
              {g.label}
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {g.ids.map((id) => {
                const m = byId.get(id)!;
                const on = selected.includes(id);
                const std = defaults.includes(id);
                return (
                  <label
                    key={id}
                    title={m.description}
                    className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[12.5px] ${
                      on ? 'border-brand/40 bg-surface' : 'border-default bg-surface'
                    } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-brand"
                      checked={on}
                      disabled={disabled}
                      onChange={(e) => toggle(id, e.target.checked)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-foreground">{m.title}</span>
                      {std && (
                        <span className="block text-[10.5px] text-foreground-subtle">standard för rollen</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}
