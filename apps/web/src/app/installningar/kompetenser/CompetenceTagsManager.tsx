'use client';

// CLAUDE.md § 29.7 — Adminvy för kompetens-hashtags (client).
// Fyra block: godkännandekö (föreslagna taggar), täckning per område med
// antal personer/nivåer/lärande, kompetensgap (taggar ingen har + taggar
// uppdrag efterfrågat utan täckning) och profilstatus per kollega. Alla
// mutationer går via server-actions (RBAC + audit där); listan hämtas om
// via router.refresh() efter varje lyckad åtgärd.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Icon } from '@/components/proto';
import {
  COMPETENCE_IDS,
  COMPETENCE_LABELS,
  COMPETENCE_LEVEL_LABELS,
  COMPETENCE_PROFILE_STATUS_LABELS,
  isCompetenceId,
  type CompetenceCoverageRow,
  type CompetenceId,
  type CompetenceProfileStatus
} from '@platform/shared';
import type { CompetenceTagRecord } from '@/lib/team/competence-tags.server';
import {
  createCompetenceTagAction,
  deleteCompetenceTagAction,
  setCompetenceTagStatusAction,
  updateCompetenceTagAction,
  type CompetenceTagActionState
} from '@/lib/actions/competence-tags';

export interface StaffProfileRow {
  id: string;
  name: string;
  title?: string;
  tagCount: number;
  updatedAt: string | null;
  status: CompetenceProfileStatus;
}

const STATUS_STYLE: Record<CompetenceProfileStatus, { background: string; color: string }> = {
  fresh: { background: 'var(--mx-st-ok-bg, #d9eddd)', color: '#1d3a1f' },
  unknown: { background: 'var(--mx-paper-3)', color: 'inherit' },
  stale: { background: 'var(--mx-st-warn-bg, #f8f1da)', color: '#4b2718' },
  missing: { background: 'var(--mx-st-danger-bg, #f1e5df)', color: '#4b2718' }
};

function areaLabel(area: string): string {
  return isCompetenceId(area) ? COMPETENCE_LABELS[area] : 'Annat';
}

export function CompetenceTagsManager({
  tagRecords,
  vocabularyError,
  coverage,
  gaps,
  neededGaps,
  missionsComplete,
  staff
}: {
  tagRecords: CompetenceTagRecord[];
  vocabularyError: string | null;
  coverage: CompetenceCoverageRow[];
  gaps: Array<{ area: CompetenceId; label: string; tags: CompetenceCoverageRow[] }>;
  neededGaps: Array<{ slug: string; missions: number }>;
  missionsComplete: boolean;
  staff: StaffProfileRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; label: string; area: string } | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newArea, setNewArea] = useState<CompetenceId>('annat');
  const [filter, setFilter] = useState('');
  const [onlyGaps, setOnlyGaps] = useState(false);

  const recordBySlug = useMemo(() => new Map(tagRecords.map((r) => [r.slug, r])), [tagRecords]);
  const suggested = tagRecords.filter((r) => r.status === 'suggested');

  const run = (label: string, fn: () => Promise<CompetenceTagActionState>) => {
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setNotice({ kind: 'error', text: res.error });
      else {
        setNotice({ kind: 'ok', text: label });
        setEditing(null);
        router.refresh();
      }
    });
  };

  const q = filter.trim().toLowerCase();
  const visibleCoverage = coverage.filter(
    (r) => (!onlyGaps || r.people === 0) && (!q || r.slug.includes(q) || r.label.toLowerCase().includes(q))
  );
  const byArea = COMPETENCE_IDS.map((area) => ({
    area,
    rows: visibleCoverage.filter((r) => r.area === area)
  })).filter((g) => g.rows.length > 0);

  const staleCount = staff.filter((s) => s.status === 'stale').length;
  const missingCount = staff.filter((s) => s.status === 'missing').length;
  const coveredTags = coverage.filter((r) => r.people > 0).length;

  return (
    <div className="mx-flex mx-col mx-gap-4">
      {vocabularyError && (
        <div className="mx-card" style={{ padding: 12, background: 'var(--mx-st-warn-bg, #f8f1da)', color: '#4b2718' }}>
          <div className="mx-t-13 mx-fw-6">{vocabularyError}</div>
          <div className="mx-t-12">Den inbyggda startlistan används tills vidare; förslag kan inte sparas.</div>
        </div>
      )}
      {notice && (
        <div
          className="mx-card"
          style={{
            padding: 12,
            background: notice.kind === 'ok' ? 'var(--mx-st-ok-bg, #d9eddd)' : 'var(--mx-st-danger-bg, #f1e5df)',
            color: notice.kind === 'ok' ? '#1d3a1f' : '#4b2718'
          }}
        >
          <div className="mx-t-13 mx-fw-6">{notice.text}</div>
        </div>
      )}

      {/* ── Nyckeltal ───────────────────────────────────────────────── */}
      <div className="mx-flex mx-gap-3 mx-wrap">
        {[
          { label: 'Hashtags i vokabulären', value: coverage.length },
          { label: 'Täckta av minst en kollega', value: coveredTags },
          { label: 'Väntar på godkännande', value: suggested.length },
          { label: 'Inaktuella / tomma profiler', value: `${staleCount} / ${missingCount}` }
        ].map((k) => (
          <div key={k.label} style={{ minWidth: 160 }}>
            <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6">{k.label}</div>
            <div className="mx-t-20 mx-fw-6 mx-tnum">{k.value}</div>
          </div>
        ))}
      </div>

      {/* ── Godkännandekö ───────────────────────────────────────────── */}
      <Card style={{ padding: 18 }}>
        <div className="mx-flex mx-items-c mx-gap-2 mx-mb-2">
          <Icon name="inbox" size={14} />
          <div className="mx-fw-6 mx-t-14">Föreslagna hashtags ({suggested.length})</div>
        </div>
        <div className="mx-t-12 mx-muted mx-mb-3">
          Taggar kollegor lagt till under Min profil. Godkänn för att ge dem en riktig etikett
          och lyfta dem i allas förslagslista — eller ta bort dem (personen behåller taggen på
          sin egen profil). Kontrollera att en tagg beskriver kompetens, inte en person.
        </div>
        {suggested.length === 0 ? (
          <div className="mx-t-13 mx-muted">Inga förslag väntar.</div>
        ) : (
          <ul className="mx-flex mx-col mx-gap-2">
            {suggested.map((r) => {
              const cov = coverage.find((c) => c.slug === r.slug);
              const isEditing = editing?.id === r.id;
              return (
                <li
                  key={r.id}
                  className="mx-flex mx-items-c mx-gap-2 mx-wrap"
                  style={{ padding: '8px 10px', background: 'var(--mx-paper-3)', borderRadius: 8 }}
                >
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div className="mx-mono mx-t-13 mx-fw-6">#{r.slug}</div>
                    <div className="mx-t-12 mx-muted">
                      {areaLabel(r.area)} · {cov?.people ?? 0} {cov?.people === 1 ? 'person' : 'personer'} har den
                    </div>
                  </div>
                  {isEditing ? (
                    <>
                      <input
                        value={editing.label}
                        onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                        placeholder="Etikett"
                        aria-label="Etikett"
                        style={{ minWidth: 160 }}
                      />
                      <select
                        value={editing.area}
                        onChange={(e) => setEditing({ ...editing, area: e.target.value })}
                        aria-label="Område"
                      >
                        {COMPETENCE_IDS.map((id) => (
                          <option key={id} value={id}>
                            {COMPETENCE_LABELS[id]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="mx-btn mx-sm mx-primary"
                        disabled={pending}
                        onClick={() =>
                          run('Taggen godkänd.', async () => {
                            const upd = await updateCompetenceTagAction(r.id, { label: editing.label, area: editing.area });
                            if (upd.error) return upd;
                            return setCompetenceTagStatusAction(r.id, 'approved');
                          })
                        }
                      >
                        <Icon name="check" size={11} /> Spara & godkänn
                      </button>
                      <button type="button" className="mx-btn mx-sm mx-ghost" onClick={() => setEditing(null)}>
                        Avbryt
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="mx-btn mx-sm mx-primary"
                        disabled={pending}
                        onClick={() => run('Taggen godkänd.', () => setCompetenceTagStatusAction(r.id, 'approved'))}
                      >
                        <Icon name="check" size={11} /> Godkänn
                      </button>
                      <button
                        type="button"
                        className="mx-btn mx-sm"
                        onClick={() => setEditing({ id: r.id, label: r.label, area: isCompetenceId(r.area) ? r.area : 'annat' })}
                      >
                        <Icon name="edit3" size={11} /> Justera
                      </button>
                      <button
                        type="button"
                        className="mx-btn mx-sm mx-ghost"
                        disabled={pending}
                        onClick={() => {
                          if (confirm(`Ta bort #${r.slug} ur vokabulären?`)) {
                            run('Taggen borttagen.', () => deleteCompetenceTagAction(r.id));
                          }
                        }}
                        aria-label="Ta bort"
                      >
                        <Icon name="trash" size={11} />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="mx-mt-3" style={{ borderTop: '1px solid var(--mx-line)', paddingTop: 12 }}>
          <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6 mx-mb-2">Lägg till godkänd hashtag</div>
          <div className="mx-flex mx-gap-2 mx-wrap mx-items-c">
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="t.ex. Offentlig upphandling"
              aria-label="Ny hashtag"
              style={{ flex: 1, minWidth: 200 }}
            />
            <select value={newArea} onChange={(e) => setNewArea(e.target.value as CompetenceId)} aria-label="Område">
              {COMPETENCE_IDS.map((id) => (
                <option key={id} value={id}>
                  {COMPETENCE_LABELS[id]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="mx-btn mx-sm"
              disabled={pending || !newLabel.trim()}
              onClick={() =>
                run('Taggen tillagd.', async () => {
                  const res = await createCompetenceTagAction({ label: newLabel, area: newArea });
                  if (!res.error) setNewLabel('');
                  return res;
                })
              }
            >
              <Icon name="plus" size={11} /> Lägg till
            </button>
          </div>
        </div>
      </Card>

      {/* ── Kompetensgap ────────────────────────────────────────────── */}
      <Card style={{ padding: 18 }}>
        <div className="mx-flex mx-items-c mx-gap-2 mx-mb-2">
          <Icon name="alert" size={14} />
          <div className="mx-fw-6 mx-t-14">Kompetensgap</div>
        </div>
        {neededGaps.length > 0 && (
          <div className="mx-mb-3">
            <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6 mx-mb-1">
              Efterfrågat av team men ingen har det
            </div>
            <div className="mx-flex mx-gap-2 mx-wrap">
              {neededGaps.map((g) => (
                <span
                  key={g.slug}
                  className="mx-chip mx-mono"
                  style={{ background: 'var(--mx-st-warn-bg, #f8f1da)', color: '#4b2718' }}
                  title={`${g.missions} avslutade team efterfrågade #${g.slug}`}
                >
                  #{g.slug} · {g.missions}
                </span>
              ))}
            </div>
            {!missionsComplete && (
              <div className="mx-t-12 mx-muted mx-mt-1">Uppdragslistan kunde inte läsas komplett — se siffrorna som ungefärliga.</div>
            )}
          </div>
        )}
        {gaps.length === 0 ? (
          <div className="mx-t-13 mx-muted">Alla hashtags i vokabulären täcks av minst en kollega.</div>
        ) : (
          <div className="mx-flex mx-col mx-gap-2">
            <div className="mx-t-12 mx-muted">
              Hashtags i vokabulären som ingen i organisationen angett. Underlag för rekrytering,
              utbildning eller extern kompetens (annan inkubator).
            </div>
            {gaps.map((g) => (
              <div key={g.area} className="mx-flex mx-gap-2 mx-wrap mx-items-c">
                <span className="mx-t-12 mx-fw-6" style={{ minWidth: 200 }}>
                  {g.label}
                </span>
                {g.tags.map((t) => (
                  <span key={t.slug} className="mx-mono mx-t-xs mx-muted" title={t.learners > 0 ? `${t.learners} vill utvecklas inom detta` : undefined}>
                    #{t.slug}
                    {t.learners > 0 ? ` (+${t.learners} vill lära)` : ''}
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Täckning per hashtag ────────────────────────────────────── */}
      <Card style={{ padding: 18 }}>
        <div className="mx-flex mx-items-c mx-justify-b mx-gap-2 mx-wrap mx-mb-2">
          <div className="mx-flex mx-items-c mx-gap-2">
            <Icon name="people" size={14} />
            <div className="mx-fw-6 mx-t-14">Täckning per hashtag</div>
          </div>
          <div className="mx-flex mx-gap-2 mx-items-c">
            <label className="mx-t-12 mx-flex mx-items-c mx-gap-1">
              <input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} /> Bara utan täckning
            </label>
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Sök hashtag…"
              aria-label="Sök hashtag"
              style={{ maxWidth: 200 }}
            />
          </div>
        </div>
        <div className="mx-t-12 mx-muted mx-mb-3">
          Antal kollegor per hashtag och deras högsta nivå. Godkända taggar kan döpas om eller flyttas;
          sluggen är oföränderlig eftersom den ligger på profilerna.
        </div>
        {byArea.length === 0 ? (
          <div className="mx-t-13 mx-muted">Inget matchar.</div>
        ) : (
          <div className="mx-flex mx-col mx-gap-3">
            {byArea.map((g) => (
              <div key={g.area}>
                <div className="mx-t-12 mx-fw-6 mx-mb-1">{COMPETENCE_LABELS[g.area]}</div>
                <ul className="mx-flex mx-col mx-gap-1">
                  {g.rows.map((r) => {
                    const rec = recordBySlug.get(r.slug);
                    const isEditing = editing?.id === rec?.id && rec?.status === 'approved';
                    return (
                      <li
                        key={r.slug}
                        className="mx-flex mx-items-c mx-gap-2 mx-wrap"
                        style={{ padding: '6px 10px', background: 'var(--mx-paper-3)', borderRadius: 8 }}
                      >
                        <span className="mx-mono mx-t-13 mx-fw-6" style={{ minWidth: 200 }}>
                          #{r.slug}
                          {rec?.status === 'suggested' ? <span className="mx-muted mx-fw-4"> · förslag</span> : null}
                          {!rec ? <span className="mx-muted mx-fw-4"> · inbyggd</span> : null}
                        </span>
                        {isEditing && editing ? (
                          <>
                            <input
                              value={editing.label}
                              onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                              aria-label="Etikett"
                              style={{ minWidth: 160 }}
                            />
                            <select
                              value={editing.area}
                              onChange={(e) => setEditing({ ...editing, area: e.target.value })}
                              aria-label="Område"
                            >
                              {COMPETENCE_IDS.map((id) => (
                                <option key={id} value={id}>
                                  {COMPETENCE_LABELS[id]}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="mx-btn mx-sm mx-primary"
                              disabled={pending}
                              onClick={() =>
                                run('Taggen uppdaterad.', () =>
                                  updateCompetenceTagAction(editing.id, { label: editing.label, area: editing.area })
                                )
                              }
                            >
                              Spara
                            </button>
                            <button type="button" className="mx-btn mx-sm mx-ghost" onClick={() => setEditing(null)}>
                              Avbryt
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="mx-t-12 mx-muted" style={{ minWidth: 140 }}>
                              {r.label}
                            </span>
                            <span className="mx-mono mx-t-xs mx-tnum" style={{ minWidth: 90 }}>
                              {r.people} {r.people === 1 ? 'person' : 'personer'}
                            </span>
                            <span className="mx-mono mx-t-xs mx-muted">
                              {r.maxLevel ? `max ${COMPETENCE_LEVEL_LABELS[r.maxLevel].toLowerCase()}` : '—'}
                              {r.byLevel.expert > 0 ? ` · ${r.byLevel.expert} expert` : ''}
                              {r.learners > 0 ? ` · ${r.learners} vill lära` : ''}
                            </span>
                            <span style={{ flex: 1 }} />
                            {rec?.status === 'approved' && (
                              <>
                                <button
                                  type="button"
                                  className="mx-btn mx-sm mx-ghost"
                                  onClick={() => setEditing({ id: rec.id, label: rec.label, area: isCompetenceId(rec.area) ? rec.area : 'annat' })}
                                  aria-label="Redigera"
                                >
                                  <Icon name="edit3" size={11} />
                                </button>
                                <button
                                  type="button"
                                  className="mx-btn mx-sm mx-ghost"
                                  disabled={pending}
                                  onClick={() => {
                                    const warn = r.people > 0 ? ` ${r.people} ${r.people === 1 ? 'kollega behåller' : 'kollegor behåller'} den på sin profil.` : '';
                                    if (confirm(`Ta bort #${r.slug} ur vokabulären?${warn}`)) {
                                      run('Taggen borttagen.', () => deleteCompetenceTagAction(rec.id));
                                    }
                                  }}
                                  aria-label="Ta bort"
                                >
                                  <Icon name="trash" size={11} />
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Profilstatus ────────────────────────────────────────────── */}
      <Card style={{ padding: 18 }}>
        <div className="mx-flex mx-items-c mx-gap-2 mx-mb-2">
          <Icon name="user" size={14} />
          <div className="mx-fw-6 mx-t-14">Kompetensprofiler ({staff.length})</div>
        </div>
        <div className="mx-t-12 mx-muted mx-mb-3">
          Movexum-personal och när de senast sparade sina hashtags. Inaktuella eller tomma
          profiler drar ned träffsäkerheten i teamförslagen — påminn kollegan att uppdatera
          Min profil.
        </div>
        <ul className="mx-flex mx-col mx-gap-1">
          {staff.map((s) => (
            <li
              key={s.id}
              className="mx-flex mx-items-c mx-gap-2 mx-wrap"
              style={{ padding: '6px 10px', background: 'var(--mx-paper-3)', borderRadius: 8 }}
            >
              <span className="mx-t-13 mx-fw-6" style={{ minWidth: 200 }}>
                {s.name}
                {s.title ? <span className="mx-muted mx-fw-4"> · {s.title}</span> : null}
              </span>
              <span className="mx-mono mx-t-xs mx-muted" style={{ minWidth: 100 }}>
                {s.tagCount} {s.tagCount === 1 ? 'hashtag' : 'hashtags'}
              </span>
              <span className="mx-mono mx-t-xs mx-muted" style={{ minWidth: 110 }}>
                {s.updatedAt
                  ? new Date(s.updatedAt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
                  : '—'}
              </span>
              <span className="mx-chip mx-mono" style={STATUS_STYLE[s.status]}>
                {COMPETENCE_PROFILE_STATUS_LABELS[s.status]}
              </span>
            </li>
          ))}
          {staff.length === 0 && <li className="mx-t-13 mx-muted">Ingen Movexum-personal i tenanten.</li>}
        </ul>
      </Card>
    </div>
  );
}
