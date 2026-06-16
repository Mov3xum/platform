'use client';

import { useState } from 'react';
import { Icon } from '@/components/proto';
import { updateModuleAction } from '@/lib/actions/compass';
import { ResultBucketsEditor } from './ResultBucketsEditor';
import type { CompassModule, FlowType } from '@/lib/compass/types';

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

interface EventOption {
  id: string;
  name: string;
  starts_at?: string;
}

interface Props {
  module: CompassModule;
  heroImageUrl?: string | null;
  modelOptions: ModelOption[];
  /** Övriga moduler i tenanten (för "nästa modul"-kedjan). */
  otherModules: OtherModule[];
  /** Tenantens event/aktiviteter (för modulens event-koppling). */
  events: EventOption[];
}

const STEPS = [
  { key: 'basics', label: 'Grunder', hint: 'Namn, typ och publik länk' },
  { key: 'public', label: 'Publik sida', hint: 'Rubrik, text och omslag' },
  { key: 'flow', label: 'Flöde & innehåll', hint: 'AI, frågor och fält' },
  { key: 'after', label: 'Efter & nästa steg', hint: 'Tack, kedja och GDPR' }
] as const;

// Stegindelat redigeringsformulär för en Startupkompass-modul. Hela formuläret
// ligger kvar i DOM:en (inaktiva steg döljs med display:none) så en enda
// submit postar ALLA fält till updateModuleAction — stegen är bara en visuell
// uppdelning för att slippa en överväldigande vägg av inputs.
export function ModuleSettingsForm({ module: mod, heroImageUrl, modelOptions, otherModules, events }: Props) {
  const [step, setStep] = useState(0);
  const [flowType, setFlowType] = useState<FlowType>(mod.flow_type);
  const isLast = step === STEPS.length - 1;

  return (
    <form action={updateModuleAction} style={{ display: 'grid' }}>
      <input type="hidden" name="id" value={mod.id} />

      {/* Steg-navigering */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${STEPS.length}, 1fr)`,
          gap: 8,
          padding: 16,
          borderBottom: '1px solid var(--mx-line-soft)'
        }}
      >
        {STEPS.map((s, i) => {
          const active = i === step;
          const done = i < step;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setStep(i)}
              className="mx-t-13"
              style={{
                textAlign: 'left',
                padding: '8px 10px',
                borderRadius: 10,
                border: `1px solid ${active ? '#002c40' : 'var(--mx-line)'}`,
                background: active ? 'var(--mx-cyan-tint-2)' : 'var(--mx-paper)',
                cursor: 'pointer'
              }}
            >
              <div className="mx-flex mx-items-c mx-gap-2">
                <span
                  className="mx-mono mx-fw-6"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 20,
                    height: 20,
                    borderRadius: 99,
                    fontSize: 11,
                    background: active || done ? '#002c40' : 'var(--mx-line-soft)',
                    color: active || done ? '#fff' : 'var(--mx-ink-soft)'
                  }}
                >
                  {done ? '✓' : i + 1}
                </span>
                <span className="mx-fw-6" style={{ color: active ? '#002c40' : 'inherit' }}>
                  {s.label}
                </span>
              </div>
              <div className="mx-t-12 mx-muted mx-truncate" style={{ marginTop: 2 }}>
                {s.hint}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ padding: 16, display: 'grid', gap: 12 }}>
        {/* ── Steg 1: Grunder ─────────────────────────────────────────────── */}
        <Step active={step === 0}>
          <label className="mx-label">
            Namn
            <input type="text" name="name" defaultValue={mod.name} required className="mx-input" style={{ marginTop: 4 }} />
          </label>
          <label className="mx-label">
            Beskrivning
            <textarea
              name="description"
              defaultValue={mod.description || ''}
              className="mx-textarea"
              style={{ marginTop: 4, minHeight: 60 }}
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
          <label className="mx-label">
            Flow-typ
            <select
              name="flow_type"
              value={flowType}
              onChange={(e) => setFlowType(e.target.value as FlowType)}
              className="mx-input"
              style={{ marginTop: 4 }}
            >
              <option value="chat">AI-chatt</option>
              <option value="wizard">Formulär</option>
              <option value="quiz">Quiz</option>
            </select>
          </label>
          <label className="mx-label">
            Publik länk (slug) — modulen blir svarbar på <code>/m/[slug]</code>
            <input
              type="text"
              name="public_slug"
              defaultValue={mod.public_slug || ''}
              className="mx-input"
              style={{ marginTop: 4, fontFamily: 'var(--mx-mono)' }}
              placeholder="t.ex. ar-du-entreprenor (globalt unik)"
            />
          </label>
          <div className="mx-flex mx-items-c mx-gap-3 mx-wrap">
            <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer' }}>
              <input type="checkbox" name="is_active" defaultChecked={!!mod.is_active} />
              <span>Aktiv (synlig på översikten)</span>
            </label>
            <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer' }}>
              <input type="checkbox" name="public_url_enabled" defaultChecked={!!mod.public_url_enabled} />
              <span>Markera som publik URL (för delning)</span>
            </label>
          </div>
        </Step>

        {/* ── Steg 2: Publik sida ─────────────────────────────────────────── */}
        <Step active={step === 1}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
          </div>
          <label className="mx-label">
            Välkomsttext (ingress på publika sidan)
            <textarea
              name="welcome_body"
              defaultValue={mod.welcome_body || ''}
              className="mx-textarea"
              style={{ marginTop: 4, minHeight: 50 }}
            />
          </label>

          <div className="mx-label">
            Omslagsbild (visas högst upp på den publika landningssidan)
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
                    maxHeight: 180,
                    objectFit: 'cover',
                    borderRadius: 10,
                    border: '1px solid var(--mx-line)'
                  }}
                />
              ) : (
                <div className="mx-muted mx-t-12">
                  Ingen bild uppladdad — den publika sidan visar rubriken utan omslag.
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

          <label className="mx-label">
            Tema-färg (frivillig)
            <input
              type="text"
              name="theme_color"
              defaultValue={mod.theme_color || ''}
              className="mx-input"
              style={{ marginTop: 4 }}
              placeholder="#002c40"
            />
          </label>
        </Step>

        {/* ── Steg 3: Flöde & innehåll ────────────────────────────────────── */}
        <Step active={step === 2}>
          <label className="mx-label">
            Intro-meddelande (visas högst upp på modul-sidan)
            <textarea
              name="intro_message"
              defaultValue={mod.intro_message || ''}
              className="mx-textarea"
              style={{ marginTop: 4, minHeight: 50 }}
            />
          </label>

          {flowType === 'chat' ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
              </div>
              <label className="mx-label">
                Assistent-namn (AI-chatt)
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
                System-prompt (för AI-chat-flöden)
                <textarea
                  name="system_prompt"
                  defaultValue={mod.system_prompt || ''}
                  className="mx-textarea"
                  style={{ marginTop: 4, minHeight: 120, fontFamily: 'var(--mx-mono)' }}
                  placeholder="Lämna tom för standard-prompten. Skriv egen om du vill att AI:n ska bete sig annorlunda — t.ex. för en specifik kohort."
                />
              </label>
            </>
          ) : (
            // Behåll modell/persona/prompt-fälten i DOM:en även för icke-chat så
            // ett byte av flow-typ inte tappar ev. sparade värden vid submit.
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
        </Step>

        {/* ── Steg 4: Efter & nästa steg ──────────────────────────────────── */}
        <Step active={step === 3}>
          <div
            style={{
              padding: 12,
              borderRadius: 12,
              background: 'var(--mx-paper-2)',
              border: '1px solid var(--mx-line-soft)',
              display: 'grid',
              gap: 6
            }}
          >
            <label className="mx-flex mx-items-c mx-gap-2 mx-t-13 mx-fw-6" style={{ cursor: 'pointer' }}>
              <input type="checkbox" name="create_lead" defaultChecked={mod.create_lead !== false} />
              <span>Skapa lead i Startupkompassen när modulen slutförs</span>
            </label>
            <span className="mx-t-12 mx-muted" style={{ lineHeight: 1.5 }}>
              Ikryssad: varje slutförd körning skapar garanterat ett lead under{' '}
              <strong>Leads</strong> (med AI-sammanställning av svaren) — kan
              leadet inte sparas visas ett fel för besökaren i stället för att
              svaren tyst tappas. Avkryssad: inga leads skapas av modulen.
            </span>
          </div>

          <label className="mx-label">
            Tack-meddelande (efter inskickat)
            <textarea
              name="success_message"
              defaultValue={mod.success_message || ''}
              className="mx-textarea"
              style={{ marginTop: 4, minHeight: 50 }}
              placeholder="t.ex. Tack! Vi hör av oss inom 3 arbetsdagar."
            />
          </label>

          <label className="mx-label">
            Nästa modul (kedja)
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
              När besökaren slutfört den här modulen erbjuds hen att fortsätta
              direkt till nästa modul. Bygg t.ex. ett quiz → ett formulär → en
              AI-chatt i följd. Nästa modul måste vara <strong>aktiv + publik</strong>
              {' '}för att knappen ska visas.
            </span>
          </label>

          <label className="mx-label">
            Kopplat event / aktivitet
            <select
              name="linked_event"
              defaultValue={mod.linked_event || ''}
              className="mx-input"
              style={{ marginTop: 4 }}
            >
              <option value="">Ingen — modulen är inte kopplad till ett event</option>
              {events.map((e) => {
                const date = e.starts_at ? e.starts_at.slice(0, 10) : '';
                return (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {date ? ` (${date})` : ''}
                  </option>
                );
              })}
            </select>
            <span className="mx-t-12 mx-muted" style={{ display: 'block', marginTop: 4 }}>
              Koppla modulen till ett event/aktivitet i CRM:t (under{' '}
              <strong>Aktiviteter</strong>) — t.ex. en intag-modul för en
              pitch-kväll eller informationsträff. Kopplingen är en referens som
              hjälper dig hålla ihop modulen med rätt aktivitet.
              {events.length === 0 && ' Inga event finns ännu — skapa ett under Aktiviteter först.'}
            </span>
          </label>

          <label className="mx-label">
            Redirect-URL (frivillig — leadet skickas vidare efter inskickning)
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
            <span className="mx-t-12 mx-muted" style={{ display: 'block', marginTop: 4 }}>
              En eller flera adresser (kommaseparerade) som får ett mejl när ett
              nytt inflöde kommer in. Lämna tom för att använda standardadressen
              (<code className="mx-mono">MOVEXUM_INFLOW_EMAIL</code>).
            </span>
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
        </Step>
      </div>

      {/* Fot — steg-navigering + spara (submitar hela formuläret) */}
      <div
        className="mx-flex mx-items-c mx-gap-2"
        style={{
          padding: 16,
          borderTop: '1px solid var(--mx-line-soft)',
          justifyContent: 'space-between'
        }}
      >
        <button
          type="button"
          className="mx-btn"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          ← Föregående
        </button>
        <div className="mx-flex mx-items-c mx-gap-2">
          {!isLast && (
            <button
              type="button"
              className="mx-btn"
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
            >
              Nästa →
            </button>
          )}
          <button type="submit" className="mx-btn mx-primary">
            <Icon name="check" size={13} /> Spara
          </button>
        </div>
      </div>
    </form>
  );
}

function Step({ active, children }: { active: boolean; children: React.ReactNode }) {
  // Inaktiva steg döljs men ligger kvar i DOM:en så submit postar alla fält.
  return <div style={{ display: active ? 'grid' : 'none', gap: 12 }}>{children}</div>;
}
