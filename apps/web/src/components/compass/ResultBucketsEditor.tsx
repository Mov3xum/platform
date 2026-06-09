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
export function ResultBucketsEditor({ initial }: { initial: ResultBucket[] }) {
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
    return cleaned.length ? JSON.stringify(cleaned) : '';
  }, [buckets]);

  function update(i: number, patch: Partial<ResultBucket>) {
    setBuckets((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }

  function add() {
    setBuckets((prev) => [...prev, { key: '', title: '', body: '', tips: [] }]);
  }

  function remove(i: number) {
    setBuckets((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {/* Dolt fält som följer med modulformuläret. */}
      <input type="hidden" name="result_buckets" value={json} />

      <div className="mx-label" style={{ marginBottom: 0 }}>
        Resultatprofiler (för quiz)
      </div>
      <div className="mx-muted mx-t-12" style={{ marginTop: -4 }}>
        Skapa en profil per möjligt resultat (t.ex. <code>green</code> / <code>yellow</code> /{' '}
        <code>red</code>). Nyckeln används som poängkolumn på frågornas svarsalternativ. Profilen med
        flest poäng visas för besökaren.
      </div>

      {buckets.length === 0 ? (
        <div className="mx-muted mx-t-12">Inga profiler än.</div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {buckets.map((b, i) => (
            <div
              key={i}
              style={{
                padding: 10,
                borderRadius: 10,
                background: 'var(--mx-paper-2)',
                border: '1px solid var(--mx-line-soft)',
                display: 'grid',
                gap: 8
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr auto', gap: 8 }}>
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
                  style={{ color: '#4b2718', alignSelf: 'end' }}
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
          ))}
        </div>
      )}

      <button type="button" className="mx-btn mx-sm" onClick={add} style={{ justifySelf: 'start' }}>
        <Icon name="plus" size={11} /> Lägg till profil
      </button>
    </div>
  );
}
