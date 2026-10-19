// Rendering av kampanjmejl (CLAUDE.md § 54) — ren, IO-fri.
//
// Blocken (email-campaigns.ts) blir tabellbaserad HTML som fungerar i Gmail,
// Outlook och Apple Mail, plus en ren textversion. Modellen är enkel med
// avsikt: inga webbtypsnitt (Gmail/Outlook laddar dem inte), inga externa
// stilmallar, inga skript, inga spårningspixlar. Varje länk kan slussas genom
// `trackLink` (klickspårning på egen domän, § 54.6) — avregistrering och
// preferenscentret spåras aldrig.
//
// All text escapas FÖRE insättning (§ 10.3). Platshållare fylls i med
// `renderMergeFields` på ren text och escapas därefter.

import {
  EMAIL_ACCENT_HEX,
  renderMergeFields,
  type EmailBlock,
  type EmailDesign,
  type EmailMergeData
} from './email-campaigns';

export interface EmailRenderLinks {
  /** Avregistreringssidan (kontakter; tom för program/personal). */
  unsubscribe?: string | null;
  /** Preferenscentret ("Hantera dina utskick"). */
  preferences?: string | null;
  /** Svarslänkar för `rsvp`-blocket. */
  rsvpYes?: string | null;
  rsvpNo?: string | null;
  /** "Lägg i kalendern" (.ics). */
  calendar?: string | null;
}

export interface EmailRenderInput {
  subject: string;
  preheader: string;
  blocks: readonly EmailBlock[];
  design: EmailDesign;
  merge: EmailMergeData;
  links: EmailRenderLinks;
  /** Fottexten "Du får det här mejlet eftersom …" (`emailReasonText`). */
  reasonText: string;
  /** Organisationens namn i fotern. */
  orgName: string;
  /** Wrappar en innehållslänk för klickspårning. Default: oförändrad. */
  trackLink?: (url: string, index: number) => string;
}

export interface EmailRenderOutput {
  html: string;
  text: string;
  /** Innehållslänkar i ordning (före spårning) — för leveransbarhetskontrollen. */
  links: string[];
  textLength: number;
  imageCount: number;
}

export function escapeEmailHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const FONT = "font-family:'Nunito Sans',Arial,Helvetica,sans-serif;";
const HEAD_FONT = "font-family:Sora,'Nunito Sans',Arial,Helvetica,sans-serif;";
const INK = '#121212';
const MUTED = '#3f3f3f';
const SUBTLE = '#6b6b6b';
const LINE = '#e5e5e5';

function isSafeHref(url: string): boolean {
  return /^https?:\/\//i.test(url) || url.startsWith('/');
}

/**
 * Enkel inline-formatering i texter: **fet**, *kursiv* och länkar
 * `[text](https://…)`. Allt escapas först; bara http(s)-länkar blir `<a>`.
 */
export function inlineEmailMarkdown(text: string, link: (url: string) => string): string {
  let s = escapeEmailHtml(text);
  s = s.replace(/\[([^\]]{1,200})\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) =>
    isSafeHref(url) ? `<a href="${escapeEmailHtml(link(url))}" style="color:inherit;text-decoration:underline;">${label}</a>` : label
  );
  s = s.replace(/\*\*([^*\n]{1,300})\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\n]{1,300})\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  return s.replace(/\n/g, '<br />');
}

/** Ren text ur samma markdown-delmängd (länkar som "text (url)"). */
export function plainEmailText(text: string): string {
  return text
    .replace(/\[([^\]]{1,200})\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*\n]{1,300})\*\*/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]{1,300})\*(?=[\s).,!?:;]|$)/g, '$1$2');
}

function button(label: string, href: string, accent: string, style: 'primary' | 'secondary', margin = '8px 8px 0 0'): string {
  const common = `display:inline-block;${FONT}font-size:14px;font-weight:600;text-decoration:none;border-radius:999px;margin:${margin};`;
  if (style === 'primary') {
    return `<a href="${escapeEmailHtml(href)}" style="${common}background:${accent};color:#ffffff;padding:12px 22px;border:1px solid ${accent};">${escapeEmailHtml(label)}</a>`;
  }
  return `<a href="${escapeEmailHtml(href)}" style="${common}background:#ffffff;color:${accent};padding:11px 21px;border:1px solid ${accent};">${escapeEmailHtml(label)}</a>`;
}

export function renderCampaignEmail(input: EmailRenderInput): EmailRenderOutput {
  const accent = EMAIL_ACCENT_HEX[input.design.accent];
  const plain = input.design.layout === 'plain';
  const merge = (s: string) => renderMergeFields(s, input.merge);
  const links: string[] = [];
  const track = (url: string): string => {
    const index = links.length;
    links.push(url);
    return input.trackLink ? input.trackLink(url, index) : url;
  };
  const resolveUrl = (raw: string): string => {
    const u = merge(raw).trim();
    return isSafeHref(u) ? u : '';
  };

  const htmlParts: string[] = [];
  const textParts: string[] = [];
  let textLength = 0;
  let imageCount = 0;
  const addText = (t: string) => {
    if (!t) return;
    textParts.push(t);
    textLength += t.length;
  };

  for (const b of input.blocks) {
    switch (b.type) {
      case 'heading': {
        const t = merge(b.text);
        if (!t) break;
        htmlParts.push(
          `<h2 style="margin:0 0 12px;${HEAD_FONT}font-size:20px;line-height:1.3;font-weight:700;color:${INK};">${escapeEmailHtml(t)}</h2>`
        );
        addText(t.toUpperCase());
        break;
      }
      case 'paragraph': {
        const t = merge(b.text);
        if (!t) break;
        htmlParts.push(
          `<p style="margin:0 0 16px;${FONT}font-size:15px;line-height:1.6;color:${MUTED};">${inlineEmailMarkdown(t, track)}</p>`
        );
        addText(plainEmailText(t));
        break;
      }
      case 'button': {
        const href = resolveUrl(b.url);
        const label = merge(b.label);
        if (!href || !label) break;
        htmlParts.push(`<p style="margin:0 0 18px;">${button(label, track(href), accent, b.style, '4px 0 0')}</p>`);
        addText(`${label}: ${href}`);
        break;
      }
      case 'image': {
        const src = resolveUrl(b.url);
        if (!src) break;
        imageCount++;
        const alt = merge(b.alt);
        const href = resolveUrl(b.href);
        const img = `<img src="${escapeEmailHtml(src)}" alt="${escapeEmailHtml(alt)}" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0;border-radius:${plain ? 0 : 12}px;" />`;
        htmlParts.push(
          `<p style="margin:0 0 18px;">${href ? `<a href="${escapeEmailHtml(track(href))}" style="text-decoration:none;">${img}</a>` : img}</p>`
        );
        if (alt) addText(`[Bild: ${alt}]${href ? ` ${href}` : ''}`);
        break;
      }
      case 'divider':
        htmlParts.push(`<hr style="border:0;border-top:1px solid ${LINE};margin:8px 0 20px;" />`);
        textParts.push('— — —');
        break;
      case 'spacer':
        htmlParts.push(`<div style="height:${b.size === 's' ? 8 : b.size === 'l' ? 32 : 16}px;line-height:1px;font-size:1px;">&nbsp;</div>`);
        break;
      case 'event_details': {
        const name = (input.merge.event_name ?? '').trim();
        const when = (input.merge.event_when ?? '').trim();
        const where = (input.merge.event_location ?? '').trim();
        if (!name && !when && !where) break;
        const row = (label: string, value: string) =>
          value
            ? `<tr><td style="padding:4px 12px 4px 0;${FONT}font-size:13px;color:${SUBTLE};white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:4px 0;${FONT}font-size:14px;color:${INK};font-weight:600;">${escapeEmailHtml(value)}</td></tr>`
            : '';
        const cal = input.links.calendar
          ? `<tr><td></td><td style="padding:6px 0 0;"><a href="${escapeEmailHtml(input.links.calendar)}" style="${FONT}font-size:13px;color:${accent};text-decoration:underline;">Lägg i kalendern</a></td></tr>`
          : '';
        htmlParts.push(
          `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border-left:3px solid ${accent};padding-left:14px;"><tr><td style="padding-left:14px;"><table role="presentation" cellpadding="0" cellspacing="0">${row('Vad', name)}${row('När', when)}${row('Var', where)}${cal}</table></td></tr></table>`
        );
        addText([name && `Vad: ${name}`, when && `När: ${when}`, where && `Var: ${where}`, input.links.calendar && `Lägg i kalendern: ${input.links.calendar}`].filter(Boolean).join('\n'));
        break;
      }
      case 'rsvp': {
        if (!input.links.rsvpYes || !input.links.rsvpNo) break;
        htmlParts.push(
          `<p style="margin:0 0 18px;">${button('Jag kommer', input.links.rsvpYes, accent, 'primary')}${button('Jag kan inte', input.links.rsvpNo, accent, 'secondary')}</p>`
        );
        addText(`Jag kommer: ${input.links.rsvpYes}\nJag kan inte: ${input.links.rsvpNo}`);
        break;
      }
      case 'signature': {
        const name = merge(b.name);
        const title = merge(b.title);
        if (!name && !title) break;
        htmlParts.push(
          `<p style="margin:8px 0 16px;${FONT}font-size:15px;line-height:1.5;color:${MUTED};">Vänliga hälsningar<br /><strong style="color:${INK};">${escapeEmailHtml(name)}</strong>${title ? `<br /><span style="color:${SUBTLE};font-size:13px;">${escapeEmailHtml(title)}</span>` : ''}</p>`
        );
        addText(`Vänliga hälsningar\n${[name, title].filter(Boolean).join('\n')}`);
        break;
      }
      default:
        break;
    }
  }

  const subject = merge(input.subject);
  const preheader = merge(input.preheader);
  const footerLinks: string[] = [];
  const footerTextLinks: string[] = [];
  if (input.links.preferences) {
    footerLinks.push(`<a href="${escapeEmailHtml(input.links.preferences)}" style="color:${SUBTLE};text-decoration:underline;">Hantera dina utskick</a>`);
    footerTextLinks.push(`Hantera dina utskick: ${input.links.preferences}`);
  }
  if (input.links.unsubscribe) {
    footerLinks.push(`<a href="${escapeEmailHtml(input.links.unsubscribe)}" style="color:${SUBTLE};text-decoration:underline;">Avregistrera dig</a>`);
    footerTextLinks.push(`Avregistrera dig: ${input.links.unsubscribe}`);
  }
  const footer = `<p style="margin:24px 0 0;${FONT}font-size:11px;line-height:1.6;color:#8a8a8a;">${escapeEmailHtml(input.reasonText)}${footerLinks.length ? ` ${footerLinks.join(' · ')}` : ''}<br />${escapeEmailHtml(input.orgName)}</p>`;

  const body = htmlParts.join('\n');
  const logo = input.design.show_logo && !plain
    ? `<tr><td style="padding-bottom:24px;"><span style="${HEAD_FONT}font-size:22px;font-weight:700;color:${INK};letter-spacing:-0.5px;">movexum</span></td></tr>`
    : '';
  const inner = plain
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;"><tr><td style="padding:32px 16px;">${body}${footer}</td></tr></table>`
    : `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;max-width:600px;width:100%;"><tr><td style="height:5px;background:${accent};border-radius:16px 16px 0 0;font-size:1px;line-height:1px;">&nbsp;</td></tr><tr><td style="padding:36px 40px 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${logo}<tr><td>${body}${footer}</td></tr></table></td></tr></table>`;

  const html = `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light" />
<title>${escapeEmailHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${plain ? '#ffffff' : '#f2f2f2'};${FONT}">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeEmailHtml(preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${plain ? '#ffffff' : '#f2f2f2'};${plain ? '' : 'padding:40px 16px;'}">
<tr><td align="center">${inner}</td></tr>
</table>
</body>
</html>`;

  const text = [...textParts, '', input.reasonText, ...footerTextLinks, input.orgName].join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  return { html, text, links, textLength, imageCount };
}
