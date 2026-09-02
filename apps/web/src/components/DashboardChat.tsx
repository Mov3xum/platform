'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChatAttachment } from '@/lib/actions/chat';
import type { AgentActivityStep, GeneratedFileRef, InlineVisualRef } from '@platform/shared';
import {
  AI_IMPACT_SOURCE_LABEL,
  formatAiImpact,
  formatTokens
} from '@platform/shared';
import {
  extractPdfFromDataUrlAction,
  extractXlsxFromDataUrlAction
} from '@/lib/actions/chat-attachments';
import { Icon } from '@/components/proto/Icon';
import VoiceInputButton from '@/components/VoiceInputButton';
import ChatHelpGuide from '@/components/ChatHelpGuide';
import type { Role } from '@platform/shared';
import { chatMarkdownToHtml } from '@/lib/safe-html';

// Markör som visas i slutet av den streamande texten. Injiceras i den redan
// säkert renderade HTML:en (chatMarkdownToHtml escapar all modell-text).
const STREAM_CURSOR =
  '<span class="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-foreground-subtle align-middle" aria-hidden="true"></span>';

function withStreamCursor(html: string): string {
  return html.endsWith('</p>')
    ? `${html.slice(0, -4)}${STREAM_CURSOR}</p>`
    : html + STREAM_CURSOR;
}

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPT_IMAGE = ['image/png', 'image/jpeg', 'image/webp'];
const ACCEPT_TEXT = ['text/plain', 'text/markdown', 'text/csv', 'application/csv'];
const ACCEPT_PDF = ['application/pdf'];
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ACCEPT_XLSX = [XLSX_MIME, 'application/vnd.ms-excel'];
const ACCEPT_IMAGE_ATTR = 'image/png,image/jpeg,image/webp';
const ACCEPT_TEXT_ATTR =
  'text/plain,text/markdown,text/csv,application/pdf,' +
  XLSX_MIME +
  ',.md,.csv,.txt,.pdf,.xlsx';

interface UploadedFile extends ChatAttachment {
  uid: string;
  size: number;
}

// Meddelande som visas i UI:t — kan bära agent-genererade filer (chips) och
// det aktivitetsspår agenten utförde för svaret.
export interface UiMessage {
  role: 'user' | 'assistant';
  content: string;
  generated_files?: GeneratedFileRef[];
  visuals?: InlineVisualRef[];
  steps?: AgentActivityStep[];
  /** Turens tokens (in + ut) → inline token-/miljöchip under svaret. */
  tokens?: number;
}

// Ett pågående verktygssteg under en streamande turn.
export interface LiveStep {
  id: string;
  label: string;
  running: boolean;
  ok?: boolean;
}

// Ett köat meddelande — skrivet medan en turn körs, körs när den är klar.
export interface QueuedItem {
  id: string;
  content: string;
}

// Kompakt aktivitetsspår ("Läser bolagen", "Skapar PowerPoint"). Visas
// live medan turen körs (running → spinner) och persiterat under färdiga svar.
function ActivityTrail({
  items
}: {
  items: Array<{ label: string; running?: boolean; ok?: boolean }>;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="mb-2 flex flex-col gap-1">
      {items.map((s, i) => (
        <li
          key={i}
          className="inline-flex items-center gap-2 text-[12.5px] text-foreground-subtle"
        >
          {s.running ? (
            <span
              className="h-3 w-3 shrink-0 animate-spin rounded-full border border-foreground-subtle border-t-transparent"
              aria-hidden
            />
          ) : (
            <Icon name={s.ok === false ? 'x' : 'check'} size={12} />
          )}
          <span>{s.label}</span>
        </li>
      ))}
    </ul>
  );
}

function detectMime(file: File): string | null {
  const mime = (file.type || '').toLowerCase();
  if (mime && [...ACCEPT_IMAGE, ...ACCEPT_TEXT, ...ACCEPT_PDF, ...ACCEPT_XLSX].includes(mime)) {
    return mime;
  }
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'md' || ext === 'markdown') return 'text/markdown';
  if (ext === 'csv') return 'text/csv';
  if (ext === 'txt') return 'text/plain';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'xlsx') return XLSX_MIME;
  return null;
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error || new Error('Kunde inte läsa filen'));
    r.onload = () => resolve(String(r.result || ''));
    r.readAsText(file);
  });
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error || new Error('Kunde inte läsa filen'));
    r.onload = () => resolve(String(r.result || ''));
    r.readAsDataURL(file);
  });
}

const IMAGE_MAX_DIM = 1600;
const IMAGE_COMPRESS_THRESHOLD = 700 * 1024;

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Kunde inte läsa bilden'));
    img.src = src;
  });
}

async function compressImage(file: File): Promise<{ dataUrl: string; size: number }> {
  if (file.size <= IMAGE_COMPRESS_THRESHOLD) {
    const dataUrl = await readAsDataUrl(file);
    return { dataUrl, size: file.size };
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const scale = Math.min(1, IMAGE_MAX_DIM / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Kunde inte processa bilden');
    ctx.drawImage(img, 0, 0, w, h);
    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Komprimering misslyckades'))),
        'image/jpeg',
        0.85
      );
    });
    const dataUrl = await readAsDataUrl(blob);
    return { dataUrl, size: blob.size };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ── Inline-visualiseringar (diagram/nyckeltal) ──────────────────────────────
// SVG:n kommer redan escapad/cappad från servern (render_visual). Den visas
// som <img src=data:image/svg+xml…> (ingen dangerouslySetInnerHTML) och
// rastreras klient-side till PNG/JPEG vid nedladdning.

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function visualFilename(title: string | undefined, ext: string): string {
  const slug =
    (title || 'visualisering')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'visualisering';
  return `${slug}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

// Rastrerar SVG:n till PNG/JPEG i 2x-upplösning och triggar nedladdning.
// Vit bakgrund fylls alltid (JPEG saknar alfakanal; SVG:n är redan vit).
async function downloadVisualImage(v: InlineVisualRef, format: 'png' | 'jpeg'): Promise<void> {
  const img = await loadImage(svgDataUrl(v.svg));
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(v.width * scale);
  canvas.height = Math.round(v.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Kunde inte skapa bilden');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Kunde inte skapa bilden'))),
      format === 'png' ? 'image/png' : 'image/jpeg',
      0.92
    );
  });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = visualFilename(v.title, format === 'png' ? 'png' : 'jpg');
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

const DOC_ICON: Record<string, string> = {
  pptx: 'image',
  xlsx: 'doc',
  docx: 'doc',
  pdf: 'doc',
  other: 'doc'
};

export interface DashboardAgent {
  id: string;
  name: string;
  description?: string;
  category: 'ai_per_startup' | 'ai_system_wide' | string;
  runs?: number;
}

export interface DashboardConnector {
  kind: 'builtin' | 'mcp';
  id: string;
  name: string;
  blurb?: string;
}

// En händelse i den verksamhetsövergripande aktivitetsloggen. Innehåller bara
// PII-fri metadata (titel, bolagsnamn, typ, tidpunkt) — samma data som
// /aktivitet redan visar för behöriga roller.
export interface DashboardActivity {
  id: string;
  title: string;
  kind?: string;
  type?: string;
  created: string;
  startupName?: string;
  startupId?: string;
  toolIcon?: string;
  /** Egen länk (systemloggrader: årshjulet, modul-admin …). Vinner över startupId. */
  href?: string;
  /** Ikonnamn satt av servern (systemloggrader). */
  icon?: string;
  /** Vem som utförde åtgärden — visas som tooltip. */
  actorName?: string;
  /** true när åtgärden gjordes av AI-agenten i chatten (art. 13-transparens). */
  viaAgent?: boolean;
}

// Relativ, svensk tidsangivelse ("nyss", "2 tim sedan", "igår").
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const min = Math.round(diff / 60000);
  if (min < 1) return 'nyss';
  if (min < 60) return `${min} min sedan`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs} tim sedan`;
  const days = Math.round(hrs / 24);
  if (days === 1) return 'igår';
  if (days < 7) return `${days} dgr sedan`;
  return new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
}

// Ikon per aktivitetstyp/-sort. Färgtonen är medvetet neutral (samma diskreta
// paper-yta för alla) — bara ikonen skiljer typerna åt, så loggen blir lugn.
const ACTIVITY_SWATCH = 'bg-canvas-muted text-foreground-subtle';

function activityVisual(act: DashboardActivity): { icon: string; swatch: string } {
  let icon = 'dot';
  if (act.icon) icon = act.icon;
  else if (act.kind === 'tool_run') icon = 'sparkle';
  else if (act.kind === 'integration_sync') icon = 'cloud';
  else if (act.kind === 'workshop_run' || act.kind === 'workshop_assignment') icon = 'cap';
  else
    switch (act.type) {
      case 'meeting':
        icon = 'calendar';
        break;
      case 'call':
        icon = 'people';
        break;
      case 'email':
        icon = 'inbox';
        break;
      case 'task':
        icon = 'check';
        break;
      case 'workshop':
        icon = 'cap';
        break;
    }
  return { icon, swatch: ACTIVITY_SWATCH };
}

interface Props {
  className?: string;
  agents?: DashboardAgent[];
  connectors?: DashboardConnector[];
  activities?: DashboardActivity[];
  /** Inloggad användares roller — styr vilka delar hjälp-guiden visar (§ 33.3). */
  userRoles?: Role[];
  greeting?: string;
  // Kontrollerade props (ChattWorkspace äger tillståndet)
  messages: UiMessage[];
  isPending: boolean;
  error: string | null;
  activeAgent: DashboardAgent | null;
  // Djupt jobb (kontrolleras av ChattWorkspace)
  deepRunning?: boolean;
  deepProgress?: number;
  // Live-aktivitetsspår för den pågående turen (streaming).
  liveSteps?: LiveStep[];
  // Svaret medan det strömmas in token-för-token (löpande utskrift).
  liveText?: string;
  // Meddelanden som köats medan en turn körs (körs när den blir klar).
  queued?: QueuedItem[];
  // Ändras när en annan tråd öppnas → återställ scroll-läget till botten.
  resetSignal?: string;
  onPickAgent: (a: DashboardAgent | null) => void;
  onReset: () => void;
  onSubmit: (
    text: string,
    opts: { includeWebContext: boolean; attachments: ChatAttachment[]; deepJob: boolean }
  ) => void;
  onDownload: (file: GeneratedFileRef) => void;
  // Ta bort ett ännu icke-körat köat meddelande.
  onCancelQueued?: (id: string) => void;
}

const AGENT_TONES = [
  { swatch: 'bg-movexum-pastell-lila text-movexum-morklila' },
  { swatch: 'bg-movexum-pastell-bla text-movexum-djupbla' },
  { swatch: 'bg-movexum-pastell-gron text-movexum-morkgron' },
  { swatch: 'bg-movexum-pastell-gul text-movexum-morkgul' },
  { swatch: 'bg-movexum-pastell-orange text-movexum-morkorange' }
];

function toneFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AGENT_TONES[h % AGENT_TONES.length];
}

export default function DashboardChat({
  className = '',
  agents = [],
  connectors = [],
  activities = [],
  userRoles = [],
  greeting,
  messages,
  isPending,
  error,
  activeAgent,
  deepRunning = false,
  deepProgress = 0,
  liveSteps = [],
  liveText = '',
  queued = [],
  resetSignal,
  onPickAgent,
  onReset,
  onSubmit,
  onDownload,
  onCancelQueued
}: Props) {
  const [input, setInput] = useState('');
  // Hjälp-guiden ("Vad kan chatten göra?") — rollspecifik, § 33.3.
  const [showGuide, setShowGuide] = useState(false);
  const [includeWebContext, setIncludeWebContext] = useState(false);
  const [deepMode, setDeepMode] = useState(false);
  const [showAssistants, setShowAssistants] = useState(false);
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  // Fullskärmsvy för en inline-visualisering (stort över hela ytan).
  const [lightbox, setLightbox] = useState<InlineVisualRef | null>(null);
  // Aktivitetsloggen visar de fem senaste; "Visa fler" utökar stegvis så att
  // hela historiken kan läsas som en logg utan att startvyn blir lång.
  const ACTIVITY_STEP = 15;
  const [visibleActivities, setVisibleActivities] = useState(5);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // "Fäst vid botten" — auto-scrollar bara när användaren redan är nära botten.
  // Scrollar hen uppåt (för att läsa/jämföra) låter vi vyn vara kvar där medan
  // svaret strömmar in, och visar en "till senaste"-knapp i stället.
  const [stickToBottom, setStickToBottom] = useState(true);

  const isActive = messages.length > 0 || isPending;
  const shownError = localError || error;

  function autoGrow() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  useEffect(() => {
    autoGrow();
  }, [input]);

  // Auto-scroll bara om användaren är "fäst" vid botten. Streamande text
  // använder instant scroll (smooth slåss med token-flödet och rycker).
  useEffect(() => {
    if (!stickToBottom) return;
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    });
  }, [messages.length, isPending, liveSteps.length, liveText, queued.length, stickToBottom]);

  // Uppdaterar "fäst vid botten" när användaren scrollar. ~120 px tolerans så
  // små avvikelser fortfarande räknas som "vid botten".
  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStickToBottom(distanceFromBottom < 120);
  }

  function scrollToBottom() {
    setStickToBottom(true);
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  }

  // Byte av tråd (eller ny chatt) → börja om fäst vid botten.
  useEffect(() => {
    setStickToBottom(true);
  }, [resetSignal]);

  // Stäng fullskärmsvyn med Escape.
  useEffect(() => {
    if (!lightbox) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightbox(null);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightbox]);

  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setLocalError(null);

    const remaining = MAX_ATTACHMENTS - attachments.length;
    if (remaining <= 0) {
      setLocalError(`Max ${MAX_ATTACHMENTS} bilagor per meddelande.`);
      return;
    }
    const accepted = list.slice(0, remaining);
    if (list.length > remaining) {
      setLocalError(`Endast ${remaining} fil(er) till — max ${MAX_ATTACHMENTS} totalt.`);
    }

    setIsProcessingFiles(true);
    try {
      const next: UploadedFile[] = [];
      for (const file of accepted) {
        const mime = detectMime(file);
        if (!mime) {
          setLocalError(`${file.name}: filformatet stöds inte.`);
          continue;
        }
        if (file.size > MAX_FILE_BYTES) {
          setLocalError(`${file.name} är större än 10 MB.`);
          continue;
        }
        try {
          if (ACCEPT_IMAGE.includes(mime)) {
            const { dataUrl, size } = await compressImage(file);
            const effectiveMime = size < file.size ? 'image/jpeg' : mime;
            next.push({
              uid: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              name: file.name,
              mime: effectiveMime,
              kind: 'image',
              size,
              dataUrl
            });
          } else if (mime === 'application/pdf') {
            const dataUrl = await readAsDataUrl(file);
            const result = await extractPdfFromDataUrlAction(dataUrl, file.name);
            if (result.error || !result.text) {
              setLocalError(result.error || `${file.name}: kunde inte läsa PDF.`);
              continue;
            }
            next.push({
              uid: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              name: file.name,
              mime: 'application/pdf',
              kind: 'text',
              size: file.size,
              text: result.text
            });
          } else if (ACCEPT_XLSX.includes(mime)) {
            const dataUrl = await readAsDataUrl(file);
            const result = await extractXlsxFromDataUrlAction(dataUrl, file.name);
            if (result.error || !result.text) {
              setLocalError(result.error || `${file.name}: kunde inte läsa Excel-filen.`);
              continue;
            }
            next.push({
              uid: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              name: file.name,
              mime: XLSX_MIME,
              kind: 'text',
              size: file.size,
              text: result.text
            });
          } else {
            const text = await readAsText(file);
            next.push({
              uid: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              name: file.name,
              mime,
              kind: 'text',
              size: file.size,
              text
            });
          }
        } catch (err) {
          setLocalError(`${file.name}: kunde inte läsa filen.`);
          console.error('[DashboardChat] file read failed', err);
        }
      }
      if (next.length > 0) setAttachments((prev) => [...prev, ...next]);
    } finally {
      setIsProcessingFiles(false);
    }
  }

  function removeAttachment(uid: string) {
    setAttachments((prev) => prev.filter((a) => a.uid !== uid));
  }

  function toggleDeepMode() {
    setDeepMode((v) => {
      const next = !v;
      // Djupa jobb tar bara en instruktion — bilagor/webbkällor gäller inte.
      if (next) {
        setAttachments([]);
        setIncludeWebContext(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (imageInputRef.current) imageInputRef.current.value = '';
      }
      return next;
    });
  }

  /**
   * Röstinmatning (§ 31): transkriptet läggs i rutan i stället för att skickas
   * automatiskt, så att människan läser igenom och skickar själv
   * (människa-i-loopen, EU AI Act art. 14). Flera inspelningar staplas på
   * varandra med mellanslag.
   */
  function appendTranscript(text: string) {
    const addition = text.trim();
    if (!addition) return;
    setInput((prev) => (prev.trim() ? `${prev.trim()} ${addition}` : addition));
    inputRef.current?.focus();
  }

  function submit() {
    const text = input.trim();
    // Djupt jobb kräver en instruktion (text); annars krävs text eller bilaga.
    if (deepMode ? !text : !text && attachments.length === 0) return;
    // Medan en turn körs blockerar vi INTE — ChattWorkspace köar meddelandet
    // och kör det när den pågående turen är klar (löpande feedback). Bilagor
    // hör till just det köade meddelandet.
    if (isProcessingFiles) return;
    setLocalError(null);
    // Användaren skickade aktivt → hoppa till botten så det egna meddelandet syns.
    setStickToBottom(true);
    const sentAttachments: ChatAttachment[] = deepMode
      ? []
      : attachments.map((a) => ({
          name: a.name,
          mime: a.mime,
          kind: a.kind,
          text: a.text,
          dataUrl: a.dataUrl
        }));
    const wasDeep = deepMode;
    setInput('');
    setAttachments([]);
    setDeepMode(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (imageInputRef.current) imageInputRef.current.value = '';
    onSubmit(text, { includeWebContext, attachments: sentAttachments, deepJob: wasDeep });
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  // Går att skicka även medan en turn körs (meddelandet köas då). Vi blockerar
  // bara medan en bilaga fortfarande läses in.
  const canSubmit =
    !isProcessingFiles &&
    (deepMode ? input.trim().length > 0 : input.trim().length > 0 || attachments.length > 0);
  // Om en turn redan kör (eller det finns kö) hamnar nästa meddelande i kön.
  const willQueue = isPending || queued.length > 0;

  const inputPill = (
    <div className="rounded-2xl border border-default bg-surface px-4 py-3 shadow-sm shadow-movexum-svart/5 transition focus-within:border-strong focus-within:ring-2 focus-within:ring-movexum-pastell-lila dark:focus-within:ring-movexum-morklila">
      {deepRunning && (
        <div className="mb-2 rounded-xl bg-movexum-pastell-lila px-3 py-2">
          <div className="flex items-center justify-between text-[12px] font-medium text-movexum-morklila">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="sparkle" size={12} />
              Djupdykning pågår — planerar, hämtar data och sammanställer ett utkast…
            </span>
            <span>{deepProgress}%</span>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-canvas-muted">
            <div className="h-full bg-movexum-lila transition-all" style={{ width: `${deepProgress}%` }} />
          </div>
        </div>
      )}
      {attachments.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {attachments.map((a) => (
            <li
              key={a.uid}
              className="group inline-flex items-center gap-2 rounded-xl border border-default bg-canvas-subtle py-1 pl-1.5 pr-2 text-[12px] text-foreground"
            >
              {a.kind === 'image' && a.dataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.dataUrl} alt="" className="h-7 w-7 rounded-lg object-cover" />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-movexum-pastell-bla text-movexum-djupbla">
                  <Icon name="doc" size={13} />
                </span>
              )}
              <span className="max-w-[160px] truncate font-medium">{a.name}</span>
              <span className="text-foreground-subtle">{formatBytes(a.size)}</span>
              <button
                type="button"
                onClick={() => removeAttachment(a.uid)}
                className="flex h-5 w-5 items-center justify-center rounded-md text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground"
                aria-label={`Ta bort ${a.name}`}
              >
                <Icon name="x" size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKey}
        placeholder={
          deepMode
            ? 'Beskriv vad djupdykningen ska göra (planeras och körs i flera steg)…'
            : willQueue
              ? 'Skriv ett meddelande — det köas och körs när det pågående svaret är klart…'
              : activeAgent
                ? `Fråga ${activeAgent.name}…`
                : 'Fråga om portföljen, ett bolag eller en aktivitet…'
        }
        rows={1}
        className="block w-full resize-none bg-transparent text-[15px] leading-6 text-foreground placeholder:text-foreground-subtle focus:outline-none disabled:opacity-50"
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPT_TEXT_ATTR}
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) addFiles(e.target.files);
        }}
      />

      <input
        ref={imageInputRef}
        type="file"
        multiple
        accept={ACCEPT_IMAGE_ATTR}
        className="hidden"
        onChange={(e) => {
          const target = e.target;
          const files = target.files;
          if (files && files.length > 0) {
            void addFiles(files).finally(() => {
              target.value = '';
            });
          } else {
            target.value = '';
          }
        }}
      />

      {shownError && (
        <div className="mt-2 rounded-xl bg-movexum-pastell-orange px-3 py-2 text-[12.5px] text-movexum-morkorange">
          {shownError}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <VoiceInputButton
            disabled={isProcessingFiles}
            onError={(message) => setLocalError(message || null)}
            onTranscript={appendTranscript}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessingFiles || deepMode || attachments.length >= MAX_ATTACHMENTS}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            title={`Bifoga fil (PNG, JPG, WebP, PDF, XLSX, TXT, MD, CSV · max ${MAX_ATTACHMENTS} filer · 10 MB/fil)`}
            aria-label="Bifoga fil"
          >
            <Icon name="paperclip" size={14} />
          </button>
          {isProcessingFiles && (
            <span className="text-[11.5px] text-foreground-subtle">Läser fil…</span>
          )}
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={deepMode || attachments.length >= MAX_ATTACHMENTS}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            title={`Bifoga bild (PNG, JPG, WebP · max ${MAX_ATTACHMENTS} bilagor · 10 MB/fil)`}
            aria-label="Bifoga bild"
          >
            <Icon name="image" size={14} />
          </button>
          <button
            type="button"
            onClick={() => setIncludeWebContext((v) => !v)}
            aria-pressed={includeWebContext}
            disabled={deepMode}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] transition disabled:cursor-not-allowed disabled:opacity-40 ${
              includeWebContext
                ? 'bg-movexum-pastell-bla text-movexum-djupbla'
                : 'border border-default text-foreground-subtle hover:text-foreground'
            }`}
            title="Inkludera aktuella publika EU-källor (Breakit, Sifted, Vinnova)"
          >
            <Icon name="globe" size={12} />
            Webbkällor
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={deepMode}
            onClick={toggleDeepMode}
            disabled={deepRunning}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
              deepMode
                ? 'bg-movexum-lila text-movexum-vit shadow-sm shadow-movexum-svart/10'
                : 'border border-default text-foreground-subtle hover:border-strong hover:text-foreground'
            }`}
            title="Djupdykning: planerar, hämtar data i flera steg och sammanställer ett utkast (ev. dokument) i tråden"
          >
            <Icon name="sparkle" size={12} />
            Djupdykning
          </button>
          {!isActive && agents.length > 0 && (
            <button
              type="button"
              role="switch"
              aria-checked={showAssistants}
              onClick={() => setShowAssistants((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition ${
                showAssistants
                  ? 'bg-movexum-pastell-gron text-movexum-morkgron'
                  : 'border border-default text-foreground-subtle hover:border-strong hover:text-foreground'
              }`}
              title="Visa assistenter — fördefinierade AI-agenter du kan starta en chatt med"
            >
              <Icon name="bot" size={12} />
              Assistenter
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowGuide(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-default px-3 py-1 text-[12px] text-foreground-subtle transition hover:border-strong hover:text-foreground"
            title="Vad kan chatten göra? Öppna guiden med exempel för din roll"
          >
            <Icon name="help" size={12} />
            Hjälp
          </button>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          aria-label={willQueue ? 'Köa meddelande' : 'Skicka'}
          title={willQueue ? 'Köa meddelande (körs när pågående svar är klart)' : 'Skicka'}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name={willQueue ? 'plus' : 'arrow'} size={16} />
        </button>
      </div>
    </div>
  );

  function renderGeneratedFiles(files?: GeneratedFileRef[]) {
    if (!files || files.length === 0) return null;
    return (
      <ul className="mt-3 flex flex-wrap gap-3">
        {files.map((f) => (
          <li key={f.user_file_id}>
            <div className="w-[300px] max-w-full overflow-hidden rounded-2xl border border-default bg-surface shadow-movexum-svart/5 shadow-lg transition hover:border-strong">
              {f.preview_svg ? (
                <button
                  type="button"
                  onClick={() => onDownload(f)}
                  className="block w-full bg-canvas-subtle"
                  title={`Öppna ${f.filename}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(f.preview_svg)}`}
                    alt={`Förhandsgranskning av ${f.filename}`}
                    className="block w-full"
                  />
                </button>
              ) : null}
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-movexum-pastell-lila text-movexum-morklila">
                  <Icon name={DOC_ICON[f.doc_kind] || 'doc'} size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-foreground" title={f.filename}>
                    {f.filename}
                  </span>
                  <span className="block text-[11px] uppercase tracking-wide text-foreground-subtle">
                    {f.doc_kind} · {Math.max(1, Math.round((f.size_bytes || 0) / 1024))} kB
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onDownload(f)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-default bg-canvas-subtle px-2.5 py-1.5 text-[12px] font-medium text-foreground transition hover:border-strong hover:bg-canvas-muted"
                  title={`Ladda ned ${f.filename}`}
                >
                  <Icon name="download" size={13} />
                  Ladda ned
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  function visualDownload(v: InlineVisualRef, format: 'png' | 'jpeg') {
    void downloadVisualImage(v, format).catch(() => {
      setLocalError('Kunde inte ladda ned bilden — försök igen.');
    });
  }

  function visualDownloadButtons(v: InlineVisualRef, size: 'sm' | 'lg' = 'sm') {
    const cls =
      size === 'lg'
        ? 'inline-flex items-center gap-1.5 rounded-lg border border-default bg-canvas-subtle px-3 py-1.5 text-[12.5px] font-medium text-foreground transition hover:border-strong hover:bg-canvas-muted'
        : 'inline-flex items-center gap-1 rounded-lg border border-default bg-canvas-subtle px-2 py-1 text-[11.5px] font-medium text-foreground transition hover:border-strong hover:bg-canvas-muted';
    return (
      <>
        <button
          type="button"
          onClick={() => visualDownload(v, 'png')}
          className={cls}
          title="Ladda ned som PNG-bild"
        >
          <Icon name="download" size={size === 'lg' ? 13 : 12} />
          PNG
        </button>
        <button
          type="button"
          onClick={() => visualDownload(v, 'jpeg')}
          className={cls}
          title="Ladda ned som JPEG-bild"
        >
          <Icon name="download" size={size === 'lg' ? 13 : 12} />
          JPEG
        </button>
      </>
    );
  }

  // Inline-visualiseringar — visas i chattens fulla bredd; klick öppnar
  // fullskärmsvyn, och PNG/JPEG laddas ned direkt från kortet.
  function renderVisuals(visuals?: InlineVisualRef[]) {
    if (!visuals || visuals.length === 0) return null;
    return (
      <div className="mt-3 flex w-full flex-col gap-4">
        {visuals.map((v) => (
          <figure
            key={v.id}
            className="w-full overflow-hidden rounded-2xl border border-default bg-surface shadow-lg shadow-movexum-svart/5"
          >
            <figcaption className="flex items-center justify-between gap-2 border-b border-default px-4 py-2.5">
              <span className="inline-flex min-w-0 items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-movexum-pastell-bla text-movexum-djupbla">
                  <Icon name="graph" size={13} />
                </span>
                <span className="truncate font-heading text-[13px] font-semibold text-foreground">
                  {v.title || (v.kind === 'stats' ? 'Nyckeltal' : 'Diagram')}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {visualDownloadButtons(v)}
                <button
                  type="button"
                  onClick={() => setLightbox(v)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground"
                  title="Visa i fullskärm"
                  aria-label="Visa i fullskärm"
                >
                  <Icon name="external" size={13} />
                </button>
              </span>
            </figcaption>
            <button
              type="button"
              onClick={() => setLightbox(v)}
              className="block w-full cursor-zoom-in bg-movexum-vit"
              title="Klicka för fullskärm"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={svgDataUrl(v.svg)}
                alt={v.title || 'Visualisering'}
                className="block w-full"
              />
            </button>
          </figure>
        ))}
      </div>
    );
  }

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${className}`}>
      {showGuide && (
        <ChatHelpGuide
          roles={userRoles}
          onClose={() => setShowGuide(false)}
          onUseExample={(text) => {
            // Exemplet läggs i chattrutan men skickas INTE — användaren
            // läser, justerar och skickar själv (människa-i-loopen).
            setInput(text);
            setShowGuide(false);
            inputRef.current?.focus();
          }}
        />
      )}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-movexum-svart/70 p-4 backdrop-blur-sm md:p-8"
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.title || 'Visualisering i fullskärm'}
          onClick={() => setLightbox(null)}
        >
          <div
            className="flex max-h-full w-full max-w-[1320px] flex-col overflow-hidden rounded-2xl border border-default bg-surface shadow-xl shadow-movexum-svart/20"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-default px-4 py-3">
              <span className="truncate font-heading text-[15px] font-semibold text-foreground">
                {lightbox.title || (lightbox.kind === 'stats' ? 'Nyckeltal' : 'Diagram')}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {visualDownloadButtons(lightbox, 'lg')}
                <button
                  type="button"
                  onClick={() => setLightbox(null)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground"
                  title="Stäng"
                  aria-label="Stäng fullskärmsvyn"
                >
                  <Icon name="x" size={15} />
                </button>
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-movexum-vit">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={svgDataUrl(lightbox.svg)}
                alt={lightbox.title || 'Visualisering'}
                className="block w-full"
              />
            </div>
          </div>
        </div>
      )}
      {!isActive ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto py-10">
          <div className="mx-auto flex w-full max-w-[720px] flex-col px-6">
            {greeting && (
              <h1 className="font-heading text-[28px] font-semibold tracking-tight text-foreground md:text-[34px]">
                {greeting}
              </h1>
            )}
            <p className="mt-2 text-[14px] text-foreground-subtle">Vad kan jag hjälpa dig med idag?</p>
            <button
              type="button"
              onClick={() => setShowGuide(true)}
              className="mt-2 inline-flex items-center gap-1.5 self-start text-[13px] text-link transition hover:underline"
            >
              <Icon name="help" size={13} />
              Vad kan chatten göra? Se guiden med exempel
            </button>

            {activeAgent && (
              <div className="mt-5 flex items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-canvas-subtle px-3 py-1 text-[12px] text-foreground-muted">
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full ${toneFor(activeAgent.id).swatch}`}>
                    <Icon name="sparkle" size={9} />
                  </span>
                  Med {activeAgent.name}
                  <button
                    type="button"
                    onClick={() => onPickAgent(null)}
                    className="text-foreground-subtle transition hover:text-foreground"
                    aria-label="Avsluta agentläge"
                  >
                    <Icon name="x" size={11} />
                  </button>
                </span>
              </div>
            )}

            <div className="mt-6">{inputPill}</div>

            {connectors.length > 0 && (
              <section className="mt-12">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="font-heading text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
                    Mina connectors
                  </h2>
                  <a href="/integrationer" className="text-[12px] text-foreground-subtle transition hover:text-foreground">
                    Hantera
                  </a>
                </div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
                  {connectors.slice(0, 6).map((c) => {
                    const tone = toneFor(`${c.kind}:${c.id}`);
                    return (
                      <a
                        key={`${c.kind}-${c.id}`}
                        href={`/integrationer/connectors/${c.kind}/${encodeURIComponent(c.id)}`}
                        className="group flex flex-col items-start gap-2 rounded-2xl border border-default bg-surface p-3 transition hover:-translate-y-0.5 hover:border-strong hover:shadow-sm hover:shadow-movexum-svart/10"
                        title={c.blurb || c.name}
                      >
                        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${tone.swatch}`}>
                          <Icon name="sparkle" size={12} />
                        </span>
                        <span className="line-clamp-2 font-heading text-[12.5px] font-semibold leading-tight text-foreground">
                          {c.name}
                        </span>
                      </a>
                    );
                  })}
                </div>
              </section>
            )}

            {showAssistants && agents.length > 0 ? (
              <section className="mt-12">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="font-heading text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
                    Assistenter
                  </h2>
                  <a href="/toolbox" className="text-[12px] text-foreground-subtle transition hover:text-foreground">
                    Alla
                  </a>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {agents.map((a) => {
                    const tone = toneFor(a.id);
                    const selected = activeAgent?.id === a.id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => onPickAgent(a)}
                        className={`group flex flex-col gap-2 rounded-2xl border bg-surface p-4 text-left transition hover:-translate-y-0.5 hover:border-strong hover:shadow-sm hover:shadow-movexum-svart/10 ${
                          selected ? 'border-strong shadow-sm shadow-movexum-svart/10' : 'border-default'
                        }`}
                      >
                        <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${tone.swatch}`}>
                          <Icon name="sparkle" size={14} />
                        </span>
                        <span className="font-heading text-[14.5px] font-semibold leading-tight text-foreground">
                          {a.name}
                        </span>
                        {a.description ? (
                          <span className="line-clamp-2 text-[12.5px] leading-snug text-foreground-muted">
                            {a.description}
                          </span>
                        ) : null}
                        <span className="mt-auto pt-1 text-[11px] text-foreground-subtle">
                          {a.runs ? `${a.runs} körningar` : 'Klicka för att starta'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : (
              <section className="mt-12">
                <div className="mb-3 flex items-baseline justify-between">
                  <div>
                    <h2 className="font-heading text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
                      Aktivitet
                    </h2>
                    <p className="mt-0.5 text-[12px] text-foreground-subtle">
                      Det senaste i portföljen och det du gjort i systemet
                    </p>
                  </div>
                  <a href="/aktivitet" className="text-[12px] text-foreground-subtle transition hover:text-foreground">
                    Alla
                  </a>
                </div>
                {activities.length === 0 ? (
                  <div className="rounded-2xl border border-default bg-surface px-4 py-8 text-center text-[13px] text-foreground-subtle">
                    Inga händelser än. Aktiviteter från bolagen dyker upp här.
                  </div>
                ) : (
                  <>
                    <ul className="overflow-hidden rounded-2xl border border-default bg-surface">
                      {activities.slice(0, visibleActivities).map((act, i) => {
                        const v = activityVisual(act);
                        const href =
                          act.href ?? (act.startupId ? `/startups/${act.startupId}` : undefined);
                        const inner = (
                          <>
                            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${v.swatch}`}>
                              {act.toolIcon ? (
                                <span className="text-[13px] leading-none">{act.toolIcon}</span>
                              ) : (
                                <Icon name={v.icon} size={13} />
                              )}
                            </span>
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <p className="truncate text-[13px] font-medium text-foreground">{act.title}</p>
                              {act.startupName && (
                                <span className="shrink-0 truncate text-[12px] text-foreground-muted">
                                  {act.startupName}
                                </span>
                              )}
                              {act.viaAgent && (
                                <span
                                  className="inline-flex shrink-0 items-center gap-1 rounded-md bg-canvas-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground-subtle"
                                  title="Utfört via AI-chatten"
                                >
                                  <Icon name="sparkle" size={9} />
                                  AI
                                </span>
                              )}
                            </div>
                            <span className="shrink-0 text-[11.5px] text-foreground-subtle">
                              {relativeTime(act.created)}
                            </span>
                            {href && (
                              <Icon
                                name="arrow-up-right"
                                size={13}
                                className="shrink-0 text-foreground-subtle transition group-hover:text-foreground"
                              />
                            )}
                          </>
                        );
                        const rowClass = `group flex items-center gap-2.5 px-4 py-2 transition ${
                          i > 0 ? 'border-t border-default' : ''
                        } ${href ? 'hover:bg-canvas-subtle' : ''}`;
                        const rowTitle = act.actorName ? `Av ${act.actorName}` : undefined;
                        return (
                          <li key={act.id}>
                            {href ? (
                              <a href={href} className={rowClass} title={rowTitle}>
                                {inner}
                              </a>
                            ) : (
                              <div className={rowClass} title={rowTitle}>
                                {inner}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {activities.length > 5 && (
                      <div className="mt-2 flex items-center justify-center gap-2">
                        {visibleActivities < activities.length && (
                          <button
                            type="button"
                            onClick={() =>
                              setVisibleActivities((v) =>
                                Math.min(activities.length, v + ACTIVITY_STEP)
                              )
                            }
                            className="flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-[12px] text-foreground-subtle transition hover:bg-canvas-subtle hover:text-foreground"
                          >
                            {`Visa ${Math.min(activities.length - visibleActivities, ACTIVITY_STEP)} till`}
                            <Icon name="chevdown" size={13} />
                          </button>
                        )}
                        {visibleActivities > 5 && (
                          <button
                            type="button"
                            onClick={() => setVisibleActivities(5)}
                            className="flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-[12px] text-foreground-subtle transition hover:bg-canvas-subtle hover:text-foreground"
                          >
                            Visa färre
                            <Icon name="chevdown" size={13} className="rotate-180" />
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </section>
            )}

            <p className="mt-10 text-center text-[11px] text-foreground-subtle">
              AI-verktyg drivs av Mistral / Le Chat (Frankrike, EU-suveränt). Konfidentiella anteckningar exkluderas alltid.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <div ref={scrollRef} onScroll={onScroll} className="absolute inset-0 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 py-6">
              <div className="flex items-center justify-between">
                {activeAgent ? (
                  <span className="inline-flex items-center gap-2 rounded-full bg-canvas-subtle px-3 py-1 text-[12px] text-foreground-muted">
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full ${toneFor(activeAgent.id).swatch}`}>
                      <Icon name="sparkle" size={9} />
                    </span>
                    Med {activeAgent.name}
                  </span>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={onReset}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] text-foreground-subtle transition hover:text-foreground"
                  title="Börja om"
                >
                  <Icon name="plus" size={12} />
                  Ny chatt
                </button>
              </div>

              {messages.map((msg, i) =>
                msg.role === 'user' ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[78%] rounded-2xl rounded-tr-md bg-brand px-4 py-2.5 text-[14.5px] leading-relaxed text-brand-foreground">
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex justify-start">
                    {/* Full bredd när visualiseringar finns — de ska visas stort över hela ytan. */}
                    <div className={msg.visuals && msg.visuals.length > 0 ? 'w-full min-w-0' : 'max-w-[85%]'}>
                      {msg.steps && msg.steps.length > 0 && (
                        <ActivityTrail items={msg.steps.map((s) => ({ label: s.label, ok: s.ok }))} />
                      )}
                      <div
                        className="max-w-[640px] text-[14.5px] leading-relaxed text-foreground"
                        dangerouslySetInnerHTML={{ __html: chatMarkdownToHtml(msg.content) }}
                      />
                      {renderVisuals(msg.visuals)}
                      {renderGeneratedFiles(msg.generated_files)}
                      {typeof msg.tokens === 'number' && msg.tokens > 0 && (
                        <p
                          className="mt-1.5 text-[11px] tabular-nums text-foreground-subtle"
                          title={`${AI_IMPACT_SOURCE_LABEL}. Uppskattningen tillämpas på turens totala tokens (in + ut) — varje verktygssteg kräver ett eget modellanrop som bearbetar hela kontexten igen.`}
                        >
                          {formatTokens(msg.tokens)} tokens · {formatAiImpact(msg.tokens)}
                        </p>
                      )}
                    </div>
                  </div>
                )
              )}

              {isPending && (
                <div className="flex justify-start">
                  <div className="max-w-[85%]">
                    <ActivityTrail
                      items={liveSteps.map((s) => ({ label: s.label, running: s.running, ok: s.ok }))}
                    />
                    {liveText ? (
                      <div
                        className="text-[14.5px] leading-relaxed text-foreground"
                        dangerouslySetInnerHTML={{
                          __html: withStreamCursor(chatMarkdownToHtml(liveText))
                        }}
                      />
                    ) : (
                      <div className="inline-flex gap-1 text-foreground-subtle" aria-label="Arbetar">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground-subtle" style={{ animationDelay: '0ms' }} />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground-subtle" style={{ animationDelay: '150ms' }} />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground-subtle" style={{ animationDelay: '300ms' }} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Köade meddelanden — skrivna medan turen körs, körs i tur och ordning. */}
              {queued.map((q) => (
                <div key={q.id} className="flex justify-end">
                  <div className="group relative max-w-[78%] rounded-2xl rounded-tr-md border border-dashed border-strong bg-canvas-subtle px-4 py-2.5 text-[14.5px] leading-relaxed text-foreground-muted">
                    <span className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-foreground-subtle">
                      <Icon name="clock" size={11} />
                      I kö
                      {onCancelQueued && (
                        <button
                          type="button"
                          onClick={() => onCancelQueued(q.id)}
                          className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground"
                          aria-label="Ta bort ur kö"
                          title="Ta bort ur kö"
                        >
                          <Icon name="x" size={10} />
                        </button>
                      )}
                    </span>
                    {q.content}
                  </div>
                </div>
              ))}

              <div ref={bottomRef} />
            </div>
            </div>
            {!stickToBottom && (
              <button
                type="button"
                onClick={scrollToBottom}
                className="absolute bottom-4 left-1/2 z-10 inline-flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-default bg-surface text-foreground-muted shadow-md shadow-movexum-svart/10 transition hover:border-strong hover:text-foreground"
                title="Till senaste"
                aria-label="Scrolla till senaste meddelandet"
              >
                <Icon name="chevdown" size={18} />
              </button>
            )}
          </div>

          <div className="border-t border-default bg-canvas">
            <div className="mx-auto w-full max-w-[720px] px-6 py-4">
              {inputPill}
              <p className="mt-2 text-center text-[11px] text-foreground-subtle">
                AI drivs av Mistral / Le Chat (EU). Konfidentiella anteckningar exkluderas alltid. Genererade dokument: verifiera innan delning.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
