'use client';

import { actionErrorMessage } from '@/lib/action-error';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { CONTACT_GROUP_DESCRIPTION_MAX, CONTACT_GROUP_NAME_MAX } from '@platform/shared';
import { Icon } from '@/components/proto';
import {
  createContactGroupAction,
  deleteContactGroupAction,
  updateContactGroupAction,
  type ContactGroupActionState
} from '@/lib/actions/contact-groups';
import { Notice, Panel, btnDanger, btnGhost, btnPrimary, inputClass, labelClass } from '../ui';

export interface ManagedGroup {
  id: string;
  name: string;
  description: string;
  count: number;
}

const initial: ContactGroupActionState = {};

function GroupFields({ group }: { group?: ManagedGroup }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <label>
        <span className={labelClass}>Namn</span>
        <input
          name="name"
          required
          maxLength={CONTACT_GROUP_NAME_MAX}
          defaultValue={group?.name ?? ''}
          placeholder="T.ex. Frukostgänget"
          className={inputClass}
        />
      </label>
      <label>
        <span className={labelClass}>Beskrivning (valfri)</span>
        <input
          name="description"
          maxLength={CONTACT_GROUP_DESCRIPTION_MAX}
          defaultValue={group?.description ?? ''}
          placeholder="Vilka som hör hit och varför"
          className={inputClass}
        />
      </label>
    </div>
  );
}

function CreateGroupForm() {
  const router = useRouter();
  const [state, action, pending] = useActionState(createContactGroupAction, initial);
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    if (state.ok) {
      setFormKey((k) => k + 1);
      router.refresh();
    }
  }, [state, router]);
  return (
    <form key={formKey} action={action} className="space-y-3">
      <GroupFields />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={btnPrimary} disabled={pending}>
          <Icon name="plus" size={13} /> {pending ? 'Skapar…' : 'Skapa grupp'}
        </button>
        {state.error && <Notice kind="error">{state.error}</Notice>}
        {state.notice && <Notice kind="notice">{state.notice}</Notice>}
      </div>
    </form>
  );
}

function GroupRow({ group, canEdit }: { group: ManagedGroup; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [state, action, saving] = useActionState(updateContactGroupAction, initial);
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (state.ok) {
      setEditing(false);
      router.refresh();
    }
  }, [state, router]);

  const remove = () => {
    const members = group.count === 1 ? '1 kontakt' : `${group.count} kontakter`;
    if (!window.confirm(`Ta bort gruppen "${group.name}"? ${members} lämnar gruppen men finns kvar i kontaktboken.`)) return;
    setDeleteError(null);
    startDelete(async () => {
      let res: Awaited<ReturnType<typeof deleteContactGroupAction>>;
      try {
        res = await deleteContactGroupAction(group.id);
      } catch (err) {
        res = { error: actionErrorMessage(err, 'Gruppen kunde inte tas bort. Ladda om sidan och försök igen.') };
      }
      if (res.error) setDeleteError(res.error);
      router.refresh();
    });
  };

  if (editing) {
    return (
      <li className="px-4 py-3">
        <form action={action} className="space-y-3">
          <input type="hidden" name="id" value={group.id} />
          <GroupFields group={group} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={btnPrimary} disabled={saving}>
              {saving ? 'Sparar…' : 'Spara'}
            </button>
            <button type="button" className={btnGhost} onClick={() => setEditing(false)}>
              Avbryt
            </button>
            {state.error && <Notice kind="error">{state.error}</Notice>}
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas-muted text-foreground-muted">
        <Icon name="people" size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <Link href={`/kontakter?grupp=${group.id}`} className="font-medium text-foreground hover:underline">
          {group.name}
        </Link>
        {group.description && <div className="truncate text-xs text-foreground-muted">{group.description}</div>}
      </div>
      <Link href={`/kontakter?grupp=${group.id}`} className="text-xs text-link hover:underline mx-tnum">
        {group.count === 1 ? '1 kontakt' : `${group.count} kontakter`}
      </Link>
      {canEdit && (
        <div className="flex items-center gap-2">
          <button type="button" className={btnGhost} onClick={() => setEditing(true)} aria-label={`Redigera ${group.name}`}>
            <Icon name="pencil" size={13} /> Redigera
          </button>
          <button type="button" className={btnDanger} onClick={remove} disabled={deleting} aria-label={`Ta bort ${group.name}`}>
            <Icon name="trash" size={13} /> {deleting ? 'Tar bort…' : 'Ta bort'}
          </button>
        </div>
      )}
      {deleteError && (
        <div className="w-full">
          <Notice kind="error">{deleteError}</Notice>
        </div>
      )}
    </li>
  );
}

export function GroupsManager({ groups, canEdit }: { groups: ManagedGroup[]; canEdit: boolean }) {
  return (
    <div className="space-y-4">
      {canEdit && (
        <Panel title="Ny grupp">
          <CreateGroupForm />
        </Panel>
      )}
      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-default p-12 text-center text-sm text-foreground-muted">
          Inga grupper än.
        </div>
      ) : (
        <ul className="divide-y divide-default rounded-2xl border border-default bg-surface">
          {groups.map((g) => (
            <GroupRow key={g.id} group={g} canEdit={canEdit} />
          ))}
        </ul>
      )}
    </div>
  );
}
