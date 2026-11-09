'use client';

import {
  CONTACT_FIELD_META,
  FOUNDER_GENDER_OPTIONS,
  KOMMUN_OPTIONS,
  REFERRAL_CHANNEL_OPTIONS,
  visibleContactFields,
  type ContactFieldKey,
  type ContactSectionConfig
} from '@platform/shared';

interface Props {
  config: ContactSectionConfig;
  values: Record<string, string>;
  onChange: (key: ContactFieldKey, value: string) => void;
  /** Rubrik över avsnittet (default "Dina uppgifter"). */
  title?: string;
  /** Visa rubrik + ingress (chattens avslutssteg har en egen). */
  heading?: boolean;
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
export function ContactSection({ config, values, onChange, title = 'Dina uppgifter', heading = true }: Props) {
  const fields = visibleContactFields(config);
  if (fields.length === 0) return null;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {heading && (
        <div>
          <div className="mx-qprompt">{title}</div>
          <p className="mx-muted mx-t-12" style={{ margin: '6px 0 0', lineHeight: 1.55 }}>
            Fält märkta * är obligatoriska. Vi hanterar dina uppgifter inom EU och delar dem aldrig
            vidare.
          </p>
        </div>
      )}
      {fields.map((key) => {
        const meta = CONTACT_FIELD_META[key];
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
                <option value="">{required ? 'Välj …' : 'Välj (frivilligt)'}</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
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
                placeholder={'Anna Andersson, anna@exempel.se\nBo Berg, bo@exempel.se'}
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
              className="mx-input"
              style={{ marginTop: 4 }}
              value={value}
              maxLength={meta.max}
              autoComplete={key === 'name' ? 'name' : key === 'email' ? 'email' : key === 'phone' ? 'tel' : undefined}
              onChange={(e) => onChange(key, e.target.value)}
            />
            {hint}
          </label>
        );
      })}
    </div>
  );
}
