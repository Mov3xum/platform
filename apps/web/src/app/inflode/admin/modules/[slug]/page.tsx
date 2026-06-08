import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageHead, Card, CardHead, Chip, Icon } from '@/components/proto';
import {
  getLeadAnalytics,
  getModuleBySlug,
  listQuestionsForModule
} from '@/lib/compass/store';
import { FLOW_TYPE_LABEL } from '@/lib/compass/types';
import {
  addQuestionAction,
  deleteModuleAction,
  deleteQuestionAction,
  updateQuestionAction,
  updateModuleAction
} from '@/lib/actions/compass';
import { ShareModule } from '@/components/compass/ShareModule';
import { moduleHeroImageUrl } from '@/lib/compass/media';

export const dynamic = 'force-dynamic';

const MODEL_OPTIONS = [
  { value: 'mistral-large-latest', label: 'Mistral Large (rikast)' },
  { value: 'mistral-medium-latest', label: 'Mistral Medium' },
  { value: 'mistral-small-latest', label: 'Mistral Small (snabb/billig)' }
];

const INPUT_TYPES = [
  { value: 'short_text', label: 'Kort text' },
  { value: 'long_text', label: 'Lång text' },
  { value: 'email', label: 'E-post' },
  { value: 'phone', label: 'Telefon' },
  { value: 'choice', label: 'Enkelval' },
  { value: 'multi_choice', label: 'Flerval' },
  { value: 'scale', label: 'Skala 1–10' }
];

export default async function EditModulePage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) {
    redirect('/inflode');
  }
  const pb = await getServerPb();
  const mod = await getModuleBySlug(pb, user.tenant, slug);
  if (!mod) notFound();

  const [questions, analytics] = await Promise.all([
    listQuestionsForModule(pb, mod.id),
    getLeadAnalytics(pb, user.tenant, 365)
  ]);
  const metrics = analytics.byModule.find((m) => m.slug === mod.slug);
  const heroImageUrl = moduleHeroImageUrl(mod);

  return (
    <div className="mx-view-pad mx-wide">
      <PageHead
        crumb={`Startupkompassen / Admin / Moduler / ${mod.name}`}
        title={mod.name}
        subtitle={`${mod.public_slug ? `/m/${mod.public_slug}` : '(ingen publik länk)'} · ${FLOW_TYPE_LABEL[mod.flow_type]} · ${mod.is_active ? 'Aktiv' : 'Utkast'}`}
        actions={
          <>
            <Link href="/inflode/admin/modules" className="mx-btn">
              <Icon name="arrow" size={13} /> Tillbaka
            </Link>
            <Link href={`/inflode/m/${mod.slug}`} className="mx-btn">
              <Icon name="spark" size={13} /> Förhandsgranska
            </Link>
          </>
        }
      />

      {metrics && (
        <Card style={{ padding: 14, marginBottom: 16, background: 'var(--mx-paper-2)' }}>
          <div className="mx-flex mx-items-c mx-gap-3 mx-t-13 mx-wrap">
            <Stat label="Leads" value={metrics.total} />
            <Stat label="Accepterade" value={metrics.accepted} />
            <Stat label="Konverterade bolag" value={metrics.converted} />
            <span className="mx-grow" />
            <Link href={`/inflode/leads?landing=${mod.slug}`} className="mx-btn mx-sm mx-ghost">
              Visa leads från modulen →
            </Link>
          </div>
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          {/* Inställningar */}
          <Card>
            <CardHead label="Grundinställningar" />
            <form
              action={updateModuleAction}
              style={{ padding: 16, display: 'grid', gap: 12 }}
            >
              <input type="hidden" name="id" value={mod.id} />
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

              {/* Omslagsbild — visas stort högst upp på den publika sidan */}
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
                      Ingen bild uppladdad — en branded gradient visas i stället.
                    </div>
                  )}
                  <input
                    type="file"
                    name="hero_image"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    className="mx-t-13"
                  />
                  <span className="mx-t-12 mx-muted">
                    PNG, JPG, WebP, GIF eller SVG. Max 15 MB. Ladda inte upp bilder
                    med personuppgifter — bilden serveras publikt.
                  </span>
                  {heroImageUrl && (
                    <label
                      className="mx-flex mx-items-c mx-gap-2 mx-t-13"
                      style={{ cursor: 'pointer' }}
                    >
                      <input type="checkbox" name="remove_hero_image" />
                      <span>Ta bort nuvarande bild</span>
                    </label>
                  )}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label className="mx-label">
                  Flow-typ
                  <select
                    name="flow_type"
                    defaultValue={mod.flow_type}
                    className="mx-input"
                    style={{ marginTop: 4 }}
                  >
                    <option value="chat">AI-chatt</option>
                    <option value="wizard">Formulär</option>
                    <option value="quiz">Quiz</option>
                  </select>
                </label>
                <label className="mx-label">
                  AI-modell (chat)
                  <select
                    name="model"
                    defaultValue={mod.model || 'mistral-large-latest'}
                    className="mx-input"
                    style={{ marginTop: 4 }}
                  >
                    {MODEL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="mx-label">
                Intro-meddelande (visas högst upp på modul-sidan)
                <textarea
                  name="intro_message"
                  defaultValue={mod.intro_message || ''}
                  className="mx-textarea"
                  style={{ marginTop: 4, minHeight: 50 }}
                />
              </label>
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
                Redirect-URL (frivillig — leadet skickas vidare efter inskickning)
                <input
                  type="url"
                  name="redirect_url"
                  defaultValue={mod.redirect_url || ''}
                  className="mx-input"
                  style={{ marginTop: 4 }}
                  placeholder="https://..."
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
                System-prompt (för AI-chat-flöden)
                <textarea
                  name="system_prompt"
                  defaultValue={mod.system_prompt || ''}
                  className="mx-textarea"
                  style={{ marginTop: 4, minHeight: 120, fontFamily: 'var(--mx-mono)' }}
                  placeholder="Lämna tom för standard-prompten. Skriv egen om du vill att AI:n ska bete sig annorlunda — t.ex. för en specifik kohort."
                />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
              <div className="mx-flex mx-items-c mx-gap-3 mx-wrap">
                <label
                  className="mx-flex mx-items-c mx-gap-2 mx-t-13"
                  style={{ cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    name="is_active"
                    defaultChecked={!!mod.is_active}
                  />
                  <span>Aktiv (synlig på översikten)</span>
                </label>
                <label
                  className="mx-flex mx-items-c mx-gap-2 mx-t-13"
                  style={{ cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    name="public_url_enabled"
                    defaultChecked={!!mod.public_url_enabled}
                  />
                  <span>Markera som publik URL (för delning)</span>
                </label>
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
                  <input
                    type="checkbox"
                    name="require_organization"
                    defaultChecked={!!mod.require_organization}
                  />
                  <span>Organisation obligatoriskt</span>
                </label>
              </div>
              {mod.flow_type === 'quiz' && (
                <label className="mx-label">
                  Resultatprofiler (JSON) — för quiz. Summan av alla valda alternativs
                  poäng jämförs mot varje profils <code>min</code>/<code>max</code>.
                  <textarea
                    name="result_buckets"
                    defaultValue={
                      mod.result_buckets && mod.result_buckets.length
                        ? JSON.stringify(mod.result_buckets, null, 2)
                        : ''
                    }
                    className="mx-textarea"
                    style={{ marginTop: 4, minHeight: 160, fontFamily: 'var(--mx-mono)', fontSize: 11 }}
                    placeholder={
                      '[\n  {"key":"green","title":"Redo","body":"...","tips":["..."],"min":14,"max":21,"cta":{"label":"Boka","url":"/m/grundare"}}\n]'
                    }
                  />
                </label>
              )}
              <div
                className="mx-flex mx-items-c mx-gap-2"
                style={{ justifyContent: 'flex-end' }}
              >
                <button type="submit" className="mx-btn mx-primary">
                  <Icon name="check" size={13} /> Spara
                </button>
              </div>
            </form>
          </Card>

          {/* Frågor */}
          <Card>
            <CardHead
              label="Frågor"
              right={
                <span className="mx-mono mx-t-xs mx-muted">
                  {questions.length} {questions.length === 1 ? 'fråga' : 'frågor'}
                </span>
              }
            />
            <div style={{ padding: 16, display: 'grid', gap: 16 }}>
              <div className="mx-muted mx-t-13" style={{ lineHeight: 1.5 }}>
                Frågor och alternativ kan användas i alla modultyper. AI-chatten använder dem som
                dynamisk intervjuguide, medan quiz och formulär visar dem direkt för besökaren.
              </div>

              {questions.length === 0 ? (
                <div className="mx-muted mx-t-13">Inga frågor ännu. Lägg till din första nedan.</div>
              ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                  {questions.map((q, i) => (
                    <form
                      key={q.id}
                      action={updateQuestionAction}
                      style={{
                        padding: 12,
                        borderRadius: 10,
                        background: 'var(--mx-paper-2)',
                        border: '1px solid var(--mx-line-soft)',
                        display: 'grid',
                        gap: 10
                      }}
                    >
                      <input type="hidden" name="id" value={q.id} />
                      <input type="hidden" name="module_id" value={mod.id} />
                      <input type="hidden" name="module_slug" value={mod.slug} />

                      <div className="mx-flex mx-items-c mx-gap-2 mx-wrap">
                        <span className="mx-mono mx-t-xs mx-muted" style={{ minWidth: 24 }}>
                          {i + 1}
                        </span>
                        <Chip mono>{q.input_type}</Chip>
                        <div className="mx-mono mx-t-xs mx-muted">
                          {q.key}
                          {q.required && ' · obligatorisk'}
                        </div>
                        <span className="mx-grow" />
                        <button type="submit" className="mx-btn mx-sm mx-primary">
                          <Icon name="check" size={11} /> Spara fråga
                        </button>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <label className="mx-label">
                          Nyckel
                          <input
                            type="text"
                            name="key"
                            required
                            defaultValue={q.key}
                            className="mx-input"
                            style={{ marginTop: 4 }}
                          />
                        </label>
                        <label className="mx-label">
                          Input-typ
                          <select
                            name="input_type"
                            defaultValue={q.input_type}
                            className="mx-input"
                            style={{ marginTop: 4 }}
                          >
                            {INPUT_TYPES.map((it) => (
                              <option key={it.value} value={it.value}>
                                {it.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <label className="mx-label">
                        Fråga (texten som visas)
                        <input
                          type="text"
                          name="prompt"
                          required
                          defaultValue={q.prompt}
                          className="mx-input"
                          style={{ marginTop: 4 }}
                        />
                      </label>

                      <label className="mx-label">
                        Hjälptext (valfri)
                        <input
                          type="text"
                          name="help_text"
                          defaultValue={q.help_text || ''}
                          className="mx-input"
                          style={{ marginTop: 4 }}
                        />
                      </label>

                      <label className="mx-label">
                        Val (en per rad). Format <code>värde | etikett | poäng</code> — en
                        poäng per alternativ. Poängen summeras och totalen avgör vilken
                        resultatprofil besökaren landar i.
                        <textarea
                          name="choices"
                          className="mx-textarea"
                          defaultValue={
                            q.choices?.length
                              ? q.choices
                                  .map((c) => [c.value, c.label, choiceScoreText(c)].join(' | '))
                                  .join('\n')
                              : ''
                          }
                          style={{ marginTop: 4, minHeight: 74, fontFamily: 'var(--mx-mono)' }}
                          placeholder={'ja | Ja, absolut | 3&#10;kanske | Delvis | 1&#10;nej | Nej | 0'}
                        />
                      </label>

                      <div className="mx-flex mx-items-c mx-gap-3 mx-wrap">
                        <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer' }}>
                          <input type="checkbox" name="required" defaultChecked={!!q.required} />
                          Obligatorisk
                        </label>
                        <span className="mx-grow" />
                        <button
                          type="submit"
                          formAction={deleteQuestionAction}
                          className="mx-btn mx-sm"
                          style={{ color: '#4b2718' }}
                        >
                          <Icon name="trash" size={11} /> Ta bort
                        </button>
                      </div>
                    </form>
                  ))}
                </div>
              )}

              <details>
                <summary
                  className="mx-btn mx-sm"
                  style={{ display: 'inline-flex', cursor: 'pointer' }}
                >
                  <Icon name="plus" size={11} /> Ny fråga
                </summary>
                <form
                  action={addQuestionAction}
                  style={{
                    marginTop: 12,
                    padding: 12,
                    borderRadius: 10,
                    background: 'var(--mx-paper-2)',
                    display: 'grid',
                    gap: 8
                  }}
                >
                  <input type="hidden" name="module_id" value={mod.id} />
                  <input type="hidden" name="module_slug" value={mod.slug} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <label className="mx-label">
                      Nyckel (mappas till lead-fält om matchande)
                      <input
                        type="text"
                        name="key"
                        required
                        className="mx-input"
                        style={{ marginTop: 4 }}
                        placeholder="t.ex. idea_summary, email, role"
                      />
                    </label>
                    <label className="mx-label">
                      Input-typ
                      <select
                        name="input_type"
                        className="mx-input"
                        defaultValue="short_text"
                        style={{ marginTop: 4 }}
                      >
                        {INPUT_TYPES.map((it) => (
                          <option key={it.value} value={it.value}>
                            {it.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="mx-label">
                    Fråga (texten som visas)
                    <input
                      type="text"
                      name="prompt"
                      required
                      className="mx-input"
                      style={{ marginTop: 4 }}
                    />
                  </label>
                  <label className="mx-label">
                    Hjälptext (valfri)
                    <input
                      type="text"
                      name="help_text"
                      className="mx-input"
                      style={{ marginTop: 4 }}
                    />
                  </label>
                  <label className="mx-label">
                    Val (en per rad). Format <code>värde | etikett | poäng</code> — en poäng
                    per alternativ. Poängen summeras och totalen avgör vilken resultatprofil
                    besökaren landar i.
                    <textarea
                      name="choices"
                      className="mx-textarea"
                      style={{ marginTop: 4, minHeight: 70, fontFamily: 'var(--mx-mono)' }}
                      placeholder="ja | Ja, absolut | 3&#10;kanske | Delvis | 1&#10;nej | Nej | 0"
                    />
                  </label>
                  <div className="mx-flex mx-items-c mx-gap-3">
                    <label
                      className="mx-flex mx-items-c mx-gap-2 mx-t-13"
                      style={{ cursor: 'pointer' }}
                    >
                      <input type="checkbox" name="required" />
                      Obligatorisk
                    </label>
                    <span className="mx-grow" />
                    <button type="submit" className="mx-btn mx-primary">
                      <Icon name="plus" size={12} /> Lägg till fråga
                    </button>
                  </div>
                </form>
              </details>
            </div>
          </Card>
        </div>

        {/* Höger: dela, exempel-URL, ta bort */}
        <div style={{ display: 'grid', gap: 16 }}>
          <ShareModule slug={mod.slug} name={mod.name} publicSlug={mod.public_slug} />

          <Card>
            <CardHead label="Kampanj-länk-byggare" />
            <div style={{ padding: 16 }}>
              <div className="mx-muted mx-t-12" style={{ marginBottom: 8 }}>
                Lägg på UTM-parametrar för att mäta var leads kommer ifrån:
              </div>
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: 'var(--mx-paper-2)',
                  border: '1px solid var(--mx-line-soft)',
                  fontFamily: 'var(--mx-mono)',
                  fontSize: 11,
                  lineHeight: 1.5,
                  wordBreak: 'break-all'
                }}
              >
                /m/{mod.public_slug || '[ange-publik-slug]'}?utm_source=<em>linkedin</em>&amp;utm_medium=<em>post</em>&amp;utm_campaign=<em>varomgang26</em>
              </div>
              <div className="mx-t-12 mx-muted" style={{ marginTop: 10 }}>
                Mätningen syns på översikten och per modul. Stöder:{' '}
                <code className="mx-mono">utm_source</code>,{' '}
                <code className="mx-mono">utm_medium</code>,{' '}
                <code className="mx-mono">utm_campaign</code>,{' '}
                <code className="mx-mono">utm_term</code>,{' '}
                <code className="mx-mono">utm_content</code>.
              </div>
            </div>
          </Card>

          <Card>
            <CardHead label="Farlig zon" />
            <form action={deleteModuleAction} style={{ padding: 16 }}>
              <input type="hidden" name="id" value={mod.id} />
              <button
                type="submit"
                className="mx-btn"
                style={{ width: '100%', color: '#4b2718', borderColor: '#d67e47' }}
              >
                <Icon name="trash" size={13} /> Radera modul
              </button>
              <div
                className="mx-mono mx-t-xs mx-muted"
                style={{ marginTop: 8, textAlign: 'center' }}
              >
                Frågor raderas också (cascade). Befintliga leads bevaras.
              </div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * Visar EN poäng per val i redigeringsfältet. Härleder en poäng ur äldre,
 * hink-baserade val (summan av hink-vikterna, eller 1 för en enkel hink) så att
 * fältet aldrig blir tomt när en seedad quiz öppnas — sparas det om blir valet
 * rent poäng-baserat (§ 23.3).
 */
function choiceScoreText(c: {
  score?: number;
  bucket?: string;
  buckets?: Record<string, number>;
}): string {
  if (typeof c.score === 'number') return String(c.score);
  if (c.buckets) return String(Object.values(c.buckets).reduce((a, b) => a + b, 0));
  if (c.bucket) return '1';
  return '0';
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6">{label}</div>
      <div className="mx-disp mx-fw-6" style={{ fontSize: 20 }}>
        {value}
      </div>
    </div>
  );
}
