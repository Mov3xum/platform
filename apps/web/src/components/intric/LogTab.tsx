'use client';

import { useState } from 'react';
import { Icon } from '@/components/proto/Icon';
import { useLiveWorkspace } from '@/lib/realtime/tool-runs';
import { LOG_KIND, formatRelativeDate } from './constants';

export interface LogFileRef {
  filename: string;
  mime: string;
  sizeBytes?: number;
  generated?: boolean;
}

export interface LogEntry {
  id: string;
  kind: string;
  actor: string;
  title: string;
  meta?: string;
  toolRunId?: string;
  startupId?: string;
  created: string;
  // Detaljer för slide-over (förrenderade/saniterade på servern).
  bodyHtml?: string;
  resultHtml?: string;
  files?: LogFileRef[];
  toolName?: string;
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

function fileIcon(mime: string): string {
  if (mime.startsWith('image/')) return 'image';
  return 'doc';
}

function ActivityDrawer({ entry, onClose }: { entry: LogEntry; onClose: () => void }) {
  const k = LOG_KIND[entry.kind] || LOG_KIND.manual;
  const hasResult = Boolean(entry.resultHtml);
  const hasFiles = Boolean(entry.files && entry.files.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Stäng"
        onClick={onClose}
        className="absolute inset-0 bg-movexum-svart/30 backdrop-blur-[1px]"
      />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-default bg-surface shadow-xl shadow-movexum-svart/20">
        <div className="flex items-start justify-between gap-3 border-b border-default px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-default bg-canvas">
              <span className={k.fgClass}>
                <Icon name={k.iconName} size={14} />
              </span>
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-canvas-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted">
                  {k.label}
                </span>
                <span className="font-mono text-[10.5px] text-foreground-subtle">
                  {formatRelativeDate(entry.created)}
                </span>
              </div>
              <h3 className="mt-1.5 font-heading text-[16px] font-semibold leading-snug text-foreground">
                {entry.title}
              </h3>
              <p className="mt-0.5 text-[11.5px] text-foreground-subtle">
                {[entry.toolName, entry.actor].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-foreground-subtle hover:bg-canvas-muted"
            aria-label="Stäng panel"
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {entry.bodyHtml && (
            <div
              className="text-[13px] leading-relaxed text-foreground-muted"
              dangerouslySetInnerHTML={{ __html: entry.bodyHtml }}
            />
          )}

          {hasResult && (
            <section>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                Resultat
              </div>
              <div
                className="rounded-2xl border border-default bg-canvas p-4 text-[13px]"
                dangerouslySetInnerHTML={{ __html: entry.resultHtml! }}
              />
              <p className="mt-2 text-[11px] text-foreground-subtle">
                ⚠️ Genererat av AI – verifiera innan delning.
              </p>
            </section>
          )}

          {hasFiles && (
            <section>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                Dokument & filer
              </div>
              <ul className="space-y-1.5">
                {entry.files!.map((f, i) => (
                  <li
                    key={`${f.filename}-${i}`}
                    className="flex items-center gap-2.5 rounded-xl border border-default bg-canvas px-3 py-2"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-canvas-muted text-foreground-muted">
                      <Icon name={fileIcon(f.mime)} size={13} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-foreground">
                        {f.filename}
                      </span>
                      <span className="block text-[10.5px] text-foreground-subtle">
                        {[
                          f.generated ? 'AI-genererad' : 'Uppladdad',
                          f.sizeBytes ? `${(f.sizeBytes / 1024).toFixed(0)} kB` : null
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!entry.bodyHtml && !hasResult && !hasFiles && (
            <p className="text-[13px] text-foreground-subtle">
              Ingen ytterligare output registrerad för den här händelsen.
            </p>
          )}
        </div>

        {entry.toolRunId && (
          <div className="border-t border-default p-4">
            <a
              href={`/toolbox/runs/${entry.toolRunId}`}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-[13px] font-medium text-brand-foreground transition hover:bg-brand-hover"
            >
              Öppna körning <Icon name="arrow-up-right" size={14} />
            </a>
          </div>
        )}
      </aside>
    </div>
  );
}

export function LogTab({ entries, startupName }: Props) {
  const [filterId, setFilterId] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useLiveWorkspace(true, 30_000);

  const activeFilter = FILTERS.find((f) => f.id === filterId) || FILTERS[0];
  const visible = entries.filter((e) => activeFilter.match(e.kind));
  const selected = entries.find((e) => e.id === selectedId) || null;

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
              Allt som händer på {startupName} — i kronologisk ordning. Klicka på en
              händelse för att se resultat, dokument och output.
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
                const hasDetail = Boolean(
                  e.toolRunId || e.resultHtml || (e.files && e.files.length) || e.bodyHtml
                );
                return (
                  <div key={e.id} className="relative pl-10">
                    <div className="absolute left-0 top-1.5 flex h-8 w-8 items-center justify-center rounded-full border border-default bg-canvas">
                      <span className={k.fgClass}>
                        <Icon name={k.iconName} size={13} />
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedId(e.id)}
                      className="block w-full rounded-xl border border-default bg-surface p-3.5 text-left shadow-sm shadow-movexum-svart/5 transition hover:border-strong hover:bg-canvas-subtle"
                    >
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-canvas-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted">
                          {k.label}
                        </span>
                        <span className="font-mono text-[10.5px] text-foreground-subtle">
                          {formatRelativeDate(e.created)}
                        </span>
                        <span className="ml-auto flex items-center gap-1.5 text-[10.5px] text-foreground-subtle">
                          · {e.actor}
                          {hasDetail && (
                            <Icon name="chevron" size={12} />
                          )}
                        </span>
                      </div>
                      <div className="font-heading text-[13.5px] font-semibold leading-snug text-foreground">
                        {e.title}
                      </div>
                      {e.meta && (
                        <div className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-foreground-muted">
                          {e.meta}
                        </div>
                      )}
                      {e.files && e.files.length > 0 && (
                        <div className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-default bg-canvas-muted px-2 py-1 font-mono text-[10.5px] text-foreground-muted">
                          <Icon name="paperclip" size={10} /> {e.files.length} fil
                          {e.files.length > 1 ? 'er' : ''}
                        </div>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {selected && <ActivityDrawer entry={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
