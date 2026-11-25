'use client';

import { useRef, useState } from 'react';
import {
  CONTACT_ATTACHMENT_ACCEPT,
  CONTACT_ATTACHMENT_MAX_FILES,
  CONTACT_FIELD_META,
  contactFieldText,
  contactOptionText,
  FOUNDER_GENDER_OPTIONS,
  KOMMUN_OPTIONS,
  REFERRAL_CHANNEL_OPTIONS,
  visibleContactFields,
  type ContactFieldKey,
  type ContactSectionConfig,
  validateContactAttachment
} from '@platform/shared';
import { useCompassLocale } from './locale';

interface Props {
  config: ContactSectionConfig;
  values: Record<string, string>;
  onChange: (key: ContactFieldKey, value: string) => void;
  /** Rubrik över avsnittet (default "Dina uppgifter"). */
  title?: string;
  /** Visa rubrik + ingress (chattens avslutssteg har en egen). */
  heading?: boolean;
  /**
   * Bilagor (§ 23.12): publika flöden laddar upp direkt till
   * `/api/public/m/<slug>/attachments` med flödets sessionstoken. Saknas
   * (admin-förhandsgranskning) visas en not i stället för filväljaren.
   */
  attachmentUpload?: { endpoint: string; sessionToken: string; consent?: boolean };
}

interface UploadedFile {
  id: string;
  filename: string;
  size: number;
}

function formatBytes(n: number, locale: 'sv' | 'en' = 'sv'): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toLocaleString(locale === 'en' ? 'en-GB' : 'sv-SE', { maximumFractionDigits: 1 })} MB`;
}

const OPTIONS_BY_FIELD: Partial<Record<ContactFieldKey, readonly { value: string; label: string }[]>> = {
  founder_gender: FOUNDER_GENDER_OPTIONS,
  kommun: KOMMUN_OPTIONS,
  referral_channel: REFERRAL_CHANNEL_OPTIONS
};

const INPUT_TYPE: Partial<Record<ContactFieldKey, string>> = {
  email: 'email',
  phone: 'tel'
};

/**
 * Avsnittet "Dina uppgifter" sist i ett intag-flöde (§ 23.11). Renderar de
 * fält modulen konfigurerat (steg 4 i modul-admin) i fast ordning: namn,
 * e-post, telefon, organisation, kön på grundare (fasta val, aldrig
 * obligatoriskt), övriga teammedlemmar, kommun (fasta val) och hur besökaren
 * kom i kontakt med Movexum (fasta val). Delas av chattens avslutssteg,
 * quizets kontaktsteg och formulärets sista steg — ingen divergerande kopia.
 * Valideringen (`missingContactField`) körs av föräldern och server-side.
 */
export function ContactSection({
  config,
  values,
  onChange,
  title,
  heading = true,
  attachmentUpload
}: Props) {
  const { locale, t } = useCompassLocale();
  const fields = visibleContactFields(config);
  if (fields.length === 0) return null;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {heading && (
        <div>
          <div className="mx-qprompt">{title ?? t.yourDetails}</div>
          <p className="mx-muted mx-t-12" style={{ margin: '6px 0 0', lineHeight: 1.55 }}>
            {t.requiredNote}
          </p>
        </div>
      )}
      {fields.map((key) => {
        const meta = { ...CONTACT_FIELD_META[key], ...contactFieldText(key, locale) };
        const required = config[key] === 'required';
        const options = OPTIONS_BY_FIELD[key];
        const value = values[key] || '';
        const label = (
          <>
            {meta.label} {required && '*'}
          </>
        );
        const hint = meta.hint ? (
          <span className="mx-t-xs mx-muted" style={{ display: 'block', marginTop: 4, lineHeight: 1.5 }}>
            {meta.hint}
          </span>
        ) : null;
        if (options) {
          return (
            <label className="mx-label" key={key}>
              {label}
              <select
                className="mx-input"
                style={{ marginTop: 4 }}
                value={value}
                required={required}
                onChange={(e) => onChange(key, e.target.value)}
              >
                <option value="">{required ? t.choose : t.chooseOptional}</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {contactOptionText(o, locale)}
                  </option>
                ))}
              </select>
              {hint}
            </label>
          );
        }
        if (key === 'attachments') {
          return (
            <div className="mx-label" key={key}>
              {label}
              {hint}
              {attachmentUpload ? (
                <AttachmentField
                  upload={attachmentUpload}
                  onCount={(n) => onChange('attachments', n > 0 ? String(n) : '')}
                />
              ) : (
                <span className="mx-t-xs mx-muted" style={{ display: 'block', marginTop: 6 }}>
                  {t.attachmentsInPreview}
                </span>
              )}
            </div>
          );
        }
        if (key === 'other_info') {
          return (
            <label className="mx-label" key={key}>
              {label}
              <textarea
                className="mx-textarea"
                style={{ marginTop: 4, minHeight: 96 }}
                value={value}
                maxLength={meta.max}
                onChange={(e) => onChange(key, e.target.value)}
              />
              {hint}
            </label>
          );
        }
        if (key === 'team_members') {
          return (
            <label className="mx-label" key={key}>
              {label}
              <textarea
                className="mx-textarea"
                style={{ marginTop: 4, minHeight: 72 }}
                value={value}
                maxLength={meta.max}
                placeholder={t.teamPlaceholder}
                onChange={(e) => onChange(key, e.target.value)}
              />
              {hint}
            </label>
          );
        }
        return (
          <label className="mx-label" key={key}>
            {label}
            <input
              type={INPUT_TYPE[key] || 'text'}
              inputMode={key === 'website' ? 'url' : undefined}
              placeholder={key === 'website' ? t.websitePlaceholder : undefined}
              className="mx-input"
              style={{ marginTop: 4 }}
              value={value}
              maxLength={meta.max}
              autoComplete={
                key === 'name' ? 'name' : key === 'email' ? 'email' : key === 'phone' ? 'tel' : key === 'website' ? 'url' : undefined
              }
              onChange={(e) => onChange(key, e.target.value)}
            />
            {hint}
          </label>
        );
      })}
    </div>
  );
}

/**
 * Filväljare för bilagor (pitch deck m.m., § 23.12). Varje fil laddas upp
 * direkt vid val; servern validerar typ/storlek igen och nycklar filen på
 * sessionen. Filerna kopplas till leadet först när flödet skickas in.
 */
function AttachmentField({
  upload,
  onCount
}: {
  upload: { endpoint: string; sessionToken: string; consent?: boolean };
  onCount: (n: number) => void;
}) {
  const { locale, t } = useCompassLocale();
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function update(next: UploadedFile[]) {
    setFiles(next);
    onCount(next.length);
  }

  async function uploadAll(list: FileList | File[]) {
    setError(null);
    let current = files;
    for (const file of Array.from(list)) {
      if (current.length >= CONTACT_ATTACHMENT_MAX_FILES) {
        setError(t.maxFiles(CONTACT_ATTACHMENT_MAX_FILES));
        break;
      }
      const checked = validateContactAttachment({ name: file.name, type: file.type, size: file.size });
      if (!checked.ok) {
        setError(`${file.name}: ${t.attachmentError[checked.code]}`);
        continue;
      }
      setBusy(true);
      try {
        const body = new FormData();
        body.set('file', file);
        body.set('sessionToken', upload.sessionToken);
        if (upload.consent) body.set('consent', 'true');
        const res = await fetch(upload.endpoint, { method: 'POST', body });
        const data = (await res.json().catch(() => ({}))) as {
          id?: string;
          filename?: string;
          size?: number;
          error?: string;
        };
        if (!res.ok || !data.id) {
          throw new Error(data.error || t.uploadFailedStatus(res.status));
        }
        current = [...current, { id: data.id, filename: data.filename || file.name, size: data.size ?? file.size }];
        update(current);
      } catch (err) {
        setError(err instanceof Error ? err.message : t.uploadFailed);
      } finally {
        setBusy(false);
      }
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      const res = await fetch(upload.endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, sessionToken: upload.sessionToken })
      });
      if (!res.ok && res.status !== 404) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || t.removeFailed);
      }
      update(files.filter((f) => f.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t.removeFailed);
    }
  }

  const full = files.length >= CONTACT_ATTACHMENT_MAX_FILES;

  return (
    <div style={{ marginTop: 6, display: 'grid', gap: 8, fontWeight: 400 }}>
      {files.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {files.map((f) => (
            <li
              key={f.id}
              className="mx-flex mx-items-c mx-gap-2 mx-t-13"
              style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid var(--mx-line)' }}
            >
              <span aria-hidden>📎</span>
              <span style={{ wordBreak: 'break-all', flex: 1 }}>{f.filename}</span>
              <span className="mx-t-xs mx-muted">{formatBytes(f.size, locale)}</span>
              <button
                type="button"
                className="mx-btn"
                onClick={() => void remove(f.id)}
                aria-label={t.removeFile(f.filename)}
              >
                {t.remove}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (!busy && e.dataTransfer.files.length) void uploadAll(e.dataTransfer.files);
          }}
          style={{
            padding: '14px 12px',
            borderRadius: 12,
            border: `1px dashed ${dragOver ? 'var(--mx-accent, currentColor)' : 'var(--mx-line-strong)'}`,
            textAlign: 'center'
          }}
        >
          <button
            type="button"
            className="mx-btn"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? t.uploading : files.length ? t.attachMore : t.chooseFiles}
          </button>
          <span className="mx-t-xs mx-muted" style={{ display: 'block', marginTop: 4 }}>
            {t.dropHint(CONTACT_ATTACHMENT_MAX_FILES)}
          </span>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={CONTACT_ATTACHMENT_ACCEPT}
            style={{ display: 'none' }}
            onChange={(e) => {
              const list = e.target.files;
              if (list && list.length) void uploadAll(list);
              e.target.value = '';
            }}
          />
        </div>
      )}
      {error && (
        <span className="mx-t-12" role="alert" style={{ color: 'var(--movexum-morkorange)' }}>
          {error}
        </span>
      )}
    </div>
  );
}
