'use client';

import { useActionState, useMemo, useState, type ReactNode } from 'react';
import { ALL_ROLES, defaultModulesForRoles, type Role } from '@platform/shared';
import { Avatar, Chip, Toggle } from '@/components/proto';
import { Icon } from '@/components/proto/Icon';
import {
  deleteUserAction,
  resetUserPasswordAction,
  updateUserModulesAction,
  updateUserRolesAction,
  type UpdateUserState
} from '@/lib/actions/users';
import { canManageUser, ROLE_LABELS, toggleableModulesForRoles } from '@/lib/users/validate';
import { ModulePicker } from './ModulePicker';
import { UserForm, type StartupOption } from './UserForm';
import { UserStartupLink } from './UserStartupLink';

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  verified: boolean;
  linkedStartups: { id: string; name: string }[];
  /** Effektiv allow-lista över moduler i sidofältet (§ 36.3). */
  enabledModules: string[];
  createdAt: string;
}

interface UsersAdminProps {
  users: ManagedUser[];
  startups: StartupOption[];
  assignableRoles: Role[];
  actorId: string;
  isAdmin: boolean;
}

const initialUpdate: UpdateUserState = { status: 'idle' };

const ROLE_CHIP: Record<Role, 'purple' | 'cyan' | 'green' | 'yellow' | 'brown' | 'default' | 'copper'> = {
  admin: 'purple',
  incubator_lead: 'cyan',
  coach: 'green',
  mentor: 'green',
  partner: 'brown',
  startup_member: 'default',
  observer: 'yellow'
};

const AVATAR_ACCENT: Record<Role, 'ink' | 'green' | 'purple' | 'brown' | 'copper' | 'yellow' | 'cyan'> = {
  admin: 'purple',
  incubator_lead: 'cyan',
  coach: 'green',
  mentor: 'green',
  partner: 'brown',
  startup_member: 'ink',
  observer: 'yellow'
};

const inputClass =
  'block w-full rounded-xl border border-default bg-surface px-3 py-2 text-[13px] text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const arr = new Uint32Array(14);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join('');
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function primaryRole(roles: Role[]): Role {
  for (const r of ALL_ROLES) if (roles.includes(r)) return r;
  return 'observer';
}

function StatusLine({ state }: { state: UpdateUserState }) {
  if (state.status === 'error') {
    return <p className="text-[12px] text-movexum-morkorange">{state.message}</p>;
  }
  if (state.status === 'ok') {
    return <p className="text-[12px] text-movexum-morkgron dark:text-movexum-gron">{state.message}</p>;
  }
  return null;
}

function Panel({
  title,
  description,
  danger = false,
  children
}: {
  title: string;
  description?: string;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        danger
          ? 'border-movexum-orange/40 bg-movexum-pastell-orange/40 dark:bg-movexum-morkorange/10'
          : 'border-default bg-canvas-subtle'
      }`}
    >
      <div className="mb-3">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        {description && <div className="text-[12px] text-foreground-muted">{description}</div>}
      </div>
      {children}
    </div>
  );
}

/* ── Roller ─────────────────────────────────────────────────────────── */

function RolesForm({
  user,
  assignableRoles,
  isSelf
}: {
  user: ManagedUser;
  assignableRoles: Role[];
  isSelf: boolean;
}) {
  const [selected, setSelected] = useState<Role[]>(user.roles);
  const [state, formAction, pending] = useActionState(updateUserRolesAction, initialUpdate);
  const payload = useMemo(() => JSON.stringify(selected), [selected]);
  const dirty = useMemo(
    () =>
      selected.length !== user.roles.length || selected.some((r) => !user.roles.includes(r)),
    [selected, user.roles]
  );

  return (
    <Panel title="Roller" description="Rollen styr behörigheter enligt RBAC. Minst en roll krävs.">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="user_id" value={user.id} />
        <input type="hidden" name="roles" value={payload} />
        <div className="grid gap-2 sm:grid-cols-2">
          {ALL_ROLES.map((r) => {
            const allowed = assignableRoles.includes(r);
            const on = selected.includes(r);
            return (
              <label
                key={r}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px] ${
                  on ? 'border-brand/40 bg-surface' : 'border-default bg-surface'
                } ${allowed ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
              >
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={on}
                  disabled={!allowed}
                  onChange={(e) =>
                    setSelected((s) =>
                      e.target.checked ? [...s, r] : s.filter((x) => x !== r)
                    )
                  }
                />
                <span className="text-foreground">{ROLE_LABELS[r]}</span>
                {!allowed && (
                  <span className="ml-auto text-[10.5px] text-foreground-subtle">bara admin</span>
                )}
              </label>
            );
          })}
        </div>
        {isSelf && (
          <p className="text-[11.5px] text-foreground-subtle">
            Du redigerar dina egna roller — administrationsrollerna kan inte tas bort här.
          </p>
        )}
        <div className="flex items-center justify-end gap-3">
          <StatusLine state={state} />
          <button
            type="submit"
            className="mx-btn mx-primary mx-sm"
            disabled={pending || !dirty || selected.length === 0}
          >
            {pending ? 'Sparar…' : 'Spara roller'}
          </button>
        </div>
      </form>
    </Panel>
  );
}

/* ── Moduler i sidofältet (§ 36.3) ───────────────────────────────────── */

function ModulesForm({ user }: { user: ManagedUser }) {
  const modules = useMemo(() => toggleableModulesForRoles(user.roles), [user.roles]);
  const defaults = useMemo(
    () => defaultModulesForRoles(user.roles).filter((id) => modules.some((m) => m.id === id)),
    [user.roles, modules]
  );
  const [selected, setSelected] = useState<string[]>(() =>
    user.enabledModules.filter((id) => modules.some((m) => m.id === id))
  );
  const [state, formAction, pending] = useActionState(updateUserModulesAction, initialUpdate);
  const payload = useMemo(() => JSON.stringify(selected), [selected]);
  const dirty = useMemo(
    () =>
      selected.length !== user.enabledModules.length ||
      selected.some((id) => !user.enabledModules.includes(id)),
    [selected, user.enabledModules]
  );

  return (
    <Panel
      title="Moduler i sidofältet"
      description="Bocka i vad personen ska se i menyn. Rollens standard är förvald; lägg till eller ta bort fritt. Rollen sätter fortfarande den yttre gränsen."
    >
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="user_id" value={user.id} />
        <input type="hidden" name="enabled_modules" value={payload} />
        <ModulePicker modules={modules} selected={selected} defaults={defaults} onChange={setSelected} />
        <div className="flex items-center justify-end gap-3">
          <StatusLine state={state} />
          <button type="submit" className="mx-btn mx-primary mx-sm" disabled={pending || !dirty}>
            {pending ? 'Sparar…' : 'Spara moduler'}
          </button>
        </div>
      </form>
    </Panel>
  );
}

/* ── Lösenord ───────────────────────────────────────────────────────── */

function PasswordForm({ user }: { user: ManagedUser }) {
  const [password, setPassword] = useState('');
  const [state, formAction, pending] = useActionState(resetUserPasswordAction, initialUpdate);

  return (
    <Panel
      title="Nytt lösenord"
      description="Sätt ett nytt initialt lösenord och dela det säkert. Personen kan byta det själv under Mitt konto."
    >
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="user_id" value={user.id} />
        <div className="flex gap-2">
          <input
            name="password"
            type="text"
            minLength={8}
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minst 8 tecken"
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => setPassword(generatePassword())}
            className="mx-btn mx-sm shrink-0"
          >
            Generera
          </button>
        </div>
        <div className="flex items-center justify-end gap-3">
          <StatusLine state={state} />
          <button type="submit" className="mx-btn mx-primary mx-sm" disabled={pending || password.length < 8}>
            {pending ? 'Sparar…' : 'Sätt lösenord'}
          </button>
        </div>
      </form>
    </Panel>
  );
}

/* ── Radera ─────────────────────────────────────────────────────────── */

function DeleteForm({ user }: { user: ManagedUser }) {
  const [confirm, setConfirm] = useState('');
  const [state, formAction, pending] = useActionState(deleteUserAction, initialUpdate);
  const email = user.email || '';
  const matches = email !== '' && confirm.trim().toLowerCase() === email.toLowerCase();

  return (
    <Panel
      title="Radera konto"
      description="Tar bort kontot permanent (GDPR art. 17). Skriv användarens e-post för att bekräfta."
      danger
    >
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="user_id" value={user.id} />
        <input
          name="confirm_email"
          type="email"
          autoComplete="off"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={email || 'E-post saknas — kan inte raderas här'}
          disabled={email === ''}
          className={inputClass}
        />
        <div className="flex items-center justify-end gap-3">
          <StatusLine state={state} />
          <button
            type="submit"
            className="mx-btn mx-sm border-movexum-orange text-movexum-morkorange hover:bg-movexum-pastell-orange dark:text-movexum-orange"
            disabled={pending || !matches}
          >
            {pending ? 'Raderar…' : 'Radera användaren'}
          </button>
        </div>
      </form>
    </Panel>
  );
}

/* ── Rad + detalj ───────────────────────────────────────────────────── */

function UserRow({
  user,
  open,
  onToggle,
  startups,
  assignableRoles,
  actorId,
  isAdmin
}: {
  user: ManagedUser;
  open: boolean;
  onToggle: () => void;
  startups: StartupOption[];
  assignableRoles: Role[];
  actorId: string;
  isAdmin: boolean;
}) {
  const isSelf = user.id === actorId;
  const manageable = canManageUser(isAdmin ? ['admin'] : ['incubator_lead'], user.roles);
  const isMember = user.roles.includes('startup_member');
  const primary = primaryRole(user.roles);

  return (
    <li className="border-b border-default last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-canvas-subtle"
      >
        <Avatar initial={initials(user.name)} size="sm" accent={AVATAR_ACCENT[primary]} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-[13.5px] font-semibold text-foreground">{user.name}</span>
            {isSelf && (
              <span className="text-[10.5px] uppercase tracking-[0.12em] text-foreground-subtle">du</span>
            )}
          </div>
          <div className="truncate text-[12px] text-foreground-subtle">{user.email || '—'}</div>
        </div>
        <div className="hidden flex-wrap items-center justify-end gap-1.5 sm:flex">
          {user.roles.map((r) => (
            <Chip key={r} variant={ROLE_CHIP[r]} mono>
              {ROLE_LABELS[r]}
            </Chip>
          ))}
          {user.linkedStartups.map((s) => (
            <Chip key={s.id} variant="purple">
              {s.name}
            </Chip>
          ))}
          {isMember && user.linkedStartups.length === 0 && (
            <Chip variant="yellow" mono>
              Inget bolag
            </Chip>
          )}
          {!user.verified && (
            <Chip variant="copper" mono>
              Ej verifierad
            </Chip>
          )}
        </div>
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-foreground-subtle transition ${
            open ? 'rotate-180 bg-canvas-muted' : ''
          }`}
        >
          <Icon name="chevdown" size={12} />
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-default bg-surface px-4 py-4">
          <div className="flex flex-wrap gap-1.5 sm:hidden">
            {user.roles.map((r) => (
              <Chip key={r} variant={ROLE_CHIP[r]} mono>
                {ROLE_LABELS[r]}
              </Chip>
            ))}
          </div>

          {!manageable ? (
            <p className="rounded-xl bg-movexum-pastell-gul px-4 py-3 text-[12.5px] text-movexum-morkgul">
              Bara en administratör kan ändra ett admin-konto.
            </p>
          ) : (
            <>
              <RolesForm user={user} assignableRoles={assignableRoles} isSelf={isSelf} />

              {isMember && (
                <Panel
                  title="Kopplat bolag"
                  description="Bolagsmedlemmen ser bara det kopplade bolagets miljö."
                >
                  <UserStartupLink
                    userId={user.id}
                    currentStartupId={user.linkedStartups[0]?.id ?? ''}
                    startups={startups}
                  />
                </Panel>
              )}

              <ModulesForm user={user} />

              {!isSelf && (
                <div className="grid gap-3 lg:grid-cols-2">
                  <PasswordForm user={user} />
                  <DeleteForm user={user} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

/* ── Lista ──────────────────────────────────────────────────────────── */

export function UsersAdmin({
  users,
  startups,
  assignableRoles,
  actorId,
  isAdmin
}: UsersAdminProps) {
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const roleCounts = useMemo(() => {
    const counts: Partial<Record<Role, number>> = {};
    for (const u of users) for (const r of u.roles) counts[r] = (counts[r] ?? 0) + 1;
    return counts;
  }, [users]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'all' && !u.roles.includes(roleFilter)) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.linkedStartups.some((s) => s.name.toLowerCase().includes(q))
      );
    });
  }, [users, query, roleFilter]);

  return (
    <div className="space-y-4">
      {/* Verktygsrad */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-subtle">
            <Icon name="search" size={13} />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sök namn, e-post eller bolag…"
            className={`${inputClass} pl-9`}
            aria-label="Sök användare"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className={`mx-btn ${showCreate ? '' : 'mx-primary'}`}
        >
          <Icon name={showCreate ? 'x' : 'plus'} size={13} />
          {showCreate ? 'Stäng' : 'Ny användare'}
        </button>
      </div>

      {/* Rollfilter */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setRoleFilter('all')}
          className={`rounded-full border px-3 py-1 text-[11.5px] font-medium transition ${
            roleFilter === 'all'
              ? 'border-brand bg-brand text-brand-foreground'
              : 'border-default bg-surface text-foreground-muted hover:bg-canvas-muted'
          }`}
        >
          Alla · {users.length}
        </button>
        {ALL_ROLES.filter((r) => (roleCounts[r] ?? 0) > 0).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRoleFilter(roleFilter === r ? 'all' : r)}
            className={`rounded-full border px-3 py-1 text-[11.5px] font-medium transition ${
              roleFilter === r
                ? 'border-brand bg-brand text-brand-foreground'
                : 'border-default bg-surface text-foreground-muted hover:bg-canvas-muted'
            }`}
          >
            {ROLE_LABELS[r]} · {roleCounts[r]}
          </button>
        ))}
      </div>

      {showCreate && (
        <div className="rounded-2xl border border-brand/30 bg-canvas-subtle p-1">
          <div className="px-4 pt-3">
            <h3 className="font-heading text-[14px] font-semibold text-foreground">Ny användare</h3>
            <p className="text-[12px] text-foreground-muted">
              Kontot skapas verifierat så personen kan logga in direkt. Endast e-post och namn
              lagras — dela det initiala lösenordet säkert.
            </p>
          </div>
          <UserForm startups={startups} assignableRoles={assignableRoles} />
        </div>
      )}

      {/* Lista */}
      <section className="overflow-hidden rounded-2xl border border-default bg-surface">
        <div className="flex items-center justify-between border-b border-default bg-canvas-subtle px-4 py-2.5 text-[11px] uppercase tracking-[0.12em] text-foreground-subtle">
          <span>
            {filtered.length} av {users.length} användare
          </span>
          <span className="hidden sm:inline">Roller · bolag · status</span>
        </div>
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-foreground-muted">
            {users.length === 0 ? 'Inga användare registrerade ännu.' : 'Inga användare matchar filtret.'}
          </p>
        ) : (
          <ul>
            {filtered.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                open={openId === u.id}
                onToggle={() => setOpenId((cur) => (cur === u.id ? null : u.id))}
                startups={startups}
                assignableRoles={assignableRoles}
                actorId={actorId}
                isAdmin={isAdmin}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
