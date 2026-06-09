'use client';

// Besökarens eget val (migration 1700000125): bli kontaktad av Movexum efter
// inskickat formulär, eller höra av sig själv när hen är redo. Frivilligt —
// inget förval, värdet skickas bara om besökaren aktivt väljer.

const OPTIONS = [
  {
    value: 'contact_me',
    label: 'Jag vill att Movexum kontaktar mig',
    hint: 'Någon från Movexum hör av sig på dina kontaktuppgifter.'
  },
  {
    value: 'self_reach',
    label: 'Jag hör av mig själv när jag är redo',
    hint: 'Vi väntar på dig — ingen kontakt från oss.'
  }
] as const;

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function ContactPreferencePicker({ value, onChange }: Props) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6">Hur vill du gå vidare?</div>
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <label
            key={opt.value}
            className="mx-t-13"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 12,
              border: `1px solid ${active ? '#002c40' : 'var(--mx-line)'}`,
              background: active ? 'var(--mx-cyan-tint-2)' : 'var(--mx-paper)',
              cursor: 'pointer'
            }}
          >
            <input
              type="radio"
              name="contact_preference"
              value={opt.value}
              checked={active}
              onChange={() => onChange(opt.value)}
              style={{ marginTop: 2 }}
            />
            <span style={{ display: 'grid', gap: 2 }}>
              <span className="mx-fw-6">{opt.label}</span>
              <span className="mx-t-12 mx-muted">{opt.hint}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
