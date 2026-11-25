import 'server-only';
import { contactValueLabel } from '@platform/shared';
import { sendInflowNotification } from '@/lib/email';
import { countLeadAttachments } from './attachments';
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
/** "2 filer — öppna leadet för att ladda ned" (filerna skickas aldrig i mejlet). */
async function attachmentLine(lead: Lead): Promise<string | undefined> {
  const n = await countLeadAttachments(lead.tenant, lead.id);
  if (n === 0) return undefined;
  return `${n} ${n === 1 ? 'fil' : 'filer'} — öppna leadet för att ladda ned`;
}

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
      // Avsnittet "Dina uppgifter" (§ 23.11). Kön på grundare mejlas aldrig
      // (art. 9-klass — bara i lead-vyn för behörig personal).
      kommun: contactValueLabel('kommun', lead.kommun),
      referralChannel: contactValueLabel('referral_channel', lead.referral_channel),
      teamMembers: lead.team_members,
      website: lead.website,
      otherInfo: lead.other_info,
      attachments: await attachmentLine(lead),
      aiSummary: lead.ai_summary,
      leadUrl
    });
  } catch (err) {
    console.error('[compass] inflow notification failed (best-effort):', err);
  }
}
