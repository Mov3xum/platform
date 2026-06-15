// CLAUDE.md § 29 — "Team & kompetenser" på uppdragskortet.
// Visar teamets samlade kompetenstäckning + varje medlems kompetenser, så att
// staff ser om det tvärfunktionella teamet täcker uppdragets behov. Ren,
// presentationell server-komponent (ingen IO, ingen klient-interaktivitet).

import { Card, Icon } from '@/components/proto';
import {
  COMPETENCE_LABELS,
  COMPETENCE_IDS,
  type CompetenceId,
  type MissionParticipantRole
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
}

export function TeamCompetencePanel({ members }: { members: TeamMemberView[] }) {
  const coverage = new Set<CompetenceId>();
  for (const m of members) {
    for (const c of m.competences) coverage.add(c);
  }
  const coverageList = COMPETENCE_IDS.filter((id) => coverage.has(id));
  const anyTagged = members.some((m) => m.competences.length > 0);

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
            </div>
            {m.competences.length > 0 ? (
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
