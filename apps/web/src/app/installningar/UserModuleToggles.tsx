'use client';

import { useActionState, useMemo, useState } from 'react';
import { Chip, Toggle } from '@/components/proto';
import { saveUserModuleTogglesAction, type SaveModuleTogglesState } from '@/lib/actions/settings';
import type { ModuleToggleItem } from './AdminToggles';

interface UserModuleToggleItem {
  id: string;
  name: string;
  email: string;
  roles: string[];
  disabledModules: string[];
}

interface UserModuleTogglesProps {
  users: UserModuleToggleItem[];
  modules: ModuleToggleItem[];
}

const initialState: SaveModuleTogglesState = {};

function UserRow({
  user,
  modules
}: {
  user: UserModuleToggleItem;
  modules: ModuleToggleItem[];
}) {
  const [state, setState] = useState<Record<string, boolean>>(() =>
    modules.reduce<Record<string, boolean>>((acc, module) => {
      acc[module.id] = !user.disabledModules.includes(module.id);
      return acc;
    }, {})
  );
  const [result, formAction, isPending] = useActionState(saveUserModuleTogglesAction, initialState);

  const disabledPayload = useMemo(
    () => JSON.stringify(modules.filter((m) => !state[m.id]).map((m) => m.id)),
    [modules, state]
  );

  return (
    <form action={formAction} className="mx-card" style={{ padding: 0, overflow: 'hidden' }}>
      <input type="hidden" name="user_id" value={user.id} />
      <input type="hidden" name="disabled_modules" value={disabledPayload} />
      <div
        className="mx-flex mx-items-c mx-gap-3"
        style={{ padding: '12px 16px', borderBottom: '1px solid var(--mx-line-soft)' }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="mx-t-13 mx-fw-6">{user.name}</div>
          <div className="mx-t-12 mx-muted">{user.email}</div>
        </div>
        <Chip variant="active" mono>
          {user.roles.join(', ')}
        </Chip>
      </div>

      <div style={{ padding: '10px 16px' }}>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          {modules.map((m) => {
            const on = state[m.id];
            return (
              <label key={`${user.id}-${m.id}`} className="mx-flex mx-items-c mx-gap-2">
                <Toggle checked={on} onChange={(next) => setState((s) => ({ ...s, [m.id]: next }))} />
                <span className="mx-t-12">{m.name}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div
        className="mx-flex mx-items-c mx-gap-3"
        style={{
          padding: '10px 16px',
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
        <button type="submit" className="mx-btn mx-primary mx-sm" disabled={isPending} aria-disabled={isPending}>
          {isPending ? 'Sparar…' : 'Spara'}
        </button>
      </div>
    </form>
  );
}

export function UserModuleToggles({ users, modules }: UserModuleTogglesProps) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {users.map((user) => (
        <UserRow key={user.id} user={user} modules={modules} />
      ))}
    </div>
  );
}
