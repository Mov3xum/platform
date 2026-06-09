'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/proto';
import { updateModuleAction, type ModuleFormState } from '@/lib/actions/compass';
import { ResultBucketsEditor } from './ResultBucketsEditor';
import { FLOW_TYPE_LABEL, type CompassModule, type FlowType } from '@/lib/compass/types';

interface ModelOption {
  value: string;
  label: string;
}

interface OtherModule {
  id: string;
  name: string;
  public_slug?: string;
  is_active?: boolean;
  public_url_enabled?: boolean;
}

interface Props {
  module: CompassModule;
  heroImageUrl?: string | null;
  modelOptions: ModelOption[];
  /** Övriga moduler i tenanten (för "nästa modul"-kedjan). */
  otherModules: OtherModule[];
}

const STEPS = [
  { key: 'basics', label: 'Vad är modulen?', hint: 'Namn, typ och om den är publik' },
  { key: 'public', label: 'Hur ser sidan ut?', hint: 'Rubrik, text och omslagsbild' },
  { key: 'flow', label: 'Vad händer i modulen?', hint: 'Frågor, AI och fält' },
  { key: 'after', label: 'Vad händer sen?', hint: 'Tack-meddelande och nästa modul' }
] as const;

// Modulinställningar som en guidad popup-wizard: en steg i taget (1 → 2 → 3 →
// 4), en röd tråd i stället för en vägg av fält. Sällan ändrade fält ligger
// hopfällda under "Visa fler inställningar" men förblir monterade (display:none)
// så en enda submit postar ALLT till updateModuleAction.
export function ModuleSettingsForm({ module: mod, heroImageUrl, modelOptions, otherModules }: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const nextName = mod.next_module
    ? otherModules.find((m) => m.id === mod.next_module)?.name
    : undefined;

  return (
    <div style={{ padding: 16, display: 'grid', gap: 14 }}>
      {/* Sammanfattning */}
      <div style={{ display: 'grid', gap: 8 }}>
        <SummaryRow label="Typ" value={FLOW_TYPE_LABEL[mod.flow_type]} />
        <SummaryRow
          label="Status"
          value={`${mod.is_active ? 'Aktiv' : 'Utkast'}${mod.public_url_enabled ? ' · Publik' : ''}`}
        />
        <SummaryRow label="Publik länk" value={mod.public_slug ? `/m/${mod.public_slug}` : '—'} mono />
        <SummaryRow label="Nästa modul" value={nextName || 'Ingen — avslutas här'} />
      </div>

      <button type="button" className="mx-btn mx-primary" onClick={() => setOpen(true)} style={{ justifySelf: 'start' }}>
        <Icon name="gear" size={13} /> Konfigurera modul (4 steg)
      </button>

      {mounted && open
        ? createPortal(
            <WizardModal
              mod={mod}
              heroImageUrl={heroImageUrl}
              modelOptions={modelOptions}
              otherModules={otherModules}
              onClose={() => setOpen(false)}
            />,
            document.body
          )
        : null}
    </div>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="mx-flex mx-items-c mx-gap-2 mx-t-13">
      <span className="mx-mono mx-t-xs mx-t-up mx-muted" style={{ width: 110, flexShrink: 0 }}>
        {label}
      </span>
      <span className={mono ? 'mx-mono' : 'mx-fw-6'}>{value}</span>
    </div>
  );
}

function WizardModal({
  mod,
  heroImageUrl,
  modelOptions,
  otherModules,
  onClose
}: {
  mod: CompassModule;
  heroImageUrl?: string | null;
  modelOptions: ModelOption[];
  otherModules: OtherModule[];
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
  const [flowType, setFlowType] = useState<FlowType>(mod.flow_type);
  const [state, formAction, pending] = useActionState<ModuleFormState, FormData>(
    updateModuleAction,
    {}
  );
  const lastSaved = useRef(0);
  const isLast = step === STEPS.length - 1;

  // Stäng wizarden vid en ren lyckad sparning (behåll öppen vid varning så
  // användaren hinner läsa den).
  useEffect(() => {
    if (state.savedAt && state.savedAt !== lastSaved.current) {
      lastSaved.current = state.savedAt;
      if (!state.warning) onClose();
    }
  }, [state, onClose]);

  // Esc stänger.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function goto(i: number) {
    const next = Math.max(0, Math.min(STEPS.length - 1, i));
    setStep(next);
    setMaxReached((m) => Math.max(m, next));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Konfigurera modul"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(10,10,10,0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '5vh 16px',
        overflowY: 'auto'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 620,
          background: 'var(--mx-paper)',
          borderRadius: 16,
          border: '1px solid var(--mx-line)',
          boxShadow: '0 20px 60px rgba(18,18,18,0.20)',
          overflow: 'hidden'
        }}
      >
        {/* Header med progress */}
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--mx-line-soft)' }}>
          <div className="mx-flex mx-items-c mx-gap-2" style={{ marginBottom: 12 }}>
            <div className="mx-mono mx-t-xs mx-t-up mx-muted">
              Steg {step + 1} av {STEPS.length}
            </div>
            <span className="mx-grow" />
            <button type="button" className="mx-btn mx-sm mx-ghost" onClick={onClose} aria-label="Stäng">
              ✕
            </button>
          </div>
          {/* Stepper — röd tråd, klickbar bara bakåt till redan nådda steg */}
          <div className="mx-flex mx-items-c mx-gap-2" style={{ flexWrap: 'nowrap' }}>
            {STEPS.map((s, i) => {
              const active = i === step;
              const done = i < step;
              const reachable = i <= maxReached;
              return (
                <div key={s.key} className="mx-flex mx-items-c mx-gap-2" style={{ flex: 1, minWidth: 0 }}>
                  <button
                    type="button"
                    disabled={!reachable}
                    onClick={() => reachable && goto(i)}
                    title={s.label}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 26,
                      height: 26,
                      flexShrink: 0,
                      borderRadius: 99,
                      border: 'none',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: reachable ? 'pointer' : 'default',
                      background: active || done ? '#002c40' : 'var(--mx-line-soft)',
                      color: active || done ? '#fff' : 'var(--mx-ink-soft)'
                    }}
                  >
                    {done ? '✓' : i + 1}
                  </button>
                  {i < STEPS.length - 1 && (
                    <span
                      style={{
                        flex: 1,
                        height: 2,
                        borderRadius: 2,
                        background: done ? '#002c40' : 'var(--mx-line-soft)'
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="mx-disp mx-fw-6" style={{ fontSize: 17 }}>
              {STEPS[step].label}
            </div>
            <div className="mx-t-12 mx-muted">{STEPS[step].hint}</div>
          </div>
        </div>

        <form action={formAction}>
          <input type="hidden" name="id" value={mod.id} />

          <div style={{ padding: 18, display: 'grid', gap: 12, maxHeight: '60vh', overflowY: 'auto' }}>
            {/* ── Steg 1: Grunder ─────────────────────────────────────────── */}
            <Step active={step === 0}>
              <label className="mx-label">
                Namn
                <input type="text" name="name" defaultValue={mod.name} required className="mx-input" style={{ marginTop: 4 }} />
              </label>
              <label className="mx-label">
                Vilken typ av flöde?
                <select
                  name="flow_type"
                  value={flowType}
                  onChange={(e) => setFlowType(e.target.value as FlowType)}
                  className="mx-input"
                  style={{ marginTop: 4 }}
                >
                  <option value="chat">AI-chatt — besökaren samtalar fritt</option>
                  <option value="wizard">Formulär — fasta frågor i ordning</option>
                  <option value="quiz">Quiz — frågor med poäng och resultatprofil</option>
                </select>
              </label>
              <div className="mx-flex mx-items-c mx-gap-3 mx-wrap">
                <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" name="is_active" defaultChecked={!!mod.is_active} />
                  <span>Aktiv (synlig på översikten)</span>
                </label>
                <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" name="public_url_enabled" defaultChecked={!!mod.public_url_enabled} />
                  <span>Publik (delas externt på /m/…)</span>
                </label>
              </div>

              <Advanced label="Visa fler inställningar">
                <label className="mx-label">
                  Publik länk (slug)
                  <input
                    type="text"
                    name="public_slug"
                    defaultValue={mod.public_slug || ''}
                    className="mx-input"
                    style={{ marginTop: 4, fontFamily: 'var(--mx-mono)' }}
                    placeholder="t.ex. ar-du-entreprenor (globalt unik)"
                  />
                </label>
                <label className="mx-label">
                  Beskrivning (intern)
                  <textarea
                    name="description"
                    defaultValue={mod.description || ''}
                    className="mx-textarea"
                    style={{ marginTop: 4, minHeight: 50 }}
                  />
                </label>
                <label className="mx-label">
                  Målgrupp
                  <input
                    type="text"
                    name="target_audience"
                    defaultValue={mod.target_audience || ''}
                    className="mx-input"
                    style={{ marginTop: 4 }}
                    placeholder="Vem är modulen till för?"
                  />
                </label>
              </Advanced>
            </Step>

            {/* ── Steg 2: Publik sida ─────────────────────────────────────── */}
            <Step active={step === 1}>
              <label className="mx-label">
                Välkomstrubrik
                <input
                  type="text"
                  name="welcome_title"
                  defaultValue={mod.welcome_title || ''}
                  className="mx-input"
                  style={{ marginTop: 4 }}
                  placeholder="Visas stort på publika sidan"
                />
              </label>
              <label className="mx-label">
                Välkomsttext (ingress)
                <textarea
                  name="welcome_body"
                  defaultValue={mod.welcome_body || ''}
                  className="mx-textarea"
                  style={{ marginTop: 4, minHeight: 60 }}
                />
              </label>

              <div className="mx-label">
                Omslagsbild
                <div
                  style={{
                    marginTop: 6,
                    display: 'grid',
                    gap: 10,
                    padding: 12,
                    borderRadius: 12,
                    background: 'var(--mx-paper-2)',
                    border: '1px solid var(--mx-line-soft)'
                  }}
                >
                  {heroImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={heroImageUrl}
                      alt="Nuvarande omslagsbild"
                      style={{
                        width: '100%',
                        maxHeight: 160,
                        objectFit: 'cover',
                        borderRadius: 10,
                        border: '1px solid var(--mx-line)'
                      }}
                    />
                  ) : (
                    <div className="mx-muted mx-t-12">
                      Ingen bild — en branded gradient visas i stället.
                    </div>
                  )}
                  <input
                    type="file"
                    name="hero_image"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    className="mx-t-13"
                  />
                  <span className="mx-t-12 mx-muted">
                    PNG, JPG, WebP, GIF eller SVG. Max 15 MB. Ladda inte upp bilder med
                    personuppgifter — bilden serveras publikt.
                  </span>
                  {heroImageUrl && (
                    <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer' }}>
                      <input type="checkbox" name="remove_hero_image" />
                      <span>Ta bort nuvarande bild</span>
                    </label>
                  )}
                </div>
              </div>

              <Advanced label="Visa fler inställningar">
                <label className="mx-label">
                  Eyebrow (liten text ovanför rubriken)
                  <input
                    type="text"
                    name="hero_eyebrow"
                    defaultValue={mod.hero_eyebrow || ''}
                    className="mx-input"
                    style={{ marginTop: 4 }}
                    placeholder="STARTUPKOMPASSEN"
                  />
                </label>
                <label className="mx-label">
                  Tema-färg
                  <input
                    type="text"
                    name="theme_color"
                    defaultValue={mod.theme_color || ''}
                    className="mx-input"
                    style={{ marginTop: 4 }}
                    placeholder="#002c40"
                  />
                </label>
              </Advanced>
            </Step>

            {/* ── Steg 3: Flöde & innehåll ────────────────────────────────── */}
            <Step active={step === 2}>
              {flowType === 'chat' ? (
                <>
                  <label className="mx-label">
                    AI-modell
                    <select
                      name="model"
                      defaultValue={mod.model || 'mistral-large-latest'}
                      className="mx-input"
                      style={{ marginTop: 4 }}
                    >
                      {modelOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="mx-label">
                    System-prompt (styr hur AI:n beter sig)
                    <textarea
                      name="system_prompt"
                      defaultValue={mod.system_prompt || ''}
                      className="mx-textarea"
                      style={{ marginTop: 4, minHeight: 110, fontFamily: 'var(--mx-mono)' }}
                      placeholder="Lämna tom för standard-prompten."
                    />
                  </label>
                  <Advanced label="Visa fler inställningar">
                    <label className="mx-label">
                      Assistent-namn
                      <input
                        type="text"
                        name="chat_persona"
                        defaultValue={mod.chat_persona || ''}
                        className="mx-input"
                        style={{ marginTop: 4 }}
                        placeholder="t.ex. Movexums AI-rådgivare"
                      />
                    </label>
                    <label className="mx-label">
                      Max antal AI-utbyten (0 = obegränsat)
                      <input
                        type="number"
                        name="max_exchanges"
                        defaultValue={mod.max_exchanges ?? 0}
                        min={0}
                        max={100}
                        className="mx-input"
                        style={{ marginTop: 4 }}
                      />
                    </label>
                    <label className="mx-label">
                      Intro-meddelande (visas högst upp)
                      <textarea
                        name="intro_message"
                        defaultValue={mod.intro_message || ''}
                        className="mx-textarea"
                        style={{ marginTop: 4, minHeight: 50 }}
                      />
                    </label>
                  </Advanced>
                </>
              ) : (
                <>
                  <div className="mx-t-13 mx-muted" style={{ lineHeight: 1.5 }}>
                    Själva frågorna redigerar du i <strong>Frågor</strong>-sektionen under
                    inställningarna. Här styr du bara vilka kontaktuppgifter som krävs
                    {flowType === 'quiz' ? ' och resultatprofilerna' : ''}.
                  </div>
                  <div className="mx-flex mx-items-c mx-gap-3 mx-wrap">
                    <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer' }}>
                      <input type="checkbox" name="require_email" defaultChecked={!!mod.require_email} />
                      <span>E-post obligatoriskt</span>
                    </label>
                    <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer' }}>
                      <input type="checkbox" name="require_phone" defaultChecked={!!mod.require_phone} />
                      <span>Telefon obligatoriskt</span>
                    </label>
                    <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer' }}>
                      <input type="checkbox" name="require_organization" defaultChecked={!!mod.require_organization} />
                      <span>Organisation obligatoriskt</span>
                    </label>
                  </div>
                  {flowType === 'quiz' && <ResultBucketsEditor initial={mod.result_buckets ?? []} />}
                  <Advanced label="Visa fler inställningar">
                    <label className="mx-label">
                      Intro-meddelande (visas högst upp)
                      <textarea
                        name="intro_message"
                        defaultValue={mod.intro_message || ''}
                        className="mx-textarea"
                        style={{ marginTop: 4, minHeight: 50 }}
                      />
                    </label>
                  </Advanced>
                </>
              )}

              {/* Behåll chat-fälten monterade även för icke-chat så ett byte av
                  flow-typ inte tappar sparade värden vid submit. */}
              {flowType !== 'chat' && (
                <div style={{ display: 'none' }} aria-hidden>
                  <select name="model" defaultValue={mod.model || 'mistral-large-latest'}>
                    {modelOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <input type="number" name="max_exchanges" defaultValue={mod.max_exchanges ?? 0} />
                  <input type="text" name="chat_persona" defaultValue={mod.chat_persona || ''} />
                  <textarea name="system_prompt" defaultValue={mod.system_prompt || ''} />
                </div>
              )}
            </Step>

            {/* ── Steg 4: Efter & nästa steg ──────────────────────────────── */}
            <Step active={step === 3}>
              <label className="mx-label">
                Tack-meddelande (visas efter slutfört)
                <textarea
                  name="success_message"
                  defaultValue={mod.success_message || ''}
                  className="mx-textarea"
                  style={{ marginTop: 4, minHeight: 50 }}
                  placeholder="t.ex. Tack! Vi hör av oss inom 3 arbetsdagar."
                />
              </label>

              <label className="mx-label">
                Koppla en nästa modul (kedja)
                <select
                  name="next_module"
                  defaultValue={mod.next_module || ''}
                  className="mx-input"
                  style={{ marginTop: 4 }}
                >
                  <option value="">Ingen — avsluta flödet här</option>
                  {otherModules.map((m) => {
                    const linkable = m.is_active && m.public_url_enabled && m.public_slug;
                    return (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {linkable ? '' : ' (ej publik ännu)'}
                      </option>
                    );
                  })}
                </select>
                <span className="mx-t-12 mx-muted" style={{ display: 'block', marginTop: 4 }}>
                  När besökaren slutfört den här modulen erbjuds hen att fortsätta direkt
                  till nästa. Bygg t.ex. quiz → formulär → AI-chatt. Nästa modul måste vara{' '}
                  <strong>aktiv + publik</strong> för att knappen ska visas.
                </span>
              </label>

              <Advanced label="Visa fler inställningar">
                <label className="mx-label">
                  Redirect-URL (skickas vidare efter inskickning)
                  <input
                    type="url"
                    name="redirect_url"
                    defaultValue={mod.redirect_url || ''}
                    className="mx-input"
                    style={{ marginTop: 4 }}
                    placeholder="https://..."
                  />
                  <span className="mx-t-12 mx-muted" style={{ display: 'block', marginTop: 4 }}>
                    Om både redirect-URL och nästa modul är satta vinner redirect-URL:en.
                  </span>
                </label>
                <label className="mx-label">
                  Notifiera inflöde till (e-post)
                  <input
                    type="text"
                    name="notify_emails"
                    defaultValue={mod.notify_emails || ''}
                    className="mx-input"
                    style={{ marginTop: 4 }}
                    placeholder="inflode@movexum.se, namn@movexum.se"
                  />
                </label>
                <label className="mx-label">
                  Samtyckesnotis (GDPR)
                  <textarea
                    name="consent_note"
                    defaultValue={mod.consent_note || ''}
                    className="mx-textarea"
                    style={{ marginTop: 4, minHeight: 50 }}
                    placeholder="Du samtycker till att Movexum kontaktar dig och lagrar dina uppgifter inom EU…"
                  />
                </label>
              </Advanced>
            </Step>

            {state.error && (
              <div
                role="alert"
                className="mx-t-13"
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid var(--mx-movexum-morkorange)',
                  background: 'var(--mx-movexum-pastell-orange)',
                  color: 'var(--mx-movexum-morkorange)'
                }}
              >
                {state.error}
              </div>
            )}
            {state.warning && (
              <div
                role="alert"
                className="mx-t-13"
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid var(--mx-movexum-morkgul)',
                  background: 'var(--mx-movexum-pastell-gul)',
                  color: 'var(--mx-movexum-morkgul)'
                }}
              >
                {state.warning}
              </div>
            )}
          </div>

          {/* Fot — Föregående / Nästa / Spara */}
          <div
            className="mx-flex mx-items-c mx-gap-2"
            style={{
              padding: '14px 18px',
              borderTop: '1px solid var(--mx-line-soft)',
              justifyContent: 'space-between'
            }}
          >
            <button
              type="button"
              className="mx-btn"
              disabled={step === 0 || pending}
              onClick={() => goto(step - 1)}
            >
              ← Föregående
            </button>
            <div className="mx-flex mx-items-c mx-gap-2">
              {!isLast ? (
                <button type="button" className="mx-btn mx-primary" onClick={() => goto(step + 1)}>
                  Nästa →
                </button>
              ) : (
                <button type="submit" className="mx-btn mx-primary" disabled={pending}>
                  <Icon name="check" size={13} /> {pending ? 'Sparar…' : 'Spara modul'}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Step({ active, children }: { active: boolean; children: React.ReactNode }) {
  // Inaktiva steg göms men ligger kvar i DOM:en så submit postar alla fält.
  return <div style={{ display: active ? 'grid' : 'none', gap: 12 }}>{children}</div>;
}

// Hopfällbart block för sällan ändrade fält. Behåller barnen MONTERADE
// (display:none när hopfällt) så deras värden alltid postas vid submit.
function Advanced({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 4 }}>
      <button
        type="button"
        className="mx-btn mx-sm mx-ghost"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? '▾' : '▸'} {label}
      </button>
      <div style={{ display: open ? 'grid' : 'none', gap: 12, marginTop: 10 }}>{children}</div>
    </div>
  );
}
