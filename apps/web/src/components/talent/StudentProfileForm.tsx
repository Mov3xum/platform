'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  STUDENT_LEVELS,
  STUDENT_LEVEL_LABELS,
  STUDENT_SUMMARY_MAX,
  STUDENT_TAGS_MAX,
  TALENT_NEED_KINDS,
  TALENT_NEED_KIND_LABELS,
  type CompetenceTagDef,
  type StudentTag,
  type TalentNeedKind
} from '@platform/shared';
import { TagPicker } from './TagPicker';

export interface StudentFormValues {
  first_name?: string;
  last_name?: string;
  email?: string;
  university?: string;
  program?: string;
  level?: string;
  graduation_year?: number | null;
  tags?: StudentTag[];
  seeking?: TalentNeedKind[];
  available_from?: string | null;
  location?: string;
  remote_ok?: boolean;
  summary?: string;
  linkedin_url?: string;
  searchable?: boolean;
}

interface Props {
  tenantSlug: string;
  tenantName: string;
  vocabulary: readonly CompetenceTagDef[];
  mode: 'register' | 'edit';
  initial?: StudentFormValues;
}

/**
 * Studentens profil (§ 54): registrering (med samtyckesgrind) och
 * redigering. Skickar JSON till den publika routen; servern validerar om
 * allt. Bolagen ser profilen ANONYMT (lärosäte, program, hashtags, vad du
 * söker) tills du själv söker eller tackar ja — namn och e-post visas aldrig
 * innan dess.
 */
export function StudentProfileForm({ tenantSlug, tenantName, vocabulary, mode, initial }: Props) {
  const router = useRouter();
  const [tags, setTags] = useState<StudentTag[]>(initial?.tags ?? []);
  const [seeking, setSeeking] = useState<TalentNeedKind[]>(initial?.seeking ?? ['exjobb']);
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<{ pending?: boolean; error?: string; notice?: string }>({});

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const profile = {
      first_name: fd.get('first_name'),
      last_name: fd.get('last_name'),
      email: fd.get('email'),
      university: fd.get('university'),
      program: fd.get('program'),
      level: fd.get('level'),
      graduation_year: fd.get('graduation_year'),
      tags,
      seeking,
      available_from: fd.get('available_from'),
      location: fd.get('location'),
      remote_ok: fd.get('remote_ok') === 'on',
      summary: fd.get('summary'),
      linkedin_url: fd.get('linkedin_url'),
      searchable: fd.get('searchable') === 'on'
    };
    setState({ pending: true });
    try {
      const url = mode === 'register' ? `/api/public/s/${encodeURIComponent(tenantSlug)}/register` : `/api/public/s/${encodeURIComponent(tenantSlug)}/profile`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'register' ? { ...profile, consent } : { action: 'update', profile })
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; notice?: string };
      if (!res.ok) {
        setState({ error: data.error ?? 'Något gick fel. Försök igen.' });
        return;
      }
      if (mode === 'register') setState({ notice: data.notice ?? 'Kolla din e-post.' });
      else {
        setState({ notice: 'Profilen är sparad.' });
        router.refresh();
      }
    } catch {
      setState({ error: 'Kunde inte nå servern. Försök igen.' });
    }
  }

  if (state.notice && mode === 'register') {
    return (
      <div className="mx-qchoice is-selected" style={{ cursor: 'default' }}>
        <strong>Nästan klart!</strong>
        <p style={{ margin: '6px 0 0' }}>{state.notice}</p>
      </div>
    );
  }

  const toggleKind = (k: TalentNeedKind) => setSeeking((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  return (
    <form onSubmit={submit} className="mx-form" style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <label className="mx-label">
          Förnamn
          <input name="first_name" required maxLength={80} defaultValue={initial?.first_name ?? ''} className="mx-input" />
        </label>
        <label className="mx-label">
          Efternamn
          <input name="last_name" maxLength={80} defaultValue={initial?.last_name ?? ''} className="mx-input" />
        </label>
      </div>
      <label className="mx-label">
        E-post {mode === 'edit' ? '(kan inte ändras — det är din inloggning)' : ''}
        <input name="email" type="email" required readOnly={mode === 'edit'} defaultValue={initial?.email ?? ''} className="mx-input" />
      </label>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <label className="mx-label">
          Lärosäte
          <input name="university" required maxLength={120} defaultValue={initial?.university ?? ''} placeholder="Högskolan i Gävle" className="mx-input" />
        </label>
        <label className="mx-label">
          Program / inriktning
          <input name="program" maxLength={160} defaultValue={initial?.program ?? ''} placeholder="Datavetenskap" className="mx-input" />
        </label>
        <label className="mx-label">
          Nivå
          <select name="level" defaultValue={initial?.level ?? 'kandidat'} className="mx-input">
            {STUDENT_LEVELS.map((l) => (
              <option key={l} value={l}>
                {STUDENT_LEVEL_LABELS[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="mx-label">
          Beräknad examen (år)
          <input name="graduation_year" type="number" min={2000} max={2100} defaultValue={initial?.graduation_year ?? ''} className="mx-input" />
        </label>
      </div>
      <div>
        <span className="mx-label">Vad söker du?</span>
        <div className="mx-qchoices" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {TALENT_NEED_KINDS.map((k) => (
            <button key={k} type="button" className={`mx-qchoice${seeking.includes(k) ? ' is-selected' : ''}`} onClick={() => toggleKind(k)} aria-pressed={seeking.includes(k)}>
              {TALENT_NEED_KIND_LABELS[k]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className="mx-label">Dina kompetenser som hashtags (välj eller skriv egna — aldrig personuppgifter)</span>
        <TagPicker vocabulary={vocabulary} value={tags} onChange={setTags} withLevels max={STUDENT_TAGS_MAX} />
      </div>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <label className="mx-label">
          Tillgänglig från
          <input name="available_from" type="date" defaultValue={initial?.available_from ?? ''} className="mx-input" />
        </label>
        <label className="mx-label">
          Ort
          <input name="location" maxLength={120} defaultValue={initial?.location ?? ''} placeholder="Gävle" className="mx-input" />
        </label>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, color: 'var(--mx-ink)' }}>
        <input name="remote_ok" type="checkbox" defaultChecked={initial?.remote_ok ?? true} /> Jag kan jobba på distans
      </label>
      <label className="mx-label">
        Om mig — vad du vill göra och vad du är bra på (inga personnummer eller uppgifter om andra)
        <textarea name="summary" rows={5} maxLength={STUDENT_SUMMARY_MAX} defaultValue={initial?.summary ?? ''} className="mx-textarea" />
      </label>
      <label className="mx-label">
        LinkedIn (valfritt, https-länk)
        <input name="linkedin_url" type="url" maxLength={300} defaultValue={initial?.linkedin_url ?? ''} placeholder="https://www.linkedin.com/in/…" className="mx-input" />
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.5, color: 'var(--mx-ink)' }}>
        <input name="searchable" type="checkbox" defaultChecked={initial?.searchable ?? true} style={{ marginTop: 4 }} />
        <span>
          Gör mig sökbar: bolagen i {tenantName}s inkubator får se min profil <strong>anonymt</strong> (utan namn och kontaktuppgifter) och kan föreslå uppdrag.
          Avstår du kan du fortfarande söka publicerade behov själv.
        </span>
      </label>
      {mode === 'register' ? (
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.5, color: 'var(--mx-ink)' }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 4 }} required />
          <span>
            Jag godkänner att {tenantName} sparar uppgifterna ovan i ett år för att matcha mig mot bolag i inkubatorn. Uppgifterna hanteras inom EU, delas aldrig med
            andra än de bolag jag själv väljer att ha kontakt med, och jag kan när som helst ändra, pausa eller ta bort min profil.
          </span>
        </label>
      ) : null}
      {state.error ? (
        <p className="mx-t-sm" style={{ color: 'var(--movexum-morkorange)', margin: 0 }}>
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="mx-t-sm" style={{ color: 'var(--movexum-morkgron)', margin: 0 }}>
          {state.notice}
        </p>
      ) : null}
      <div>
        <button type="submit" className="mx-btn mx-primary mx-lg" disabled={state.pending || (mode === 'register' && !consent)}>
          {state.pending ? 'Sparar…' : mode === 'register' ? 'Skapa min profil' : 'Spara profilen'}
        </button>
      </div>
    </form>
  );
}
