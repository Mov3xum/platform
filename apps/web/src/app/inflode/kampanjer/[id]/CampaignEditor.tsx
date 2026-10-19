'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Card, Icon } from '@/components/proto';
import { actionErrorMessage } from '@/lib/action-error';
import {
  cancelScheduleAction,
  createCampaignAction,
  deleteCampaignAction,
  listCampaignRecipientOptionsAction,
  previewRecipientsAction,
  saveCampaignAction,
  saveCampaignAsTemplateAction,
  scheduleCampaignAction,
  sendCampaignNowAction,
  sendTestAction,
  type CampaignActionState
} from '@/lib/actions/email-campaigns';
import type { InviteListMeta, InviteOption, InviteOptionsResult } from '@/lib/actions/invitations';
import type { CampaignRow } from '@/lib/email/campaign-data';
import {
  CONTACT_CATEGORIES,
  CONTACT_CATEGORY_LABELS,
  EMAIL_ACCENTS,
  EMAIL_ACCENT_HEX,
  EMAIL_ACCENT_LABELS,
  EMAIL_BLOCK_LABELS,
  EMAIL_BLOCK_TYPES,
  EMAIL_CAMPAIGN_STATUS_LABELS,
  EMAIL_CATEGORIES,
  EMAIL_CATEGORY_DESCRIPTIONS,
  EMAIL_CATEGORY_LABELS,
  EMAIL_CONSENT_MODES,
  EMAIL_CONSENT_MODE_LABELS,
  EMAIL_EVENT_GROUPS,
  EMAIL_EVENT_GROUP_LABELS,
  isEmailEventGroup,
  EMAIL_LAYOUTS,
  EMAIL_LAYOUT_LABELS,
  EMAIL_MERGE_FIELDS,
  EMAIL_SAMPLE_MERGE,
  blocksNeedEvent,
  checkEmailDeliverability,
  deliverabilityVerdict,
  emailReasonText,
  formatStockholmDateTime,
  newEmailBlockId,
  renderCampaignEmail,
  splitInviteSelection,
  toStockholmDateTimeInputValue,
  type EmailAccent,
  type EmailBlock,
  type EmailBlockType,
  type EmailCategory,
  type EmailConsentMode,
  type EmailDesign,
  type EmailEventGroup,
  type EmailLayout
} from '@platform/shared';

/**
 * Kampanjeditorn (CLAUDE.md § 54.3–54.8): blockbaserat innehåll, mallens
 * design (accent + kort/enkelt), ämne/förhandsrad, kategori och rättslig
 * grund, avsändare med riktig svarsadress, kopplat event, mottagarurval (samma
 * listor som inbjudningspanelen) och **live-förhandsgranskning** renderad med
 * exakt samma `renderCampaignEmail` som utskicket — det man ser är det som
 * skickas. Leveransbarhetskontrollen (`checkEmailDeliverability`) körs på
 * samma rendering. Alla utskick är mänskliga klick med bekräftelse.
 */

interface StaffOption {
  id: string;
  name: string;
  hasEmail: boolean;
}
interface EventOption {
  id: string;
  name: string;
  starts_at?: string;
  location?: string;
}
interface SurveyOption {
  id: string;
  name: string;
  /** Eventet enkäten följer upp (tomt = fristående). */
  event: string;
}

const KIND_LABEL: Record<InviteOption['kind'], string> = { contact: 'Kontakt', user: 'Användare', startup: 'Bolag' };

function Notice({ state }: { state: CampaignActionState | null }) {
  if (!state || (!state.error && !state.notice && !state.warning)) return null;
  const tone = state.error ? 'orange' : state.warning ? 'gul' : 'gron';
  return (
    <div
      role="status"
      className="mx-t-13"
      style={{
        padding: '8px 12px',
        borderRadius: 10,
        background: `var(--movexum-pastell-${tone})`,
        color: `var(--movexum-mork${tone})`
      }}
    >
      {state.error ?? state.notice}
      {state.warning ? ` ${state.warning}` : ''}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="mx-field" style={{ display: 'block' }}>
      <span className="mx-label">{label}</span>
      {children}
      {hint && (
        <span className="mx-t-xs mx-muted" style={{ display: 'block', marginTop: 4 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

function newBlock(type: EmailBlockType): EmailBlock {
  const id = newEmailBlockId();
  switch (type) {
    case 'heading':
      return { id, type, text: 'Rubrik' };
    case 'paragraph':
      return { id, type, text: '' };
    case 'button':
      return { id, type, label: 'Läs mer', url: 'https://', style: 'primary' };
    case 'image':
      return { id, type, url: '', alt: '', href: '' };
    case 'divider':
      return { id, type };
    case 'spacer':
      return { id, type, size: 'm' };
    case 'event_details':
      return { id, type };
    case 'rsvp':
      return { id, type };
    case 'ticket':
      return { id, type };
    case 'signature':
      return { id, type, name: '{{avsändare}}', title: 'Movexum' };
  }
}

function BlockEditor({
  block,
  onChange,
  onRemove,
  onMove,
  first,
  last
}: {
  block: EmailBlock;
  onChange: (b: EmailBlock) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  first: boolean;
  last: boolean;
}) {
  const input = 'mx-input';
  return (
    <div style={{ border: '1px solid var(--mx-line-soft)', borderRadius: 12, padding: 10, background: 'var(--color-surface)' }}>
      <div className="mx-flex mx-items-c mx-gap-2" style={{ marginBottom: 8 }}>
        <span className="mx-fw-6 mx-t-xs" style={{ textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {EMAIL_BLOCK_LABELS[block.type]}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="mx-btn mx-sm" onClick={() => onMove(-1)} disabled={first} aria-label="Flytta upp">
          ↑
        </button>
        <button type="button" className="mx-btn mx-sm" onClick={() => onMove(1)} disabled={last} aria-label="Flytta ned">
          ↓
        </button>
        <button type="button" className="mx-btn mx-sm" onClick={onRemove} aria-label="Ta bort block">
          <Icon name="trash" size={12} />
        </button>
      </div>
      {block.type === 'heading' && <input className={input} value={block.text} maxLength={200} onChange={(e) => onChange({ ...block, text: e.target.value })} />}
      {block.type === 'paragraph' && (
        <textarea
          className={input}
          rows={4}
          value={block.text}
          maxLength={4000}
          placeholder="Skriv texten. **fet**, *kursiv* och [länktext](https://…) fungerar. Platshållare: {{förnamn|du}}, {{event.namn}} …"
          onChange={(e) => onChange({ ...block, text: e.target.value })}
        />
      )}
      {block.type === 'button' && (
        <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
          <input className={input} value={block.label} maxLength={80} placeholder="Knapptext" onChange={(e) => onChange({ ...block, label: e.target.value })} />
          <input className={input} value={block.url} maxLength={2000} placeholder="https://…" onChange={(e) => onChange({ ...block, url: e.target.value })} />
          <select className={input} value={block.style} onChange={(e) => onChange({ ...block, style: e.target.value === 'secondary' ? 'secondary' : 'primary' })}>
            <option value="primary">Fylld</option>
            <option value="secondary">Kontur</option>
          </select>
        </div>
      )}
      {block.type === 'image' && (
        <div className="grid gap-2">
          <input className={input} value={block.url} maxLength={2000} placeholder="Bildens adress (https://…)" onChange={(e) => onChange({ ...block, url: e.target.value })} />
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={input} value={block.alt} maxLength={200} placeholder="Alternativtext (vad bilden visar)" onChange={(e) => onChange({ ...block, alt: e.target.value })} />
            <input className={input} value={block.href} maxLength={2000} placeholder="Länk vid klick (valfritt)" onChange={(e) => onChange({ ...block, href: e.target.value })} />
          </div>
          <span className="mx-t-xs mx-muted">Håll mejlet textburet — en stor bild och lite text är en klassisk skräppostsignal.</span>
        </div>
      )}
      {block.type === 'spacer' && (
        <select className={input} value={block.size} onChange={(e) => onChange({ ...block, size: (e.target.value as 's' | 'm' | 'l') || 'm' })}>
          <option value="s">Liten</option>
          <option value="m">Mellan</option>
          <option value="l">Stor</option>
        </select>
      )}
      {block.type === 'signature' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <input className={input} value={block.name} maxLength={200} placeholder="Namn ({{avsändare}} = kampanjens avsändare)" onChange={(e) => onChange({ ...block, name: e.target.value })} />
          <input className={input} value={block.title} maxLength={200} placeholder="Titel / organisation" onChange={(e) => onChange({ ...block, title: e.target.value })} />
        </div>
      )}
      {block.type === 'event_details' && <span className="mx-t-xs mx-muted">Tid, plats och &ldquo;Lägg i kalendern&rdquo; från det kopplade eventet.</span>}
      {block.type === 'rsvp' && (
        <span className="mx-t-xs mx-muted">
          Personliga svarsknappar. Varje mottagare blir en inbjuden rad i eventets deltagarlista och svaret landar där (§ 53.5).
        </span>
      )}
      {block.type === 'divider' && <span className="mx-t-xs mx-muted">En tunn linje.</span>}
    </div>
  );
}

function ListSelect({ value, onChange, meta }: { value: string; onChange: (v: string) => void; meta?: InviteListMeta }) {
  const n = (v: number | undefined) => (meta && v !== undefined ? ` (${v})` : '');
  return (
    <select className="mx-input" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Vilka ska få utskicket?">
      <option value="everyone">Alla personer — sök överallt</option>
      <optgroup label="Kontaktboken">
        <option value="contacts">Hela kontaktboken{n(meta?.contacts)}</option>
        {CONTACT_CATEGORIES.map((c) => {
          const count = meta?.byCategory[c];
          if (meta && !count) return null;
          return (
            <option key={c} value={`cat:${c}`}>
              {CONTACT_CATEGORY_LABELS[c]}
              {n(count)}
            </option>
          );
        })}
      </optgroup>
      {meta && meta.groups.length > 0 && (
        <optgroup label="Egna grupper">
          {meta.groups.map((g) => (
            <option key={g.id} value={`group:${g.id}`}>
              {g.name} ({g.count})
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="Plattformen">
        <option value="staff">Movexum-personal{n(meta?.staff)}</option>
        <option value="members">Bolagsmedlemmar{n(meta?.members)}</option>
        <option value="startups">Bolag{n(meta?.startups)}</option>
      </optgroup>
    </select>
  );
}

export function CampaignEditor({
  campaign,
  staff,
  events,
  surveys,
  orgName,
  replyToConfigured,
  meEmail
}: {
  campaign: CampaignRow;
  staff: StaffOption[];
  events: EventOption[];
  surveys: SurveyOption[];
  orgName: string;
  replyToConfigured: boolean;
  meEmail: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(campaign.title);
  const [subject, setSubject] = useState(campaign.subject);
  const [preheader, setPreheader] = useState(campaign.preheader);
  const [category, setCategory] = useState<EmailCategory>(campaign.category);
  const [consentMode, setConsentMode] = useState<EmailConsentMode>(campaign.consent_mode);
  const [senderName, setSenderName] = useState(campaign.sender_name);
  const [senderUserId, setSenderUserId] = useState(campaign.sender_user ?? '');
  const [eventId, setEventId] = useState(campaign.event ?? '');
  const [surveyId, setSurveyId] = useState(campaign.survey ?? '');
  const [eventGroup, setEventGroup] = useState<EmailEventGroup | ''>(campaign.audience.event_group ?? '');
  const [blocks, setBlocks] = useState<EmailBlock[]>(campaign.blocks);
  const [design, setDesign] = useState<EmailDesign>(campaign.design);
  const [list, setList] = useState(campaign.audience.list || 'everyone');
  const [picked, setPicked] = useState<Map<string, string>>(() => new Map(campaign.audience.keys.map((k) => [k, ''])));
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<CampaignActionState | null>(null);
  const [busy, startBusy] = useTransition();
  const [preview, setPreview] = useState<'desktop' | 'mobile' | 'text'>('desktop');
  const [sendAt, setSendAt] = useState(toStockholmDateTimeInputValue(campaign.send_at) || '');
  const [recipientPreview, setRecipientPreview] = useState<Awaited<ReturnType<typeof previewRecipientsAction>> | null>(null);
  const [addType, setAddType] = useState<EmailBlockType>('paragraph');

  // Mottagarlistan (samma listning som inbjudningspanelen, utan event).
  const [q, setQ] = useState('');
  const [result, setResult] = useState<InviteOptionsResult | null>(null);
  const [meta, setMeta] = useState<InviteListMeta>();
  const [loadingList, startLoading] = useTransition();
  const req = useRef(0);
  const needMeta = useRef(true);
  useEffect(() => {
    const id = ++req.current;
    const timer = setTimeout(
      () =>
        startLoading(async () => {
          let res: InviteOptionsResult;
          try {
            res = await listCampaignRecipientOptionsAction({ list, q, withMeta: needMeta.current });
          } catch (err) {
            res = { error: actionErrorMessage(err, 'Kunde inte läsa listan. Ladda om sidan och försök igen.'), items: [], total: 0 };
          }
          if (id !== req.current) return;
          setResult(res);
          if (res.meta) {
            setMeta(res.meta);
            needMeta.current = false;
          }
          // Fyll i namn på redan valda mottagare när de syns i listan.
          setPicked((prev) => {
            let changed = false;
            const next = new Map(prev);
            for (const i of res.items) if (next.has(i.key) && !next.get(i.key)) (next.set(i.key, i.name), (changed = true));
            return changed ? next : prev;
          });
        }),
      q ? 250 : 0
    );
    return () => clearTimeout(timer);
  }, [list, q]);

  const mark = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
  };

  const editable = campaign.status === 'draft' || campaign.status === 'scheduled';
  const isTemplate = campaign.is_template;
  const event = events.find((e) => e.id === eventId) ?? null;
  const needsEvent = blocksNeedEvent(blocks);
  const sender = staff.find((s) => s.id === senderUserId);

  // Förhandsgranskningen — exakt samma renderare som utskicket (§ 54.5).
  const rendered = useMemo(
    () =>
      renderCampaignEmail({
        subject,
        preheader,
        blocks,
        design,
        merge: {
          ...EMAIL_SAMPLE_MERGE,
          sender_name: senderName || orgName,
          event_name: event?.name ?? EMAIL_SAMPLE_MERGE.event_name,
          event_when: event?.starts_at ? formatStockholmDateTime(event.starts_at) : EMAIL_SAMPLE_MERGE.event_when,
          event_location: event?.location ?? EMAIL_SAMPLE_MERGE.event_location
        },
        links: { unsubscribe: '#', preferences: '#', rsvpYes: event ? '#' : null, rsvpNo: event ? '#' : null, calendar: event ? '#' : null },
        reasonText: emailReasonText('contact', category, consentMode),
        orgName
      }),
    [subject, preheader, blocks, design, senderName, orgName, event, category, consentMode]
  );
  const findings = useMemo(
    () =>
      checkEmailDeliverability({
        subject,
        preheader,
        textLength: rendered.textLength,
        imageCount: rendered.imageCount,
        links: rendered.links,
        hasReplyTo: Boolean(sender?.hasEmail) || replyToConfigured,
        senderName,
        layout: design.layout,
        category,
        consentMode
      }),
    [subject, preheader, rendered, sender, replyToConfigured, senderName, design.layout, category, consentMode]
  );
  const verdict = deliverabilityVerdict(findings);
  const verdictTone = verdict === 'ok' ? 'gron' : verdict === 'warn' ? 'gul' : 'orange';

  const payload = () => ({
    id: campaign.id,
    title,
    subject,
    preheader,
    category,
    consent_mode: consentMode,
    blocks,
    design,
    sender_name: senderName,
    senderUserId,
    eventId,
    surveyId,
    audience: { list, keys: [...picked.keys()], event_group: eventId && eventGroup ? eventGroup : null }
  });

  const run = (fn: () => Promise<CampaignActionState>, after?: (s: CampaignActionState) => void) =>
    startBusy(async () => {
      let res: CampaignActionState;
      try {
        res = await fn();
      } catch (err) {
        res = { error: actionErrorMessage(err, 'Något gick fel. Ladda om sidan och försök igen.') };
      }
      setState(res);
      if (res.ok) after?.(res);
    });

  const save = (then?: () => Promise<CampaignActionState>) =>
    run(async () => {
      const saved = await saveCampaignAction(payload());
      if (!saved.ok) return saved;
      setDirty(false);
      if (!then) return saved;
      const next = await then();
      return next.ok && saved.warning ? { ...next, warning: saved.warning } : next;
    }, () => router.refresh());

  const split = splitInviteSelection(picked.keys());
  const hasGroup = Boolean(eventId && eventGroup);
  const summary = [
    hasGroup ? EMAIL_EVENT_GROUP_LABELS[eventGroup as EmailEventGroup].toLowerCase() : '',
    split.contactIds.length ? `${split.contactIds.length} ${split.contactIds.length === 1 ? 'kontakt' : 'kontakter'}` : '',
    split.userIds.length ? `${split.userIds.length} användare` : '',
    split.startupIds.length ? `${split.startupIds.length} bolag` : ''
  ].filter(Boolean);
  const items = result?.items ?? [];
  const selectable = items.filter((i) => i.selectable);
  const allPicked = selectable.length > 0 && selectable.every((i) => picked.has(i.key));
  const toggle = (entries: InviteOption[], on: boolean) => {
    setPicked((prev) => {
      const next = new Map(prev);
      for (const i of entries) (on ? next.set(i.key, i.name) : next.delete(i.key));
      return next;
    });
    setDirty(true);
  };

  const updateBlock = (idx: number, b: EmailBlock) => mark(setBlocks)(blocks.map((x, i) => (i === idx ? b : x)));
  const moveBlock = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    mark(setBlocks)(next);
  };

  const sendNow = () => {
    if (picked.size === 0 && !hasGroup) return setState({ error: 'Välj mottagare först.' });
    if (!window.confirm(`Skicka "${subject || title}" till ${summary.join(', ')} nu? Det går inte att ångra.`)) return;
    save(() => sendCampaignNowAction(campaign.id));
  };
  const schedule = () => {
    if (!sendAt) return setState({ error: 'Välj en tidpunkt.' });
    save(() => scheduleCampaignAction({ id: campaign.id, sendAt }));
  };

  const frameWidth = preview === 'mobile' ? 390 : '100%';

  return (
    <div className="space-y-4 py-4">
      <div className="mx-flex mx-items-c mx-gap-2" style={{ flexWrap: 'wrap' }}>
        <Link href="/inflode/kampanjer" className="mx-btn mx-sm">
          <Icon name="back" size={12} /> Kampanjer
        </Link>
        <span className="mx-t-xs mx-muted mx-mono">
          {isTemplate ? 'Mall' : EMAIL_CAMPAIGN_STATUS_LABELS[campaign.status]}
          {campaign.status === 'scheduled' && campaign.send_at ? ` · ${formatStockholmDateTime(campaign.send_at)}` : ''}
          {campaign.last_test_at ? ` · test skickat ${formatStockholmDateTime(campaign.last_test_at)}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        {dirty && <span className="mx-t-xs" style={{ color: 'var(--movexum-morkgul)' }}>Osparade ändringar</span>}
        <button type="button" className="mx-btn mx-sm mx-primary" disabled={busy || !editable} onClick={() => save()}>
          Spara
        </button>
      </div>
      <Notice state={state} />
      {!editable && (
        <div className="mx-t-13" style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--movexum-pastell-gul)', color: 'var(--movexum-morkgul)' }}>
          Utskicket är {EMAIL_CAMPAIGN_STATUS_LABELS[campaign.status].toLowerCase()} och kan inte ändras. Duplicera det för att skicka igen.
        </div>
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
        {/* ── Vänster: innehåll ─────────────────────────────── */}
        <div className="space-y-4">
          <Card style={{ padding: 16 }}>
            <div className="grid gap-3">
              <Field label="Namn (internt)">
                <input className="mx-input" value={title} maxLength={120} disabled={!editable} onChange={(e) => mark(setTitle)(e.target.value)} />
              </Field>
              <Field label="Ämnesrad" hint={`${subject.length}/70 tecken syns i de flesta klienter. Platshållare fungerar: {{förnamn|du}}, {{event.namn}}.`}>
                <input className="mx-input" value={subject} maxLength={150} disabled={!editable} onChange={(e) => mark(setSubject)(e.target.value)} />
              </Field>
              <Field label="Förhandsrad" hint="Texten som visas efter ämnesraden i inkorgen.">
                <input className="mx-input" value={preheader} maxLength={200} disabled={!editable} onChange={(e) => mark(setPreheader)(e.target.value)} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Kategori" hint={EMAIL_CATEGORY_DESCRIPTIONS[category]}>
                  <select className="mx-input" value={category} disabled={!editable} onChange={(e) => mark(setCategory)(e.target.value as EmailCategory)}>
                    {EMAIL_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {EMAIL_CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Rättslig grund"
                  hint={
                    consentMode === 'consent_only'
                      ? 'Bara kontakter med registrerat nyhetsbrevssamtycke får mejlet; användare och bolag utesluts.'
                      : 'Kontaktnätet nås på berättigat intresse med avregistrering i varje mejl; bolag och personal som del av programmet.'
                  }
                >
                  <select className="mx-input" value={consentMode} disabled={!editable} onChange={(e) => mark(setConsentMode)(e.target.value as EmailConsentMode)}>
                    {EMAIL_CONSENT_MODES.map((m) => (
                      <option key={m} value={m}>
                        {EMAIL_CONSENT_MODE_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Avsändare (kollega)" hint={sender ? (sender.hasEmail ? 'Svar går direkt till kollegans inkorg.' : 'Kollegan saknar e-post — svar går till standardadressen.') : 'Utan kollega: organisationens namn och standardsvarsadress.'}>
                  <select className="mx-input" value={senderUserId} disabled={!editable} onChange={(e) => mark(setSenderUserId)(e.target.value)}>
                    <option value="">{orgName}</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Avsändarnamn (visas i inkorgen)">
                  <input className="mx-input" value={senderName} maxLength={80} disabled={!editable} placeholder={sender ? `${sender.name} · ${orgName}` : orgName} onChange={(e) => mark(setSenderName)(e.target.value)} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Kopplat event" hint={needsEvent && !eventId ? 'Innehållet har eventblock — koppla ett event innan utskick.' : 'Ger tid, plats, kalenderfil, svarsknappar och biljett.'}>
                  <select
                    className="mx-input"
                    value={eventId}
                    disabled={!editable}
                    onChange={(e) => {
                      mark(setEventId)(e.target.value);
                      if (!e.target.value) setEventGroup('');
                    }}
                  >
                    <option value="">Inget event</option>
                    {events.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                        {e.starts_at ? ` · ${formatStockholmDateTime(e.starts_at)}` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Kopplad utvärdering"
                  hint={surveyId ? 'Platshållaren {{utvärdering.länk}} blir enkätens publika länk.' : 'Välj enkäten för "Tack och utvärdering" — knappen visas bara när en är kopplad.'}
                >
                  <select className="mx-input" value={surveyId} disabled={!editable} onChange={(e) => mark(setSurveyId)(e.target.value)}>
                    <option value="">Ingen utvärdering</option>
                    {surveys
                      .filter((sv) => !eventId || !sv.event || sv.event === eventId)
                      .map((sv) => (
                        <option key={sv.id} value={sv.id}>
                          {sv.name}
                        </option>
                      ))}
                  </select>
                </Field>
              </div>
            </div>
          </Card>

          <Card style={{ padding: 16 }}>
            <div className="mx-flex mx-items-c mx-gap-2" style={{ marginBottom: 10 }}>
              <span className="mx-fw-6 mx-t-13">Innehåll</span>
              <span style={{ flex: 1 }} />
              <select className="mx-input" style={{ width: 'auto' }} value={addType} onChange={(e) => setAddType(e.target.value as EmailBlockType)} disabled={!editable}>
                {EMAIL_BLOCK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {EMAIL_BLOCK_LABELS[t]}
                  </option>
                ))}
              </select>
              <button type="button" className="mx-btn mx-sm" disabled={!editable || blocks.length >= 40} onClick={() => mark(setBlocks)([...blocks, newBlock(addType)])}>
                <Icon name="plus" size={12} /> Lägg till
              </button>
            </div>
            <div className="grid gap-2">
              {blocks.length === 0 && <p className="mx-t-13 mx-muted">Inget innehåll än — lägg till en rubrik och en text.</p>}
              {blocks.map((b, i) => (
                <BlockEditor
                  key={b.id}
                  block={b}
                  first={i === 0}
                  last={i === blocks.length - 1}
                  onChange={(nb) => updateBlock(i, nb)}
                  onRemove={() => mark(setBlocks)(blocks.filter((_, j) => j !== i))}
                  onMove={(dir) => moveBlock(i, dir)}
                />
              ))}
            </div>
            <details style={{ marginTop: 10 }}>
              <summary className="mx-t-xs mx-muted" style={{ cursor: 'pointer' }}>
                Platshållare du kan använda i texten
              </summary>
              <ul className="mx-t-xs mx-muted" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {EMAIL_MERGE_FIELDS.map((m) => (
                  <li key={m.token}>
                    <code>{m.token}</code> — {m.label}
                  </li>
                ))}
              </ul>
            </details>
          </Card>

          <Card style={{ padding: 16 }}>
            <div className="mx-fw-6 mx-t-13" style={{ marginBottom: 10 }}>
              Utseende
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Layout" hint={design.layout === 'plain' ? 'Enkelt textmejl — ser ut som ett personligt mejl och hamnar oftare i Primär.' : 'Brandat kort med accentbalk och logotyp.'}>
                <select className="mx-input" value={design.layout} disabled={!editable} onChange={(e) => mark(setDesign)({ ...design, layout: e.target.value as EmailLayout })}>
                  {EMAIL_LAYOUTS.map((l) => (
                    <option key={l} value={l}>
                      {EMAIL_LAYOUT_LABELS[l]}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="mx-field">
                <span className="mx-label">Accentfärg</span>
                <div className="mx-flex mx-gap-2" style={{ flexWrap: 'wrap' }}>
                  {EMAIL_ACCENTS.map((a: EmailAccent) => (
                    <button
                      key={a}
                      type="button"
                      title={EMAIL_ACCENT_LABELS[a]}
                      aria-pressed={design.accent === a}
                      disabled={!editable}
                      onClick={() => mark(setDesign)({ ...design, accent: a })}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 999,
                        background: EMAIL_ACCENT_HEX[a],
                        border: design.accent === a ? '3px solid var(--color-foreground)' : '3px solid transparent',
                        cursor: 'pointer'
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
            {design.layout === 'card' && (
              <label className="mx-t-13 mx-flex mx-items-c mx-gap-2" style={{ marginTop: 8 }}>
                <input type="checkbox" checked={design.show_logo} disabled={!editable} onChange={(e) => mark(setDesign)({ ...design, show_logo: e.target.checked })} /> Visa logotyp
              </label>
            )}
          </Card>

          {!isTemplate && (
            <Card style={{ padding: 16 }}>
              <div className="mx-flex mx-items-c mx-gap-2" style={{ marginBottom: 10 }}>
                <span className="mx-fw-6 mx-t-13">Mottagare</span>
                <span className="mx-t-xs mx-muted">{summary.length ? summary.join(', ') : 'inga valda'}</span>
                <span style={{ flex: 1 }} />
                {picked.size > 0 && editable && (
                  <button type="button" className="mx-btn mx-sm" onClick={() => (setPicked(new Map()), setDirty(true))}>
                    Rensa alla
                  </button>
                )}
              </div>
              {eventId && (
                <Field
                  label="Eventets deltagarlista"
                  hint="Samma rader som svaren och närvaron — inbjudna, anmälda eller närvarande. Kombineras med egna val nedan; spärrade och avregistrerade räknas bort vid utskick."
                >
                  <select
                    className="mx-input"
                    value={eventGroup}
                    disabled={!editable}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEventGroup(isEmailEventGroup(v) ? v : '');
                      setDirty(true);
                    }}
                  >
                    <option value="">Ingen grupp — bara mottagare jag väljer</option>
                    {EMAIL_EVENT_GROUPS.map((g) => (
                      <option key={g} value={g}>
                        {EMAIL_EVENT_GROUP_LABELS[g]}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <div className="grid gap-2 sm:grid-cols-2" style={{ marginTop: eventId ? 10 : 0 }}>
                <ListSelect value={list} onChange={(v) => mark(setList)(v)} meta={meta} />
                <input className="mx-input" placeholder="Sök namn, organisation…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              {result?.error && <p className="mx-t-13" style={{ color: 'var(--movexum-morkorange)' }}>{result.error}</p>}
              <div style={{ maxHeight: 320, overflow: 'auto', marginTop: 8, border: '1px solid var(--mx-line-soft)', borderRadius: 10 }}>
                {selectable.length > 0 && editable && (
                  <label className="mx-t-13 mx-flex mx-items-c mx-gap-2" style={{ padding: '7px 8px', borderBottom: '1px solid var(--mx-line-soft)', background: 'var(--color-canvas-subtle)' }}>
                    <input type="checkbox" checked={allPicked} onChange={(e) => toggle(selectable, e.target.checked)} />
                    <span className="mx-fw-6">Välj alla i listan som kan nås ({selectable.length})</span>
                  </label>
                )}
                {loadingList && items.length === 0 && <p className="mx-t-13 mx-muted" style={{ padding: 10 }}>Läser…</p>}
                {!loadingList && items.length === 0 && <p className="mx-t-13 mx-muted" style={{ padding: 10 }}>Inga träffar.</p>}
                {items.map((item) => (
                  <label
                    key={item.key}
                    className="mx-t-13 mx-flex mx-items-c mx-gap-2"
                    style={{ padding: '6px 8px', borderBottom: '1px solid var(--mx-line-soft)', opacity: item.selectable ? 1 : 0.55 }}
                  >
                    <input type="checkbox" checked={picked.has(item.key)} disabled={!item.selectable || !editable} onChange={(e) => toggle([item], e.target.checked)} />
                    <span style={{ flex: 1, minWidth: 0 }} className="mx-truncate">
                      {item.name}
                      {item.detail ? <span className="mx-muted"> · {item.detail}</span> : null}
                    </span>
                    <span className="mx-mono mx-t-xs mx-muted">{item.note || KIND_LABEL[item.kind]}</span>
                  </label>
                ))}
                {result && result.total > items.length && (
                  <p className="mx-t-xs mx-muted" style={{ padding: 8 }}>
                    Visar {items.length} av {result.total} — sök för att hitta fler.
                  </p>
                )}
              </div>
              {picked.size > 0 && (
                <div className="mx-flex mx-gap-1" style={{ flexWrap: 'wrap', marginTop: 8 }}>
                  {[...picked.entries()].slice(0, 60).map(([key, name]) => (
                    <span key={key} className="mx-t-xs" style={{ padding: '2px 8px', borderRadius: 999, background: 'var(--color-canvas-muted)' }}>
                      {name || key}
                      {editable && (
                        <button type="button" aria-label="Ta bort" onClick={() => toggle([{ key } as InviteOption], false)} style={{ marginLeft: 4, border: 0, background: 'none', cursor: 'pointer' }}>
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                  {picked.size > 60 && <span className="mx-t-xs mx-muted">+{picked.size - 60} till</span>}
                </div>
              )}
              <div className="mx-flex mx-items-c mx-gap-2" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="mx-btn mx-sm"
                  disabled={busy || (picked.size === 0 && !hasGroup)}
                  onClick={() =>
                    run(async () => {
                      const saved = await saveCampaignAction(payload());
                      if (!saved.ok) return saved;
                      setDirty(false);
                      const res = await previewRecipientsAction(campaign.id);
                      setRecipientPreview(res);
                      return res.ok ? { ok: true, notice: `${res.sendable} av ${res.total} kan nås.` } : res;
                    })
                  }
                >
                  Kontrollera mottagarna
                </button>
                <span className="mx-t-xs mx-muted">Räknar bort spärrade, avregistrerade och saknade adresser innan utskick.</span>
              </div>
              {recipientPreview?.ok && recipientPreview.blocked && recipientPreview.blocked.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary className="mx-t-xs" style={{ cursor: 'pointer' }}>
                    {recipientPreview.blocked.length} får inte mejlet — visa varför
                  </summary>
                  <ul className="mx-t-xs mx-muted" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {recipientPreview.blocked.map((b, i) => (
                      <li key={i}>
                        {b.name}
                        {b.organization ? ` (${b.organization})` : ''}: {b.why}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          )}
        </div>

        {/* ── Höger: förhandsgranskning + leverans ─────────── */}
        <div className="space-y-4" style={{ position: 'sticky', top: 12, alignSelf: 'start' }}>
          <Card style={{ padding: 12 }}>
            <div className="mx-flex mx-items-c mx-gap-2" style={{ marginBottom: 8 }}>
              <span className="mx-fw-6 mx-t-13">Förhandsgranskning</span>
              <span style={{ flex: 1 }} />
              {(['desktop', 'mobile', 'text'] as const).map((p) => (
                <button key={p} type="button" className={`mx-btn mx-sm${preview === p ? ' mx-primary' : ''}`} onClick={() => setPreview(p)}>
                  {p === 'desktop' ? 'Dator' : p === 'mobile' ? 'Mobil' : 'Ren text'}
                </button>
              ))}
            </div>
            <div className="mx-t-xs mx-muted" style={{ marginBottom: 6 }}>
              <strong>{senderName || sender?.name || orgName}</strong> · {subject || <em>ingen ämnesrad</em>}
              {preheader ? <span> — {preheader}</span> : null}
            </div>
            {preview === 'text' ? (
              <pre className="mx-t-xs" style={{ whiteSpace: 'pre-wrap', margin: 0, padding: 12, background: 'var(--color-canvas-subtle)', borderRadius: 10, maxHeight: 640, overflow: 'auto' }}>
                {rendered.text}
              </pre>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'center', background: 'var(--color-canvas-muted)', borderRadius: 10, padding: 8 }}>
                <iframe
                  title="Förhandsgranskning av mejlet"
                  sandbox=""
                  srcDoc={rendered.html}
                  style={{ width: frameWidth, maxWidth: '100%', height: 640, border: 0, background: '#fff', borderRadius: 8 }}
                />
              </div>
            )}
            <p className="mx-t-xs mx-muted" style={{ margin: '8px 0 0' }}>
              Exempeldata (Anna Svensson) i platshållarna. Mejlet renderas med exakt samma kod som utskicket.
            </p>
          </Card>

          <Card style={{ padding: 12, borderLeft: `4px solid var(--movexum-mork${verdictTone})` }}>
            <div className="mx-fw-6 mx-t-13" style={{ marginBottom: 6 }}>
              Leveransbarhet: {verdict === 'ok' ? 'ser bra ut' : verdict === 'warn' ? 'några saker att se över' : 'åtgärda innan utskick'}
            </div>
            {findings.length === 0 ? (
              <p className="mx-t-13 mx-muted" style={{ margin: 0 }}>
                Inga varningar. Skicka ett testmejl till dig själv och kontrollera att det landar i Primär.
              </p>
            ) : (
              <ul className="mx-t-13" style={{ margin: 0, paddingLeft: 18 }}>
                {findings.map((f, i) => (
                  <li key={i} style={{ color: f.level === 'alert' ? 'var(--movexum-morkorange)' : f.level === 'warn' ? 'var(--movexum-morkgul)' : 'inherit' }}>
                    {f.text}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card style={{ padding: 12 }}>
            <div className="mx-fw-6 mx-t-13" style={{ marginBottom: 8 }}>
              {isTemplate ? 'Mall' : 'Skicka'}
            </div>
            <div className="mx-flex mx-gap-2" style={{ flexWrap: 'wrap' }}>
              {!isTemplate && (
                <button type="button" className="mx-btn mx-sm" disabled={busy || !editable} onClick={() => save(() => sendTestAction(campaign.id))} title={`Skickas till ${meEmail}`}>
                  <Icon name="send" size={12} /> Testmejl till mig
                </button>
              )}
              <button type="button" className="mx-btn mx-sm" disabled={busy} onClick={() => run(() => saveCampaignAsTemplateAction({ id: campaign.id }))}>
                Spara som mall
              </button>
              <button
                type="button"
                className="mx-btn mx-sm"
                disabled={busy}
                onClick={() => run(() => createCampaignAction({ fromId: campaign.id }), (s) => s.path && router.push(s.path))}
              >
                <Icon name="copy" size={12} /> {isTemplate ? 'Ny kampanj från mallen' : 'Duplicera'}
              </button>
              <button
                type="button"
                className="mx-btn mx-sm"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`Ta bort "${title || subject}"?`)) return;
                  run(() => deleteCampaignAction(campaign.id), () => router.push('/inflode/kampanjer'));
                }}
              >
                <Icon name="trash" size={12} /> Ta bort
              </button>
            </div>
            {!isTemplate && editable && (
              <div style={{ marginTop: 12, borderTop: '1px solid var(--mx-line-soft)', paddingTop: 12 }} className="grid gap-2">
                {campaign.status === 'scheduled' ? (
                  <div className="mx-flex mx-items-c mx-gap-2" style={{ flexWrap: 'wrap' }}>
                    <span className="mx-t-13">
                      Schemalagt till <strong>{formatStockholmDateTime(campaign.send_at)}</strong>.
                    </span>
                    <button type="button" className="mx-btn mx-sm" disabled={busy} onClick={() => run(() => cancelScheduleAction(campaign.id), () => router.refresh())}>
                      Avbryt schemaläggningen
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="mx-flex mx-items-c mx-gap-2" style={{ flexWrap: 'wrap' }}>
                      <input type="datetime-local" className="mx-input" style={{ width: 'auto' }} value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
                      <button type="button" className="mx-btn mx-sm" disabled={busy || (picked.size === 0 && !hasGroup)} onClick={schedule}>
                        <Icon name="clock" size={12} /> Schemalägg
                      </button>
                      <span style={{ flex: 1 }} />
                      <button type="button" className="mx-btn mx-sm mx-primary" disabled={busy || (picked.size === 0 && !hasGroup)} onClick={sendNow}>
                        <Icon name="send" size={12} /> Skicka nu
                      </button>
                    </div>
                    <span className="mx-t-xs mx-muted">
                      Svensk tid. Bästa tiderna för Primär-inkorgen är tisdag–torsdag 08–10 — och ett testmejl först är alltid rätt.
                    </span>
                  </>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
