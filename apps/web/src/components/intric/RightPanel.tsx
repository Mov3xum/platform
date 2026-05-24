'use client';

import { useState } from 'react';
import { Icon } from '@/components/proto/Icon';

export interface KnowledgeItem {
  id: string;
  kind: 'note' | 'milestone' | 'compass' | 'irl' | 'file';
  name: string;
  meta?: string;
  updated?: string;
}

export interface AssistantShortcut {
  id: string;
  name: string;
  category?: string;
  runs?: number;
}

interface Props {
  knowledge: KnowledgeItem[];
  assistants: AssistantShortcut[];
  startupId: string;
}

const kindIcon: Record<KnowledgeItem['kind'], string> = {
  note: 'doc',
  milestone: 'check',
  compass: 'compass',
  irl: 'graph',
  file: 'doc'
};

export function RightPanel({ knowledge, assistants, startupId }: Props) {
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute right-3 top-3 z-10 hidden h-9 w-9 items-center justify-center rounded-lg border border-default bg-surface text-foreground-subtle hover:bg-canvas-muted lg:flex"
        title="Visa kunskap"
        aria-label="Visa kunskap"
      >
        <Icon name="panel-right" size={15} />
      </button>
    );
  }

  return (
    <aside className="mx-workspace-aside flex flex-col">
      <div className="flex items-center justify-between border-b border-default px-5 py-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
          Kunskap
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-subtle hover:bg-canvas-muted"
          title="Stäng"
          aria-label="Stäng panel"
        >
          <Icon name="x" size={14} />
        </button>
      </div>

      <div className="space-y-1 px-3 py-3">
        {knowledge.length === 0 ? (
          <div className="px-2 py-6 text-center text-[12px] text-foreground-subtle">
            Inga kunskaps­källor ännu.
          </div>
        ) : (
          knowledge.map((k) => (
            <button
              key={k.id}
              type="button"
              className="flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-canvas-muted"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-default bg-canvas-muted text-foreground-muted">
                <Icon name={kindIcon[k.kind]} size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium text-foreground">{k.name}</div>
                {k.meta && (
                  <div className="truncate text-[11px] text-foreground-subtle">{k.meta}</div>
                )}
                {k.updated && (
                  <div className="mt-0.5 truncate font-mono text-[10.5px] text-foreground-subtle">
                    {k.updated}
                  </div>
                )}
              </div>
            </button>
          ))
        )}

        <button
          type="button"
          className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-default px-3 py-2.5 text-[12.5px] text-foreground-muted transition hover:border-brand hover:bg-canvas-muted hover:text-brand"
        >
          <Icon name="plus" size={14} /> Lägg till
        </button>
      </div>

      <div className="mt-2 border-t border-default px-5 pb-2 pt-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
          Assistenter
        </div>
      </div>
      <div className="space-y-1 px-3 py-2">
        {assistants.length === 0 ? (
          <div className="px-2 py-4 text-center text-[11px] text-foreground-subtle">
            Inga assistenter aktiverade.
          </div>
        ) : (
          assistants.slice(0, 5).map((a) => (
            <a
              key={a.id}
              href={`/startups/${startupId}/verktyg`}
              className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-canvas-muted"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-movexum-pastell-lila text-movexum-lila">
                <Icon name="sparkle" size={13} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-foreground">
                  {a.name}
                </span>
                <span className="block truncate text-[10.5px] text-foreground-subtle">
                  {[a.category, a.runs ? `${a.runs} körningar` : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              <Icon name="chevron" size={13} />
            </a>
          ))
        )}
      </div>

      <div className="mt-auto border-t border-default p-4">
        <div className="rounded-xl border border-default bg-canvas-muted p-3">
          <div className="mb-1.5 flex items-center gap-2">
            <Icon name="bot" size={13} />
            <span className="font-mono text-[11px] font-medium text-foreground">Mistral · EU</span>
          </div>
          <p className="text-[11px] leading-relaxed text-foreground-subtle">
            Alla AI-körningar går via Mistral / Le Chat i Frankrike. Inga data lämnar EU.
            Konfidentiella anteckningar exkluderas alltid.
          </p>
        </div>
      </div>
    </aside>
  );
}
