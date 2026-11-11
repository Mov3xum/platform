'use client';

import { useMemo, useState, useTransition } from 'react';
import { Icon } from '@/components/proto';
import {
  COMPASS_TRANSLATION_GROUP_LABEL,
  COMPASS_TRANSLATION_MAX_TEXT,
  compassSourceHash,
  compassTranslatableEntries,
  compassTranslationEntryState,
  normalizeCompassTranslations,
  type CompassTranslationEntry,
  type CompassTranslationEntryState,
  type CompassTranslationGroup
} from '@platform/shared';
import {
  saveModuleTranslationAction,
  suggestModuleTranslationAction
} from '@/lib/actions/compass-translation';
import { actionErrorMessage } from '@/lib/action-error';
import type { CompassModule, CompassQuestion } from '@/lib/compass/types';

interface Props {
  module: CompassModule;
  questions: CompassQuestion[];
  /** Publik länk (`/m/<slug>`) när modulen är publicerad — för "Visa på engelska". */
  publicPath: string | null;
}

type Notice = { kind: 'ok' | 'error' | 'warn'; text: string };

const STATE_CHIP: Record<CompassTranslationEntryState | 'edited', { label: string; tone: string }> = {
  missing: { label: 'Saknas', tone: 'var(--movexum-pastell-gul)' },
  stale: { label: 'Svenskan ändrad', tone: 'var(--movexum-pastell-orange)' },
  ok: { label: 'Klar', tone: 'var(--movexum-pastell-gron)' },
  edited: { label: 'Ej sparad', tone: 'var(--movexum-pastell-lila)' }
};

/**
 * Steget "Engelska" i modul-editorn (CLAUDE.md § 23.13). Personalen fyller
 * i den engelska versionen av besökartexterna — med AI-förslag från Mistral
 * som utgångspunkt — granskar och publicerar. Först när den är publicerad
 * visas språkknappen Svenska/English på den publika sidan. Sparas för sig
 * (egen knapp), inte med modulens Spara.
 */
export function TranslationEditor({ module: mod, questions, publicPath }: Props) {
  const entries = useMemo(() => compassTranslatableEntries(mod, questions), [mod, questions]);
  const [stored, setStored] = useState(() => normalizeCompassTranslations(mod.translations).en);
  const [texts, setTexts] = useState<Record<string, string>>(() => ({ ...(stored?.texts ?? {}) }));
  const [enabled, setEnabled] = useState<boolean>(stored?.enabled ?? false);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [aiKeys, setAiKeys] = useState<Set<string>>(() => new Set());
  const [suggesting, startSuggest] = useTransition();
  const [saving, startSave] = useTransition();

  const stateOf = (e: CompassTranslationEntry): CompassTranslationEntryState | 'edited' => {
    const current = (texts[e.key] ?? '').trim();
    if (current !== (stored?.texts[e.key] ?? '').trim()) return current ? 'edited' : 'missing';
    return compassTranslationEntryState(e, stored);
  };

  const counts = useMemo(() => {
    let done = 0;
    let open = 0;
    for (const e of entries) {
      const s = stateOf(e);
      if (s === 'missing' || s === 'stale') open++;
      if ((texts[e.key] ?? '').trim()) done++;
    }
    return { done, open };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, texts, stored]);

  const dirty =
    enabled !== (stored?.enabled ?? false) ||
    entries.some((e) => (texts[e.key] ?? '').trim() !== (stored?.texts[e.key] ?? '').trim());

  function suggest(mode: 'missing' | 'all') {
    if (mode === 'all' && !window.confirm('Översätta ALLA texter på nytt? Dina egna ändringar ersätts av AI-förslag.')) {
      return;
    }
    setNotice(null);
    startSuggest(async () => {
      try {
        // Osparade egna texter skickas inte — AI:n översätter utifrån svenskan.
        const res = await suggestModuleTranslationAction(mod.id, mode);
        if (!res.ok) {
          setNotice({ kind: 'error', text: res.error });
          return;
        }
        if (res.translated === 0) {
          setNotice({ kind: 'ok', text: 'Allt är redan översatt — inget att föreslå.' });
          return;
        }
        setTexts((prev) => {
          const next = { ...prev };
          for (const [key, value] of Object.entries(res.texts)) {
            // "Saknas/ändrad"-läget skriver aldrig över en text du själv skrivit
            // men inte sparat.
            const unsavedOwn = (prev[key] ?? '').trim() && (prev[key] ?? '').trim() !== (stored?.texts[key] ?? '').trim();
            if (mode === 'all' || !unsavedOwn) next[key] = value;
          }
          return next;
        });
        setAiKeys((prev) => new Set([...prev, ...Object.keys(res.texts)]));
        setNotice({
          kind: res.failed ? 'warn' : 'ok',
          text: res.failed
            ? `AI-förslag för ${res.translated} texter. Några texter kunde inte översättas — fyll i dem själv eller försök igen. Granska och spara.`
            : `AI-förslag för ${res.translated} texter. Granska dem och tryck Spara.`
        });
      } catch (err) {
        setNotice({ kind: 'error', text: actionErrorMessage(err, 'AI-översättningen misslyckades.') });
      }
    });
  }

  function save(nextEnabled: boolean) {
    setNotice(null);
    startSave(async () => {
      try {
        const res = await saveModuleTranslationAction(mod.id, texts, nextEnabled);
        if (!res.ok) {
          setNotice({ kind: 'error', text: res.error });
          return;
        }
        const clean: Record<string, string> = {};
        for (const e of entries) {
          const v = (texts[e.key] ?? '').trim();
          if (v) clean[e.key] = v;
        }
        setStored({
          enabled: res.enabled,
          texts: clean,
          sources: Object.fromEntries(
            entries.filter((e) => clean[e.key]).map((e) => [e.key, compassSourceHash(e.source)])
          )
        });
        setEnabled(res.enabled);
        setAiKeys(new Set());
        const { translated, total } = res.summary;
        setNotice({
          kind: 'ok',
          text: res.enabled
            ? `Den engelska versionen är publicerad (${translated} av ${total} texter). Besökare kan nu välja English på modulsidan.`
            : `Sparat (${translated} av ${total} texter). Den engelska versionen är inte publicerad.`
        });
      } catch (err) {
        setNotice({ kind: 'error', text: actionErrorMessage(err, 'Kunde inte spara den engelska versionen.') });
      }
    });
  }

  const groups = (['page', 'questions', 'results'] as CompassTranslationGroup[])
    .map((g) => ({
      group: g,
      items: entries.filter(
        (e) => e.group === g && (!onlyOpen || ['missing', 'stale', 'edited'].includes(stateOf(e)))
      )
    }))
    .filter((g) => g.items.length > 0);

  const busy = suggesting || saving;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="mx-flex mx-items-c mx-gap-2 mx-wrap" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <div className="mx-flex mx-items-c mx-gap-2">
            <span className="mx-disp mx-fw-6" style={{ fontSize: 17 }}>
              Engelsk version
            </span>
            <span
              className="mx-chip mx-mono"
              style={{
                background: stored?.enabled ? 'var(--movexum-pastell-gron)' : 'var(--mx-paper-2)',
                color: stored?.enabled ? 'var(--movexum-morkgron)' : 'var(--mx-ink-soft)'
              }}
            >
              {stored?.enabled ? 'PUBLICERAD' : 'INTE PUBLICERAD'}
            </span>
          </div>
          <span className="mx-t-12 mx-muted">
            {counts.done} av {entries.length} texter på engelska
            {counts.open > 0 ? ` · ${counts.open} behöver åtgärdas` : ''}
          </span>
        </div>
        <div className="mx-flex mx-items-c mx-gap-2 mx-wrap">
          <button type="button" className="mx-btn mx-primary" disabled={busy} onClick={() => suggest('missing')}>
            <Icon name="sparkle" size={13} /> {suggesting ? 'Översätter…' : 'Översätt med AI'}
          </button>
          <button type="button" className="mx-btn" disabled={busy} onClick={() => suggest('all')}>
            Översätt allt på nytt
          </button>
          {publicPath && stored?.enabled && (
            <a className="mx-btn" href={`${publicPath}?lang=en`} target="_blank" rel="noopener noreferrer">
              <Icon name="globe" size={13} /> Visa på engelska
            </a>
          )}
        </div>
      </div>

      <div
        className="mx-t-12"
        style={{
          padding: '10px 12px',
          borderRadius: 10,
          background: 'var(--mx-paper-2)',
          border: '1px solid var(--mx-line-soft)',
          lineHeight: 1.55
        }}
      >
        När den engelska versionen är publicerad visas knappen <strong>Svenska / English</strong> uppe till höger
        på modulsidan. Texter du lämnar tomma visas på svenska. Gränssnittet (knappar, steg, kontaktfält) och
        AI-chatten byter språk automatiskt. AI-förslagen kommer från Mistral (EU) — granska varje text innan du
        publicerar. Ändrar du frågor i steg 3, ladda om sidan så de syns här.
      </div>

      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className="mx-t-13"
          style={{
            padding: '10px 12px',
            borderRadius: 10,
            background:
              notice.kind === 'error'
                ? 'var(--movexum-pastell-orange)'
                : notice.kind === 'warn'
                  ? 'var(--movexum-pastell-gul)'
                  : 'var(--movexum-pastell-gron)',
            color:
              notice.kind === 'error'
                ? 'var(--movexum-morkorange)'
                : notice.kind === 'warn'
                  ? '#4b2718'
                  : 'var(--movexum-morkgron)'
          }}
        >
          {notice.text}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="mx-muted mx-t-13">Modulen har inga texter att översätta ännu — fyll i rubrik och frågor först.</p>
      ) : (
        <>
          <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
            Visa bara texter som behöver åtgärdas
          </label>
          {groups.length === 0 && <p className="mx-muted mx-t-13">Inget att åtgärda — alla texter är klara.</p>}
          {groups.map(({ group, items }) => (
            <section key={group} style={{ display: 'grid', gap: 10 }}>
              <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6">{COMPASS_TRANSLATION_GROUP_LABEL[group]}</div>
              {items.map((e) => {
                const state = stateOf(e);
                const chip = STATE_CHIP[state];
                const value = texts[e.key] ?? '';
                return (
                  <div
                    key={e.key}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                      gap: 10,
                      padding: 12,
                      borderRadius: 12,
                      border: '1px solid var(--mx-line)'
                    }}
                  >
                    <div style={{ display: 'grid', gap: 4, alignContent: 'start' }}>
                      <div className="mx-flex mx-items-c mx-gap-2 mx-wrap">
                        <span className="mx-t-12 mx-fw-6">{e.label}</span>
                        <span className="mx-chip mx-mono" style={{ background: chip.tone, color: 'var(--mx-ink)' }}>
                          {chip.label}
                        </span>
                        {aiKeys.has(e.key) && state === 'edited' && (
                          <span className="mx-chip mx-mono" style={{ background: 'var(--mx-cyan-tint-2)', color: '#002c40' }}>
                            AI-FÖRSLAG
                          </span>
                        )}
                      </div>
                      <div className="mx-t-13 mx-muted" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }} lang="sv">
                        {e.source}
                      </div>
                    </div>
                    <label style={{ display: 'grid', gap: 4 }}>
                      <span className="mx-t-xs mx-muted mx-mono mx-t-up">English</span>
                      {e.multiline ? (
                        <textarea
                          className="mx-textarea"
                          lang="en"
                          rows={Math.min(8, Math.max(3, e.source.split('\n').length + 1))}
                          maxLength={COMPASS_TRANSLATION_MAX_TEXT}
                          value={value}
                          onChange={(ev) => setTexts((t) => ({ ...t, [e.key]: ev.target.value }))}
                        />
                      ) : (
                        <input
                          className="mx-input"
                          lang="en"
                          maxLength={COMPASS_TRANSLATION_MAX_TEXT}
                          value={value}
                          onChange={(ev) => setTexts((t) => ({ ...t, [e.key]: ev.target.value }))}
                        />
                      )}
                    </label>
                  </div>
                );
              })}
            </section>
          ))}

          <div
            className="mx-flex mx-items-c mx-gap-2 mx-wrap"
            style={{
              justifyContent: 'space-between',
              padding: 12,
              borderRadius: 12,
              background: 'var(--mx-paper-2)',
              border: '1px solid var(--mx-line-soft)'
            }}
          >
            <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span>
                <strong>Publicera den engelska versionen</strong> — visa språkknappen Svenska / English på modulsidan
              </span>
            </label>
            <button type="button" className="mx-btn mx-primary" disabled={busy || !dirty} onClick={() => save(enabled)}>
              <Icon name="check" size={13} /> {saving ? 'Sparar…' : 'Spara engelska'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
