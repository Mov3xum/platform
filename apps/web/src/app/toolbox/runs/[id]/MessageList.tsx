import type { ToolRunMessage, ToolRunAttachmentRef } from '@platform/shared';

function AttachmentChip({ att }: { att: ToolRunAttachmentRef }) {
  const icon = att.mime.startsWith('image/')
    ? '🖼️'
    : att.mime === 'application/pdf'
      ? '📄'
      : '📝';
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-default bg-canvas-subtle px-2.5 py-1 text-xs text-foreground-muted">
      <span aria-hidden>{icon}</span>
      <span className="truncate max-w-[160px]">{att.filename}</span>
      {att.extracted_text_bytes !== undefined && att.extracted_text_bytes > 0 && (
        <span className="text-foreground-subtle">
          · {(att.extracted_text_bytes / 1024).toFixed(0)} kB text
        </span>
      )}
    </span>
  );
}

function MessageBubble({ message }: { message: ToolRunMessage }) {
  const isUser = message.role === 'user';
  const alignClass = isUser ? 'justify-end' : 'justify-start';
  const bubbleClass = isUser
    ? 'bg-canvas-subtle text-foreground'
    : 'bg-surface text-foreground border border-default';

  return (
    <div className={`flex ${alignClass}`}>
      <div className={`max-w-[85%] rounded-3xl px-5 py-4 ${bubbleClass}`}>
        {message.attachments && message.attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {message.attachments.map((a, i) => (
              <AttachmentChip key={`${a.pb_file}-${i}`} att={a} />
            ))}
          </div>
        )}
        <div className="prose prose-sm max-w-none text-foreground dark:prose-invert">
          <pre className="whitespace-pre-wrap font-body text-sm">{message.content}</pre>
        </div>
        {message.role === 'assistant' && (message.model || message.tokens_in) && (
          <p className="mt-2 text-xs text-foreground-subtle">
            {message.model && <span className="font-mono">{message.model}</span>}
            {message.tokens_in !== undefined && (
              <span>
                {' '}· {(message.tokens_in + (message.tokens_out ?? 0)).toLocaleString('sv-SE')} tokens
              </span>
            )}
            {message.cost_usd !== undefined && message.cost_usd > 0 && (
              <span> · ≈ ${message.cost_usd.toFixed(4)}</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

export function MessageList({ messages }: { messages: ToolRunMessage[] }) {
  const visible = messages.filter((m) => m.role !== 'system');
  if (visible.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-strong bg-surface/50 p-12 text-center">
        <p className="text-foreground-muted">Inga meddelanden ännu.</p>
      </div>
    );
  }

  // Sammanställning av modeller använda i denna chatt
  const modelCounts = new Map<string, number>();
  for (const m of visible) {
    if (m.role === 'assistant' && m.model) {
      modelCounts.set(m.model, (modelCounts.get(m.model) ?? 0) + 1);
    }
  }
  const modelSummary = Array.from(modelCounts.entries())
    .map(([m, c]) => `${m} (${c})`)
    .join(', ');

  return (
    <div className="space-y-4">
      {modelCounts.size > 1 && (
        <p className="rounded-2xl bg-canvas-subtle px-4 py-2 text-xs text-foreground-muted">
          Modeller använda i denna chatt: <span className="font-mono">{modelSummary}</span>
        </p>
      )}
      {visible.map((m, i) => (
        <MessageBubble key={`${m.role}-${i}-${m.at}`} message={m} />
      ))}
    </div>
  );
}

/**
 * För legacy-körningar (skapade innan messages-fältet fanns): syntetisera
 * en minimal historik från output_md så att chatten kan renderas och
 * fortsätta.
 */
export function legacyMessagesFromRun(run: {
  output_md?: string;
  model?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_estimate_usd?: number;
  created: string;
}): ToolRunMessage[] {
  if (!run.output_md) return [];
  return [
    {
      role: 'user',
      content: '(Första körningen — bara verktygets systemprompt och kontext.)',
      at: run.created
    },
    {
      role: 'assistant',
      content: run.output_md,
      model: run.model,
      tokens_in: run.tokens_in,
      tokens_out: run.tokens_out,
      cost_usd: run.cost_estimate_usd,
      at: run.created
    }
  ];
}
