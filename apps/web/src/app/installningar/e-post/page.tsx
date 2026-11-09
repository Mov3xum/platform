// Inställningar → E-post & leverans (CLAUDE.md § 55.10).
// Driftvyn för utskicken: är avsändardomänen verifierad i Resend (SPF/DKIM),
// finns DMARC, är webhooken och länkhemligheten satta, hur ser studs- och
// klagomålsnivån ut de senaste 30 dagarna, och spärrlistan (hashade adresser,
// maskerad visning) med manuell spärr och borttagning. Inget här bär
// e-postadresser i klartext annat än den maskerade formen.

import Link from 'next/link';
import { Icon } from '@/components/proto';
import { getServerPb } from '@/lib/auth.server';
import { loadDeliverabilityStatus } from '@/lib/email/deliverability';
import { listSuppressions } from '@/lib/email/suppression';
import { listRecentEmailEvents } from '@/lib/email/campaign-data';
import {
  COMPLAINT_RATE_ALERT,
  COMPLAINT_RATE_WARN,
  EMAIL_SUPPRESSION_REASONS,
  EMAIL_SUPPRESSION_REASON_LABELS,
  deliverabilityHealth,
  formatRate,
  formatStockholmDateTime
} from '@platform/shared';
import { requireSettingsUser, SettingsSectionPage } from '../shared';
import { SuppressionManager } from './SuppressionManager';

export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 30;

function Row({ label, ok, text }: { label: string; ok: boolean | null; text: string }) {
  const tone = ok === null ? 'var(--color-foreground-subtle)' : ok ? 'var(--movexum-morkgron)' : 'var(--movexum-morkorange)';
  return (
    <div className="flex items-start gap-3 border-b border-default py-2 text-sm last:border-0">
      <span style={{ color: tone, marginTop: 2 }}>
        <Icon name={ok === null ? 'dot' : ok ? 'check' : 'alert'} size={13} />
      </span>
      <span className="w-44 shrink-0 font-semibold">{label}</span>
      <span className="text-foreground-muted">{text}</span>
    </div>
  );
}

export default async function EpostPage() {
  const user = await requireSettingsUser();
  const pb = await getServerPb();
  const [status, suppressions, events] = await Promise.all([
    loadDeliverabilityStatus(),
    listSuppressions(pb, user.tenant, { perPage: 200 }),
    listRecentEmailEvents(pb, user.tenant, WINDOW_DAYS)
  ]);

  const count = (type: string) => events.rows.filter((e) => e.type === type).length;
  const delivered = count('delivered');
  const bounced = count('bounced');
  const complained = count('complained');
  const base = delivered + bounced;
  const rates = {
    bounceRate: base > 0 ? bounced / base : null,
    complaintRate: delivered > 0 ? complained / delivered : null
  };
  const health = deliverabilityHealth(rates);
  const healthTone = health === 'ok' ? 'var(--movexum-morkgron)' : health === 'warn' ? 'var(--movexum-morkgul)' : health === 'alert' ? 'var(--movexum-morkorange)' : 'var(--color-foreground-subtle)';

  const inviteDomain = status.domains.find((d) => d.domain === status.inviteDomain);
  const senderDomain = status.domains.find((d) => d.domain === status.senderDomain);
  const dmarc = status.dmarc.find((d) => d.domain === status.inviteDomain || d.domain === status.senderDomain);

  return (
    <SettingsSectionPage
      slug="e-post"
      roles={user.roles}
      intro="Allt som avgör om utskicken hamnar i Primär: en verifierad avsändardomän, DMARC, låga studs- och klagomålsnivåer och en spärrlista som hålls uppdaterad automatiskt."
      actions={
        <>
          <Link href="/kontakter/import/sparrlista" className="mx-btn mx-sm">
            <Icon name="upload" size={12} /> Importera spärrlista (Mailchimp)
          </Link>
          <Link href="/inflode/kampanjer" className="mx-btn mx-sm">
            Kampanjer
          </Link>
        </>
      }
    >
      <section className="rounded-3xl border border-default bg-surface p-5">
        <h2 className="text-base font-semibold">Avsändare & domän</h2>
        <p className="mt-1 text-sm text-foreground-muted">
          Resend skickar mejlen; domänen måste vara verifierad där (SPF + DKIM) och ha en DMARC-post i DNS. Kontrollerat {formatStockholmDateTime(status.checkedAt)}.
        </p>
        <div className="mt-3">
          <Row label="E-posttjänst" ok={status.emailConfigured && status.keyFormatOk} text={status.emailConfigured ? (status.keyFormatOk ? 'RESEND_API_KEY är satt.' : 'RESEND_API_KEY har oväntat format.') : 'RESEND_API_KEY saknas på web-appen — inget kan skickas.'} />
          <Row label="Avsändare (utskick)" ok={null} text={`${status.inviteSender}${status.replyTo ? ` · svar till ${status.replyTo}` : ' · ingen RESEND_REPLY_TO (svar går till noreply)'}`} />
          <Row
            label="Domän i Resend"
            ok={status.domainsError ? null : inviteDomain?.status === 'verified'}
            text={
              status.domainsError
                ? `Kunde inte läsa domänerna: ${status.domainsError}`
                : inviteDomain
                  ? `${inviteDomain.domain}: ${inviteDomain.status}${inviteDomain.region ? ` · region ${inviteDomain.region}` : ''}${inviteDomain.region && !inviteDomain.region.startsWith('eu') ? ' — välj EU-regionen (eu-west-1) för dataresidens' : ''}`
                  : `${status.inviteDomain} finns inte bland Resends domäner — lägg till och verifiera den (SPF/DKIM-poster).`
            }
          />
          {senderDomain && senderDomain.domain !== inviteDomain?.domain && (
            <Row label="Domän (övriga mejl)" ok={senderDomain.status === 'verified'} text={`${senderDomain.domain}: ${senderDomain.status}`} />
          )}
          <Row
            label="DMARC"
            ok={dmarc ? Boolean(dmarc.record) : null}
            text={
              !dmarc
                ? 'Kunde inte slå upp DNS.'
                : dmarc.record
                  ? `${dmarc.domain}: p=${dmarc.policy ?? 'okänd'}${dmarc.hasReporting ? ' · rapportering på' : ' · lägg till rua= för rapporter'}${dmarc.policy === 'none' ? ' — skärp till quarantine när rapporterna är rena' : ''}`
                  : `Ingen DMARC-post för ${dmarc.domain}. Lägg till TXT _dmarc: "v=DMARC1; p=none; rua=mailto:dmarc@${dmarc.domain}".`
            }
          />
          <Row label="Webhook (studsar/klagomål)" ok={status.webhookSecretSet} text={status.webhookSecretSet ? 'RESEND_WEBHOOK_SECRET är satt. Endpoint: /api/public/e/webhook/resend (email.bounced, email.complained, email.delivered).' : 'RESEND_WEBHOOK_SECRET saknas — studsar och klagomål når inte spärrlistan. Skapa webhooken i Resend och lägg in signeringshemligheten.'} />
          <Row label="Länkhemlighet" ok={status.linkSecretSet} text={status.linkSecretSet ? 'Avregistrering, preferenscenter och klickspårning är signerade.' : 'MOVEXUM_UNSUBSCRIBE_SECRET/MOVEXUM_INTEGRATION_KEY saknas — länkar i mejlen kan inte signeras.'} />
          <Row label="Publik adress" ok={status.appUrlSet} text={status.appUrlSet ? 'APP_URL är satt — länkar i mejlen pekar rätt.' : 'APP_URL saknas — schemalagda utskick och påminnelser kan inte bygga länkar.'} />
        </div>
        <p className="mt-3 text-xs text-foreground-subtle">
          Tips för Primär-inkorgen: skicka från en underdomän (t.ex. event.movexum.se), håll klagomålen under {formatRate(COMPLAINT_RATE_WARN, 1)} (Gmail varnar vid {formatRate(COMPLAINT_RATE_ALERT, 1)}), registrera domänen i Google Postmaster Tools (postmaster.google.com) och Microsoft SNDS, och skicka bara till dem som väntar sig mejlet.
        </p>
        <p className="mt-2 text-xs text-foreground-subtle">
          Outlook (Prioriterad/Övrigt) sorterar mejl med listhuvuden och spårade länkar till Övrigt — slå på <strong>Personlig leverans</strong> i kampanjens design för inbjudningar och personliga mejl (testmejlet skickas redan så). För Movexums egna Microsoft 365-konton kan administratören lägga en e-postflödesregel som sätter huvudet <code>X-MS-Exchange-Organization-BypassFocusedInbox: true</code> för avsändardomänen; en mottagare kan själv välja &quot;Flytta alltid till Prioriterad&quot; på mejlet.
        </p>
      </section>

      <section className="rounded-3xl border border-default bg-surface p-5" style={{ borderLeft: `4px solid ${healthTone}` }}>
        <h2 className="text-base font-semibold">Leverans senaste {WINDOW_DAYS} dagarna</h2>
        {events.error ? (
          <p className="mt-1 text-sm" style={{ color: 'var(--movexum-morkorange)' }}>
            {events.error}
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-6 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wide text-foreground-subtle">Levererade</div>
              <div className="font-heading text-2xl">{delivered}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-foreground-subtle">Studsar</div>
              <div className="font-heading text-2xl">{formatRate(rates.bounceRate)}</div>
              <div className="text-xs text-foreground-subtle">{bounced} st · gräns 2 %</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-foreground-subtle">Klagomål</div>
              <div className="font-heading text-2xl">{formatRate(rates.complaintRate, 2)}</div>
              <div className="text-xs text-foreground-subtle">{complained} st · gräns 0,1 %</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-foreground-subtle">Klick</div>
              <div className="font-heading text-2xl">{count('clicked')}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-foreground-subtle">Avregistreringar</div>
              <div className="font-heading text-2xl">{count('unsubscribed')}</div>
            </div>
          </div>
        )}
        <p className="mt-2 text-xs text-foreground-subtle">
          Händelserna kommer från Resends webhook. Studsar och klagomål spärras automatiskt. Öppningar mäts inte (ingen spårningspixel).
        </p>
      </section>

      <section className="rounded-3xl border border-default bg-surface p-5">
        <h2 className="text-base font-semibold">Spärrlista</h2>
        <p className="mt-1 text-sm text-foreground-muted">
          Adresser som aldrig får utskick: hårda studsar, spamklagomål, avregistreringar, importerade från Mailchimp eller spärrade för hand. Lagras bara som hash — här visas de maskerade.
          {suppressions.total > 0 && (
            <>
              {' '}
              Totalt {suppressions.total}:{' '}
              {EMAIL_SUPPRESSION_REASONS.filter((r) => suppressions.byReason[r]).map((r) => `${EMAIL_SUPPRESSION_REASON_LABELS[r].toLowerCase()} ${suppressions.byReason[r]}`).join(', ')}.
            </>
          )}
        </p>
        {suppressions.missing && (
          <p className="mt-2 text-sm" style={{ color: 'var(--movexum-morkgul)' }}>
            Kollektionen saknas i PocketBase — kör migration 1700000203.
          </p>
        )}
        {suppressions.error && !suppressions.missing && (
          <p className="mt-2 text-sm" style={{ color: 'var(--movexum-morkorange)' }}>
            {suppressions.error}
          </p>
        )}
        <SuppressionManager rows={suppressions.rows} canDelete={user.roles.includes('admin') || user.roles.includes('incubator_lead')} />
      </section>
    </SettingsSectionPage>
  );
}
