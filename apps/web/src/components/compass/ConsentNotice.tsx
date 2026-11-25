'use client';

import { useCompassLocale } from './locale';

/**
 * Samtyckestexten (GDPR art. 7/13) där besökaren slutför — sista steget i
 * formulär/quiz, chattens avslutssteg och under chattens skrivfält. Ersätter
 * den tidigare samtyckesgrinden på första sidan (2026-11). Utan text på
 * modulen renderas ingenting.
 */
export function ConsentNotice({ note, variant = 'submit' }: { note?: string | null; variant?: 'submit' | 'chat' }) {
  const { t } = useCompassLocale();
  const text = (note || '').trim();
  if (!text) return null;
  return (
    <p className="mx-consent-note">
      <strong>{variant === 'chat' ? t.consentOnChat : t.consentOnSubmit}</strong> {text}
    </p>
  );
}
