'use client';

import { useState, useTransition, useOptimistic } from 'react';
import Link from 'next/link';
import { DEAL_STAGES, type Deal, type DealStage } from '@platform/shared';
import { moveDealStageAction } from '@/lib/actions/investors';
import { Avatar, Icon } from '@/components/proto';

type DealWithExpand = Deal & {
  expand?: {
    startup?: { id: string; name: string };
    investor?: { id: string; name: string };
  };
};

function formatMkr(amountKr?: number): string {
  if (!amountKr || amountKr <= 0) return '—';
  const mkr = amountKr / 1_000_000;
  return mkr < 10 ? `${mkr.toFixed(1).replace('.', ',')} Mkr` : `${Math.round(mkr)} Mkr`;
}

function formatRelative(iso?: string): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  const d = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (d <= 0) return 'idag';
  if (d === 1) return 'igår';
  if (d < 7) return `${d}d sen`;
  if (d < 30) return `${Math.floor(d / 7)}v sen`;
  if (d < 365) return `${Math.floor(d / 30)}m sen`;
  return `${Math.floor(d / 365)}å sen`;
}

const STARTUP_ACCENTS = ['ink', 'green', 'purple', 'copper', 'cyan', 'yellow', 'brown'] as const;

function accentFor(id: string | undefined): (typeof STARTUP_ACCENTS)[number] {
  if (!id) return 'ink';
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return STARTUP_ACCENTS[h % STARTUP_ACCENTS.length];
}

export function DealFlowBoard({ deals }: { deals: DealWithExpand[] }) {
  const [optimisticDeals, setOptimisticDeals] = useOptimistic(
    deals,
    (state: DealWithExpand[], next: { id: string; stage: DealStage }) =>
      state.map((d) => (d.id === next.id ? { ...d, stage: next.stage } : d))
  );
  const [pending, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);

  function moveDeal(dealId: string, nextStage: DealStage) {
    startTransition(async () => {
      setOptimisticDeals({ id: dealId, stage: nextStage });
      await moveDealStageAction(dealId, nextStage);
    });
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${DEAL_STAGES.length}, 1fr)`,
        gap: 10,
        opacity: pending ? 0.85 : 1,
        transition: 'opacity .15s'
      }}
    >
      {DEAL_STAGES.map((stage) => {
        const items = optimisticDeals.filter((d) => d.stage === stage.id);
        const totalKr = items.reduce((s, d) => s + (d.amount || 0), 0);
        return (
          <div
            key={stage.id}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/plain');
              if (id) moveDeal(id, stage.id);
              setDragId(null);
            }}
            style={{
              background: 'var(--mx-paper-3, #f4f4f4)',
              borderRadius: 12,
              padding: 10,
              minHeight: 240
            }}
          >
            <div className="mx-flex mx-items-c mx-gap-2 mx-mb-3">
              <span className="mx-mono mx-t-xs mx-t-up mx-fw-6">{stage.label}</span>
              <span className="mx-mono mx-t-xs mx-muted">{items.length}</span>
              <span className="mx-grow" />
              <span className="mx-mono mx-t-xs mx-muted">{formatMkr(totalKr)}</span>
            </div>
            <div className="mx-flex mx-col mx-gap-2">
              {items.map((d) => {
                const startup = d.expand?.startup;
                const investor = d.expand?.investor;
                const isDragging = dragId === d.id;
                return (
                  <div
                    key={d.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', d.id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDragId(d.id);
                    }}
                    onDragEnd={() => setDragId(null)}
                    className="mx-card"
                    style={{
                      padding: 10,
                      cursor: 'grab',
                      opacity: isDragging ? 0.4 : 1
                    }}
                  >
                    <div className="mx-flex mx-items-c mx-gap-2 mx-mb-2">
                      <Avatar
                        initial={(startup?.name || '··').slice(0, 2).toUpperCase()}
                        size="xs"
                        accent={accentFor(startup?.id)}
                      />
                      <span className="mx-t-12 mx-fw-6 mx-truncate">
                        {startup?.name || 'Okänt bolag'}
                      </span>
                    </div>
                    <div className="mx-mono mx-t-xs mx-muted mx-truncate mx-mb-1">
                      → {investor?.name || 'Okänd investerare'}
                    </div>
                    <div className="mx-flex mx-items-c mx-justify-b">
                      <span className="mx-disp mx-fw-6 mx-t-13">{formatMkr(d.amount)}</span>
                      <span className="mx-mono mx-t-xs mx-muted">
                        {formatRelative(d.last_activity || d.updated)}
                      </span>
                    </div>
                    <div
                      className="mx-flex mx-items-c mx-gap-1"
                      style={{ marginTop: 8, flexWrap: 'wrap' }}
                    >
                      {DEAL_STAGES.filter((s) => s.id !== d.stage).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          disabled={pending}
                          onClick={() => moveDeal(d.id, s.id)}
                          className="mx-btn mx-sm mx-ghost"
                          style={{ fontSize: 10, padding: '2px 6px' }}
                          title={`Flytta till ${s.label}`}
                        >
                          → {s.label}
                        </button>
                      ))}
                      {investor && (
                        <Link
                          href={`/investerare/${investor.id}`}
                          className="mx-btn mx-sm mx-ghost"
                          style={{ fontSize: 10, padding: '2px 6px', marginLeft: 'auto' }}
                        >
                          <Icon name="external" size={10} />
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
              {items.length === 0 && (
                <div
                  className="mx-t-xs mx-muted"
                  style={{ textAlign: 'center', padding: 12 }}
                >
                  Tomt
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
