import 'server-only';
import { normalizeEmailAddress, splitFullName } from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { resolveLoginBrandingTenant } from '@/lib/login-branding.server';
import { listUnsubscribeHeaders, resolveReplyTo, resolveSender } from '@/lib/mail-sender';
import { isEmailConfigured } from '@/lib/email';
import { normalizeEmailBlocks, normalizeEmailDesign, renderCampaignEmail } from '@platform/shared';
import { sendOne } from './send-batch';
import { emailLinkSecret, signSubscribeToken, verifySubscribeToken, type SubscribePayload } from './signed-tokens';
import { isSuppressed } from './suppression';

/**
 * Nyhetsbrev med dubbel opt-in (CLAUDE.md § 54.9). Ingen rad skapas förrän
 * personen klickat i bekräftelsemejlet — adressen ligger bara i den
 * signerade länken (48 h). Vid bekräftelse skapas/uppdateras kontakten med
 * `gdpr_consent` + `newsletter_consent` (källa `double_opt_in`). En spärrad
 * adress får inget mejl (men formuläret svarar likadant — inget läcker).
 */

const ID = /^[a-zA-Z0-9_-]{1,64}$/;

export async function resolveSubscribeTenant(orgParam: unknown): Promise<{ id: string; name: string } | null> {
  const su = await getSuperuserPb();
  if (!su.ok) return null;
  if (typeof orgParam === 'string' && ID.test(orgParam)) {
    try {
      const t = await su.pb.collection('tenants').getOne<{ id: string; name?: string }>(orgParam, { fields: 'id,name' });
      return { id: t.id, name: t.name || 'Movexum' };
    } catch {
      return null;
    }
  }
  const row = await resolveLoginBrandingTenant();
  return row ? { id: row.id, name: (row as { name?: string }).name || 'Movexum' } : null;
}

export async function startSubscription(input: {
  email: unknown;
  name: unknown;
  organization: unknown;
  org: unknown;
  baseUrl: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = normalizeEmailAddress(input.email);
  if (!email) return { ok: false, error: 'Skriv en giltig e-postadress.' };
  const tenant = await resolveSubscribeTenant(input.org);
  if (!tenant) return { ok: false, error: 'Tjänsten är inte tillgänglig just nu.' };
  if (!isEmailConfigured()) return { ok: false, error: 'E-posttjänsten är inte konfigurerad.' };
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  const organization = typeof input.organization === 'string' ? input.organization.replace(/\s+/g, ' ').trim().slice(0, 160) : '';

  // Spärrad adress: svara "skickat" utan att skicka (avslöjar inte spärren).
  const su = await getSuperuserPb();
  if (su.ok && (await isSuppressed(su.pb, tenant.id, email).catch(() => false))) return { ok: true };

  const token = signSubscribeToken({ email, tenant: tenant.id, name, organization }, emailLinkSecret());
  if (!token) return { ok: false, error: 'Tjänsten är inte konfigurerad (länkhemlighet saknas).' };
  const confirmUrl = `${input.baseUrl.replace(/\/+$/, '')}/e/bekrafta?k=${token}`;
  const from = resolveSender(process.env, 'invite');
  // Samma renderare som alla andra utskick (§ 54): enkelt textmejl, ingen
  // klickspårning, inga avregistreringslänkar (ingen prenumeration finns än).
  const rendered = renderCampaignEmail({
    subject: `Bekräfta din prenumeration på ${tenant.name}s nyhetsbrev`,
    preheader: 'Ett klick så är du med — annars sparas inga uppgifter.',
    blocks: normalizeEmailBlocks([
      { type: 'heading', text: 'Bekräfta din prenumeration' },
      {
        type: 'paragraph',
        text: `Hej {{förnamn|du}}! Du har bett om att få ${tenant.name}s nyhetsbrev. Klicka på knappen för att bekräfta — annars händer ingenting och inga uppgifter sparas.`
      },
      { type: 'button', label: 'Ja, jag vill ha nyhetsbrevet', url: confirmUrl, style: 'primary' },
      { type: 'paragraph', text: `Länken gäller i 48 timmar. Fungerar inte knappen, kopiera adressen: ${confirmUrl}` }
    ]),
    design: normalizeEmailDesign({ accent: 'morkbla', layout: 'plain', show_logo: false }),
    merge: { first_name: name ? splitFullName(name).first || name : '', name },
    links: {},
    reasonText: 'Du får det här mejlet eftersom någon bett om nyhetsbrevet med din adress. Om det inte var du kan du ignorera mejlet.',
    orgName: tenant.name
  });
  const { html, text } = rendered;
  const res = await sendOne({
    key: 'subscribe',
    from,
    to: email,
    subject: `Bekräfta din prenumeration på ${tenant.name}s nyhetsbrev`,
    html,
    text,
    reply_to: resolveReplyTo(process.env),
    headers: listUnsubscribeHeaders(null),
    tags: [{ name: 'category', value: 'newsletter_confirm' }, { name: 'tenant', value: tenant.id }]
  });
  if (res.error) {
    console.error('[subscribe] confirmation send failed:', res.error);
    return { ok: false, error: 'Bekräftelsemejlet kunde inte skickas just nu. Försök igen om en stund.' };
  }
  return { ok: true };
}

export function readSubscribeToken(key: unknown): SubscribePayload | null {
  return verifySubscribeToken(key, emailLinkSecret());
}

/** Bekräftelsen: skapar eller uppdaterar kontakten med samtycke. */
export async function confirmSubscription(key: unknown): Promise<{ ok: true; tenantName: string } | { ok: false; error: 'lank' | 'spara' }> {
  const payload = readSubscribeToken(key);
  if (!payload) return { ok: false, error: 'lank' };
  const su = await getSuperuserPb();
  if (!su.ok) return { ok: false, error: 'spara' };
  const pb = su.pb;
  const now = new Date().toISOString();
  let tenantName = 'Movexum';
  try {
    const t = await pb.collection('tenants').getOne<{ name?: string }>(payload.tenant, { fields: 'id,name' });
    tenantName = t.name || tenantName;
  } catch {
    return { ok: false, error: 'lank' };
  }
  try {
    const existing = await pb.collection('contacts').getFullList<{ id: string }>({
      filter: pb.filter('tenant = {:t} && email = {:e}', { t: payload.tenant, e: payload.email }),
      fields: 'id'
    });
    const consent = {
      newsletter_consent: true,
      newsletter_consent_at: now,
      newsletter_consent_source: 'double_opt_in',
      // Nyhetsbrevet var det personen bad om — en tidigare "allt av" lyfts för just den kategorin.
      email_opt_out: [] as string[]
    };
    if (existing.length > 0) {
      for (const c of existing) await pb.collection('contacts').update(c.id, { ...consent, gdpr_consent: true, gdpr_consent_at: now });
    } else {
      const { first, last } = splitFullName(payload.name || payload.email.split('@')[0] || 'Prenumerant');
      await pb.collection('contacts').create({
        tenant: payload.tenant,
        first_name: first || 'Prenumerant',
        last_name: last,
        email: payload.email,
        organization: payload.organization,
        category: 'annan',
        info: 'Prenumererade på nyhetsbrevet via webben (dubbel opt-in).',
        gdpr_consent: true,
        gdpr_consent_at: now,
        owners: [],
        ...consent
      });
    }
  } catch (err) {
    console.error('[subscribe] confirm failed', { status: (err as { status?: number })?.status });
    return { ok: false, error: 'spara' };
  }
  return { ok: true, tenantName };
}
