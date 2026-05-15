'use client';

import { useState, useActionState } from 'react';
import { Chip, Toggle } from '@/components/proto';
import { saveModuleTogglesAction, type SaveModuleTogglesState } from '@/lib/actions/settings';

export interface ModuleToggleItem {
  id: string;
  name: string;
  description: string;
  defaultOn: boolean;
}

interface AdminTogglesProps {
  modules: ModuleToggleItem[];
}

const initialState: SaveModuleTogglesState = {};

export function AdminToggles({ modules }: AdminTogglesProps) {
  const [state, setState] = useState<Record<string, boolean>>(() =>
    modules.reduce<Record<string, boolean>>((acc, m) => {
      acc[m.id] = m.defaultOn;
      return acc;
    }, {})
  );

  const [result, formAction, isPending] = useActionState(saveModuleTogglesAction, initialState);

  return (
    <form action={formAction}>
      <input
        type="hidden"
        name="disabled_modules"
        value={JSON.stringify(
          modules.filter((m) => !state[m.id]).map((m) => m.id)
        )}
      />
      <div className="mx-card" style={{ padding: 0, overflow: 'hidden' }}>
        {modules.map((m, i) => {
          const on = state[m.id];
          const isLast = i === modules.length - 1;
          return (
            <div
              key={m.id}
              className="mx-flex mx-items-c mx-gap-3"
              style={{
                padding: '14px 18px',
                borderBottom: isLast ? 'none' : '1px solid var(--mx-line-soft)'
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="mx-t-13 mx-fw-6">{m.name}</div>
                <div className="mx-t-12 mx-muted">{m.description}</div>
              </div>
              <Chip variant={on ? 'active' : 'draft'} mono>
                {on ? 'På' : 'Av'}
              </Chip>
              <Toggle
                checked={on}
                onChange={(next) => setState((s) => ({ ...s, [m.id]: next }))}
              />
            </div>
          );
        })}

        <div
          className="mx-flex mx-items-c mx-gap-3"
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--mx-line-soft)',
            justifyContent: 'flex-end'
          }}
        >
          {result?.error && (
            <span className="mx-t-12" style={{ color: 'var(--mx-copper)' }}>
              {result.error}
            </span>
          )}
          {result?.success && !isPending && (
            <span className="mx-t-12" style={{ color: 'var(--mx-green)' }}>
              Sparat!
            </span>
          )}
          <button
            type="submit"
            className="mx-btn mx-primary"
            disabled={isPending}
            aria-disabled={isPending}
          >
            {isPending ? 'Sparar…' : 'Spara moduler'}
          </button>
        </div>
      </div>
    </form>
  );
}
