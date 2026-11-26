'use client';

import { useMemo, useState } from 'react';
import { Icon } from '@/components/proto';
import type { ResultBucket } from '@/lib/compass/types';

/**
 * Visuell editor för quiz-resultatprofiler (ersätter den råa JSON-textarean).
 * Ligger INNE i modulformuläret (`updateModuleAction`) och skriver tillbaka
 * profilerna som JSON i ett dolt `result_buckets`-fält, vilket server-actionen
 * redan tolkar. Behåller ev. äldre `min`/`max` (intervall-läge) på profiler
 * som har dem, så ingen data tappas tyst — men UI:t fokuserar på det enkla
 * topp-hink-läget (poäng per profil sätts på svarsalternativen).
 */
export function ResultBucketsEditor({
  initial,
  formId
}: {
  initial: ResultBucket[];
  /** Modulformulärets id — låter editorn ligga utanför <form>-elementet. */
  formId?: string;
}) {
  const [buckets, setBuckets] = useState<ResultBucket[]>(() =>
    initial.map((b) => ({ ...b, tips: Array.isArray(b.tips) ? b.tips : [] }))
  );

  const json = useMemo(() => {
    const cleaned = buckets
      .map((b) => ({
        ...b,
        key: b.key.trim(),
        title: b.title.trim(),
        body: (b.body ?? '').trim(),
        tips: (b.tips ?? []).map((t) => t.trim()).filter(Boolean)
      }))
      .filter((b) => b.key && b.title);
    // Alltid giltig JSON — '[]' låter servern RENSA profilerna (en tom sträng
    // hoppas över av updateModuleAction och gjorde det omöjligt att ta bort
    // sista profilen).
    return JSON.stringify(cleaned);
  }, [buckets]);

  // Sparade profiler är hopfällda (bara titeln syns); nya öppnas direkt.
  const [openIdx, setOpenIdx] = useState<Set<number>>(() => new Set());
  function toggle(i: number) {
    setOpenIdx((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function update(i: number, patch: Partial<ResultBucket>) {
    setBuckets((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }

  function add() {
    setOpenIdx((prev) => new Set(prev).add(buckets.length));
    setBuckets((prev) => [...prev, { key: '', title: '', body: '', tips: [] }]);
  }

  function remove(i: number) {
    setBuckets((prev) => prev.filter((_, idx) => idx !== i));
    // Index efter den borttagna flyttas ett steg upp.
    setOpenIdx((prev) => {
      const next = new Set<number>();
      for (const n of prev) if (n !== i) next.add(n > i ? n - 1 : n);
      return next;
    });
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {/* Dolt fält som följer med modulformuläret. */}
      <input type="hidden" name="result_buckets" value={json} form={formId} />

      {buckets.length === 0 ? (
        <div className="mx-muted mx-t-12">Inga profiler än.</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {buckets.map((b, i) => {
            const open = openIdx.has(i);
            return (
            <div key={i} className={`mx-qcard ${open ? 'is-open' : ''}`}>
              <div className="mx-qcard-head">
                <button
                  type="button"
                  className="mx-qcard-toggle"
                  aria-expanded={open}
                  onClick={() => toggle(i)}
                >
                  <span className="mx-qcard-num">{i + 1}</span>
                  <span className="mx-qcard-title">{b.title.trim() || '(profil utan titel)'}</span>
                  {b.key.trim() && <span className="mx-chip">{b.key.trim()}</span>}
                  <Icon name={open ? 'chevdown' : 'chevron'} size={14} />
                </button>
              </div>
              {open && (
              <div className="mx-qcard-body">
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr auto', gap: 12 }}>
                <label className="mx-label">
                  Nyckel
                  <input
                    type="text"
                    className="mx-input"
                    style={{ marginTop: 4, fontFamily: 'var(--mx-mono)' }}
                    placeholder="green"
                    value={b.key}
                    onChange={(e) => update(i, { key: e.target.value })}
                  />
                </label>
                <label className="mx-label">
                  Titel
                  <input
                    type="text"
                    className="mx-input"
                    style={{ marginTop: 4 }}
                    placeholder="Redo att testas"
                    value={b.title}
                    onChange={(e) => update(i, { title: e.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="mx-btn mx-sm"
                  onClick={() => remove(i)}
                  title="Ta bort profil"
                  style={{ color: 'var(--movexum-morkorange)', alignSelf: 'end' }}
                >
                  <Icon name="trash" size={11} />
                </button>
              </div>

              <label className="mx-label">
                Beskrivning
                <textarea
                  className="mx-textarea"
                  style={{ marginTop: 4, minHeight: 50 }}
                  value={b.body ?? ''}
                  onChange={(e) => update(i, { body: e.target.value })}
                />
              </label>

              <label className="mx-label">
                Tips (en per rad)
                <textarea
                  className="mx-textarea"
                  style={{ marginTop: 4, minHeight: 50 }}
                  value={(b.tips ?? []).join('\n')}
                  onChange={(e) => update(i, { tips: e.target.value.split('\n') })}
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label className="mx-label">
                  CTA-etikett (valfri)
                  <input
                    type="text"
                    className="mx-input"
                    style={{ marginTop: 4 }}
                    placeholder="Boka möte"
                    value={b.cta?.label ?? ''}
                    onChange={(e) =>
                      update(i, {
                        cta: { label: e.target.value, url: b.cta?.url ?? '' }
                      })
                    }
                  />
                </label>
                <label className="mx-label">
                  CTA-länk (valfri)
                  <input
                    type="text"
                    className="mx-input"
                    style={{ marginTop: 4, fontFamily: 'var(--mx-mono)' }}
                    placeholder="/m/grundare"
                    value={b.cta?.url ?? ''}
                    onChange={(e) =>
                      update(i, {
                        cta: { label: b.cta?.label ?? '', url: e.target.value }
                      })
                    }
                  />
                </label>
              </div>

              {(typeof b.min === 'number' || typeof b.max === 'number') && (
                <div className="mx-muted mx-t-12">
                  Den här profilen använder intervall-poäng ({b.min ?? '−∞'}–{b.max ?? '∞'}) från en
                  äldre uppsättning. Det behålls; nya poäng sätts enklast per svarsalternativ.
                </div>
              )}
              </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      <button type="button" className="mx-btn mx-sm" onClick={add} style={{ justifySelf: 'start' }}>
        <Icon name="plus" size={11} /> Lägg till profil
      </button>
    </div>
  );
}
