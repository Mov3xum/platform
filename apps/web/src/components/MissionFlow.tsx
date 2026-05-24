// Movexum OS — MissionFlow
// Visar uppdragets header (meta), flödesrail (steg), artefakter och AI-förslag.
// Server-komponent. Stage-knappar och form använder server actions.

import { Chip, Avatar, Meta, Icon } from '@/components/proto';
import { advanceStageFormAction, addArtifactFormAction, updateMissionStatusFormAction } from '@/lib/actions/missions';
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

function fmtDate(s?: string) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('sv-SE', { year: 'numeric', month: 'short', day: '2-digit' });
}

function isOverdue(due?: string, status?: MissionStatus) {
  if (!due || status === 'done' || status === 'archived') return false;
  const d = new Date(due);
  return d.getTime() < Date.now();
}

function daysUntil(due?: string) {
  if (!due) return null;
  const d = new Date(due).getTime();
  const diff = Math.round((d - Date.now()) / (24 * 3600 * 1000));
  return diff;
}

export function MissionFlow({ mission, currentUserId, canAdvance }: {
  mission: Mission;
  currentUserId: string;
  canAdvance: boolean;
}) {
  const issuer = mission.expand?.issuer;
  const recipients = mission.expand?.recipients || [];
  const mentor = mission.expand?.mentor;
  const startup = mission.expand?.startup;
  const stages: MissionStage[] = Array.isArray(mission.stages_json) ? mission.stages_json : [];
  const artifacts = Array.isArray(mission.artifacts_json) ? mission.artifacts_json : [];
  const nextStageIdx = stages.findIndex((s) => !s.done);
  const overdue = isOverdue(mission.due_date, mission.status);
  const days = daysUntil(mission.due_date);

  return (
    <div className="mx-card" style={{ overflow: 'auto' }}>
      {/* Header */}
      <div style={{ padding: 18, borderBottom: '1px solid var(--mx-line-soft)' }}>
        <div className="mx-flex mx-items-c mx-gap-2 mx-mb-2">
          <span className="mx-mono mx-t-xs mx-muted mx-t-up">
            {mission.id.slice(0, 6)} · {mission.type.replace('_', ' ')}
          </span>
          <span className="mx-grow" />
          <Chip variant={statusVariant(mission.status)} mono dot>
            {STATUS_LABELS[mission.status]}
          </Chip>
        </div>
        <h2 className="mx-disp" style={{ fontSize: 22, fontWeight: 500, letterSpacing: -0.3 }}>
          {mission.title}
        </h2>
        {mission.description && (
          <p className="mx-t-13 mx-muted mx-mt-2" style={{ lineHeight: 1.5 }}>
            {mission.description}
          </p>
        )}

        <div className="mx-flex mx-gap-4 mx-mt-3 mx-wrap">
          {issuer && (
            <Meta
              label="Utfärdare"
              value={
                <div className="mx-flex mx-items-c mx-gap-2">
                  <Avatar
                    initial={initials(issuer.display_name || issuer.email)}
                    size="xs"
                    accent={avatarAccent(issuer.id)}
                  />
                  <span className="mx-t-13 mx-fw-6">
                    {issuer.display_name || issuer.email}
                  </span>
                </div>
              }
            />
          )}
          {recipients.length > 0 && (
            <Meta
              label={`Mottagare (${recipients.length})`}
              value={
                <div className="mx-av-stack">
                  {recipients.slice(0, 6).map((r) => (
                    <Avatar
                      key={r.id}
                      initial={initials(r.display_name || r.email)}
                      size="sm"
                      accent={avatarAccent(r.id)}
                    />
                  ))}
                </div>
              }
            />
          )}
          {mentor && (
            <Meta
              label="Mentor"
              value={
                <div className="mx-flex mx-items-c mx-gap-2">
                  <Avatar
                    initial={initials(mentor.display_name || mentor.email)}
                    size="xs"
                    accent={avatarAccent(mentor.id)}
                  />
                  <span className="mx-t-13 mx-fw-6">
                    {mentor.display_name || mentor.email}
                  </span>
                </div>
              }
            />
          )}
          {startup && (
            <Meta
              label="Bolag"
              value={<span className="mx-t-13 mx-fw-6">{startup.name}</span>}
            />
          )}
          <Meta
            label="Deadline"
            value={
              <span
                className="mx-mono mx-fw-6 mx-t-13"
                style={{ color: overdue ? 'var(--mx-st-danger, #4b2718)' : 'inherit' }}
              >
                {fmtDate(mission.due_date)}
                {days !== null && (
                  <span className="mx-muted mx-t-xs" style={{ marginLeft: 6 }}>
                    {days < 0 ? `${Math.abs(days)} d försenat` : days === 0 ? 'idag' : `om ${days} d`}
                  </span>
                )}
              </span>
            }
          />
        </div>
      </div>

      {/* Flow rail */}
      <div style={{ padding: 18 }}>
        <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6 mx-mb-3">Flöde</div>
        {stages.length === 0 ? (
          <div className="mx-muted mx-t-13">Inga steg definierade.</div>
        ) : (
          <div className="mx-flex" style={{ gap: 0 }}>
            {stages.map((s, i) => (
              <Stage
                key={s.id}
                stage={s}
                isLast={i === stages.length - 1}
                isNext={i === nextStageIdx}
                missionId={mission.id}
                canAdvance={canAdvance}
              />
            ))}
          </div>
        )}
      </div>

      {/* Artifacts */}
      <div style={{ padding: 18, borderTop: '1px solid var(--mx-line-soft)' }}>
        <div className="mx-flex mx-items-c mx-gap-2 mx-mb-3">
          <span className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6">
            Artefakter ({artifacts.length})
          </span>
        </div>
        {artifacts.length === 0 ? (
          <div className="mx-muted mx-t-13 mx-mb-3">Inga artefakter ännu.</div>
        ) : (
          <div className="mx-flex mx-col mx-gap-2 mx-mb-3">
            {artifacts.map((a) => (
              <div
                key={a.id}
                className="mx-flex mx-items-c mx-gap-3"
                style={{ padding: '10px 12px', background: 'var(--mx-paper-3)', borderRadius: 8 }}
              >
                <Icon name="doc" size={16} className="mx-muted" />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="mx-t-13 mx-fw-6 mx-truncate">{a.name}</div>
                  <div className="mx-t-xs mx-muted mx-mono">
                    {[a.size, a.created ? new Date(a.created).toLocaleDateString('sv-SE') : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noreferrer" className="mx-btn mx-sm mx-ghost">
                    <Icon name="external" size={12} />
                  </a>
                ) : (
                  <span className="mx-mono mx-t-xs mx-muted">Ingen länk</span>
                )}
              </div>
            ))}
          </div>
        )}

        {canAdvance && (
          <form action={addArtifactFormAction} className="mx-flex mx-gap-2 mx-wrap">
            <input type="hidden" name="mission_id" value={mission.id} />
            <input
              name="name"
              required
              placeholder="Artefaktens namn"
              style={inputStyle}
            />
            <input name="size" placeholder="t.ex. 1.2 MB" style={{ ...inputStyle, maxWidth: 120 }} />
            <input name="url" placeholder="https://…" style={inputStyle} />
            <button type="submit" className="mx-btn mx-sm">
              <Icon name="plus" size={12} /> Lägg till
            </button>
          </form>
        )}
      </div>

      {/* AI suggestion when overdue */}
      {overdue && (
        <div
          style={{
            padding: 18,
            borderTop: '1px solid var(--mx-line-soft)',
            background: 'var(--mx-cyan-tint)'
          }}
        >
          <div className="mx-flex mx-items-c mx-gap-2 mx-mb-2">
            <Icon name="sparkle" size={14} style={{ color: '#005470' }} />
            <span className="mx-mono mx-t-xs mx-t-up mx-fw-6" style={{ color: '#0e3b44' }}>
              AI-FÖRSLAG
            </span>
          </div>
          <div className="mx-t-13 mx-fw-6 mx-mb-2" style={{ color: '#0e3b44' }}>
            Uppdraget är försenat. Skicka påminnelse till mottagarna eller flytta deadline?
          </div>
          <div className="mx-muted mx-t-13">
            Uppdatera deadline eller status nedan för att få uppdraget tillbaka i plan.
          </div>
        </div>
      )}

      {/* Status admin */}
      <div style={{ padding: 18, borderTop: '1px solid var(--mx-line-soft)' }}>
        <form action={updateMissionStatusFormAction} className="mx-flex mx-items-c mx-gap-2">
          <input type="hidden" name="mission_id" value={mission.id} />
          <span className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6">Status</span>
          <select name="status" defaultValue={mission.status} style={selectStyle} disabled={!canAdvance}>
            {(Object.keys(STATUS_LABELS) as MissionStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <button type="submit" className="mx-btn mx-sm" disabled={!canAdvance}>
            Spara
          </button>
        </form>
      </div>
    </div>
  );
}

function Stage({
  stage,
  isLast,
  isNext,
  missionId,
  canAdvance
}: {
  stage: MissionStage;
  isLast: boolean;
  isNext: boolean;
  missionId: string;
  canAdvance: boolean;
}) {
  return (
    <div style={{ flex: 1, position: 'relative', paddingRight: isLast ? 0 : 8 }}>
      <div
        style={{
          height: 4,
          background: stage.done ? '#002c40' : 'var(--mx-line)',
          borderRadius: 999,
          position: 'relative',
          marginBottom: 10
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: -4,
            width: 12,
            height: 12,
            borderRadius: 50,
            background: stage.done ? '#002c40' : 'var(--mx-paper)',
            border: `2px solid ${stage.done ? '#002c40' : 'var(--mx-line-strong)'}`
          }}
        />
      </div>
      <div className="mx-flex mx-items-c mx-gap-2 mx-mb-1">
        <Chip variant={stage.done ? 'active' : isNext ? 'review' : 'draft'} mono>
          {stage.label}
        </Chip>
      </div>
      {stage.time && (
        <div className="mx-mono mx-t-xs mx-muted" style={{ marginBottom: 4 }}>
          {stage.time}
        </div>
      )}
      {stage.note && (
        <div className="mx-t-12 mx-muted-2" style={{ lineHeight: 1.4, marginBottom: 6 }}>
          {stage.note}
        </div>
      )}
      {!stage.done && isNext && canAdvance && (
        <form action={advanceStageFormAction} style={{ marginTop: 6 }}>
          <input type="hidden" name="mission_id" value={missionId} />
          <input type="hidden" name="stage_id" value={stage.id} />
          <button type="submit" className="mx-btn mx-sm mx-primary">
            <Icon name="check" size={12} /> Markera klart
          </button>
        </form>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 140,
  background: 'var(--mx-paper)',
  border: '1px solid var(--mx-line)',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 13,
  outline: 'none',
  color: 'var(--mx-ink)'
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  flex: 'none'
};
