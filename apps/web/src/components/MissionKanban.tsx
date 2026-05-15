// Movexum OS — MissionKanban
// 5 kolumner per status. Klick på kort → /uppdrag/[id]
// Server-komponent. Ingen drag-and-drop i denna iteration (uppdatera status från detaljvyn).

import Link from 'next/link';
import { Icon, Avatar } from '@/components/proto';
import type { Mission, MissionStatus } from '@platform/shared';

type AvatarAccent = 'ink' | 'green' | 'purple' | 'brown' | 'copper' | 'yellow' | 'cyan';

const COLUMNS: Array<{ status: MissionStatus; label: string }> = [
  { status: 'draft', label: 'Utkast' },
  { status: 'preparation', label: 'Förberedelse' },
  { status: 'in_progress', label: 'Pågående' },
  { status: 'review', label: 'Granskning' },
  { status: 'done', label: 'Klart' }
];

function avatarAccent(seed: string): AvatarAccent {
  const tones: AvatarAccent[] = ['ink', 'green', 'purple', 'brown', 'copper', 'yellow', 'cyan'];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return tones[hash % tones.length];
}

function initials(name?: string) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function MissionKanban({ missions }: { missions: Mission[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 12,
        minHeight: 0,
        overflow: 'auto'
      }}
    >
      {COLUMNS.map((col) => {
        const items = missions.filter((m) => m.status === col.status);
        return (
          <div
            key={col.status}
            style={{
              background: 'var(--mx-paper-3)',
              borderRadius: 12,
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              minHeight: 200
            }}
          >
            <div className="mx-flex mx-items-c mx-gap-2 mx-mb-2">
              <span className="mx-mono mx-t-xs mx-t-up mx-fw-6">{col.label}</span>
              <span className="mx-mono mx-t-xs mx-muted">{items.length}</span>
              <span className="mx-grow" />
              <Link href="/uppdrag/new" className="mx-btn mx-sm mx-ghost" style={{ padding: '2px 6px' }}>
                <Icon name="plus" size={12} />
              </Link>
            </div>
            {items.length === 0 ? (
              <div className="mx-t-xs mx-muted" style={{ textAlign: 'center', padding: 16 }}>
                Tomt
              </div>
            ) : (
              items.map((m) => {
                const issuer = m.expand?.issuer;
                return (
                  <Link
                    key={m.id}
                    href={`/uppdrag/${m.id}`}
                    className="mx-card"
                    style={{ padding: 12, cursor: 'pointer', textDecoration: 'none', color: 'inherit' }}
                  >
                    <div className="mx-flex mx-items-c mx-gap-2 mx-mb-2">
                      <span className="mx-mono mx-t-xs mx-muted">
                        {m.id.slice(0, 6).toUpperCase()}
                      </span>
                    </div>
                    <div className="mx-t-13 mx-fw-6 mx-mb-2" style={{ lineHeight: 1.3 }}>
                      {m.title}
                    </div>
                    <div className="mx-flex mx-items-c mx-gap-2 mx-justify-b">
                      {issuer ? (
                        <Avatar
                          initial={initials(issuer.display_name || issuer.email)}
                          size="xs"
                          accent={avatarAccent(issuer.id)}
                        />
                      ) : (
                        <span className="mx-t-xs mx-muted">—</span>
                      )}
                      <span className="mx-mono mx-t-xs mx-muted">
                        {m.due_date ? m.due_date.slice(5, 10) : '—'}
                      </span>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        );
      })}
    </div>
  );
}
