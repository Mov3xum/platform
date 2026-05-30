'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/proto/Icon';
import type { ToolRun, ToolRunStatus, WorkshopAssignmentStatus } from '@platform/shared';
import { useLiveWorkspace } from '@/lib/realtime/tool-runs';
import { AssignModal, type AssignableTool, type AssignableUser } from './AssignModal';
import { EducationAssignModal, type AssignableEducation } from './EducationAssignModal';
import type { AssignableResource } from '@/lib/assignments/types';
import { ASSIGN_STATUS, statusFor, daysUntil, formatDeadline, formatRelativeDate } from './constants';

interface AssignmentView {
  id: string;
  status: ToolRunStatus;
  toolId: string;
  toolName: string;
  toolCategory?: string;
  assignedByName: string;
  assignedToName: string;
  deadline?: string;
  instruction?: string;
  createdAt: string;
  version: number;
  hasOutput: boolean;
}

interface ToolCard {
  id: string;
  name: string;
  category?: string;
  description?: string;
  runs: number;
  lastUsed?: string;
}

interface EducationCard {
  id: string;
  title: string;
  goal?: string;
  moduleCount: number;
  blockCount: number;
  assigned: boolean;
}

interface AssignedEducation {
  id: string;
  workshopId: string;
  title: string;
  status: WorkshopAssignmentStatus;
  statusLabel: string;
  dueDate?: string;
  createdAt: string;
}

interface Props {
  startupId: string;
  startupName: string;
  active: AssignmentView[];
  done: AssignmentView[];
  catalog: ToolCard[];
  assignees: AssignableUser[];
  canAssign: boolean;
  educationCatalog?: EducationCard[];
  assignedEducations?: AssignedEducation[];
  resources?: AssignableResource[];
}

export function ToolsTab(props: Props) {
  const {
    startupId,
    startupName,
    active,
    done,
    catalog,
    assignees,
    canAssign,
    educationCatalog = [],
    assignedEducations = [],
    resources = []
  } = props;
  const [modalOpen, setModalOpen] = useState(false);
  const [defaultToolId, setDefaultToolId] = useState<string | undefined>();
  const [eduModalWorkshop, setEduModalWorkshop] = useState<AssignableEducation | null>(null);

  useLiveWorkspace(true, 20_000);

  function openAssignEducation(workshop: AssignableEducation) {
    setEduModalWorkshop(workshop);
  }

  function openAssign(toolId?: string) {
    setDefaultToolId(toolId);
    setModalOpen(true);
  }

  const assignableTools: AssignableTool[] = catalog.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category
  }));

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-10">
      <div className="mx-auto max-w-5xl space-y-10">
        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                {canAssign ? 'Aktiva uppdrag' : 'Mina uppdrag på detta bolag'}
              </div>
              <h2 className="mt-1 font-heading text-[20px] font-semibold text-foreground">
                {canAssign ? 'Tilldelade verktyg' : 'Det här ska du köra'}
              </h2>
              <p className="mt-1 text-[13px] text-foreground-subtle">
                {canAssign
                  ? 'Coach tilldelar — founder kör — output sparas tillbaka på bolaget.'
                  : 'Klicka på ett uppdrag för att se instruktionen och köra verktyget.'}
              </p>
            </div>
            {canAssign && catalog.length > 0 && (
              <button
                type="button"
                onClick={() => openAssign(undefined)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-[12.5px] font-medium text-brand-foreground hover:opacity-90"
              >
                <Icon name="plus" size={14} /> Tilldela verktyg
              </button>
            )}
          </div>

          {active.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-default p-10 text-center">
              <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-canvas-muted text-foreground-subtle">
                <Icon name="inbox" size={18} />
              </div>
              <p className="text-[13px] text-foreground-subtle">
                Inga aktiva uppdrag just nu.
                {canAssign ? ' Tilldela ett verktyg från katalogen nedan.' : ''}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {active.map((a) => {
                const days = daysUntil(a.deadline);
                const overdue = days !== null && days < 0 && a.status !== 'approved';
                const s = statusFor(a.status, overdue);
                return (
                  <Link
                    key={a.id}
                    href={`/startups/${startupId}/verktyg/${a.id}`}
                    className="block rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5 transition hover:border-brand/40 hover:shadow-md"
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-movexum-pastell-lila text-movexum-lila">
                        <Icon name="sparkle" size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-heading text-[14.5px] font-semibold text-foreground">
                            {a.toolName}
                          </h3>
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium ${s.bgClass} ${s.fgClass}`}
                          >
                            <Icon name={s.iconName} size={10} /> {s.label}
                          </span>
                          {a.version > 1 && (
                            <span className="rounded-md bg-canvas-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground-muted">
                              v{a.version}
                            </span>
                          )}
                        </div>
                        {a.instruction && (
                          <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-foreground-muted">
                            {a.instruction.replace(/<[^>]*>/g, ' ').trim()}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-foreground-subtle">
                          <span className="inline-flex items-center gap-1">
                            <Icon name="people" size={11} /> {a.assignedByName} → {a.assignedToName}
                          </span>
                          {a.deadline && (
                            <span
                              className={`inline-flex items-center gap-1 ${overdue ? 'font-medium text-movexum-orange' : ''}`}
                            >
                              <Icon name="calendar" size={11} /> deadline{' '}
                              {formatDeadline(a.deadline)}
                              {overdue
                                ? ' (försenad)'
                                : days !== null && days >= 0
                                  ? ` · om ${days} dgr`
                                  : ''}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1">
                            <Icon name="clock" size={11} /> tilldelad{' '}
                            {formatRelativeDate(a.createdAt)}
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0">
                        <span className="inline-flex items-center gap-1 rounded-lg border border-default px-2.5 py-1 text-[11px] text-foreground-muted">
                          Öppna <Icon name="chevron" size={11} />
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {done.length > 0 && (
            <details className="mt-4 group">
              <summary className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-foreground-subtle hover:bg-canvas-muted">
                <span className="transition group-open:rotate-90">
                  <Icon name="chevron" size={12} />
                </span>
                Visa {done.length} godkända uppdrag
              </summary>
              <div className="mt-2 space-y-2">
                {done.map((a) => (
                  <Link
                    key={a.id}
                    href={`/startups/${startupId}/verktyg/${a.id}`}
                    className="flex items-center gap-3 rounded-xl border border-default bg-canvas-subtle p-3 hover:border-brand/40"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-movexum-pastell-gron text-movexum-gron">
                      <Icon name="check" size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-heading text-[13px] font-semibold">
                        {a.toolName}
                      </div>
                      <div className="truncate text-[11px] text-foreground-subtle">
                        Levererad {formatRelativeDate(a.createdAt)} · godkänd av {a.assignedByName}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </details>
          )}
        </section>

        {/* Verktygskatalog */}
        {catalog.length > 0 && (
          <section>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                  Verktygskatalog
                </div>
                <h2 className="mt-1 font-heading text-[20px] font-semibold text-foreground">
                  AI-assistenter för {startupName}
                </h2>
                <p className="mt-1 text-[13px] text-foreground-subtle">
                  {canAssign
                    ? 'Klicka på Tilldela för att schemalägga ett uppdrag. EU-suveränt via Mistral / Le Chat.'
                    : 'Klicka på Kör för att starta ett verktyg direkt.'}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {catalog.map((t) => (
                <div
                  key={t.id}
                  className="rounded-2xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5 transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-movexum-pastell-lila text-movexum-lila">
                      <Icon name="sparkle" size={18} />
                    </div>
                    <span className="font-mono text-[10.5px] text-foreground-subtle">
                      {t.runs} körningar
                    </span>
                  </div>
                  <h3 className="font-heading text-[15px] font-semibold text-foreground">
                    {t.name}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {t.category && (
                      <span className="rounded-md bg-canvas-muted px-1.5 py-0.5 text-[10.5px] font-medium text-foreground-muted">
                        {t.category}
                      </span>
                    )}
                    {t.lastUsed && (
                      <span className="inline-flex items-center gap-1 text-[10.5px] text-foreground-subtle">
                        <Icon name="clock" size={10} /> {t.lastUsed}
                      </span>
                    )}
                  </div>
                  <div className="mt-4 flex items-center gap-2 border-t border-default pt-3">
                    {canAssign ? (
                      <button
                        type="button"
                        onClick={() => openAssign(t.id)}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[11.5px] font-medium text-brand-foreground hover:opacity-90"
                      >
                        <Icon name="inbox" size={12} /> Tilldela
                      </button>
                    ) : (
                      <Link
                        href={`/toolbox/${t.id}`}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[11.5px] font-medium text-brand-foreground hover:opacity-90"
                      >
                        <Icon name="sparkle" size={12} /> Kör
                      </Link>
                    )}
                    <Link
                      href={`/toolbox/${t.id}`}
                      className="rounded-lg border border-default px-2.5 py-1.5 text-[11.5px] text-foreground-muted hover:bg-canvas-muted"
                    >
                      Info
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Tilldelade utbildningar */}
        {assignedEducations.length > 0 && (
          <section>
            <div className="mb-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                Utbildningar
              </div>
              <h2 className="mt-1 font-heading text-[20px] font-semibold text-foreground">
                Tilldelade utbildningar
              </h2>
              <p className="mt-1 text-[13px] text-foreground-subtle">
                Movexum-utbildningar som {startupName} arbetar med.
              </p>
            </div>
            <div className="space-y-2">
              {assignedEducations.map((e) => {
                const isDone = e.status === 'done';
                return (
                  <Link
                    key={e.id}
                    href="/education"
                    className="flex items-center gap-3 rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5 transition hover:border-brand/40 hover:shadow-md"
                  >
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isDone ? 'bg-movexum-pastell-gron text-movexum-gron' : 'bg-movexum-pastell-lila text-movexum-lila'}`}
                    >
                      <Icon name={isDone ? 'check' : 'cap'} size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-heading text-[14.5px] font-semibold text-foreground">
                          {e.title}
                        </h3>
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium ${isDone ? 'bg-movexum-pastell-gron text-movexum-morkgron' : e.status === 'in_progress' ? 'bg-movexum-pastell-bla text-movexum-morkbla' : 'bg-canvas-muted text-foreground-muted'}`}
                        >
                          {e.statusLabel}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-foreground-subtle">
                        {e.dueDate && (
                          <span className="inline-flex items-center gap-1">
                            <Icon name="calendar" size={11} /> deadline {formatDeadline(e.dueDate)}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <Icon name="clock" size={11} /> tilldelad {formatRelativeDate(e.createdAt)}
                        </span>
                      </div>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-default px-2.5 py-1 text-[11px] text-foreground-muted">
                      Öppna <Icon name="chevron" size={11} />
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* Utbildningskatalog */}
        {educationCatalog.length > 0 && (
          <section>
            <div className="mb-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                Utbildningskatalog
              </div>
              <h2 className="mt-1 font-heading text-[20px] font-semibold text-foreground">
                Movexum-utbildningar
              </h2>
              <p className="mt-1 text-[13px] text-foreground-subtle">
                {canAssign
                  ? 'Tilldela en utbildning för att lägga den på bolagets arbetsyta.'
                  : 'Färdiga utbildningar hos Movexum.'}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {educationCatalog.map((e) => (
                <div
                  key={e.id}
                  className="flex flex-col rounded-2xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5 transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-movexum-pastell-lila text-movexum-lila">
                      <Icon name="cap" size={18} />
                    </div>
                    <span className="font-mono text-[10.5px] text-foreground-subtle">
                      {e.moduleCount} mod · {e.blockCount} block
                    </span>
                  </div>
                  <h3 className="font-heading text-[15px] font-semibold text-foreground">
                    {e.title}
                  </h3>
                  {e.goal && (
                    <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-foreground-muted">
                      {e.goal}
                    </p>
                  )}
                  <div className="mt-4 flex items-center gap-2 border-t border-default pt-3">
                    {canAssign ? (
                      e.assigned ? (
                        <span className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-movexum-pastell-gron px-3 py-1.5 text-[11.5px] font-medium text-movexum-morkgron">
                          <Icon name="check" size={12} /> Tilldelad
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openAssignEducation({ id: e.id, title: e.title })}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[11.5px] font-medium text-brand-foreground hover:opacity-90 disabled:opacity-50"
                        >
                          <Icon name="inbox" size={12} /> Tilldela
                        </button>
                      )
                    ) : null}
                    <Link
                      href={`/education/workshops/${e.id}`}
                      className="rounded-lg border border-default px-2.5 py-1.5 text-[11.5px] text-foreground-muted hover:bg-canvas-muted"
                    >
                      Info
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <AssignModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        defaultToolId={defaultToolId}
        tools={assignableTools}
        assignees={assignees}
        startupId={startupId}
        startupName={startupName}
      />

      <EducationAssignModal
        open={eduModalWorkshop !== null}
        onClose={() => setEduModalWorkshop(null)}
        workshop={eduModalWorkshop}
        resources={resources}
        startupId={startupId}
        startupName={startupName}
      />
    </div>
  );
}
