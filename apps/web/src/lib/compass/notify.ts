import 'server-only';
import { sendInflowNotification } from '@/lib/email';
import {
  CONTACT_PREFERENCE_LABEL,
  FLOW_TYPE_LABEL,
  type CompassModule,
  type Lead
} from './types';

// Notifiering av Movexums inflödesmail om nya inflöden (leads) från
// Startupkompassen. Mottagarna är DYNAMISKA: per modul (`notify_emails`,
// migration 1700000110) med fallback på env `MOVEXUM_INFLOW_EMAIL`. Båda
// stödjer komma-/radseparerade listor (en eller flera adresser).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Parsar en komma-/radseparerad sträng till en deduplicerad adresslista. */
function parseEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => EMAIL_RE.test(s));
}

/** Mottagare för en modul: modulens egna adresser, annars env-defaulten. */
export function resolveInflowRecipients(module: Pick<CompassModule, 'notify_emails'>): string[] {
  const perModule = parseEmails(module.notify_emails);
  const fallback = parseEmails(process.env.MOVEXUM_INFLOW_EMAIL);
  const all = perModule.length > 0 ? perModule : fallback;
  return Array.from(new Set(all));
}

/**
 * Skickar en inflödesnotis för ett nyskapat lead. BEST-EFFORT: fångar alla fel
 * (inkl. saknad RESEND_API_KEY / saknade mottagare) så att intag-flödet aldrig
 * felar för att notisen inte gick fram.
 */
export async function notifyNewInflow(module: CompassModule, lead: Lead): Promise<void> {
  try {
    const recipients = resolveInflowRecipients(module);
    if (recipients.length === 0) return;

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
    const leadUrl = appUrl ? `${appUrl}/inflode/leads/${lead.id}` : undefined;

    await sendInflowNotification(recipients, {
      moduleName: module.name,
      flowLabel: FLOW_TYPE_LABEL[module.flow_type] ?? module.flow_type,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      organization: lead.organization,
      ideaSummary: lead.idea_summary,
      ideaCategory: lead.idea_category,
      contactPreference: lead.contact_preference
        ? CONTACT_PREFERENCE_LABEL[lead.contact_preference]
        : undefined,
      aiSummary: lead.ai_summary,
      leadUrl
    });
  } catch (err) {
    console.error('[compass] inflow notification failed (best-effort):', err);
  }
}
