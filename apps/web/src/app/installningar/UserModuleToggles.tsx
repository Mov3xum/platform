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
    <form action={formAction} className="mx-card p-0 overflow-hidden">
      <input type="hidden" name="user_id" value={user.id} />
      <input type="hidden" name="disabled_modules" value={disabledPayload} />
      <div className="mx-flex mx-items-c mx-gap-3 border-b border-default px-4 py-3">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="mx-t-13 mx-fw-6">{user.name}</div>
          <div className="mx-t-12 mx-muted">{user.email}</div>
        </div>
        <Chip variant="active" mono>
          {user.roles.join(', ')}
        </Chip>
      </div>

      <div className="px-4 py-2.5">
        <div className="grid grid-cols-2 gap-2.5">
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

      <div className="mx-flex mx-items-c mx-gap-3 justify-end border-t border-default px-4 py-2.5">
        {result?.error && (
          <span className="mx-t-12 text-movexum-morkorange">
            {result.error}
          </span>
        )}
        {result?.success && !isPending && (
          <span className="mx-t-12 text-movexum-morkgron">
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
    <div className="grid gap-3">
      {users.map((user) => (
        <UserRow key={user.id} user={user} modules={modules} />
      ))}
    </div>
  );
}
