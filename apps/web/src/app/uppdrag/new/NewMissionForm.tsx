'use client';

// Movexum OS — Formulär för nytt tvärfunktionellt team (uppdrag/projekt).
// Klientkomponent för useFormState + multi-select av deltagare och bolag.
// CLAUDE.md § 29: AI-teamförslag — beskriv uppdraget, låt AI:n föreslå
// kompetenser + kollegor (riktiga användare med kompetenstaggar), koppla på
// med ett klick (människa-i-loopen).

import { useActionState, useMemo, useState } from 'react';
import { Card, Icon } from '@/components/proto';
import {
  COMPETENCE_LABELS,
  COMPETENCE_LEVEL_LABELS,
  DEFAULT_MAX_ACTIVE_TEAMS,
  LOAD_LEVEL_LABELS,
  describeLoad,
  isAtTeamCap,
  loadLevel,
  type CompetenceId,
  type LoadLevel,
  type MissionParticipantRole,
  type MissionType,
  type MissionVisibility,
  type TeamMemberLoad,
  type UserCompetenceTag
} from '@platform/shared';
import type { MissionActionState } from '@/lib/actions/missions';
import { suggestTeamAction, type SuggestTeamResult } from '@/lib/actions/team';

interface UserOption {
  id: string;
  label: string;
  /** Kompetensområden (härledda ur hashtags) användaren angett under Min profil. */
  competences?: CompetenceId[];
  /** Kompetens-hashtags med nivå (§ 29.7). */
  tags?: UserCompetenceTag[];
  /** Nuvarande belastning: pågående team. */
  load?: TeamMemberLoad;
}

const LOAD_CHIP_STYLE: Record<LoadLevel, { background: string; color: string }> = {
  free: { background: 'var(--mx-st-ok-bg, #d9eddd)', color: '#1d3a1f' },
  normal: { background: 'var(--mx-paper-3)', color: 'inherit' },
  high: { background: 'var(--mx-st-warn-bg, #f8f1da)', color: '#4b2718' },
  full: { background: 'var(--mx-st-danger-bg, #f1e5df)', color: '#4b2718' }
};

function LoadChip({ load, cap }: { load: TeamMemberLoad; cap: number }) {
  const lvl = loadLevel(load, cap);
  return (
    <span className="mx-chip mx-mono" style={LOAD_CHIP_STYLE[lvl]} title={describeLoad(load, cap)}>
      {LOAD_LEVEL_LABELS[lvl]} · {load.active}/{cap}
    </span>
  );
}
interface StartupOption {
  id: string;
  name: string;
}

const TYPE_OPTIONS: Array<{ value: MissionType; label: string; hint: string }> = [
  { value: 'project', label: 'Projekt', hint: 'Kickoff → Planera → Genomför → Uppföljning' },
  { value: 'workshop', label: 'Workshop', hint: 'Tilldelat → Mottaget → Utförs → Inlämning' },
  { value: 'sprint_x', label: 'Sprint X', hint: 'Tilldelat → Självskattning → Granskning → Commit' },
  { value: 'community', label: 'Community', hint: 'Utlyst → RSVP → Närvaro' },
  { value: 'report', label: 'Rapport', hint: 'Utkast → Granskning → Inlämnad' },
  { value: 'onboarding', label: 'Onboarding', hint: 'Kickoff → Profil → Första uppdrag' },
  { value: 'custom', label: 'Custom', hint: 'Tilldelat → Utförs → Klart' }
];

const ACCENT_OPTIONS = [
  { value: 'purple', label: 'Lila' },
  { value: 'green', label: 'Grön' },
  { value: 'cyan', label: 'Blå' },
  { value: 'copper', label: 'Koppar' },
  { value: 'brown', label: 'Brun' },
  { value: 'yellow', label: 'Gul' }
];

const ROLE_LABELS: Record<MissionParticipantRole, string> = {
  lead: 'Ansvarig',
  contributor: 'Deltagare',
  observer: 'Observatör'
};

interface ParticipantDraft {
  user_id: string;
  role: MissionParticipantRole;
}

export function NewMissionForm({
  action,
  users,
  startups,
  currentUserId,
  teamCap = DEFAULT_MAX_ACTIVE_TEAMS
}: {
  action: (state: MissionActionState, formData: FormData) => Promise<MissionActionState>;
  users: UserOption[];
  startups: StartupOption[];
  currentUserId: string;
  /** Max antal pågående team per person (§ 29.7). */
  teamCap?: number;
}) {
  const [state, formAction, pending] = useActionState(action, {} as MissionActionState);
  const [type, setType] = useState<MissionType>('project');
  const [visibility, setVisibility] = useState<MissionVisibility>('tenant');
  const [description, setDescription] = useState('');
  const [selectedStartups, setSelectedStartups] = useState<string[]>([]);
  const [participants, setParticipants] = useState<ParticipantDraft[]>([]);

  // AI-teamförslag
  const [suggestion, setSuggestion] = useState<Extract<SuggestTeamResult, { ok: true }> | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const userById = useMemo(() => {
    const map = new Map<string, UserOption>();
    for (const u of users) map.set(u.id, u);
    return map;
  }, [users]);

  const otherUsers = users.filter((u) => u.id !== currentUserId);
  const remaining = otherUsers.filter((u) => !participants.some((p) => p.user_id === u.id));

  const typeHint = TYPE_OPTIONS.find((t) => t.value === type)?.hint;

  const toggleStartup = (id: string) => {
    setSelectedStartups((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  // § 29.7 — den som nått teamtaket kan inte läggas till (servern prövar
  // samma sak; här blir det tydligt redan i formuläret).
  const atCap = (u?: UserOption) => Boolean(u?.load && isAtTeamCap(u.load, teamCap));
  const me = userById.get(currentUserId);
  const addParticipant = (id: string, role: MissionParticipantRole = 'contributor') => {
    if (id === currentUserId) return;
    if (atCap(userById.get(id))) return;
    setParticipants((prev) =>
      prev.some((p) => p.user_id === id) ? prev : [...prev, { user_id: id, role }]
    );
  };
  const removeParticipant = (id: string) => {
    setParticipants((prev) => prev.filter((p) => p.user_id !== id));
  };
  const setRole = (id: string, role: MissionParticipantRole) => {
    setParticipants((prev) => prev.map((p) => (p.user_id === id ? { ...p, role } : p)));
  };

  async function runSuggest() {
    setSuggestError(null);
    setSuggesting(true);
    try {
      const res = await suggestTeamAction({
        description,
        startupId: selectedStartups[0]
      });
      if (!res.ok) {
        setSuggestError(res.error);
        setSuggestion(null);
      } else {
        setSuggestion(res);
      }
    } catch {
      setSuggestError('Något gick fel när teamförslaget skulle hämtas.');
    } finally {
      setSuggesting(false);
    }
  }

  function applyWholeTeam() {
    if (!suggestion) return;
    for (const m of suggestion.members) {
      addParticipant(m.id, m.role === 'lead' ? 'contributor' : m.role);
    }
  }

  const suggestedMembers = suggestion?.members ?? [];
  const taggedColleagues = otherUsers.filter(
    (u) => (u.tags?.length ?? 0) > 0 || (u.competences?.length ?? 0) > 0
  ).length;
  const [showShortlist, setShowShortlist] = useState(false);
  const otherShortlist = (suggestion?.shortlist ?? []).filter(
    (c) => !suggestedMembers.some((m) => m.id === c.id)
  );

  // Skicka full participants_json inkl. utfärdaren som lead
  const submittedParticipants: ParticipantDraft[] = [
    { user_id: currentUserId, role: 'lead' },
    ...participants
  ];

  return (
    <form action={formAction} className="mx-mt-4" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card style={{ padding: 18 }}>
        <div className="mx-flex mx-col mx-gap-4">
          <div className="mx-field">
            <label className="mx-label" htmlFor="title">
              Titel *
            </label>
            <input
              id="title"
              name="title"
              required
              minLength={2}
              maxLength={200}
              placeholder="t.ex. Klimatkompass · Q2-uppföljning"
            />
          </div>

          <div className="mx-field">
            <label className="mx-label" htmlFor="type">
              Typ *
            </label>
            <select
              id="type"
              name="type"
              value={type}
              onChange={(e) => setType(e.target.value as MissionType)}
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {typeHint && (
              <div className="mx-mono mx-t-xs mx-muted mx-mt-1">Steg: {typeHint}</div>
            )}
          </div>

          <div className="mx-field">
            <label className="mx-label" htmlFor="description">
              Beskrivning av uppdraget
            </label>
            <textarea
              id="description"
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Beskriv uppdraget/utmaningen — vad ska göras, varför? Detta ligger till grund för AI-teamförslaget."
            />
          </div>

          <div
            className="mx-flex mx-gap-4 mx-wrap"
            style={{ alignItems: 'flex-start' }}
          >
            <div className="mx-field" style={{ flex: 1, minWidth: 220 }}>
              <label className="mx-label" htmlFor="due_date">
                Deadline
              </label>
              <input id="due_date" name="due_date" type="date" />
            </div>
            <div className="mx-field" style={{ flex: 1, minWidth: 220 }}>
              <label className="mx-label" htmlFor="accent">
                Accentfärg
              </label>
              <select id="accent" name="accent" defaultValue="purple">
                {ACCENT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mx-field">
            <label className="mx-label" htmlFor="visibility">
              Synlighet
            </label>
            <select
              id="visibility"
              name="visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as MissionVisibility)}
            >
              <option value="tenant">Hela organisationen kan se</option>
              <option value="participants">Endast deltagarna</option>
            </select>
          </div>
        </div>
      </Card>

      {/* ── AI-teamförslag (CLAUDE.md § 29) ───────────────────────────── */}
      <Card style={{ padding: 18 }}>
        <div className="mx-flex mx-items-c mx-gap-2 mx-mb-2">
          <Icon name="sparkle" size={14} />
          <div className="mx-fw-6 mx-t-14">Föreslå team med AI</div>
        </div>
        <div className="mx-t-12 mx-muted mx-mb-3">
          Utifrån beskrivningen ovan tolkas vilka kompetenser och hashtags
          uppdraget kräver. Kollegorna rankas sedan på hashtag-träff och nivå,
          relation till bolaget och <strong>hur många team de redan ingår i</strong>,
          innan AI:n sätter ihop teamet ur den listan. Bara riktiga användare i
          systemet som fyllt i <strong>Min profil</strong> kan matchas — inga
          externa kontakter. Du bestämmer — inget tilldelas automatiskt.
          AI-verktyg drivs av Mistral (Frankrike, EU).
        </div>
        <div className="mx-mono mx-t-xs mx-muted mx-mb-2">
          {taggedColleagues} {taggedColleagues === 1 ? 'kollega' : 'kollegor'} med
          kompetensprofil kan matchas.
        </div>
        <button
          type="button"
          className="mx-btn mx-sm"
          onClick={runSuggest}
          disabled={suggesting || description.trim().length < 10}
        >
          <Icon name="sparkle" size={12} />
          {suggesting ? 'Analyserar…' : 'Föreslå kompetenser & team'}
        </button>
        {description.trim().length < 10 && (
          <div className="mx-t-12 mx-muted mx-mt-2">
            Skriv en beskrivning av uppdraget först (minst en mening).
          </div>
        )}

        {suggestError && (
          <div className="mx-t-13 mx-mt-2" style={{ color: '#4b2718' }}>
            {suggestError}
          </div>
        )}

        {suggestion && (
          <div className="mx-flex mx-col mx-gap-3 mx-mt-3">
            {suggestion.summary && (
              <div className="mx-t-13">{suggestion.summary}</div>
            )}

            {!suggestion.loadComplete && (
              <div className="mx-t-12 mx-muted">
                Belastningen kunde inte läsas komplett — se den som ungefärlig.
              </div>
            )}

            {suggestion.needsReview && (
              <div
                className="mx-card"
                style={{ padding: 10, background: 'var(--mx-st-warn-bg, #f8f1da)', color: '#4b2718' }}
              >
                <div className="mx-t-12 mx-fw-6">
                  AI:n är osäker — granska förslaget noga och välj manuellt.
                </div>
              </div>
            )}

            {(suggestion.neededTags.length > 0 || suggestion.neededCompetences.length > 0) && (
              <div>
                <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6 mx-mb-2">
                  Uppdraget kräver
                </div>
                <div className="mx-flex mx-gap-2 mx-wrap">
                  {suggestion.neededTags.map((t) => (
                    <span
                      key={`t-${t}`}
                      className={`mx-chip mx-mono ${suggestion.gaps.tags.includes(t) ? '' : 'mx-active'}`}
                      title={suggestion.gaps.tags.includes(t) ? 'Ingen kollega har denna hashtag' : 'Täcks av minst en kollega'}
                    >
                      #{t}
                    </span>
                  ))}
                  {suggestion.neededCompetences.map((c: CompetenceId) => (
                    <span key={`a-${c}`} className="mx-chip mx-mono" style={{ opacity: 0.8 }}>
                      {COMPETENCE_LABELS[c]}
                    </span>
                  ))}
                </div>
                {(suggestion.gaps.tags.length > 0 || suggestion.gaps.areas.length > 0) && (
                  <div className="mx-t-12 mx-muted mx-mt-1">
                    Saknas helt internt:{' '}
                    {[
                      ...suggestion.gaps.tags.map((t) => `#${t}`),
                      ...suggestion.gaps.areas.map((a) => COMPETENCE_LABELS[a])
                    ].join(', ')}
                    .
                  </div>
                )}
              </div>
            )}

            {suggestedMembers.length > 0 && (
              <div>
                <div className="mx-flex mx-items-c mx-justify-b mx-mb-2">
                  <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6">
                    Föreslagna kollegor
                  </div>
                  <button type="button" className="mx-btn mx-sm mx-ghost" onClick={applyWholeTeam}>
                    <Icon name="plus" size={11} /> Lägg till alla
                  </button>
                </div>
                <ul className="mx-flex mx-col mx-gap-2">
                  {suggestedMembers.map((m) => {
                    const added = participants.some((p) => p.user_id === m.id) || m.id === currentUserId;
                    return (
                      <li
                        key={m.id}
                        className="mx-flex mx-items-c mx-gap-2"
                        style={{ padding: '8px 10px', background: 'var(--mx-paper-3)', borderRadius: 8 }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="mx-t-13 mx-fw-6">
                            {m.name}
                            {m.title ? <span className="mx-muted mx-fw-4"> · {m.title}</span> : null}
                            <span className="mx-mono mx-t-xs mx-muted"> · {ROLE_LABELS[m.role]}</span>
                          </div>
                          {m.reason && <div className="mx-t-12 mx-muted">{m.reason}</div>}
                          <div className="mx-flex mx-gap-1 mx-wrap mx-mt-1 mx-items-c">
                            <LoadChip load={m.load} cap={suggestion.teamCap} />
                            {m.matchedTags.map((t) => (
                              <span key={t.tag} className="mx-chip mx-mono mx-active" title={COMPETENCE_LEVEL_LABELS[t.level]}>
                                #{t.tag} · {COMPETENCE_LEVEL_LABELS[t.level].toLowerCase()}
                              </span>
                            ))}
                            {m.matchedTags.length === 0 &&
                              m.competences.map((c) => (
                                <span key={c} className="mx-mono mx-t-xs mx-muted">
                                  #{COMPETENCE_LABELS[c]}
                                </span>
                              ))}
                          </div>
                        </div>
                        <span className="mx-mono mx-t-xs mx-muted" title={`Rankningspoäng ${m.score} · AI:ns säkerhet ${Math.round(m.confidence * 100)}%`}>
                          {m.score}p
                        </span>
                        {m.id === currentUserId ? (
                          <span className="mx-mono mx-t-xs mx-muted">Du</span>
                        ) : added ? (
                          <span className="mx-mono mx-t-xs" style={{ color: '#1d3a1f' }}>
                            <Icon name="check" size={11} /> Tillagd
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="mx-btn mx-sm"
                            onClick={() => addParticipant(m.id, m.role === 'lead' ? 'contributor' : m.role)}
                          >
                            <Icon name="plus" size={11} /> Lägg till
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {otherShortlist.length > 0 && (
              <div>
                <button
                  type="button"
                  className="mx-btn mx-sm mx-ghost"
                  onClick={() => setShowShortlist((v) => !v)}
                >
                  <Icon name={showShortlist ? 'chevdown' : 'chevron'} size={11} />
                  {showShortlist ? 'Dölj' : 'Visa'} fler rankade kollegor ({otherShortlist.length})
                </button>
                {showShortlist && (
                  <ul className="mx-flex mx-col mx-gap-1 mx-mt-2">
                    {otherShortlist.map((c) => {
                      const added = participants.some((p) => p.user_id === c.id) || c.id === currentUserId;
                      return (
                        <li
                          key={c.id}
                          className="mx-flex mx-items-c mx-gap-2"
                          style={{ padding: '6px 10px', background: 'var(--mx-paper-3)', borderRadius: 8 }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="mx-t-13 mx-fw-6">
                              {c.name}
                              {c.title ? <span className="mx-muted mx-fw-4"> · {c.title}</span> : null}
                            </div>
                            <div className="mx-t-12 mx-muted">{c.reasons.join(' · ')}</div>
                          </div>
                          <LoadChip load={c.load} cap={suggestion.teamCap} />
                          <span className="mx-mono mx-t-xs mx-muted">{c.score}p</span>
                          {added ? (
                            <span className="mx-mono mx-t-xs mx-muted">Tillagd</span>
                          ) : (
                            <button type="button" className="mx-btn mx-sm" onClick={() => addParticipant(c.id)}>
                              <Icon name="plus" size={11} /> Lägg till
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {suggestion.atCapacity.length > 0 && (
              <div className="mx-t-12 mx-muted">
                <span className="mx-fw-6">Fullt (taket är {suggestion.teamCap} pågående team) — föreslås inte:</span>{' '}
                {suggestion.atCapacity
                  .map((c) => (c.matchedTags.length > 0 ? `${c.name} (#${c.matchedTags.join(', #')})` : c.name))
                  .join(', ')}
                . Avsluta ett av deras team eller be ledningen höja taket under Inställningar → Kompetenser.
              </div>
            )}

            {suggestion.externalNote && (
              <div
                className="mx-card"
                style={{ padding: 10, background: 'var(--mx-paper-3)' }}
              >
                <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6 mx-mb-1">
                  Kompetensgap
                </div>
                <div className="mx-t-12">{suggestion.externalNote}</div>
              </div>
            )}

            <div className="mx-mono mx-t-xs mx-muted">
              Genererat av AI – verifiera innan du sätter teamet.
            </div>
          </div>
        )}
      </Card>

      <Card style={{ padding: 18 }}>
        <div className="mx-flex mx-col mx-gap-3">
          <div>
            <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6 mx-mb-2">
              Bolag ({selectedStartups.length})
            </div>
            {startups.length === 0 ? (
              <div className="mx-muted mx-t-13">Inga bolag i din tenant ännu.</div>
            ) : (
              <div className="mx-flex mx-gap-2 mx-wrap" style={{ maxHeight: 160, overflowY: 'auto' }}>
                {startups.map((s) => {
                  const selected = selectedStartups.includes(s.id);
                  return (
                    <button
                      type="button"
                      key={s.id}
                      onClick={() => toggleStartup(s.id)}
                      className={`mx-chip mx-mono ${selected ? 'mx-active' : ''}`}
                      style={{
                        cursor: 'pointer',
                        border: selected ? '1px solid #002c40' : '1px solid var(--mx-line)'
                      }}
                    >
                      {selected ? <Icon name="check" size={10} /> : <Icon name="plus" size={10} />}
                      {s.name}
                    </button>
                  );
                })}
              </div>
            )}
            {selectedStartups.map((id) => (
              <input key={id} type="hidden" name="startups" value={id} />
            ))}
          </div>

          <div>
            <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6 mx-mb-2">
              Deltagare ({participants.length + 1})
            </div>
            <div className="mx-t-12 mx-muted mx-mb-2">
              Du läggs till automatiskt som ansvarig. Lägg till fler Movexum-kollegor
              och välj roll. Bara personal kan ingå i ett tvärfunktionellt team, och
              varje person får ingå i högst {teamCap} pågående team samtidigt.
            </div>
            {atCap(me) && (
              <div
                className="mx-t-12 mx-mb-2"
                style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--mx-st-warn-bg)' }}
              >
                Du ingår redan i {teamCap} pågående team, vilket är taket. Avsluta ett team
                eller be ledningen höja taket innan du startar ett nytt.
              </div>
            )}
            {participants.length > 0 && (
              <ul className="mx-flex mx-col mx-gap-1 mx-mb-2">
                {participants.map((p) => {
                  const u = userById.get(p.user_id);
                  return (
                    <li
                      key={p.user_id}
                      className="mx-flex mx-items-c mx-gap-2"
                      style={{
                        padding: '6px 10px',
                        background: 'var(--mx-paper-3)',
                        borderRadius: 8
                      }}
                    >
                      <span className="mx-t-13 mx-fw-6" style={{ flex: 1, minWidth: 0 }}>
                        {u?.label || p.user_id}
                      </span>
                      {u?.load ? <LoadChip load={u.load} cap={teamCap} /> : null}
                      <select
                        value={p.role}
                        onChange={(e) => setRole(p.user_id, e.target.value as MissionParticipantRole)}
                        style={{
                          background: 'var(--mx-paper)',
                          border: '1px solid var(--mx-line)',
                          borderRadius: 6,
                          padding: '2px 6px',
                          fontSize: 11
                        }}
                      >
                        {(['contributor', 'lead', 'observer'] as const).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeParticipant(p.user_id)}
                        className="mx-btn mx-sm mx-ghost"
                        aria-label="Ta bort"
                      >
                        <Icon name="close" size={11} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {remaining.length > 0 ? (
              <div
                className="mx-flex mx-gap-2 mx-wrap"
                style={{ maxHeight: 160, overflowY: 'auto' }}
              >
                {remaining.map((u) => (
                  <button
                    type="button"
                    key={u.id}
                    onClick={() => addParticipant(u.id)}
                    disabled={atCap(u)}
                    className="mx-chip mx-mono"
                    style={{ cursor: atCap(u) ? 'not-allowed' : 'pointer', opacity: atCap(u) ? 0.5 : 1 }}
                    title={[
                      atCap(u) ? `Fullt: ingår redan i ${teamCap} pågående team` : '',
                      u.tags && u.tags.length > 0
                        ? u.tags.map((t) => `#${t.tag} (${COMPETENCE_LEVEL_LABELS[t.level].toLowerCase()})`).join(', ')
                        : u.competences && u.competences.length > 0
                          ? u.competences.map((c) => COMPETENCE_LABELS[c]).join(', ')
                          : 'Inga kompetenstaggar angivna',
                      u.load ? describeLoad(u.load, teamCap) : ''
                    ]
                      .filter(Boolean)
                      .join(' — ')}
                  >
                    <Icon name="plus" size={10} /> {u.label}
                    {u.tags && u.tags.length > 0 ? (
                      <span className="mx-muted"> · {u.tags.length}#</span>
                    ) : u.competences && u.competences.length > 0 ? (
                      <span className="mx-muted"> · {u.competences.length}</span>
                    ) : null}
                    {u.load ? (
                      <span className="mx-muted" title={describeLoad(u.load, teamCap)}>
                        {' '}· {u.load.active}/{teamCap}
                        {atCap(u) ? ' fullt' : ''}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : otherUsers.length === 0 ? (
              <div className="mx-muted mx-t-13">Inga andra Movexum-kollegor i din tenant.</div>
            ) : (
              <div className="mx-muted mx-t-12">Alla kollegor är redan tillagda.</div>
            )}
            <input
              type="hidden"
              name="participants_json"
              value={JSON.stringify(submittedParticipants)}
            />
            {/* Behovet teamet sattes ihop för (§ 29.7) → meriter när uppdraget avslutas. */}
            <input
              type="hidden"
              name="needed_tags_json"
              value={JSON.stringify(suggestion?.neededTags ?? [])}
            />
          </div>
        </div>
      </Card>

      {state?.error && (
        <div
          className="mx-card"
          style={{
            padding: 12,
            background: 'var(--mx-st-danger-bg, #f1e5df)',
            color: '#4b2718'
          }}
        >
          <div className="mx-t-13 mx-fw-6">{state.error}</div>
        </div>
      )}

      <div className="mx-flex mx-gap-2 mx-justify-b mx-items-c">
        <span className="mx-mono mx-t-xs mx-muted">
          Stegen i flödet skapas automatiskt utifrån typ.
        </span>
        <div className="mx-flex mx-gap-2">
          <a href="/uppdrag" className="mx-btn mx-sm mx-ghost">
            Avbryt
          </a>
          <button type="submit" className="mx-btn mx-primary" disabled={pending}>
            <Icon name="plus" size={13} />
            {pending ? 'Skapar…' : 'Skapa team'}
          </button>
        </div>
      </div>
    </form>
  );
}
