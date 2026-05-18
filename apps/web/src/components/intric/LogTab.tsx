'use client';

import { useState } from 'react';
import { Icon } from '@/components/proto/Icon';
import { useLiveWorkspace } from '@/lib/realtime/tool-runs';
import { LOG_KIND, formatRelativeDate } from './constants';

export interface LogEntry {
  id: string;
  kind: string;
  actor: string;
  title: string;
  meta?: string;
  artefact?: string;
  toolRunId?: string;
  startupId?: string;
  created: string;
}

interface Props {
  entries: LogEntry[];
  startupName: string;
}

const FILTERS: { id: string; label: string; match: (kind: string) => boolean }[] = [
  { id: 'all', label: 'Alla', match: () => true },
  { id: 'assignment', label: 'Tilldelningar', match: (k) => k === 'assignment' },
  { id: 'tool_run', label: 'AI-körningar', match: (k) => k === 'tool_run' },
  { id: 'meeting', label: 'Möten', match: (k) => k === 'meeting' },
  { id: 'milestone', label: 'Milstolpar', match: (k) => k === 'milestone' },
  { id: 'note', label: 'Noteringar', match: (k) => k === 'note' },
  { id: 'irl_phase', label: 'IRL & fas', match: (k) => k === 'irl' || k === 'phase' },
  { id: 'approval', label: 'Godkännanden', match: (k) => k === 'approval' }
];

export function LogTab({ entries, startupName }: Props) {
  const [filterId, setFilterId] = useState('all');
  useLiveWorkspace(true, 30_000);

  const activeFilter = FILTERS.find((f) => f.id === filterId) || FILTERS[0];
  const visible = entries.filter((e) => activeFilter.match(e.kind));

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
              Bolagslogg
            </div>
            <h2 className="mt-1 font-heading text-[20px] font-semibold text-foreground">
              Den röda tråden
            </h2>
            <p className="mt-1 max-w-[60ch] text-[13px] text-foreground-subtle">
              Allt som händer på {startupName} — i kronologisk ordning. Tilldelningar,
              AI-körningar, möten, milstolpar, anteckningar, fas-skiften.
            </p>
          </div>
        </div>

        <div className="mb-6 mt-5 flex flex-wrap items-center gap-1.5">
          {FILTERS.map((ft) => {
            const count = entries.filter((e) => ft.match(e.kind)).length;
            const on = filterId === ft.id;
            return (
              <button
                key={ft.id}
                type="button"
                onClick={() => setFilterId(ft.id)}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] transition ${on ? 'bg-brand text-brand-foreground' : 'border border-default text-foreground-muted hover:bg-canvas-muted'}`}
              >
                {ft.label}
                <span
                  className={`font-mono text-[10px] ${on ? 'opacity-80' : 'text-foreground-subtle'}`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default p-10 text-center">
            <p className="text-[13px] text-foreground-subtle">Inga händelser ännu.</p>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute bottom-3 left-[15px] top-3 w-px bg-default" />
            <div className="space-y-2.5">
              {visible.map((e) => {
                const k = LOG_KIND[e.kind] || LOG_KIND.manual;
                return (
                  <div key={e.id} className="relative pl-10">
                    <div className="absolute left-0 top-1.5 flex h-8 w-8 items-center justify-center rounded-full border border-default bg-canvas">
                      <span className={k.fgClass}>
                        <Icon name={k.iconName} size={13} />
                      </span>
                    </div>
                    <div className="rounded-xl border border-default bg-surface p-3.5 shadow-sm shadow-movexum-svart/5">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-canvas-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted">
                          {k.label}
                        </span>
                        <span className="font-mono text-[10.5px] text-foreground-subtle">
                          {formatRelativeDate(e.created)}
                        </span>
                        <span className="ml-auto text-[10.5px] text-foreground-subtle">
                          · {e.actor}
                        </span>
                      </div>
                      <div className="font-heading text-[13.5px] font-semibold leading-snug text-foreground">
                        {e.title}
                      </div>
                      {e.meta && (
                        <div className="mt-0.5 text-[12px] leading-relaxed text-foreground-muted">
                          {e.meta}
                        </div>
                      )}
                      {e.artefact && (
                        <div className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-default bg-canvas-muted px-2 py-1 font-mono text-[10.5px] text-foreground-muted">
                          <Icon name="doc" size={10} /> {e.artefact}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
