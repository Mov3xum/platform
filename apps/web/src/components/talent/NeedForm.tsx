'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  TALENT_COMPENSATIONS,
  TALENT_COMPENSATION_LABELS,
  TALENT_NEED_DESCRIPTION_MAX,
  TALENT_NEED_KINDS,
  TALENT_NEED_KIND_LABELS,
  TALENT_NEED_TAGS_MAX,
  TALENT_NEED_TITLE_MAX,
  TALENT_WORK_MODES,
  TALENT_WORK_MODE_LABELS,
  type CompetenceTagDef,
  type StudentTag
} from '@platform/shared';
import { createTalentNeedAction, updateTalentNeedAction, type TalentActionState } from '@/lib/actions/talent';
import { TagPicker } from './TagPicker';
import { Notice, btnGhost, btnPrimary, inputClass, labelClass } from './ui';

export interface NeedFormValues {
  id?: string;
  startup?: string;
  title?: string;
  kind?: string;
  description?: string;
  tags?: string[];
  scope?: string;
  starts_at?: string | null;
  ends_at?: string | null;
  compensation?: string;
  compensation_note?: string;
  location?: string;
  work_mode?: string;
  supervisor?: boolean;
  deadline?: string | null;
  anonymous?: boolean;
  status?: string;
}

interface Props {
  vocabulary: readonly CompetenceTagDef[];
  initial?: NeedFormValues;
  /** Staff väljer bolag; bolagsmedlemmen får sitt länkade bolag från sessionen. */
  startups?: Array<{ id: string; name: string }>;
  /** Vart sidan går efter spara (annars resultatets `path`). */
  afterPath?: string;
}

const initialState: TalentActionState = {};

/**
 * Formulär för ett behov (§ 54) — samma komponent för bolaget (Mitt bolag)
 * och Movexum (/talang). Bolaget sparar utkast eller skickar till
 * granskning; publicering görs av Movexum på behovets sida.
 */
export function NeedForm({ vocabulary, initial, startups, afterPath }: Props) {
  const router = useRouter();
  const isEdit = Boolean(initial?.id);
  const [state, action, pending] = useActionState(isEdit ? updateTalentNeedAction : createTalentNeedAction, initialState);
  const [tags, setTags] = useState<StudentTag[]>((initial?.tags ?? []).map((t) => ({ tag: t, level: 'contribute' })));

  useEffect(() => {
    if (state.ok) router.push(afterPath ?? state.path ?? '/talang');
  }, [state, router, afterPath]);

  return (
    <form action={action} className="space-y-5">
      {isEdit ? <input type="hidden" name="need" value={initial!.id} /> : null}
      {startups && startups.length > 0 ? (
        <label className="block">
          <span className={labelClass}>Bolag</span>
          <select name="startup" defaultValue={initial?.startup ?? startups[0]!.id} className={inputClass} required>
            {startups.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <label className="block">
          <span className={labelClass}>Rubrik</span>
          <input name="title" required maxLength={TALENT_NEED_TITLE_MAX} defaultValue={initial?.title ?? ''} placeholder="T.ex. Exjobb: prediktion av energiförbrukning" className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Typ av uppdrag</span>
          <select name="kind" defaultValue={initial?.kind ?? 'exjobb'} className={inputClass}>
            {TALENT_NEED_KINDS.map((k) => (
              <option key={k} value={k}>
                {TALENT_NEED_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className={labelClass}>Beskrivning — vad studenten ska göra, vad ni erbjuder, vem som handleder</span>
        <textarea
          name="description"
          required
          rows={7}
          maxLength={TALENT_NEED_DESCRIPTION_MAX}
          defaultValue={initial?.description ?? ''}
          className={inputClass}
          placeholder="Skriv för studenten: bakgrund, uppgiften, vad hen lär sig och hur ni jobbar. Inga personuppgifter om andra."
        />
      </label>
      <div>
        <span className={labelClass}>Kompetens-hashtags (det matchningen bygger på)</span>
        <TagPicker vocabulary={vocabulary} value={tags} onChange={setTags} name="tags" max={TALENT_NEED_TAGS_MAX} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>Omfattning (valfritt)</span>
          <input name="scope" maxLength={160} defaultValue={initial?.scope ?? ''} placeholder="T.ex. 30 hp, 20 veckor · ca 50 %" className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Ort</span>
          <input name="location" maxLength={120} defaultValue={initial?.location ?? ''} placeholder="Gävle" className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Start (valfritt)</span>
          <input type="date" name="starts_at" defaultValue={initial?.starts_at ?? ''} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Slut (valfritt)</span>
          <input type="date" name="ends_at" defaultValue={initial?.ends_at ?? ''} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Sista ansökningsdag (valfritt)</span>
          <input type="date" name="deadline" defaultValue={initial?.deadline ?? ''} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Arbetssätt</span>
          <select name="work_mode" defaultValue={initial?.work_mode ?? 'hybrid'} className={inputClass}>
            {TALENT_WORK_MODES.map((m) => (
              <option key={m} value={m}>
                {TALENT_WORK_MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Ersättning</span>
          <select name="compensation" defaultValue={initial?.compensation ?? 'negotiable'} className={inputClass}>
            {TALENT_COMPENSATIONS.map((c) => (
              <option key={c} value={c}>
                {TALENT_COMPENSATION_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Kommentar om ersättning (valfritt)</span>
          <input name="compensation_note" maxLength={200} defaultValue={initial?.compensation_note ?? ''} className={inputClass} />
        </label>
      </div>
      <div className="flex flex-wrap gap-5 text-sm text-foreground">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" name="supervisor" defaultChecked={initial?.supervisor ?? true} /> Handledare finns på bolaget
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" name="anonymous" defaultChecked={initial?.anonymous ?? false} /> Visa inte bolagets namn för studenter
        </label>
      </div>
      {state.error ? <Notice kind="error">{state.error}</Notice> : null}
      {state.warning ? <Notice kind="warning">{state.warning}</Notice> : null}
      <div className="flex flex-wrap gap-3">
        {isEdit ? (
          <button type="submit" className={btnPrimary} disabled={pending}>
            {pending ? 'Sparar…' : 'Spara ändringar'}
          </button>
        ) : (
          <>
            <button type="submit" name="intent" value="submit" className={btnPrimary} disabled={pending}>
              {pending ? 'Skickar…' : 'Skicka till Movexum för publicering'}
            </button>
            <button type="submit" name="intent" value="draft" className={btnGhost} disabled={pending}>
              Spara som utkast
            </button>
          </>
        )}
      </div>
      <p className="text-xs text-foreground-subtle">
        Movexum granskar texten innan den syns för studenter. Studenter ser bolagsnamn, rubrik, beskrivning, hashtags, period, ort och ersättning — aldrig
        era kontaktuppgifter förrän ni själva tar kontakt.
      </p>
    </form>
  );
}
