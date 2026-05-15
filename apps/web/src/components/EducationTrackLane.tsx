// Movexum OS — TrackLane för utbildning.
// Renderar en horisontellt scrollande rad av workshop-kort, grupperade per
// Sprint X-axel (funding / sustain / intl / team).

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Workshop, WorkshopAssignmentStatus } from '@platform/shared';
import { Card, Chip } from './proto';

type Accent = 'yellow' | 'green' | 'cyan' | 'purple';

type ChipVariant = 'default' | 'active' | 'draft' | 'yellow' | 'green' | 'cyan' | 'purple';

export interface TrackModule {
  workshop: Workshop;
  status: WorkshopAssignmentStatus | 'not_started';
  lengthLabel?: string;
}

interface TrackLaneProps {
  trackId: string;
  trackLabel: string;
  accent: Accent;
  modules: TrackModule[];
  children?: ReactNode;
}

function chipVariantFor(status: TrackModule['status'], accent: Accent): {
  variant: ChipVariant;
  label: string;
} {
  if (status === 'done') return { variant: 'active', label: '✓ Klar' };
  if (status === 'in_progress') return { variant: accent, label: 'Pågående' };
  return { variant: 'draft', label: 'Ej startad' };
}

function borderForActive(accent: Accent): string {
  switch (accent) {
    case 'yellow':
      return 'var(--mx-yellow)';
    case 'green':
      return 'var(--mx-green)';
    case 'cyan':
      return 'var(--mx-cyan)';
    case 'purple':
      return 'var(--mx-purple)';
  }
}

export function EducationTrackLane({
  trackLabel,
  accent,
  modules
}: TrackLaneProps) {
  const doneCount = modules.filter((m) => m.status === 'done').length;
  return (
    <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
      <div className="mx-card-head">
        <Chip variant={accent} mono>
          {trackLabel}
        </Chip>
        <span className="mx-grow" />
        <span className="mx-mono mx-t-xs mx-muted">
          {doneCount}/{modules.length}
        </span>
      </div>
      {modules.length === 0 ? (
        <div
          className="mx-t-13 mx-muted"
          style={{ padding: '20px 16px' }}
        >
          Inga moduler i detta spår ännu.
        </div>
      ) : (
        <div
          className="mx-flex"
          style={{ padding: 16, overflowX: 'auto', gap: 8 }}
        >
          {modules.map((m) => {
            const { variant, label } = chipVariantFor(m.status, accent);
            const isActive = m.status === 'in_progress';
            return (
              <Link
                key={m.workshop.id}
                href={`/education/workshops/${m.workshop.id}`}
                style={{
                  textDecoration: 'none',
                  color: 'inherit',
                  display: 'block',
                  flexShrink: 0
                }}
              >
                <div
                  className="mx-card"
                  style={{
                    padding: 12,
                    minWidth: 200,
                    borderColor: isActive ? borderForActive(accent) : 'var(--mx-line)',
                    borderWidth: isActive ? 2 : 1,
                    cursor: 'pointer'
                  }}
                >
                  <div className="mx-flex mx-items-c mx-gap-2 mx-mb-2">
                    <Chip variant={variant} mono>
                      {label}
                    </Chip>
                  </div>
                  <div className="mx-t-13 mx-fw-6 mx-mb-2">{m.workshop.title}</div>
                  <div className="mx-mono mx-t-xs mx-muted">
                    {m.lengthLabel || `v${m.workshop.version}`}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Card>
  );
}
