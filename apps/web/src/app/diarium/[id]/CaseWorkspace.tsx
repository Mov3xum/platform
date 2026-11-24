'use client';

import { useActionState, useState, useTransition } from 'react';
import { RECORD_DIRECTION_LABELS, REGISTER_VIA_LABELS } from '@platform/shared';
import type { DisclosureView, RegisterCaseView, RegisterEntryView } from '@/lib/register/data';
import { setCaseStatusAction, setEntrySecrecyAction, voidEntryAction, type RegisterActionState } from '@/lib/actions/register';
import { ActionNotice, Chip, btnDanger, btnGhost, btnPrimary, card, formatRegisterDate, inputClass, labelClass, retentionText } from '@/components/register/ui';
import { ManualEntryForm } from '../RegisterList';
import { DisclosureForm, DisclosureRows } from '../DisclosureLog';

type Panel = { kind: 'secrecy' | 'void' | 'disclose'; entryId: string } | { kind: 'add' } | null;

function SecrecyForm({ entry, onClose }: { entry: RegisterEntryView; onClose: () => void }) {
  const [state, action, pending] = useActionState<RegisterActionState, FormData>(setEntrySecrecyAction, {});
  const [on, setOn] = useState(entry.secrecy);
  return (
    <form action={action} onReset={() => setOn(entry.secrecy)} className="space-y-3 border-t border-default bg-canvas-subtle p-4">
      <input type="hidden" name="entry_id" value={entry.id} />
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" name="secrecy" defaultChecked={entry.secrecy} onChange={(e) => setOn(e.target.checked)} />
        Kan innehålla sekretessbelagda uppgifter
      </label>
      {on && (
        <label className="block">
          <span className={labelClass}>Lagrum / grund</span>
          <input name="secrecy_basis" defaultValue={entry.secrecyBasis} maxLength={300} className={inputClass} />
        </label>
      )}
      <ActionNotice state={state} />
      <div className="flex gap-2">
        <button className={btnPrimary} disabled={pending}>
          {pending ? 'Sparar…' : 'Spara markering'}
        </button>
        <button type="button" className={btnGhost} onClick={onClose}>
          Stäng
        </button>
      </div>
    </form>
  );
}

function VoidForm({ entry, onClose }: { entry: RegisterEntryView; onClose: () => void }) {
  const [state, action, pending] = useActionState<RegisterActionState, FormData>(voidEntryAction, {});
  return (
    <form action={action} className="space-y-3 border-t border-default bg-canvas-subtle p-4">
      <input type="hidden" name="entry_id" value={entry.id} />
      <label className="block">
        <span className={labelClass}>Varför makuleras {entry.designation}?</span>
        <input name="reason" required minLength={3} maxLength={300} className={inputClass} placeholder="T.ex. registrerad i fel ärende" />
      </label>
      <ActionNotice state={state} />
      <div className="flex gap-2">
        <button className={btnDanger} disabled={pending}>
          {pending ? 'Makulerar…' : 'Makulera'}
        </button>
        <button type="button" className={btnGhost} onClick={onClose}>
          Stäng
        </button>
      </div>
    </form>
  );
}

export function CaseWorkspace({
  registerCase,
  entries,
  disclosures,
  registerable,
  canManage,
  canRegister
}: {
  registerCase: RegisterCaseView;
  entries: RegisterEntryView[];
  disclosures: DisclosureView[];
  registerable: { key: string; label: string; secrecyPossible: boolean; secrecyBasis: string }[];
  canManage: boolean;
  canRegister: boolean;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [status, setStatus] = useState<RegisterActionState>({});
  const [pending, start] = useTransition();
  const closed = registerCase.status === 'closed';
  const toggle = (kind: 'secrecy' | 'void' | 'disclose', entryId: string) =>
    setPanel(panel && 'entryId' in panel && panel.kind === kind && panel.entryId === entryId ? null : { kind, entryId });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-foreground-muted">
        <span>Öppnat {formatRegisterDate(registerCase.openedAt)}</span>
        {closed && <span>Avslutat {formatRegisterDate(registerCase.closedAt)}</span>}
        {registerCase.startupName && <span>Bolag: {registerCase.startupName}</span>}
        <div className="ml-auto flex gap-2">
          {canRegister && (
            <button className={btnGhost} onClick={() => setPanel(panel?.kind === 'add' ? null : { kind: 'add' })}>
              Lägg till handling
            </button>
          )}
          {canManage && (
            <button
              className={btnGhost}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  try {
                    setStatus(await setCaseStatusAction(registerCase.id, closed ? 'open' : 'closed'));
                  } catch {
                    setStatus({ error: 'Kunde inte ändra status. Ladda om sidan och försök igen.' });
                  }
                })
              }
            >
              {closed ? 'Öppna ärendet igen' : 'Avsluta ärendet'}
            </button>
          )}
        </div>
      </div>
      <ActionNotice state={status} />
      {panel?.kind === 'add' && <ManualEntryForm registerable={registerable} caseId={registerCase.id} onDone={() => setPanel(null)} />}

      <section className={`${card} divide-y divide-default overflow-hidden`}>
        {entries.map((e) => {
          const open = panel && 'entryId' in panel && panel.entryId === e.id ? panel.kind : null;
          return (
            <div key={e.id} id={`h-${e.id}`} className="scroll-mt-24">
              <div className={`flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-4 ${e.voided ? 'opacity-60' : ''}`}>
                <div className="mx-tnum w-28 shrink-0 text-sm font-semibold text-foreground">{e.designation}</div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className={`text-sm font-medium text-foreground ${e.voided ? 'line-through' : ''}`}>{e.title}</div>
                  <div className="text-xs text-foreground-muted">
                    {e.typeLabel} · {RECORD_DIRECTION_LABELS[e.direction]}
                    {e.counterpart && ` · ${e.counterpart}`}
                  </div>
                  <div className="text-xs text-foreground-subtle">
                    Handlingens datum {formatRegisterDate(e.documentDate)} · registrerad {formatRegisterDate(e.registeredAt, true)}
                    {e.registeredByName ? ` av ${e.registeredByName}` : e.via === 'auto' ? ' av systemet' : ''} · {retentionText(e.retention, e.retentionMonths)}
                    {e.disposalDue && ` (tidigast ${e.disposalDue})`}
                  </div>
                  {e.note && <div className="text-xs text-foreground-muted">{e.note}</div>}
                  {e.secrecy && <div className="text-xs text-foreground-muted">Sekretess: {e.secrecyBasis || 'lagrum saknas'}</div>}
                  {e.voided && <div className="text-xs text-foreground-muted">Makulerad: {e.voidReason}</div>}
                  <div className="text-[11px] text-foreground-subtle" title={e.contentHash}>
                    Kontrollsumma <code>{e.contentHash.slice(0, 16)}…</code>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="flex flex-wrap justify-end gap-1">
                    {e.voided && <Chip tone="bad">Makulerad</Chip>}
                    {e.secrecy && <Chip tone="warn">Sekretess</Chip>}
                    <Chip>{REGISTER_VIA_LABELS[e.via]}</Chip>
                  </div>
                  {canManage && !e.voided && (
                    <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-xs">
                      <button className="text-link hover:underline" onClick={() => toggle('secrecy', e.id)}>
                        Sekretess
                      </button>
                      <button className="text-link hover:underline" onClick={() => toggle('disclose', e.id)}>
                        Logga utlämnande
                      </button>
                      <button className="text-link hover:underline" onClick={() => toggle('void', e.id)}>
                        Makulera
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {open === 'secrecy' && <SecrecyForm entry={e} onClose={() => setPanel(null)} />}
              {open === 'void' && <VoidForm entry={e} onClose={() => setPanel(null)} />}
              {open === 'disclose' && (
                <div className="border-t border-default bg-canvas-subtle p-4">
                  <DisclosureForm entryId={e.id} onDone={() => setPanel(null)} />
                </div>
              )}
            </div>
          );
        })}
      </section>

      {disclosures.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">Utlämnanden i ärendet</h2>
          <DisclosureRows items={disclosures} />
        </section>
      )}
    </div>
  );
}
