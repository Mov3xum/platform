'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/proto';
import { updateModuleAction } from '@/lib/actions/compass';
import { QuestionsManager } from './QuestionsManager';
import { ResultBucketsEditor } from './ResultBucketsEditor';
import { HeroMediaUploader } from './HeroMediaUploader';
import { LayoutPicker } from './LayoutPicker';
import { COMPASS_LAYOUT_META, normalizeCompassLayout,
  COMPASS_PURPOSES,
  COMPASS_PURPOSE_LABELS,
  SURVEY_SUBJECT_KINDS,
  SURVEY_SUBJECT_KIND_LABELS,
  normalizeCompassPurpose,
  type CompassPurpose,
  CONTACT_FIELD_KEYS,
  CONTACT_FIELD_META,
  CONTACT_FIELD_MODES,
  CONTACT_FIELD_MODE_LABEL,
  contactSectionForModule
} from '@platform/shared';
import type { CompassLayout } from '@platform/shared';
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

interface SaveNotice {
  kind: 'ok' | 'error';
  text: string;
}

const SAVED_TEXT = {
  saved: 'Sparat',
  published: 'Publicerad — den publika länken fungerar nu',
  unpublished: 'Avpublicerad — den publika länken är stängd'
} as const;

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
 *
 * Spara stannar på samma steg och visar en "Sparat"-ruta (actionen
 * returnerar utfallet, ingen redirect). Publicering sker BARA via knappen
 * Publicera på sista steget.
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
  // Ett fält, två roller: chattens egna systemprompt och quizets
  // bedömningsinstruktion för fritextsvar (§ 23.14). Kontrollerat så ett
  // typbyte aldrig tappar texten; skickas via ett dolt fält i formuläret.
  const [systemPrompt, setSystemPrompt] = useState(mod.system_prompt || '');
  const [purpose, setPurpose] = useState<CompassPurpose>(normalizeCompassPurpose(mod.purpose));
  const [layout, setLayout] = useState<CompassLayout>(() => normalizeCompassLayout(mod.layout));
  const layoutMeta = COMPASS_LAYOUT_META[layout];
  // Avsnittet "Dina uppgifter" (§ 23.11) — lagrad konfiguration eller legacy.
  const contactSection = contactSectionForModule(mod);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingIntent, setPendingIntent] = useState<string | null>(null);
  const [notice, setNotice] = useState<SaveNotice | null>(null);
  // Kontrollerade så att Publicera/Avpublicera syns i rutorna direkt — annars
  // skulle nästa vanliga Spara posta de gamla värdena och ångra publiceringen.
  const [isActive, setIsActive] = useState(!!mod.is_active);
  const [publicEnabled, setPublicEnabled] = useState(!!mod.public_url_enabled);
  const isPublished = Boolean(mod.is_active && mod.public_url_enabled);

  // "Sparat"-rutan försvinner av sig själv; fel står kvar tills de stängs.
  useEffect(() => {
    if (notice?.kind !== 'ok') return;
    const t = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(t);
  }, [notice]);

  // Submit via transition så knapparna kan visa pending-läge trots att de
  // ligger UTANFÖR <form> (form-attributet; useFormStatus når dem inte).
  // Knappens name/value (intent) skickas med explicit — FormData(form,
  // submitter) stöds inte i alla webbläsare.
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const intent = submitter?.value || 'save';
    const fd = new FormData(form);
    fd.set('intent', intent);
    setPendingIntent(intent);
    setNotice(null);
    startTransition(async () => {
      try {
        const res = await updateModuleAction(fd);
        if (!res.ok) {
          setNotice({ kind: 'error', text: res.error });
        } else {
          if (res.result === 'published') {
            setIsActive(true);
            setPublicEnabled(true);
          } else if (res.result === 'unpublished') {
            setPublicEnabled(false);
          }
          setNotice({ kind: 'ok', text: SAVED_TEXT[res.result] });
          router.refresh();
        }
      } catch {
        setNotice({
          kind: 'error',
          text: 'Kunde inte spara. Ladda om sidan och försök igen.'
        });
      } finally {
        setPendingIntent(null);
      }
    });
  }

  const steps = [
    { key: 'basics', label: 'Grunder' },
    { key: 'look', label: 'Utseende & mall' },
    { key: 'questions', label: flowType === 'chat' ? 'Samtal & frågor' : 'Frågor' },
    { key: 'audience', label: 'Målgrupp & uppgifter' },
    { key: 'finish', label: 'Efter slutförande' }
  ];
  const isLast = step === steps.length - 1;

  return (
    <div className="mx-modedit" style={{ display: 'grid' }}>
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

      <div style={{ padding: 16, display: 'grid', gap: 16 }}>
        <form id={FORM_ID} onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
          <input type="hidden" name="id" value={mod.id} />

          {/* ── Steg 1: Grunder ─────────────────────────────────────────── */}
          <Step active={step === 0}>
            <Section title="Namn och typ" desc="Vad modulen heter och hur besökaren svarar.">
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

            </Section>

            {/* Syfte (§ 43): intag skapar lead; enkät samlar svar utan lead. */}
            <Section title="Syfte" desc="Intag skapar ett lead när modulen slutförs. En enkät samlar bara svar.">
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {COMPASS_PURPOSES.map((p) => (
                  <label
                    key={p}
                    className="mx-flex mx-items-c mx-gap-2 mx-t-13"
                    style={{ cursor: 'pointer', border: '1px solid var(--mx-line)', borderRadius: 10, padding: '8px 10px' }}
                  >
                    <input
                      type="radio"
                      name="purpose"
                      value={p}
                      checked={purpose === p}
                      onChange={() => setPurpose(p)}
                    />
                    <span>{COMPASS_PURPOSE_LABELS[p]}</span>
                  </label>
                ))}
              </div>
              {purpose === 'survey' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
                  <label className="mx-label">
                    Enkäten handlar om
                    <select name="subject_kind" defaultValue={mod.subject_kind || 'none'} className="mx-input" style={{ marginTop: 4 }}>
                      {SURVEY_SUBJECT_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {SURVEY_SUBJECT_KIND_LABELS[k]}
                        </option>
                      ))}
                    </select>
                    <span className="mx-t-12 mx-muted" style={{ display: 'block', marginTop: 4 }}>
                      Subjektet skickas i länken som <code>?om=&lt;id&gt;</code> (t.ex. bolagets id).
                    </span>
                  </label>
                  <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer', alignSelf: 'end' }}>
                    <input type="checkbox" name="anonymous" defaultChecked={mod.anonymous === true} />
                    <span>Anonym enkät — inga identifierare alls; resultat visas först vid minst 5 svar</span>
                  </label>
                </div>
              )}
              {purpose === 'survey' && (
                <div className="mx-t-12 mx-muted" style={{ marginTop: 6 }}>
                  En enkät skapar aldrig lead. Svaren aggregeras med k-anonymitet och kan kopplas som indikator i Måluppföljning.
                </div>
              )}
            </div>
            </Section>
          </Step>

          {/* ── Steg 2: Utseende & mall ─────────────────────────────────── */}
          <Step active={step === 1}>
            <Section
              title="Mall"
              desc={`Det första besökaren ser. Mallen bestämmer var bild, rubrik och ${
                flowType === 'chat' ? 'chatten' : 'frågorna'
              } hamnar.`}
            >
              <LayoutPicker initial={layout} flowType={flowType} onChange={setLayout} />
              <label className="mx-label" style={{ maxWidth: 320 }}>
                Accentfärg (hex)
                <input
                  type="text"
                  name="theme_color"
                  defaultValue={mod.theme_color || ''}
                  className="mx-input"
                  style={{ marginTop: 4 }}
                  placeholder="#002c40"
                />
                <span className="mx-t-12 mx-muted" style={{ display: 'block', marginTop: 4 }}>
                  Färgar knappar, progress, färgpanel och heltäckande bakgrund. Tomt = Movexum mörkblå.
                </span>
              </label>
            </Section>

            <Section title="Rubrik och text" desc="Texten överst på sidan.">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
                Liten text ovanför rubriken
                <input
                  type="text"
                  name="hero_eyebrow"
                  defaultValue={mod.hero_eyebrow || ''}
                  className="mx-input"
                  style={{ marginTop: 4 }}
                  placeholder="t.ex. MOVEXUM"
                />
                <span className="mx-t-12 mx-muted" style={{ display: 'block', marginTop: 4 }}>
                  Tomt = ingen text ovanför rubriken.
                </span>
              </label>
            </div>
            <label className="mx-label">
              Beskrivning (visas under rubriken)
              <textarea
                name="welcome_body"
                defaultValue={mod.welcome_body || ''}
                className="mx-textarea"
                style={{ marginTop: 4, minHeight: 60 }}
              />
            </label>
            </Section>

            <Section
              title={`Startsida innan ${flowType === 'chat' ? 'chatten' : 'frågorna'}`}
              desc="En första sida där besökaren läser vad modulen är till för innan hen börjar svara. Tom text = ingen startsida. Samtyckestexten (steg 4) visas på samma sida."
            >
              <label className="mx-label">
                Rubrik på startsidan
                <input
                  type="text"
                  name="start_page_title"
                  defaultValue={mod.start_page_title || ''}
                  className="mx-input"
                  style={{ marginTop: 4 }}
                  placeholder="Innan du börjar"
                  maxLength={200}
                />
              </label>
              <label className="mx-label">
                Beskrivning och syfte
                <textarea
                  name="start_page_body"
                  defaultValue={mod.start_page_body || ''}
                  className="mx-textarea"
                  style={{ marginTop: 4, minHeight: 140 }}
                  maxLength={6000}
                  placeholder={
                    'Vad är det här till för och vad händer med svaren?\n\n' +
                    'Tomrad ger nytt stycke. Rader som börjar med "- " blir en punktlista, ' +
                    '"## " blir en mellanrubrik.'
                  }
                />
                <span className="mx-t-12 mx-muted" style={{ display: 'block', marginTop: 4 }}>
                  Skriv inte personuppgifter här — texten är publik.
                </span>
              </label>
            </Section>

            <Section title="Bild eller video">
            <div style={{ opacity: layoutMeta.media === 'none' ? 0.6 : 1 }}>
              <div className="mx-layoutpick-hint" style={{ marginBottom: 8 }}>
                <strong>{layoutMeta.label}:</strong> {layoutMeta.mediaHint}
                {layoutMeta.media !== 'none' && (
                  <> Finns både bild och video spelas videon, med bilden som startbild.</>
                )}
              </div>
              <HeroMediaUploader
                moduleId={mod.id}
                initialImageUrl={heroImageUrl}
                initialVideoUrl={heroVideoUrl}
              />
            </div>

            </Section>
          </Step>

          {/* ── Steg 3: Samtalsinställningar (bara AI-chatt) ────────────── */}
          {/* Fälten ligger alltid i DOM:en så ett typbyte inte tappar värden. */}
          <div
            style={{ display: step === 2 && flowType === 'chat' ? 'grid' : 'none' }}
            aria-hidden={!(step === 2 && flowType === 'chat')}
          >
            <Section title="Samtalet" desc="Hur AI-assistenten presenterar sig och hur långt samtalet får bli.">
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
                <span className="mx-muted mx-t-xs" style={{ display: 'block', marginTop: 4 }}>
                  Namnet assistenten hälsar och presenterar sig med. Tomt = modulens namn.
                </span>
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
              <span className="mx-t-xs mx-muted" style={{ display: 'block', marginTop: 4 }}>
                Assistenten vet hur många svar besökaren har kvar och rundar alltid av på sista
                turen (sammanfattning + nästa steg, inga frågor) — samtalet slutar aldrig mitt i
                en fråga.
              </span>
            </label>
            <details>
              <summary className="mx-t-13" style={{ cursor: 'pointer' }}>
                Egen systemprompt (valfri)
              </summary>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                aria-label="Egen systemprompt"
                className="mx-textarea"
                style={{ marginTop: 8, minHeight: 100, fontFamily: 'var(--mx-mono)', width: '100%' }}
                placeholder="Lämna tom för standardbeteendet."
              />
            </details>
            </Section>
          </div>

          <input type="hidden" name="system_prompt" value={systemPrompt} />

          {/* ── Steg 4: Målgrupp & uppgifter ────────────────────────────── */}
          <Step active={step === 3}>
            <Section title="Målgrupp och inledning">
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

            </Section>

            <Section
              title="Dina uppgifter — avsnittet sist i flödet"
              desc="Vilka uppgifter besökaren fyller i efter frågorna och vilka som är obligatoriska. I AI-chatten visas de som avslutssteg efter samtalet, i formulär och quiz som sista steg."
            >
            <div>
              <table className="mx-modedit-table">
                <tbody>
                  {CONTACT_FIELD_KEYS.map((key) => {
                    const meta = CONTACT_FIELD_META[key];
                    const current = contactSection[key];
                    return (
                      <tr key={key}>
                        <td>
                          <span className="mx-t-13 mx-fw-6">{meta.label}</span>
                          {key === 'founder_gender' && (
                            <span className="mx-t-xs mx-muted" style={{ display: 'block', fontWeight: 400 }}>
                              Kvinna / Man / Mixat team / Vill inte ange. Kan vara obligatoriskt —
                              besökaren kan alltid välja &quot;Vill inte ange&quot;. Används bara för
                              Vinnovas statistik, aldrig i bedömningen.
                            </span>
                          )}
                          {key === 'attachments' && (
                            <span className="mx-t-xs mx-muted" style={{ display: 'block', fontWeight: 400 }}>
                              Pitch deck, affärsplan m.m. — PDF, PowerPoint, Word, Excel eller bild, högst
                              5 filer à 25 MB. Filerna syns på leadet och kan laddas ned av personalen.
                            </span>
                          )}
                          {key === 'other_info' && (
                            <span className="mx-t-xs mx-muted" style={{ display: 'block', fontWeight: 400 }}>
                              Fritextruta där idébäraren kan lägga till det som inte fått plats i frågorna.
                            </span>
                          )}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {CONTACT_FIELD_MODES.filter((m) => !(meta.neverRequired && m === 'required')).map(
                            (mode) => (
                              <label
                                key={mode}
                                className="mx-t-12"
                                style={{ marginRight: 12, cursor: 'pointer', fontWeight: 400 }}
                              >
                                <input
                                  type="radio"
                                  name={`contact_${key}`}
                                  value={mode}
                                  defaultChecked={current === mode}
                                  style={{ marginRight: 4 }}
                                />
                                {CONTACT_FIELD_MODE_LABEL[mode]}
                              </label>
                            )
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <span className="mx-t-12 mx-muted" style={{ display: 'block', marginTop: 10 }}>
                Kön, kommun och kontaktväg är fasta val. Övriga teammedlemmar är en fritextruta
                (namn + e-post). Hemsidan kontrolleras som en webbadress. Kön på grundare och teammedlemmar når aldrig AI-analysen och
                exporteras inte per lead.
              </span>
            </div>
            </Section>

            <Section title="Samtycke" desc="Visas för besökaren innan hen börjar svara.">
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
            </Section>
          </Step>

          {/* ── Steg 5: Efter slutförande ───────────────────────────────── */}
          <Step active={step === 4}>
            <Section title="När besökaren är klar" desc="Vad besökaren ser och vart hen skickas efter sista steget.">
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
            </Section>

            <Section title="Leads och notiser">
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

            <label className="mx-label">
              Kopplat event / aktivitet (valfri)
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
            </Section>

            <Section
              title="Publicering"
              desc="Modulen publiceras först när du trycker Publicera här nedanför."
            >
              <label className="mx-label">
                Publik länk — modulen nås på /m/[länk]
                <input
                  key={mod.public_slug || 'no-slug'}
                  type="text"
                  name="public_slug"
                  defaultValue={mod.public_slug || ''}
                  className="mx-input"
                  style={{ marginTop: 4 }}
                  placeholder="t.ex. ar-du-entreprenor"
                />
              </label>
              <div className="mx-flex mx-items-c mx-gap-3 mx-wrap">
                <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    name="is_active"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                  />
                  <span>Aktiv</span>
                </label>
                <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    name="public_url_enabled"
                    checked={publicEnabled}
                    onChange={(e) => setPublicEnabled(e.target.checked)}
                  />
                  <span>Publicerad publikt (kräver Aktiv)</span>
                </label>
              </div>
              <span className="mx-t-12 mx-muted">
                Länken fungerar när båda är ibockade och du har sparat. Knappen{' '}
                <strong>Publicera</strong> bockar i båda och sparar i ett steg.
              </span>
            </Section>
          </Step>
        </form>

        {/* ── Steg 3: Frågor (utanför formuläret — sparas direkt per fråga) ── */}
        <div style={{ display: step === 2 ? 'grid' : 'none', gap: 16 }}>
          {flowType === 'quiz' && (
            <>
              <Section
                title="Resultatprofiler"
                desc="En profil per möjligt resultat (t.ex. grön/gul/röd). Profilen med flest poäng visas för besökaren. Sparas med Spara-knappen längst ned."
              >
                <ResultBucketsEditor initial={mod.result_buckets ?? []} formId={FORM_ID} />
              </Section>
              {purpose !== 'survey' && (
                <Section
                  title="AI-bedömning av fritextsvar (valfritt)"
                  desc="Sparas med Spara-knappen längst ned."
                >
                <label className="mx-label">
                  Så bedömer AI fritextsvaren
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    maxLength={8000}
                    className="mx-textarea"
                    style={{ marginTop: 4, minHeight: 140, width: '100%' }}
                    placeholder={
                      'Beskriv per fritextfråga vad som kännetecknar varje profil, t.ex.\n\n"Beskriv din idé":\nPotential: allmänt hållen, inget konkret problem eller kund\nUtveckling: tydligt problem och det framgår vem som har det\nRedo: problem, kund och lösning är konkreta, något är testat eller sålt'
                    }
                  />
                  <span className="mx-muted mx-t-12" style={{ display: 'block', marginTop: 6 }}>
                    Tomt = fritextsvar ger inga poäng. Ifyllt = varje fritextsvar (kort eller lång
                    text) tolkas av AI (Mistral, EU) och kan ge en profil lika många poäng som
                    quizets lättaste kryssfråga. Använd profilernas nycklar eller titlar. Besökaren
                    får veta att svaren tolkats av AI, och bedömningen sparas under Anteckningar på
                    leadet. Gäller quiz där profilen med flest poäng vinner.
                  </span>
                </label>
                </Section>
              )}
            </>
          )}
          <Section
            title="Frågor"
            desc={
              flowType === 'chat'
                ? 'Frågorna används som intervjuguide i samtalet. Klicka på en fråga för att öppna den. Varje fråga sparas för sig.'
                : 'Visas för besökaren i den här ordningen. Klicka på en fråga för att öppna den. Varje fråga sparas för sig.'
            }
          >
            <QuestionsManager
              moduleId={mod.id}
              moduleSlug={mod.slug}
              flowType={flowType}
              initialQuestions={questions}
              resultBuckets={mod.result_buckets ?? []}
            />
          </Section>
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
          {isPublished && (
            <span className="mx-t-12 mx-muted mx-flex mx-items-c mx-gap-1">
              <Icon name="globe" size={12} /> Publicerad
            </span>
          )}
          <button
            key="save"
            type="submit"
            form={FORM_ID}
            name="intent"
            value="save"
            className="mx-btn"
            disabled={isPending}
          >
            <Icon name="check" size={13} />{' '}
            {isPending && pendingIntent === 'save' ? 'Sparar…' : 'Spara'}
          </button>
          {/* key på varje knapp: utan den återanvänder React "Nästa"-knappens
              DOM-nod som "Publicera" (type=submit) MITT I klicket, och
              webbläsaren skickar då formuläret — modulen publicerades av
              att man klickade Nästa på steg 4. */}
          {!isLast ? (
            <button
              key="next"
              type="button"
              className="mx-btn mx-primary"
              onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
            >
              Nästa →
            </button>
          ) : isPublished ? (
            <button
              key="unpublish"
              type="submit"
              form={FORM_ID}
              name="intent"
              value="unpublish"
              className="mx-btn"
              disabled={isPending}
              title="Stänger den publika länken /m/… — modulen förblir aktiv för förhandsgranskning."
            >
              <Icon name="eye" size={13} />{' '}
              {isPending && pendingIntent === 'unpublish' ? 'Avpublicerar…' : 'Avpublicera'}
            </button>
          ) : (
            <button
              key="publish"
              type="submit"
              form={FORM_ID}
              name="intent"
              value="publish"
              className="mx-btn mx-primary"
              disabled={isPending}
              title="Sparar alla steg, bockar i Aktiv + Publicerad publikt och öppnar länken /m/…"
            >
              <Icon name="globe" size={13} />{' '}
              {isPending && pendingIntent === 'publish' ? 'Publicerar…' : 'Publicera'}
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div
          className={`mx-savetoast ${notice.kind === 'error' ? 'is-error' : ''}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          <Icon name={notice.kind === 'error' ? 'alert' : 'check'} size={14} />
          <span>{notice.text}</span>
          {notice.kind === 'error' && (
            <button
              type="button"
              className="mx-savetoast-close"
              aria-label="Stäng"
              onClick={() => setNotice(null)}
            >
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Avgränsad sektion med egen rubrik — så fält och grupper inte flyter ihop. */
function Section({
  title,
  desc,
  children
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mx-modsec">
      <header className="mx-modsec-head">
        <h3 className="mx-modsec-title">{title}</h3>
        {desc && <p className="mx-modsec-desc">{desc}</p>}
      </header>
      <div className="mx-modsec-body">{children}</div>
    </section>
  );
}

function Step({ active, children }: { active: boolean; children: React.ReactNode }) {
  // Inaktiva steg döljs men ligger kvar i DOM:en så submit postar alla fält.
  return <div style={{ display: active ? 'grid' : 'none', gap: 16 }}>{children}</div>;
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
