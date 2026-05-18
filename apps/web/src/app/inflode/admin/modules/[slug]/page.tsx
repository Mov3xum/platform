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
  updateModuleAction
} from '@/lib/actions/compass';
import { ShareModule } from '@/components/compass/ShareModule';

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
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
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

  return (
    <div className="mx-view-pad mx-wide">
      <PageHead
        crumb={`Inflöde / Admin / Moduler / ${mod.name}`}
        title={mod.name}
        subtitle={`/inflode/m/${mod.slug} · ${FLOW_TYPE_LABEL[mod.flow_type]} · ${mod.is_active ? 'Aktiv' : 'Utkast'}`}
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
                System-prompt (för AI-chat-flöden)
                <textarea
                  name="system_prompt"
                  defaultValue={mod.system_prompt || ''}
                  className="mx-textarea"
                  style={{ marginTop: 4, minHeight: 120, fontFamily: 'var(--mx-mono)' }}
                  placeholder="Lämna tom för standard-prompten. Skriv egen om du vill att AI:n ska bete sig annorlunda — t.ex. för en specifik kohort."
                />
              </label>
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
          {mod.flow_type !== 'chat' && (
            <Card>
              <CardHead
                label="Frågor"
                right={
                  <span className="mx-mono mx-t-xs mx-muted">
                    {questions.length} {questions.length === 1 ? 'fråga' : 'frågor'}
                  </span>
                }
              />
              <div style={{ padding: 16 }}>
                {questions.length === 0 ? (
                  <div className="mx-muted mx-t-13" style={{ marginBottom: 12 }}>
                    Inga frågor ännu. Lägg till din första nedan.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 6, marginBottom: 16 }}>
                    {questions.map((q, i) => (
                      <div
                        key={q.id}
                        className="mx-flex mx-items-c mx-gap-2"
                        style={{
                          padding: 10,
                          borderRadius: 8,
                          background: 'var(--mx-paper-2)',
                          border: '1px solid var(--mx-line-soft)'
                        }}
                      >
                        <span
                          className="mx-mono mx-t-xs mx-muted"
                          style={{ minWidth: 24 }}
                        >
                          {i + 1}
                        </span>
                        <Chip mono>{q.input_type}</Chip>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="mx-t-13 mx-fw-6 mx-truncate">{q.prompt}</div>
                          <div className="mx-mono mx-t-xs mx-muted mx-truncate">
                            {q.key}
                            {q.required && ' · obligatorisk'}
                          </div>
                        </div>
                        <form action={deleteQuestionAction}>
                          <input type="hidden" name="id" value={q.id} />
                          <input type="hidden" name="module_slug" value={mod.slug} />
                          <button
                            type="submit"
                            className="mx-btn mx-sm"
                            style={{ color: '#4b2718' }}
                          >
                            <Icon name="trash" size={11} />
                          </button>
                        </form>
                      </div>
                    ))}
                  </div>
                )}

                {/* Lägg till fråga */}
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
                        Nyckel (mappar till lead-fält om matchande)
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
                      Val (en per rad, format <code>nyckel | etikett</code>) — endast för
                      enkelval/flerval
                      <textarea
                        name="choices"
                        className="mx-textarea"
                        style={{ marginTop: 4, minHeight: 60, fontFamily: 'var(--mx-mono)' }}
                        placeholder="tech | Tech / digitalt&#10;hardware | Hårdvara&#10;service | Tjänst"
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
          )}
        </div>

        {/* Höger: dela, exempel-URL, ta bort */}
        <div style={{ display: 'grid', gap: 16 }}>
          <ShareModule slug={mod.slug} name={mod.name} />

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
                /inflode/m/{mod.slug}?utm_source=<em>linkedin</em>&amp;utm_medium=<em>post</em>&amp;utm_campaign=<em>varomgang26</em>
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
