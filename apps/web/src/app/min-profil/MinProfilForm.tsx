'use client';

// CLAUDE.md § 29.7 — Profilformulär: titel, bio, kompetens-HASHTAGS med nivå
// och utvecklingsintressen. Klientkomponent för useActionState.
//
// Interaktion: klick på en hashtag cyklar nivå (av → kan bidra → stark →
// expert → av). Egna taggar läggs till via fritext med autocomplete över
// tenantens vokabulär (normaliseras till slug i @platform/shared — samma
// regel som servern). Kompetensområdena härleds automatiskt ur taggarna.
// Formuläret postar JSON i dolda fält; servern sanerar allt igen.

import { useActionState, useMemo, useState } from 'react';
import { Card, Icon } from '@/components/proto';
import {
  COMPETENCE_LABELS,
  COMPETENCE_LEVELS,
  COMPETENCE_LEVEL_LABELS,
  COMPETENCE_PROFILE_STALE_DAYS,
  DEVELOPMENT_INTERESTS_MAX,
  LOAD_LEVEL_LABELS,
  USER_COMPETENCE_TAGS_MAX,
  competenceProfileStatus,
  competenceTagsByArea,
  describeLoad,
  deriveCompetenceAreas,
  loadLevel,
  normalizeCompetenceTagSlug,
  type CompetenceId,
  type CompetenceLevel,
  type CompetenceTagDef,
  type TeamMemberLoad,
  type UserCompetenceTag
} from '@platform/shared';
import { saveMyProfileAction, type ProfileActionState } from '@/lib/actions/profile';

const LEVEL_MARK: Record<CompetenceLevel, string> = {
  contribute: '·',
  strong: '··',
  expert: '···'
};

function nextLevel(current: CompetenceLevel | null): CompetenceLevel | null {
  if (current === null) return 'contribute';
  const i = COMPETENCE_LEVELS.indexOf(current);
  return i >= COMPETENCE_LEVELS.length - 1 ? null : COMPETENCE_LEVELS[i + 1];
}

export function MinProfilForm({
  initialTitle,
  initialBio,
  initialTags,
  initialDevelopmentInterests,
  vocabulary,
  load,
  competenceUpdatedAt
}: {
  initialTitle: string;
  initialBio: string;
  initialTags: UserCompetenceTag[];
  initialDevelopmentInterests: string[];
  vocabulary: CompetenceTagDef[];
  load: TeamMemberLoad;
  competenceUpdatedAt: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    saveMyProfileAction,
    {} as ProfileActionState
  );
  const [tags, setTags] = useState<UserCompetenceTag[]>(initialTags);
  const [interests, setInterests] = useState<string[]>(initialDevelopmentInterests);
  const [query, setQuery] = useState('');
  const [customTag, setCustomTag] = useState('');
  const [customArea, setCustomArea] = useState<CompetenceId>('annat');
  const [interestInput, setInterestInput] = useState('');

  const labelBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of vocabulary) m.set(t.slug, t.label);
    return m;
  }, [vocabulary]);
  const areaBySlug = useMemo(() => {
    const m = new Map<string, CompetenceId>();
    for (const t of vocabulary) m.set(t.slug, t.area);
    return m;
  }, [vocabulary]);

  // Taggar som bara finns på personen (egna, utanför vokabulären) visas i sin
  // områdesgrupp så de inte "försvinner".
  const fullVocabulary = useMemo<CompetenceTagDef[]>(() => {
    const known = new Set(vocabulary.map((t) => t.slug));
    const extra = tags
      .filter((t) => !known.has(t.tag))
      .map((t) => ({ slug: t.tag, label: t.tag.replace(/-/g, ' '), area: t.area }));
    return [...vocabulary, ...extra];
  }, [vocabulary, tags]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return competenceTagsByArea(fullVocabulary)
      .map((g) => ({
        ...g,
        tags: q
          ? g.tags.filter((t) => t.label.toLowerCase().includes(q) || t.slug.includes(q))
          : g.tags
      }))
      .filter((g) => g.tags.length > 0);
  }, [fullVocabulary, query]);

  const levelOf = (slug: string): CompetenceLevel | null =>
    tags.find((t) => t.tag === slug)?.level ?? null;

  const setLevel = (slug: string, area: CompetenceId, level: CompetenceLevel | null) => {
    setTags((prev) => {
      const without = prev.filter((t) => t.tag !== slug);
      if (level === null) return without;
      if (without.length >= USER_COMPETENCE_TAGS_MAX && !prev.some((t) => t.tag === slug)) return prev;
      const existing = prev.find((t) => t.tag === slug);
      return [...without, { tag: slug, area: existing?.area ?? area, level }];
    });
  };

  const cycle = (slug: string, area: CompetenceId) => setLevel(slug, area, nextLevel(levelOf(slug)));

  const addCustom = () => {
    const slug = normalizeCompetenceTagSlug(customTag);
    if (!slug) return;
    const area = areaBySlug.get(slug) ?? customArea;
    setLevel(slug, area, levelOf(slug) ?? 'strong');
    setCustomTag('');
  };

  const addInterest = () => {
    const slug = normalizeCompetenceTagSlug(interestInput);
    if (!slug) return;
    setInterests((prev) =>
      prev.includes(slug) || prev.length >= DEVELOPMENT_INTERESTS_MAX ? prev : [...prev, slug]
    );
    setInterestInput('');
  };

  const derivedAreas = deriveCompetenceAreas(tags);
  const sortedTags = [...tags].sort(
    (a, b) =>
      COMPETENCE_LEVELS.indexOf(b.level) - COMPETENCE_LEVELS.indexOf(a.level) ||
      a.tag.localeCompare(b.tag, 'sv')
  );
  const myLoadLevel = loadLevel(load);
  const profileStatus = competenceProfileStatus(competenceUpdatedAt, initialTags.length > 0);
  const updatedLabel = competenceUpdatedAt
    ? new Date(competenceUpdatedAt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
    : null;

  return (
    <form action={formAction} className="mx-mt-4" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {(profileStatus === 'stale' || profileStatus === 'missing') && (
        <div className="mx-card" style={{ padding: 12, background: 'var(--mx-st-warn-bg, #f8f1da)', color: '#4b2718' }}>
          <div className="mx-t-13 mx-fw-6">
            {profileStatus === 'missing'
              ? 'Du har inga hashtags ännu — utan dem kan du inte föreslås till tvärfunktionella team.'
              : `Din kompetensprofil uppdaterades senast ${updatedLabel} (mer än ${COMPETENCE_PROFILE_STALE_DAYS} dagar sedan). Gå igenom hashtags och nivåer och spara igen så att teamförslagen bygger på aktuell information.`}
          </div>
        </div>
      )}
      <Card style={{ padding: 18 }}>
        <div className="mx-flex mx-col mx-gap-4">
          <div className="mx-field">
            <label className="mx-label" htmlFor="title">
              Yrkestitel
            </label>
            <input
              id="title"
              name="title"
              maxLength={120}
              defaultValue={initialTitle}
              placeholder="t.ex. Affärscoach, Projektledare, Kommunikatör"
            />
          </div>
          <div className="mx-field">
            <label className="mx-label" htmlFor="bio">
              Kort om mig
            </label>
            <textarea
              id="bio"
              name="bio"
              maxLength={1000}
              defaultValue={initialBio}
              placeholder="Bakgrund och specialitet — vad du kan kopplas på för i ett team."
            />
            <div className="mx-t-12 mx-muted mx-mt-1">
              Skriv inga personuppgifter om andra. Texten är intern.
            </div>
          </div>
        </div>
      </Card>

      {/* ── Mina hashtags ─────────────────────────────────────────────── */}
      <Card style={{ padding: 18 }}>
        <div className="mx-flex mx-items-c mx-justify-b mx-mb-2 mx-gap-2 mx-wrap">
          <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6">
            Mina kompetenser ({tags.length}/{USER_COMPETENCE_TAGS_MAX})
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sök hashtag…"
            aria-label="Sök hashtag"
            style={{ maxWidth: 220 }}
          />
        </div>
        <div className="mx-t-12 mx-muted mx-mb-3">
          Klicka på en hashtag för att lägga till den — klicka igen för att höja nivån
          (<strong>kan bidra → stark → expert</strong>), en fjärde gång tar bort den.
          Hashtags väger tyngre än områden när ett team sätts ihop, och nivån avgör
          vem som föreslås som ansvarig. Områdena nedan härleds automatiskt.
        </div>

        {sortedTags.length > 0 && (
          <div className="mx-mb-3" style={{ padding: 10, background: 'var(--mx-paper-3)', borderRadius: 8 }}>
            <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6 mx-mb-2">Dina hashtags</div>
            <ul className="mx-flex mx-col mx-gap-1">
              {sortedTags.map((t) => (
                <li key={t.tag} className="mx-flex mx-items-c mx-gap-2 mx-wrap">
                  <span className="mx-mono mx-t-13 mx-fw-6" style={{ minWidth: 160 }}>
                    #{labelBySlug.get(t.tag) ?? t.tag}
                  </span>
                  <span className="mx-mono mx-t-xs mx-muted">{COMPETENCE_LABELS[t.area]}</span>
                  <span className="mx-flex mx-gap-1" role="group" aria-label={`Nivå för #${t.tag}`}>
                    {COMPETENCE_LEVELS.map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        className={`mx-chip mx-mono ${t.level === lvl ? 'mx-active' : ''}`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setLevel(t.tag, t.area, lvl)}
                        aria-pressed={t.level === lvl}
                      >
                        {COMPETENCE_LEVEL_LABELS[lvl]}
                      </button>
                    ))}
                  </span>
                  <button
                    type="button"
                    className="mx-btn mx-sm mx-ghost"
                    onClick={() => setLevel(t.tag, t.area, null)}
                    aria-label={`Ta bort #${t.tag}`}
                  >
                    <Icon name="close" size={11} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mx-flex mx-col mx-gap-3">
          {groups.map((g) => (
            <div key={g.area}>
              <div className="mx-t-12 mx-fw-6 mx-mb-1">{g.label}</div>
              <div className="mx-flex mx-gap-2 mx-wrap">
                {g.tags.map((t) => {
                  const lvl = levelOf(t.slug);
                  return (
                    <button
                      type="button"
                      key={t.slug}
                      onClick={() => cycle(t.slug, t.area)}
                      title={lvl ? `${COMPETENCE_LEVEL_LABELS[lvl]} — klicka för nästa nivå` : 'Klicka för att lägga till'}
                      className={`mx-chip mx-mono ${lvl ? 'mx-active' : ''}`}
                      style={{
                        cursor: 'pointer',
                        border: lvl ? '1px solid var(--color-brand)' : '1px solid var(--mx-line)'
                      }}
                      aria-pressed={Boolean(lvl)}
                    >
                      #{t.label}
                      {lvl ? <span aria-label={COMPETENCE_LEVEL_LABELS[lvl]}> {LEVEL_MARK[lvl]}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {groups.length === 0 && (
            <div className="mx-t-12 mx-muted">Ingen hashtag matchar sökningen — lägg till den som egen nedan.</div>
          )}
        </div>

        <div className="mx-mt-3" style={{ borderTop: '1px solid var(--mx-line)', paddingTop: 12 }}>
          <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6 mx-mb-2">Lägg till egen hashtag</div>
          <div className="mx-flex mx-gap-2 mx-wrap mx-items-c">
            <input
              value={customTag}
              onChange={(e) => setCustomTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCustom();
                }
              }}
              list="mx-competence-tag-options"
              placeholder="#t.ex. tillverkande-industri"
              aria-label="Egen hashtag"
              style={{ flex: 1, minWidth: 200 }}
            />
            <datalist id="mx-competence-tag-options">
              {vocabulary.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.label}
                </option>
              ))}
            </datalist>
            <select
              value={customArea}
              onChange={(e) => setCustomArea(e.target.value as CompetenceId)}
              aria-label="Område för egen hashtag"
            >
              {(Object.keys(COMPETENCE_LABELS) as CompetenceId[]).map((id) => (
                <option key={id} value={id}>
                  {COMPETENCE_LABELS[id]}
                </option>
              ))}
            </select>
            <button type="button" className="mx-btn mx-sm" onClick={addCustom} disabled={!customTag.trim()}>
              <Icon name="plus" size={11} /> Lägg till
            </button>
          </div>
          <div className="mx-t-12 mx-muted mx-mt-1">
            Nya hashtags blir synliga för kollegorna i förslagslistan så att ni använder
            samma ord. Skriv kompetens, aldrig personuppgifter.
          </div>
        </div>

        <div className="mx-mt-3">
          <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6 mx-mb-1">Områden (härleds)</div>
          {derivedAreas.length > 0 ? (
            <div className="mx-flex mx-gap-1 mx-wrap">
              {derivedAreas.map((a) => (
                <span key={a} className="mx-chip mx-mono">
                  {COMPETENCE_LABELS[a]}
                </span>
              ))}
            </div>
          ) : (
            <div className="mx-t-12 mx-muted">Inga hashtags valda än.</div>
          )}
        </div>

        <input type="hidden" name="competence_tags_json" value={JSON.stringify(tags)} />
      </Card>

      {/* ── Vill utvecklas inom ───────────────────────────────────────── */}
      <Card style={{ padding: 18 }}>
        <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6 mx-mb-2">
          Vill utvecklas inom ({interests.length}/{DEVELOPMENT_INTERESTS_MAX})
        </div>
        <div className="mx-t-12 mx-muted mx-mb-2">
          Hashtags du vill lära dig mer om. Ett tvärfunktionellt team mår bra av en
          expert och en som vill lära — det här gör att du kan föreslås som
          deltagare även där du ännu inte är stark.
        </div>
        {interests.length > 0 && (
          <div className="mx-flex mx-gap-2 mx-wrap mx-mb-2">
            {interests.map((slug) => (
              <span key={slug} className="mx-chip mx-mono mx-flex mx-items-c mx-gap-1">
                #{labelBySlug.get(slug) ?? slug}
                <button
                  type="button"
                  onClick={() => setInterests((prev) => prev.filter((s) => s !== slug))}
                  aria-label={`Ta bort #${slug}`}
                  style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit' }}
                >
                  <Icon name="close" size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="mx-flex mx-gap-2 mx-wrap mx-items-c">
          <input
            value={interestInput}
            onChange={(e) => setInterestInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addInterest();
              }
            }}
            list="mx-competence-tag-options"
            placeholder="#t.ex. eic"
            aria-label="Hashtag att utvecklas inom"
            style={{ flex: 1, minWidth: 200 }}
          />
          <button type="button" className="mx-btn mx-sm" onClick={addInterest} disabled={!interestInput.trim()}>
            <Icon name="plus" size={11} /> Lägg till
          </button>
        </div>
        <input type="hidden" name="development_interests_json" value={JSON.stringify(interests)} />
      </Card>

      {/* ── Min belastning ────────────────────────────────────────────── */}
      <Card style={{ padding: 18 }}>
        <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6 mx-mb-1">Min belastning just nu</div>
        <div className="mx-flex mx-items-c mx-gap-2 mx-wrap">
          <span className={`mx-chip mx-mono ${myLoadLevel === 'free' ? 'mx-active' : ''}`}>
            {LOAD_LEVEL_LABELS[myLoadLevel]}
          </span>
          <span className="mx-t-13">{describeLoad(load)}</span>
        </div>
        <div className="mx-t-12 mx-muted mx-mt-1">
          Räknas ur de team (uppdrag) du ingår i som pågår. Teamförslaget väger in detta
          så att ledig kompetens föreslås före en redan fullbelagd kollega.
        </div>
      </Card>

      {state?.error && (
        <div className="mx-card" style={{ padding: 12, background: 'var(--mx-st-danger-bg, #f1e5df)', color: '#4b2718' }}>
          <div className="mx-t-13 mx-fw-6">{state.error}</div>
        </div>
      )}
      {state?.ok && (
        <div className="mx-card" style={{ padding: 12, background: 'var(--mx-st-ok-bg, #d9eddd)', color: '#1d3a1f' }}>
          <div className="mx-t-13 mx-fw-6">Profilen sparad.</div>
        </div>
      )}
      {state?.warning && (
        <div className="mx-card" style={{ padding: 12, background: 'var(--mx-st-warn-bg, #f8f1da)', color: '#4b2718' }}>
          <div className="mx-t-13 mx-fw-6">{state.warning}</div>
        </div>
      )}

      <div className="mx-flex mx-gap-2 mx-justify-b mx-items-c">
        <span className="mx-mono mx-t-xs mx-muted">
          Bara du kan ändra din profil.{updatedLabel ? ` Kompetenser sparade ${updatedLabel}.` : ''}
        </span>
        <button type="submit" className="mx-btn mx-primary" disabled={pending}>
          <Icon name="check" size={13} />
          {pending ? 'Sparar…' : 'Spara profil'}
        </button>
      </div>
    </form>
  );
}
