'use client';

import { useState } from 'react';
import { Icon } from '@/components/proto';
import { updateModuleAction } from '@/lib/actions/compass';
import { QuestionsManager } from './QuestionsManager';
import { ResultBucketsEditor } from './ResultBucketsEditor';
import { HeroMediaUploader } from './HeroMediaUploader';
import type { CompassModule, CompassQuestion, FlowType } from '@/lib/compass/types';

const FORM_ID = 'compass-module-form';

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
  heroImageUrl: string | null;
  heroVideoUrl: string | null;
  modelOptions: ModelOption[];
  otherModules: OtherModule[];
  events: EventOption[];
  questions: CompassQuestion[];
}

/**
 * Stegvis modul-editor: ETT steg synligt i taget — inklusive frågorna, som
 * har ett eget steg. Alla formulärfält ligger kvar i DOM:en (dolda steg får
 * display:none) så en enda Spara postar allt till updateModuleAction.
 * Frågor sparas direkt per fråga (egna server actions) och media laddas upp
 * direkt vid val (route handler) — de behöver ingen Spara.
 */
export function ModuleEditor({
  module: mod,
  heroImageUrl,
  heroVideoUrl,
  modelOptions,
  otherModules,
  events,
  questions
}: Props) {
  const [step, setStep] = useState(0);
  const [flowType, setFlowType] = useState<FlowType>(mod.flow_type);

  const steps = [
    { key: 'basics', label: 'Grunder' },
    { key: 'landing', label: 'Landningssida' },
    { key: 'questions', label: flowType === 'chat' ? 'Samtal & frågor' : 'Frågor' },
    { key: 'audience', label: 'Målgrupp & uppgifter' },
    { key: 'finish', label: 'Efter slutförande' }
  ];
  const isLast = step === steps.length - 1;

  return (
    <div style={{ display: 'grid' }}>
      {/* Steg-navigering */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${steps.length}, 1fr)`,
          gap: 8,
          padding: 16,
          borderBottom: '1px solid var(--mx-line-soft)'
        }}
      >
        {steps.map((s, i) => {
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
                    flexShrink: 0,
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
            </button>
          );
        })}
      </div>

      <div style={{ padding: 16, display: 'grid', gap: 12 }}>
        <form id={FORM_ID} action={updateModuleAction} style={{ display: 'grid', gap: 12 }}>
          <input type="hidden" name="id" value={mod.id} />

          {/* ── Steg 1: Grunder ─────────────────────────────────────────── */}
          <Step active={step === 0}>
            <label className="mx-label">
              Namn
              <input
                type="text"
                name="name"
                defaultValue={mod.name}
                required
                className="mx-input"
                style={{ marginTop: 4 }}
              />
            </label>

            <div>
              <div className="mx-label" style={{ marginBottom: 6 }}>
                Typ av modul
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                <FlowOption
                  value="wizard"
                  title="Formulär"
                  desc="Fasta frågor i ordning"
                  current={flowType}
                  onSelect={setFlowType}
                />
                <FlowOption
                  value="quiz"
                  title="Quiz"
                  desc="Frågor med poäng och resultat"
                  current={flowType}
                  onSelect={setFlowType}
                />
                <FlowOption
                  value="chat"
                  title="AI-chatt"
                  desc="Ett samtal som ställer frågorna"
                  current={flowType}
                  onSelect={setFlowType}
                />
              </div>
            </div>

            <label className="mx-label">
              Intern beskrivning
              <textarea
                name="description"
                defaultValue={mod.description || ''}
                className="mx-textarea"
                style={{ marginTop: 4, minHeight: 60 }}
                placeholder="Visas bara för er — inte för besökaren."
              />
            </label>
          </Step>

          {/* ── Steg 2: Landningssida ───────────────────────────────────── */}
          <Step active={step === 1}>
            <div className="mx-muted mx-t-13">Det här är det första besökaren ser.</div>
            <label className="mx-label">
              Rubrik
              <input
                type="text"
                name="welcome_title"
                defaultValue={mod.welcome_title || ''}
                className="mx-input"
                style={{ marginTop: 4 }}
                placeholder={mod.name}
              />
            </label>
            <label className="mx-label">
              Beskrivning (visas under rubriken)
              <textarea
                name="welcome_body"
                defaultValue={mod.welcome_body || ''}
                className="mx-textarea"
                style={{ marginTop: 4, minHeight: 60 }}
              />
            </label>

            <div className="mx-label">
              Bild eller video (visas överst — går att ha båda; då spelas videon
              med bilden som startbild)
              <div style={{ marginTop: 6 }}>
                <HeroMediaUploader
                  moduleId={mod.id}
                  initialImageUrl={heroImageUrl}
                  initialVideoUrl={heroVideoUrl}
                />
              </div>
            </div>

            <details>
              <summary className="mx-t-13" style={{ cursor: 'pointer' }}>
                Fler alternativ
              </summary>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
                <label className="mx-label">
                  Liten text ovanför rubriken
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
                  Accentfärg (hex)
                  <input
                    type="text"
                    name="theme_color"
                    defaultValue={mod.theme_color || ''}
                    className="mx-input"
                    style={{ marginTop: 4 }}
                    placeholder="#002c40"
                  />
                </label>
              </div>
            </details>
          </Step>

          {/* ── Steg 3: Samtalsinställningar (bara AI-chatt) ────────────── */}
          {/* Fälten ligger alltid i DOM:en så ett typbyte inte tappar värden. */}
          <div
            style={{
              display: step === 2 && flowType === 'chat' ? 'grid' : 'none',
              gap: 12
            }}
            aria-hidden={!(step === 2 && flowType === 'chat')}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label className="mx-label">
                Assistentens namn
                <input
                  type="text"
                  name="chat_persona"
                  defaultValue={mod.chat_persona || ''}
                  className="mx-input"
                  style={{ marginTop: 4 }}
                  placeholder="t.ex. Movexums rådgivare"
                />
              </label>
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
            </div>
            <label className="mx-label">
              Max antal utbyten (0 = obegränsat)
              <input
                type="number"
                name="max_exchanges"
                defaultValue={mod.max_exchanges ?? 0}
                min={0}
                max={100}
                className="mx-input"
                style={{ marginTop: 4, maxWidth: 200 }}
              />
            </label>
            <details>
              <summary className="mx-t-13" style={{ cursor: 'pointer' }}>
                Egen systemprompt (valfri)
              </summary>
              <textarea
                name="system_prompt"
                defaultValue={mod.system_prompt || ''}
                className="mx-textarea"
                style={{ marginTop: 8, minHeight: 100, fontFamily: 'var(--mx-mono)', width: '100%' }}
                placeholder="Lämna tom för standardbeteendet."
              />
            </details>
          </div>

          {/* ── Steg 4: Målgrupp & uppgifter ────────────────────────────── */}
          <Step active={step === 3}>
            <label className="mx-label">
              Målgrupp
              <input
                type="text"
                name="target_audience"
                defaultValue={mod.target_audience || ''}
                className="mx-input"
                style={{ marginTop: 4 }}
                placeholder="Vem är modulen till för? Visas på landningssidan."
              />
            </label>
            <label className="mx-label">
              Text ovanför frågorna (valfri)
              <textarea
                name="intro_message"
                defaultValue={mod.intro_message || ''}
                className="mx-textarea"
                style={{ marginTop: 4, minHeight: 50 }}
              />
            </label>

            <div className="mx-label">
              Obligatoriska uppgifter från besökaren
              <div className="mx-flex mx-items-c mx-gap-3 mx-wrap" style={{ marginTop: 6 }}>
                <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" name="require_email" defaultChecked={!!mod.require_email} />
                  <span>E-post</span>
                </label>
                <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" name="require_phone" defaultChecked={!!mod.require_phone} />
                  <span>Telefon</span>
                </label>
                <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    name="require_organization"
                    defaultChecked={!!mod.require_organization}
                  />
                  <span>Organisation</span>
                </label>
              </div>
            </div>

            <label className="mx-label">
              Samtyckestext (GDPR)
              <textarea
                name="consent_note"
                defaultValue={mod.consent_note || ''}
                className="mx-textarea"
                style={{ marginTop: 4, minHeight: 50 }}
                placeholder="Du samtycker till att Movexum kontaktar dig och lagrar dina uppgifter inom EU."
              />
            </label>
          </Step>

          {/* ── Steg 5: Efter slutförande ───────────────────────────────── */}
          <Step active={step === 4}>
            <label className="mx-label">
              Tack-meddelande
              <textarea
                name="success_message"
                defaultValue={mod.success_message || ''}
                className="mx-textarea"
                style={{ marginTop: 4, minHeight: 50 }}
                placeholder="t.ex. Tack! Vi hör av oss inom 3 arbetsdagar."
              />
            </label>

            <label className="mx-label">
              Fortsätt till modul (kedja)
              <select
                name="next_module"
                defaultValue={mod.next_module || ''}
                className="mx-input"
                style={{ marginTop: 4 }}
              >
                <option value="">Ingen — avsluta här</option>
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
                Besökaren erbjuds att fortsätta dit när den här modulen är klar.
              </span>
            </label>

            <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer' }}>
              <input type="checkbox" name="create_lead" defaultChecked={mod.create_lead !== false} />
              <span>Skapa lead under Leads när modulen slutförs</span>
            </label>

            <label className="mx-label">
              Mejla nya inflöden till (valfri)
              <input
                type="text"
                name="notify_emails"
                defaultValue={mod.notify_emails || ''}
                className="mx-input"
                style={{ marginTop: 4 }}
                placeholder="inflode@movexum.se, namn@movexum.se"
              />
            </label>

            <details>
              <summary className="mx-t-13" style={{ cursor: 'pointer' }}>
                Fler alternativ
              </summary>
              <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
                <label className="mx-label">
                  Kopplat event / aktivitet
                  <select
                    name="linked_event"
                    defaultValue={mod.linked_event || ''}
                    className="mx-input"
                    style={{ marginTop: 4 }}
                  >
                    <option value="">Inget</option>
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
                </label>
                <label className="mx-label">
                  Skicka vidare till URL efter inskick (vinner över kedjan)
                  <input
                    type="url"
                    name="redirect_url"
                    defaultValue={mod.redirect_url || ''}
                    className="mx-input"
                    style={{ marginTop: 4 }}
                    placeholder="https://..."
                  />
                </label>
              </div>
            </details>

            {/* Publicering */}
            <div
              style={{
                padding: 12,
                borderRadius: 12,
                background: 'var(--mx-paper-2)',
                border: '1px solid var(--mx-line-soft)',
                display: 'grid',
                gap: 8
              }}
            >
              <div className="mx-fw-6 mx-t-13">Publicering</div>
              <label className="mx-label">
                Publik länk — modulen nås på /m/[länk]
                <input
                  type="text"
                  name="public_slug"
                  defaultValue={mod.public_slug || ''}
                  className="mx-input"
                  style={{ marginTop: 4, fontFamily: 'var(--mx-mono)' }}
                  placeholder="t.ex. ar-du-entreprenor"
                />
              </label>
              <div className="mx-flex mx-items-c mx-gap-3 mx-wrap">
                <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" name="is_active" defaultChecked={!!mod.is_active} />
                  <span>Aktiv</span>
                </label>
                <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    name="public_url_enabled"
                    defaultChecked={!!mod.public_url_enabled}
                  />
                  <span>Publicerad publikt (kräver Aktiv)</span>
                </label>
              </div>
              <span className="mx-t-12 mx-muted">
                Länken fungerar när båda är ibockade och du har sparat.
              </span>
            </div>
          </Step>
        </form>

        {/* ── Steg 3: Frågor (utanför formuläret — sparas direkt per fråga) ── */}
        <div style={{ display: step === 2 ? 'grid' : 'none', gap: 16 }}>
          {flowType === 'quiz' && (
            <>
              <ResultBucketsEditor initial={mod.result_buckets ?? []} formId={FORM_ID} />
              <div className="mx-muted mx-t-12">
                Resultatprofilerna sparas med <strong>Spara</strong>-knappen nedan.
                Frågorna sparas direkt, en i taget.
              </div>
            </>
          )}
          <QuestionsManager
            moduleId={mod.id}
            moduleSlug={mod.slug}
            flowType={flowType}
            initialQuestions={questions}
            resultBuckets={mod.result_buckets ?? []}
          />
        </div>
      </div>

      {/* Fot — steg-navigering + spara */}
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
          <button type="submit" form={FORM_ID} className="mx-btn">
            <Icon name="check" size={13} /> Spara
          </button>
          {!isLast ? (
            <button
              type="button"
              className="mx-btn mx-primary"
              onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
            >
              Nästa →
            </button>
          ) : (
            <button type="submit" form={FORM_ID} className="mx-btn mx-primary">
              <Icon name="check" size={13} /> Spara & klart
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Step({ active, children }: { active: boolean; children: React.ReactNode }) {
  // Inaktiva steg döljs men ligger kvar i DOM:en så submit postar alla fält.
  return <div style={{ display: active ? 'grid' : 'none', gap: 12 }}>{children}</div>;
}

function FlowOption({
  value,
  title,
  desc,
  current,
  onSelect
}: {
  value: FlowType;
  title: string;
  desc: string;
  current: FlowType;
  onSelect: (v: FlowType) => void;
}) {
  const active = current === value;
  return (
    <label
      style={{
        padding: 10,
        borderRadius: 12,
        border: `1px solid ${active ? '#002c40' : 'var(--mx-line)'}`,
        background: active ? 'var(--mx-cyan-tint-2)' : 'var(--mx-paper)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8
      }}
    >
      <input
        type="radio"
        name="flow_type"
        value={value}
        checked={active}
        onChange={() => onSelect(value)}
        style={{ accentColor: '#002c40', marginTop: 3 }}
      />
      <span>
        <span className="mx-fw-6 mx-t-13" style={{ display: 'block' }}>
          {title}
        </span>
        <span className="mx-t-12 mx-muted" style={{ display: 'block', lineHeight: 1.4 }}>
          {desc}
        </span>
      </span>
    </label>
  );
}
