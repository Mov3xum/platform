'use client';

// Movexum OS — MissionList (vänster pane på /uppdrag)
// Klient-komponent för urval. Klick byter aktivt uppdrag via URL-uppdatering.

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Chip, Avatar, ProgressBar } from '@/components/proto';
import type { Mission, MissionStage, MissionStatus } from '@platform/shared';

type AvatarAccent = 'ink' | 'green' | 'purple' | 'brown' | 'copper' | 'yellow' | 'cyan';

const STATUS_LABELS: Record<MissionStatus, string> = {
  draft: 'Utkast',
  preparation: 'Förberedelse',
  in_progress: 'Pågående',
  review: 'Granskning',
  done: 'Klart',
  archived: 'Arkiverat'
};

function statusVariant(status: MissionStatus) {
  switch (status) {
    case 'done':
      return 'done' as const;
    case 'in_progress':
      return 'active' as const;
    case 'review':
      return 'review' as const;
    case 'archived':
      return 'archive' as const;
    default:
      return 'draft' as const;
  }
}

function avatarAccent(seed: string): AvatarAccent {
  const tones: AvatarAccent[] = ['ink', 'green', 'purple', 'brown', 'copper', 'yellow', 'cyan'];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return tones[hash % tones.length];
}

function initials(name?: string, fallback = '?') {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function MissionList({
  missions,
  selectedId
}: {
  missions: Mission[];
  selectedId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const select = (id: string) => {
    const sp = new URLSearchParams(params.toString());
    sp.set('m', id);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  return (
    <div className="mx-card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div className="mx-card-head">
        <span className="mx-lab">{missions.length} uppdrag</span>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {missions.length === 0 ? (
          <div className="mx-muted mx-t-13" style={{ padding: 24, textAlign: 'center' }}>
            Inga uppdrag matchar filtret.
          </div>
        ) : (
          missions.map((m) => {
            const issuer = m.expand?.issuer;
            const stages: MissionStage[] = Array.isArray(m.stages_json) ? m.stages_json : [];
            const done = stages.filter((s) => s.done).length;
            const total = Math.max(stages.length, 1);
            const isSel = m.id === selectedId;
            return (
              <button
                key={m.id}
                onClick={() => select(m.id)}
                type="button"
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--mx-line-soft)',
                  cursor: 'pointer',
                  background: isSel ? 'var(--mx-paper-3)' : 'transparent',
                  borderLeft: isSel ? '3px solid var(--mx-ink, #002c40)' : '3px solid transparent',
                  transition: 'background .12s',
                  border: 'none',
                  borderLeftStyle: 'solid',
                  borderLeftWidth: 3,
                  borderLeftColor: isSel ? '#002c40' : 'transparent',
                  borderBottomStyle: 'solid',
                  borderBottomWidth: 1,
                  borderBottomColor: 'var(--mx-line-soft)',
                  color: 'inherit',
                  font: 'inherit'
                }}
              >
                <div className="mx-flex mx-items-c mx-gap-2 mx-mb-2">
                  <span className="mx-mono mx-t-xs mx-muted">{m.id.slice(0, 6).toUpperCase()}</span>
                  <span className="mx-grow" />
                  <Chip variant={statusVariant(m.status)} mono>
                    {STATUS_LABELS[m.status]}
                  </Chip>
                </div>
                <div className="mx-disp mx-t-13 mx-fw-6 mx-mb-1" style={{ lineHeight: 1.25 }}>
                  {m.title}
                </div>
                <div className="mx-flex mx-items-c mx-gap-2">
                  {issuer && (
                    <Avatar
                      initial={initials(issuer.display_name || issuer.email)}
                      size="xs"
                      accent={avatarAccent(issuer.id)}
                    />
                  )}
                  <span className="mx-t-xs mx-muted">
                    {issuer ? (issuer.display_name || issuer.email).split(' ')[0] : '—'} →{' '}
                    {(m.recipients?.length || 0)} mottagare
                  </span>
                </div>
                <div className="mx-flex mx-items-c mx-gap-2 mx-mt-2">
                  <ProgressBar pct={(done / total) * 100} accent={m.accent || 'purple'} />
                  <span className="mx-mono mx-t-xs mx-muted">
                    {done}/{stages.length}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
