'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  sendChatMessage,
  type ChatAttachment,
  type ChatMessage
} from '@/lib/actions/chat';
import {
  extractPdfFromDataUrlAction,
  extractXlsxFromDataUrlAction
} from '@/lib/actions/chat-attachments';
import { Icon } from '@/components/proto/Icon';

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPT_IMAGE = ['image/png', 'image/jpeg', 'image/webp'];
const ACCEPT_TEXT = ['text/plain', 'text/markdown', 'text/csv', 'application/csv'];
const ACCEPT_PDF = ['application/pdf'];
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ACCEPT_XLSX = [
  XLSX_MIME,
  'application/vnd.ms-excel'
];
const ACCEPT_IMAGE_ATTR = 'image/png,image/jpeg,image/webp';
const ACCEPT_TEXT_ATTR =
  'text/plain,text/markdown,text/csv,application/pdf,' +
  XLSX_MIME +
  ',.md,.csv,.txt,.pdf,.xlsx';

interface UploadedFile extends ChatAttachment {
  uid: string;
  size: number;
}

function detectMime(file: File): string | null {
  const mime = (file.type || '').toLowerCase();
  if (
    mime &&
    [...ACCEPT_IMAGE, ...ACCEPT_TEXT, ...ACCEPT_PDF, ...ACCEPT_XLSX].includes(mime)
  ) {
    return mime;
  }
  // Fallback via extension för md/csv/txt/pdf/xlsx utan korrekt mime
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

export interface DashboardAgent {
  id: string;
  name: string;
  description?: string;
  category: 'ai_per_startup' | 'ai_system_wide' | string;
  runs?: number;
}

// Pinnade connectors visas under assistenter-sektionen på /idag.
// Klick → öppnar connector-chatten i samma layout som vanliga
// connector-vyer (/integrationer/connectors/<kind>/<id>).
export interface DashboardConnector {
  kind: 'builtin' | 'mcp';
  id: string;
  name: string;
  blurb?: string;
}

interface Props {
  className?: string;
  agents?: DashboardAgent[];
  connectors?: DashboardConnector[];
  greeting?: string;
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

export default function DashboardChat({ className = '', agents = [], connectors = [], greeting }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [includeWebContext, setIncludeWebContext] = useState(false);
  const [activeAgent, setActiveAgent] = useState<DashboardAgent | null>(null);
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isActive = messages.length > 0 || isPending;

  function autoGrow() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  useEffect(() => {
    autoGrow();
  }, [input]);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  }

  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setError(null);

    const remaining = MAX_ATTACHMENTS - attachments.length;
    if (remaining <= 0) {
      setError(`Max ${MAX_ATTACHMENTS} bilagor per meddelande.`);
      return;
    }
    const accepted = list.slice(0, remaining);
    if (list.length > remaining) {
      setError(`Endast ${remaining} fil(er) till — max ${MAX_ATTACHMENTS} totalt.`);
    }

    setIsProcessingFiles(true);
    try {
      const next: UploadedFile[] = [];
      for (const file of accepted) {
        const mime = detectMime(file);
        if (!mime) {
          setError(`${file.name}: filformatet stöds inte.`);
          continue;
        }
        if (file.size > MAX_FILE_BYTES) {
          setError(`${file.name} är större än 10 MB.`);
          continue;
        }
        try {
          if (ACCEPT_IMAGE.includes(mime)) {
            const { dataUrl, size } = await compressImage(file);
            // Vid kompression encodas alltid som JPEG; reflektera det i mime.
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
              setError(result.error || `${file.name}: kunde inte läsa PDF.`);
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
              setError(result.error || `${file.name}: kunde inte läsa Excel-filen.`);
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
          setError(`${file.name}: kunde inte läsa filen.`);
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

  function submit() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || isPending) return;

    const displayText =
      text || (attachments.length === 1 ? '(bilaga skickad)' : '(bilagor skickade)');
    const userMessage: ChatMessage = { role: 'user', content: displayText };
    const nextMessages: ChatMessage[] = [...messages, userMessage];

    setMessages(nextMessages);
    setInput('');
    setError(null);
    scrollToBottom();

    const agentId = activeAgent?.id;
    const sentAttachments: ChatAttachment[] = attachments.map((a) => ({
      name: a.name,
      mime: a.mime,
      kind: a.kind,
      text: a.text,
      dataUrl: a.dataUrl
    }));
    setAttachments([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (imageInputRef.current) imageInputRef.current.value = '';

    startTransition(async () => {
      try {
        const result = await sendChatMessage(nextMessages, {
          includeWebContext,
          agentId,
          attachments: sentAttachments
        });
        if (result.error) {
          setError(result.error);
        } else if (result.text) {
          setMessages((prev) => [...prev, { role: 'assistant', content: result.text! }]);
          scrollToBottom();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Något gick fel';
        const bodyLimit = /body|request.*size|payload|too large/i.test(msg);
        setError(
          bodyLimit
            ? 'Bilagorna är för stora för att skickas — försök med färre eller mindre filer.'
            : msg
        );
        console.error('[DashboardChat] submit failed', err);
      }
    });
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function pickAgent(agent: DashboardAgent) {
    setActiveAgent(agent);
    setError(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function clearAgent() {
    setActiveAgent(null);
  }

  function resetConversation() {
    setMessages([]);
    setError(null);
    setActiveAgent(null);
    setInput('');
    setAttachments([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (imageInputRef.current) imageInputRef.current.value = '';
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function openImagePicker() {
    imageInputRef.current?.click();
  }

  const canSubmit =
    !isPending && !isProcessingFiles && (input.trim().length > 0 || attachments.length > 0);

  const inputPill = (
    <div className="rounded-2xl border border-default bg-surface px-4 py-3 shadow-sm shadow-movexum-svart/5 transition focus-within:border-strong focus-within:ring-2 focus-within:ring-movexum-pastell-lila dark:focus-within:ring-movexum-morklila">
      {attachments.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {attachments.map((a) => (
            <li
              key={a.uid}
              className="group inline-flex items-center gap-2 rounded-xl border border-default bg-canvas-subtle py-1 pl-1.5 pr-2 text-[12px] text-foreground"
            >
              {a.kind === 'image' && a.dataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.dataUrl}
                  alt=""
                  className="h-7 w-7 rounded-lg object-cover"
                />
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
          activeAgent
            ? `Fråga ${activeAgent.name}…`
            : 'Fråga om portföljen, ett bolag eller en aktivitet…'
        }
        disabled={isPending}
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

      {error && (
        <div className="mt-2 rounded-xl bg-movexum-pastell-orange px-3 py-2 text-[12.5px] text-movexum-morkorange">
          {error}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={openFilePicker}
            disabled={isPending || isProcessingFiles || attachments.length >= MAX_ATTACHMENTS}
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
            onClick={openImagePicker}
            disabled={isPending || attachments.length >= MAX_ATTACHMENTS}
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
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] transition ${
              includeWebContext
                ? 'bg-movexum-pastell-bla text-movexum-djupbla'
                : 'border border-default text-foreground-subtle hover:text-foreground'
            }`}
            title="Inkludera publika webbkällor (Wikipedia, EU)"
          >
            <Icon name="globe" size={12} />
            Webbkällor
          </button>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          aria-label="Skicka"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="arrow" size={16} />
        </button>
      </div>
    </div>
  );

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${className}`}>
      {!isActive ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto py-10">
          <div className="mx-auto flex w-full max-w-[720px] flex-col px-6">
            {greeting && (
              <h1 className="font-heading text-[28px] font-semibold tracking-tight text-foreground md:text-[34px]">
                {greeting}
              </h1>
            )}
            <p className="mt-2 text-[14px] text-foreground-subtle">
              Vad kan jag hjälpa dig med idag?
            </p>

            {activeAgent && (
              <div className="mt-5 flex items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-canvas-subtle px-3 py-1 text-[12px] text-foreground-muted">
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full ${toneFor(activeAgent.id).swatch}`}>
                    <Icon name="sparkle" size={9} />
                  </span>
                  Med {activeAgent.name}
                  <button
                    type="button"
                    onClick={clearAgent}
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
                  <a
                    href="/integrationer"
                    className="text-[12px] text-foreground-subtle transition hover:text-foreground"
                  >
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

            {agents.length > 0 && (
              <section className="mt-12">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="font-heading text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
                    Assistenter
                  </h2>
                  <a
                    href="/toolbox"
                    className="text-[12px] text-foreground-subtle transition hover:text-foreground"
                  >
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
                        onClick={() => pickAgent(a)}
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
            )}

            <p className="mt-10 text-center text-[11px] text-foreground-subtle">
              AI-verktyg drivs av Mistral / Le Chat (Frankrike, EU-suveränt). Konfidentiella anteckningar exkluderas alltid.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 py-6">
              <div className="flex items-center justify-between">
                {activeAgent ? (
                  <span className="inline-flex items-center gap-2 rounded-full bg-canvas-subtle px-3 py-1 text-[12px] text-foreground-muted">
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full ${toneFor(activeAgent.id).swatch}`}>
                      <Icon name="sparkle" size={9} />
                    </span>
                    Med {activeAgent.name}
                    <button
                      type="button"
                      onClick={clearAgent}
                      className="text-foreground-subtle transition hover:text-foreground"
                      aria-label="Avsluta agentläge"
                    >
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={resetConversation}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] text-foreground-subtle transition hover:text-foreground"
                  title="Börja om"
                >
                  <Icon name="plus" size={12} />
                  Ny konversation
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
                    <div className="max-w-[85%] whitespace-pre-wrap text-[14.5px] leading-relaxed text-foreground">
                      {msg.content}
                    </div>
                  </div>
                )
              )}

              {isPending && (
                <div className="flex justify-start">
                  <div className="inline-flex gap-1 text-foreground-subtle" aria-label="Laddar svar">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground-subtle" style={{ animationDelay: '0ms' }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground-subtle" style={{ animationDelay: '150ms' }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground-subtle" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </div>

          <div className="border-t border-default bg-canvas">
            <div className="mx-auto w-full max-w-[720px] px-6 py-4">
              {inputPill}
              <p className="mt-2 text-center text-[11px] text-foreground-subtle">
                AI drivs av Mistral / Le Chat (EU). Konfidentiella anteckningar exkluderas alltid.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
