'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Icon } from '@/components/proto';
import { actionErrorMessage } from '@/lib/action-error';
import { createCampaignAction } from '@/lib/actions/email-campaigns';
import type { EmailEventGroup } from '@platform/shared';

/**
 * Startpunkten för utskick kring ett event (CLAUDE.md § 54.3) — EN väg:
 * varje knapp skapar en kampanj från rätt mall, förkopplad till eventet och
 * med eventets deltagarlista som mottagargrupp, och öppnar den i editorn.
 * Där väljs/kompletteras mottagarna, mejlet förhandsgranskas och skickas.
 * Ingen knapp här skickar något.
 */
export function InviteLauncher({
  eventId,
  open,
  counts,
  compact = false
}: {
  eventId: string;
  /** Eventet har inte ägt rum (inbjudan/påminnelse är meningsfulla). */
  open: boolean;
  counts: { unsent?: number; unanswered?: number; confirmed?: number; attended?: number };
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const launch = (templateKey: string, eventGroup?: EmailEventGroup) =>
    start(async () => {
      setError(null);
      try {
        const res = await createCampaignAction({ templateKey, eventId, eventGroup });
        if (res.ok && res.path) router.push(res.path);
        else setError(res.error ?? 'Kunde inte skapa utskicket.');
      } catch (err) {
        setError(actionErrorMessage(err, 'Kunde inte skapa utskicket. Ladda om sidan och försök igen.'));
      }
    });

  const n = (v: number | undefined) => (typeof v === 'number' ? ` (${v})` : '');
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="mx-flex mx-gap-2" style={{ flexWrap: 'wrap' }}>
        {open && (
          <button type="button" className="mx-btn mx-sm mx-primary" disabled={busy} onClick={() => launch('event_invite')} title="Ny inbjudan: välj mottagare i editorn">
            <Icon name="send" size={12} /> Skapa inbjudan
          </button>
        )}
        {open && (counts.unsent ?? 0) > 0 && (
          <button type="button" className="mx-btn mx-sm" disabled={busy} onClick={() => launch('event_invite', 'unsent')}>
            Skicka till ej utskickade{n(counts.unsent)}
          </button>
        )}
        {open && (counts.unanswered ?? 0) > 0 && (
          <button type="button" className="mx-btn mx-sm" disabled={busy} onClick={() => launch('reminder', 'unanswered')}>
            <Icon name="clock" size={12} /> Påminn dem som inte svarat{n(counts.unanswered)}
          </button>
        )}
        {open && (counts.confirmed ?? 0) > 0 && (
          <button type="button" className="mx-btn mx-sm" disabled={busy} onClick={() => launch('confirmed_reminder', 'confirmed')}>
            Vi ses snart till anmälda{n(counts.confirmed)}
          </button>
        )}
        {!open && (counts.attended ?? 0) > 0 && (
          <button type="button" className="mx-btn mx-sm mx-primary" disabled={busy} onClick={() => launch('thank_you', 'attended')}>
            <Icon name="send" size={12} /> Tack och utvärdering till närvarande{n(counts.attended)}
          </button>
        )}
      </div>
      {!compact && (
        <span className="mx-t-xs mx-muted">
          Varje knapp skapar ett utskick i Kampanjer med eventets deltagarlista som mottagare. Du granskar, lägger till fler mottagare och skickar där.
        </span>
      )}
      {error && (
        <span className="mx-t-13" style={{ color: 'var(--movexum-morkorange)' }}>
          {error}
        </span>
      )}
    </div>
  );
}
