import 'server-only';
import type PocketBase from 'pocketbase';
import {
  EMAIL_CATEGORIES,
  applyEmailPreference,
  emailOptOutCategories,
  type EmailCategory
} from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { unsubscribeSecret, verifyUnsubscribeKey } from '@/lib/unsubscribe-key';

/**
 * Preferenscentret (CLAUDE.md § 55.9): mottagaren väljer själv vilka utskick
 * hen vill ha. Nyckeln är samma signerade kontaktnyckel som avregistreringen
 * (`lib/unsubscribe-key.ts`) — den finns i varje mejl och går inte att gissa.
 * Läsning/skrivning sker med superusern (ingen session); bara kontaktens egna
 * preferensfält rörs. Sidan visar förnamn och kategorierna — aldrig e-post.
 */

export interface PreferenceView {
  contactId: string;
  firstName: string;
  optOut: Set<EmailCategory | 'all'>;
  newsletterConsent: boolean;
}

export async function loadPreferences(key: unknown): Promise<PreferenceView | null> {
  const contactId = verifyUnsubscribeKey(key, unsubscribeSecret());
  if (!contactId) return null;
  const su = await getSuperuserPb();
  if (!su.ok) return null;
  try {
    const c = await su.pb.collection('contacts').getOne<{
      id: string;
      first_name?: string;
      invite_opt_out?: boolean;
      email_opt_out?: unknown;
      newsletter_consent?: boolean;
    }>(contactId, { fields: 'id,first_name,invite_opt_out,email_opt_out,newsletter_consent' });
    return {
      contactId: c.id,
      firstName: (c.first_name ?? '').trim(),
      optOut: emailOptOutCategories(c),
      newsletterConsent: c.newsletter_consent === true
    };
  } catch {
    return null;
  }
}

/**
 * Sparar valen ur formuläret: `cat_<kategori>=on` = vill ha, annars av;
 * `alla_av=1` = stäng av allt. Kryssar mottagaren i nyhetsbrev räknas det
 * som samtycke (källa `preference_center`).
 */
export async function savePreferences(key: unknown, form: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const contactId = verifyUnsubscribeKey(key, unsubscribeSecret());
  if (!contactId) return { ok: false, error: 'lank' };
  const su = await getSuperuserPb();
  if (!su.ok) return { ok: false, error: 'spara' };
  const pb: PocketBase = su.pb;
  let current: { invite_opt_out?: boolean; email_opt_out?: unknown; newsletter_consent?: boolean };
  try {
    current = await pb.collection('contacts').getOne(contactId, { fields: 'id,invite_opt_out,email_opt_out,newsletter_consent' });
  } catch {
    return { ok: false, error: 'lank' };
  }
  const now = new Date().toISOString();
  let next = { invite_opt_out: current.invite_opt_out === true, email_opt_out: [...emailOptOutCategories(current)].filter((c) => c !== 'events') as Array<EmailCategory | 'all'> };
  const patch: Record<string, unknown> = {};
  if (form.get('alla_av') === '1') {
    next = applyEmailPreference({ ...current, ...next }, { category: 'all', optOut: true });
  } else {
    for (const cat of EMAIL_CATEGORIES) {
      const wants = form.get(`cat_${cat}`) === 'on';
      next = applyEmailPreference({ invite_opt_out: next.invite_opt_out, email_opt_out: next.email_opt_out }, { category: cat, optOut: !wants });
    }
    const wantsNewsletter = form.get('cat_newsletter') === 'on';
    if (wantsNewsletter && current.newsletter_consent !== true) {
      patch.newsletter_consent = true;
      patch.newsletter_consent_at = now;
      patch.newsletter_consent_source = 'preference_center';
    }
    if (!wantsNewsletter && current.newsletter_consent === true) {
      patch.newsletter_consent = false;
      patch.newsletter_consent_at = null;
      patch.newsletter_consent_source = '';
    }
  }
  patch.invite_opt_out = next.invite_opt_out;
  patch.invite_opt_out_at = next.invite_opt_out ? now : null;
  patch.email_opt_out = next.email_opt_out;
  try {
    await pb.collection('contacts').update(contactId, patch);
  } catch (err) {
    console.error('[preferences] update failed', { status: (err as { status?: number })?.status });
    return { ok: false, error: 'spara' };
  }
  return { ok: true };
}
