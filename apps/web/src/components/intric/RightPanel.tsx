'use client';

import { useState } from 'react';
import { Icon } from '@/components/proto/Icon';

export interface KnowledgeItem {
  id: string;
  kind: 'note' | 'milestone' | 'compass' | 'irl' | 'file' | 'tool_run';
  name: string;
  meta?: string;
  updated?: string;
  href?: string;
}

interface Props {
  knowledge: KnowledgeItem[];
  startupId: string;
}

const kindIcon: Record<KnowledgeItem['kind'], string> = {
  note: 'doc',
  milestone: 'check',
  compass: 'compass',
  irl: 'graph',
  file: 'doc',
  tool_run: 'sparkle'
};

const kindIconClass: Partial<Record<KnowledgeItem['kind'], string>> = {
  tool_run: 'bg-movexum-pastell-lila text-movexum-lila',
  milestone: 'bg-movexum-pastell-gron text-movexum-gron'
};

export function RightPanel({ knowledge, startupId }: Props) {
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

      <p className="px-5 pt-3 text-[11.5px] leading-relaxed text-foreground-subtle">
        Allt bolaget producerar — AI-resultat, dokument, anteckningar och milstolpar.
      </p>

      <div className="space-y-1 px-3 py-3">
        {knowledge.length === 0 ? (
          <div className="px-2 py-6 text-center text-[12px] text-foreground-subtle">
            Inga kunskaps­källor ännu.
          </div>
        ) : (
          knowledge.map((k) => {
            const inner = (
              <>
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-default ${kindIconClass[k.kind] ?? 'bg-canvas-muted text-foreground-muted'}`}
                >
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
              </>
            );
            const cls =
              'flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-canvas-muted';
            return k.href ? (
              <a key={k.id} href={k.href} className={cls}>
                {inner}
              </a>
            ) : (
              <button key={k.id} type="button" className={cls}>
                {inner}
              </button>
            );
          })
        )}

        <a
          href={`/startups/${startupId}/logg`}
          className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-default px-3 py-2.5 text-[12.5px] text-foreground-muted transition hover:border-brand hover:bg-canvas-muted hover:text-brand"
        >
          <Icon name="flow" size={14} /> Visa hela loggen
        </a>
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
