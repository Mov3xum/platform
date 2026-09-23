/**
 * Deterministiska KVITTON på agentens skrivningar (CLAUDE.md § 33.4).
 *
 * Problemet som löses: modellen var tidigare ensam källa till "vad som hände".
 * Ett verktygsanrop som svarade `ok:false` matades tillbaka som rå JSON, och
 * inget hindrade modellen från att ändå skriva "alla fem är upplagda". Här
 * byggs i stället ett kvitto per SKRIVNING direkt ur verktygsresultatet —
 * modellens text har ingen del i det — och kvittot persisteras på
 * assistant-meddelandet + renderas i chatten som "Utfört i systemet".
 *
 * Ren modul (ingen IO, ingen `server-only`) så den kan enhetstestas.
 * PII: etikett/utfall/felmeddelande/id:n/intern länk — aldrig fältdata utöver
 * en cappad titel som användaren själv angav.
 */
import { monthShortLabel, type AgentActionReceipt } from '@platform/shared';

/**
 * Verktyg som muterar domändata (eller minnet). Källa av sanning för både
 * kvittot och godkännandespärren i `tools.ts`. OBS: detta är UX-lagrets
 * lista, inte säkerhetsgränsen — den är RBAC + skrivlagrets whitelist
 * (`lib/core/write`).
 */
export const DOMAIN_WRITE_TOOLS: ReadonlySet<string> = new Set([
  'update_startup_field',
  'create_startup_activity',
  'update_activity_field',
  'create_annual_wheel_item',
  'update_annual_wheel_item',
  'create_compass_module',
  'add_compass_question',
  'update_compass_module_field',
  'create_workshop',
  'assign_workshop',
  'assign_education_document',
  'create_task',
  'move_task',
  'create_event',
  'create_mission',
  'register_de_minimis_support',
  'add_startup_kpi',
  'add_capital_round',
  'schedule_agent',
  'create_startup_note',
  'create_org_post',
  'update_org_post',
  'create_procurement',
  'create_procurement_calloff',
  'update_procurement_calloff',
  'memory_write'
]);

export function isWriteTool(name: string): boolean {
  return DOMAIN_WRITE_TOOLS.has(name);
}

/**
 * Instruktion som fästs på VARJE misslyckat skrivanrop innan det matas
 * tillbaka till modellen. Utan den läste modellen `ok:false` som en
 * bagatell och rapporterade framgång ändå.
 */
export const FAILED_WRITE_WARNING =
  'DETTA ANROP MISSLYCKADES — INGET SPARADES. Är felet åtgärdbart (t.ex. en ' +
  'ogiltig kategori med giltiga alternativ i felmeddelandet) rättar du ' +
  'argumenten och anropar verktyget IGEN i samma svar. Går det inte: säg ' +
  'exakt vilken post som inte sparades och varför. Påstå ALDRIG att den är ' +
  'utförd eller "justerad" — användaren ser ett systemkvitto med det ' +
  'faktiska utfallet.';

const MAX_ERROR_CHARS = 400;
const MAX_SUMMARY_CHARS = 160;
const MAX_TITLE_CHARS = 80;
const MAX_RECORD_IDS = 50;

/** Den delmängd av ett verktygsresultat kvittot behöver. */
export interface ReceiptToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  warning?: string;
}

export interface BuildReceiptInput {
  tool: string;
  /** PII-fri stegetikett ("Lägger till i årshjulet"). */
  label: string;
  /** Verktygsargumenten (för titel/fältnamn i sammanfattningen). */
  args: Record<string, unknown>;
  result: ReceiptToolResult;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Intern länk: måste börja med exakt ett '/' (aldrig protokoll-relativ). */
export function isInternalHref(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith('/') && !v.startsWith('//');
}

/** Samlar post-id:n ur resultatets data (nycklar som slutar på id/_id/_ids). */
function collectRecordIds(data: Record<string, unknown>): string[] {
  const ids: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (!/(^id$|_id$|Id$|_ids$|Ids$)/.test(key)) continue;
    if (typeof value === 'string' && value.trim()) ids.push(value.trim());
    else if (Array.isArray(value)) {
      for (const v of value) if (typeof v === 'string' && v.trim()) ids.push(v.trim());
    }
    if (ids.length >= MAX_RECORD_IDS) break;
  }
  return [...new Set(ids)].slice(0, MAX_RECORD_IDS);
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '–';
  if (Array.isArray(v)) return v.map(String).join(', ') || '–';
  if (typeof v === 'object') return '{…}';
  return String(v);
}

function annualWheelSummary(args: Record<string, unknown>, data: Record<string, unknown>): string {
  const parts: string[] = [];
  const title = str(args.title);
  if (title) parts.push(clip(title, MAX_TITLE_CHARS));
  const created = typeof data.created === 'number' ? data.created : null;
  if (created !== null) parts.push(`${created} ${created === 1 ? 'post' : 'poster'}`);
  const months = Array.isArray(data.months)
    ? (data.months as unknown[]).filter((m): m is number => typeof m === 'number')
    : [];
  const years = Array.isArray(data.years)
    ? (data.years as unknown[]).filter((y): y is number => typeof y === 'number')
    : [];
  if (months.length > 0) {
    const labels = months.slice(0, 12).map((m) => monthShortLabel(m).toLowerCase());
    parts.push(months.length > 12 ? `${labels.join(', ')} …` : labels.join(', '));
  } else if (created !== null) {
    parts.push('helår');
  }
  if (years.length > 0) parts.push(years.join(', '));
  return parts.join(' · ');
}

function fieldChangeSummary(data: Record<string, unknown>): string | null {
  const field = str(data.field);
  if (!field) return null;
  if (!('before' in data) && !('after' in data)) return field;
  return `${field}: ${clip(fmtValue(data.before), 40)} → ${clip(fmtValue(data.after), 40)}`;
}

function genericSummary(args: Record<string, unknown>, data: Record<string, unknown>): string | null {
  const name =
    str(data.title) ??
    str(data.name) ??
    str(data.kpi_name) ??
    str(data.workshop) ??
    str(data.document) ??
    str(args.title) ??
    str(args.name);
  const startup = str(data.startup);
  const bits = [name ? clip(name, MAX_TITLE_CHARS) : null, startup ? clip(startup, 60) : null].filter(
    (b): b is string => Boolean(b)
  );
  return bits.length > 0 ? bits.join(' · ') : null;
}

/**
 * Bygger kvittot för ETT verktygsanrop. Returnerar null för läsverktyg och
 * UX-verktyg (request_approval, start_meeting, generate_document …) — bara
 * domänskrivningar kvitteras.
 */
export function buildActionReceipt(input: BuildReceiptInput): AgentActionReceipt | null {
  const { tool, label, args, result } = input;
  if (!isWriteTool(tool)) return null;

  const receipt: AgentActionReceipt = { tool, label, ok: result.ok === true };
  if (!receipt.ok) {
    receipt.error = clip(str(result.error) ?? 'Okänt fel — inget sparades.', MAX_ERROR_CHARS);
    const title = str(args.title) ?? str(args.name);
    if (title) receipt.summary = clip(title, MAX_TITLE_CHARS);
    return receipt;
  }

  const data = asRecord(result.data);
  const ids = collectRecordIds(data);
  if (ids.length > 0) receipt.record_ids = ids;

  let summary: string | null = null;
  let href: string | null = null;

  switch (tool) {
    case 'create_annual_wheel_item':
    case 'update_annual_wheel_item': {
      summary =
        tool === 'create_annual_wheel_item'
          ? annualWheelSummary(args, data)
          : fieldChangeSummary(data) ?? annualWheelSummary(args, data);
      href = isInternalHref(data.href) ? data.href : ids[0] ? `/arshjul?item=${encodeURIComponent(ids[0])}` : null;
      break;
    }
    case 'update_startup_field':
    case 'update_activity_field':
    case 'update_compass_module_field': {
      summary = fieldChangeSummary(data);
      break;
    }
    case 'create_procurement':
    case 'create_procurement_calloff':
    case 'update_procurement_calloff': {
      const base = genericSummary(args, data);
      const followups = str(data.followups);
      summary = [base, followups].filter(Boolean).join(' · ');
      break;
    }
    default:
      summary = genericSummary(args, data);
  }

  if (!href) {
    const candidate = data.path ?? data.board_path ?? data.admin_path ?? data.href;
    if (isInternalHref(candidate)) href = candidate;
    else if (
      (tool === 'update_startup_field' || tool === 'create_startup_activity') &&
      str(data.startupId)
    ) {
      href = `/startups/${encodeURIComponent(str(data.startupId) as string)}`;
    }
  }

  if (summary) receipt.summary = clip(summary, MAX_SUMMARY_CHARS);
  if (href) receipt.href = href;
  const warning = str(result.warning);
  if (warning) receipt.warning = clip(warning, MAX_ERROR_CHARS);
  return receipt;
}

export interface ReceiptTotals {
  total: number;
  succeeded: number;
  failed: number;
  /** Lyckade men med varning (t.ex. schema-drift). */
  partial: number;
}

export function receiptTotals(receipts: readonly AgentActionReceipt[]): ReceiptTotals {
  let succeeded = 0;
  let failed = 0;
  let partial = 0;
  for (const r of receipts) {
    if (!r.ok) failed++;
    else {
      succeeded++;
      if (r.warning) partial++;
    }
  }
  return { total: receipts.length, succeeded, failed, partial };
}

/**
 * Textversion av kvittot som injiceras som DATA i den tvingade slutrundan
 * (steg-taket) — så att sammanfattningen bygger på fakta, inte på vad
 * modellen "minns" att den gjorde.
 */
export function summarizeReceiptsForModel(receipts: readonly AgentActionReceipt[]): string {
  if (receipts.length === 0) return '';
  const t = receiptTotals(receipts);
  const lines = receipts.map((r) => {
    const head = r.ok ? '✓ SPARAT' : '✕ INTE SPARAT';
    const what = r.summary ? ` — ${r.summary}` : '';
    const why = r.ok ? (r.warning ? ` (varning: ${r.warning})` : '') : ` (fel: ${r.error ?? 'okänt'})`;
    return `${head}: ${r.label}${what}${why}`;
  });
  return (
    `SYSTEMKVITTO ÖVER SKRIVNINGAR I DENNA TUR (fakta från systemet — detta ` +
    `är sanningen, oavsett vad du tidigare trodde): ${t.succeeded} av ${t.total} ` +
    `sparades${t.failed > 0 ? `, ${t.failed} misslyckades` : ''}.\n` +
    lines.join('\n')
  );
}
