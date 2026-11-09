// CLAUDE.md § 29 / § 29.7 — "Team & kompetenser" på uppdragskortet.
// Visar teamets samlade kompetenstäckning (områden + hashtags med högsta
// nivå i teamet), varje medlems hashtags/nivå och NUVARANDE belastning
// (pågående team), så att staff ser om det tvärfunktionella teamet täcker
// uppdragets behov och vem som är tungt belastad. Ren, presentationell
// server-komponent (ingen IO, ingen klient-interaktivitet).

import { Card, Icon } from '@/components/proto';
import {
  COMPETENCE_LABELS,
  COMPETENCE_IDS,
  COMPETENCE_LEVEL_LABELS,
  COMPETENCE_LEVEL_WEIGHT,
  DEFAULT_MAX_ACTIVE_TEAMS,
  LOAD_LEVEL_LABELS,
  describeLoad,
  loadLevel,
  type CompetenceId,
  type CompetenceLevel,
  type MissionParticipantRole,
  type TeamMemberLoad,
  type UserCompetenceTag
} from '@platform/shared';

const ROLE_LABELS: Record<MissionParticipantRole, string> = {
  lead: 'Ansvarig',
  contributor: 'Deltagare',
  observer: 'Observatör'
};

export interface TeamMemberView {
  id: string;
  name: string;
  title?: string;
  role: MissionParticipantRole;
  competences: CompetenceId[];
  tags?: UserCompetenceTag[];
  load?: TeamMemberLoad;
}

export function TeamCompetencePanel({
  members,
  teamCap = DEFAULT_MAX_ACTIVE_TEAMS
}: {
  members: TeamMemberView[];
  /** Max antal pågående team per person (§ 29.7). */
  teamCap?: number;
}) {
  const coverage = new Set<CompetenceId>();
  const tagCoverage = new Map<string, CompetenceLevel>();
  for (const m of members) {
    for (const c of m.competences) coverage.add(c);
    for (const t of m.tags ?? []) {
      coverage.add(t.area);
      const cur = tagCoverage.get(t.tag);
      if (!cur || COMPETENCE_LEVEL_WEIGHT[t.level] > COMPETENCE_LEVEL_WEIGHT[cur]) tagCoverage.set(t.tag, t.level);
    }
  }
  const coverageList = COMPETENCE_IDS.filter((id) => coverage.has(id));
  const tagList = Array.from(tagCoverage.entries()).sort(
    (a, b) => COMPETENCE_LEVEL_WEIGHT[b[1]] - COMPETENCE_LEVEL_WEIGHT[a[1]] || a[0].localeCompare(b[0], 'sv')
  );
  const anyTagged = members.some((m) => m.competences.length > 0 || (m.tags?.length ?? 0) > 0);
  const heavy = members.filter((m) => m.load && ['high', 'full'].includes(loadLevel(m.load, teamCap)));

  return (
    <Card style={{ padding: 16 }}>
      <div className="mx-flex mx-items-c mx-gap-2 mx-mb-2">
        <Icon name="people" size={14} />
        <div className="mx-fw-6 mx-t-14">Team & kompetenser</div>
      </div>

      {coverageList.length > 0 && (
        <div className="mx-mb-3">
          <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6 mx-mb-2">
            Samlad kompetens i teamet
          </div>
          <div className="mx-flex mx-gap-2 mx-wrap">
            {coverageList.map((c) => (
              <span key={c} className="mx-chip mx-mono">
                {COMPETENCE_LABELS[c]}
              </span>
            ))}
          </div>
          {tagList.length > 0 && (
            <div className="mx-flex mx-gap-1 mx-wrap mx-mt-2">
              {tagList.map(([tag, level]) => (
                <span key={tag} className="mx-mono mx-t-xs mx-muted" title={COMPETENCE_LEVEL_LABELS[level]}>
                  #{tag} · {COMPETENCE_LEVEL_LABELS[level].toLowerCase()}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {heavy.length > 0 && (
        <div
          className="mx-t-12 mx-mb-3"
          style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--mx-st-warn-bg, #f8f1da)', color: '#4b2718' }}
        >
          <strong>Hög belastning:</strong>{' '}
          {heavy.map((m) => `${m.name} (${describeLoad(m.load!, teamCap).toLowerCase()})`).join(', ')}.
        </div>
      )}

      <ul className="mx-flex mx-col mx-gap-2">
        {members.map((m) => (
          <li
            key={m.id}
            style={{ padding: '8px 10px', background: 'var(--mx-paper-3)', borderRadius: 8 }}
          >
            <div className="mx-t-13 mx-fw-6">
              {m.name}
              {m.title ? <span className="mx-muted mx-fw-4"> · {m.title}</span> : null}
              <span className="mx-mono mx-t-xs mx-muted"> · {ROLE_LABELS[m.role]}</span>
              {m.load ? (
                <span className="mx-mono mx-t-xs mx-muted" title={describeLoad(m.load, teamCap)}>
                  {' '}· {LOAD_LEVEL_LABELS[loadLevel(m.load, teamCap)].toLowerCase()} ({m.load.active}/{teamCap} team)
                </span>
              ) : null}
            </div>
            {(m.tags?.length ?? 0) > 0 ? (
              <div className="mx-flex mx-gap-1 mx-wrap mx-mt-1">
                {[...(m.tags ?? [])]
                  .sort((a, b) => COMPETENCE_LEVEL_WEIGHT[b.level] - COMPETENCE_LEVEL_WEIGHT[a.level])
                  .map((t) => (
                    <span key={t.tag} className="mx-mono mx-t-xs mx-muted" title={`${COMPETENCE_LABELS[t.area]} · ${COMPETENCE_LEVEL_LABELS[t.level]}`}>
                      #{t.tag} · {COMPETENCE_LEVEL_LABELS[t.level].toLowerCase()}
                    </span>
                  ))}
              </div>
            ) : m.competences.length > 0 ? (
              <div className="mx-flex mx-gap-1 mx-wrap mx-mt-1">
                {m.competences.map((c) => (
                  <span key={c} className="mx-mono mx-t-xs mx-muted">
                    #{COMPETENCE_LABELS[c]}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mx-t-12 mx-muted mx-mt-1">Inga kompetenser angivna än.</div>
            )}
          </li>
        ))}
      </ul>

      {!anyTagged && (
        <div className="mx-t-12 mx-muted mx-mt-2">
          Be teamet fylla i sina kompetenser under <strong>Min profil</strong> så
          syns täckningen här.
        </div>
      )}
    </Card>
  );
}
