'use client';

import { useState } from 'react';
import { Chip, Toggle } from '@/components/proto';

export interface ModuleToggleItem {
  id: string;
  name: string;
  description: string;
  defaultOn: boolean;
}

interface AdminTogglesProps {
  modules: ModuleToggleItem[];
}

// Visuell modul-aktivering. Persistens hanteras separat — vi lagrar bara
// state lokalt (in-memory) tills feature flagging-backenden är klar.
export function AdminToggles({ modules }: AdminTogglesProps) {
  const [state, setState] = useState<Record<string, boolean>>(() =>
    modules.reduce<Record<string, boolean>>((acc, m) => {
      acc[m.id] = m.defaultOn;
      return acc;
    }, {})
  );

  return (
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
    </div>
  );
}
