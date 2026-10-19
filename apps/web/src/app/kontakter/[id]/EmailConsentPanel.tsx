'use client';

import { useState, useTransition } from 'react';
import { actionErrorMessage } from '@/lib/action-error';
import { setNewsletterConsentAction, type CampaignActionState } from '@/lib/actions/email-campaigns';
import {
  CONTACT_EMAIL_STATUS_LABELS,
  EMAIL_CATEGORY_LABELS,
  formatStockholmDateTime,
  isEmailCategory,
  type ContactEmailStatus
} from '@platform/shared';
import { Panel } from '../ui';

/**
 * Kontaktens utskicksläge (§ 55.1/§ 55.9): e-poststatus (studsar, klagomål,
 * avregistrerad), avstängda kategorier (preferenscentret), avregistrering
 * från inbjudningar och nyhetsbrevssamtycke (med källa). Samtycket kan
 * registreras för hand när personen sagt ja på annat sätt — källan blir då
 * "staff" och syns här; dubbel opt-in via webben har källan "double_opt_in".
 */
export function EmailConsentPanel({
  contactId,
  hasEmail,
  emailStatus,
  emailStatusAt,
  optOut,
  inviteOptOut,
  newsletterConsent,
  newsletterConsentAt,
  newsletterConsentSource,
  canEdit
}: {
  contactId: string;
  hasEmail: boolean;
  emailStatus: ContactEmailStatus | null;
  emailStatusAt: string | null;
  optOut: string[];
  inviteOptOut: boolean;
  newsletterConsent: boolean;
  newsletterConsentAt: string | null;
  newsletterConsentSource: string | null;
  canEdit: boolean;
}) {
  const [consent, setConsent] = useState(newsletterConsent);
  const [state, setState] = useState<CampaignActionState | null>(null);
  const [busy, start] = useTransition();
  const all = optOut.includes('all');
  const categories = optOut.filter(isEmailCategory);
  const blocked = Boolean(emailStatus) || all;

  const toggle = (next: boolean) =>
    start(async () => {
      try {
        const res = await setNewsletterConsentAction({ contactId, consent: next });
        setState(res);
        if (res.ok) setConsent(next);
      } catch (err) {
        setState({ error: actionErrorMessage(err, 'Kunde inte spara.') });
      }
    });

  return (
    <Panel
      title="Utskick & samtycke"
      meta={
        blocked ? (
          <span className="inline-flex rounded-full bg-movexum-pastell-orange px-2 py-0.5 text-[11px] font-semibold text-movexum-morkorange">
            {emailStatus ? CONTACT_EMAIL_STATUS_LABELS[emailStatus] : 'Alla utskick avstängda'}
          </span>
        ) : hasEmail ? (
          <span className="inline-flex rounded-full bg-movexum-pastell-gron px-2 py-0.5 text-[11px] font-semibold text-movexum-morkgron">Kan nås</span>
        ) : (
          <span className="text-xs text-foreground-subtle">Ingen e-post</span>
        )
      }
    >
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold text-foreground-subtle">E-poststatus</dt>
          <dd className="text-foreground">
            {emailStatus ? `${CONTACT_EMAIL_STATUS_LABELS[emailStatus]}${emailStatusAt ? ` · ${formatStockholmDateTime(emailStatusAt)}` : ''}` : 'Inga problem registrerade'}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-foreground-subtle">Avstängda utskick</dt>
          <dd className="text-foreground">
            {all ? 'Alla kategorier' : categories.length ? categories.map((c) => EMAIL_CATEGORY_LABELS[c]).join(', ') : 'Inga'}
            {inviteOptOut ? (all || categories.length ? ' · inbjudningar' : 'Inbjudningar') : ''}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold text-foreground-subtle">Nyhetsbrev</dt>
          <dd className="mt-1 flex flex-wrap items-center gap-3 text-foreground">
            <span>
              {consent ? 'Samtycke registrerat' : 'Inget samtycke'}
              {consent && newsletterConsentAt ? ` · ${formatStockholmDateTime(newsletterConsentAt)}` : ''}
              {consent && newsletterConsentSource ? ` · källa: ${newsletterConsentSource === 'double_opt_in' ? 'dubbel opt-in (webben)' : newsletterConsentSource === 'preference_center' ? 'preferenscentret' : newsletterConsentSource}` : ''}
            </span>
            {canEdit && hasEmail && (
              <button type="button" className="mx-btn mx-sm" disabled={busy} onClick={() => toggle(!consent)}>
                {consent ? 'Ta bort samtycket' : 'Registrera samtycke'}
              </button>
            )}
          </dd>
        </div>
      </dl>
      {state?.error && (
        <p className="mt-2 text-xs" style={{ color: 'var(--movexum-morkorange)' }}>
          {state.error}
        </p>
      )}
      <p className="mt-3 text-xs text-foreground-subtle">
        Kampanjer med rättslig grund &ldquo;bara samtycke&rdquo; går enbart till kontakter med registrerat nyhetsbrevssamtycke. Statusar sätts automatiskt av studsar, klagomål och avregistreringar.
      </p>
    </Panel>
  );
}
