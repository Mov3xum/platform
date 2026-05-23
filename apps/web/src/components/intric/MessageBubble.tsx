import { Icon } from '@/components/proto/Icon';
import { inlineMarkdown } from '@/lib/safe-html';

export interface ChatBubble {
  role: 'user' | 'assistant';
  content: string;
  at?: string;
  model?: string;
  sources?: string[];
}

export function MessageBubble({ msg }: { msg: ChatBubble }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] rounded-2xl rounded-tr-md bg-brand px-4 py-3 text-brand-foreground shadow-sm shadow-movexum-svart/5">
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{msg.content}</p>
          {msg.at && (
            <div className="mt-1.5 font-mono text-[10.5px] opacity-70">{msg.at}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-default bg-canvas-muted text-foreground-muted">
        <Icon name="sparkle" size={14} />
      </div>
      <div className="max-w-[78%]">
        <div className="rounded-2xl rounded-tl-md border border-default bg-surface px-4 py-3.5 shadow-sm shadow-movexum-svart/5">
          {msg.model && (
            <div className="mb-2 flex items-center gap-2">
              <span className="font-mono text-[11px] text-foreground-subtle">{msg.model}</span>
              <span className="rounded-md bg-movexum-pastell-gron px-1.5 py-0.5 text-[10px] font-medium text-movexum-gron">
                grounded
              </span>
            </div>
          )}
          <p
            className="whitespace-pre-wrap text-[14px] leading-relaxed text-foreground"
            dangerouslySetInnerHTML={{ __html: inlineMarkdown(msg.content) }}
          />
          {msg.sources && msg.sources.length > 0 && (
            <div className="mt-4 border-t border-default pt-3">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                Källor
              </div>
              <div className="flex flex-wrap gap-1.5">
                {msg.sources.map((s, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 rounded-md border border-default bg-canvas-muted px-2 py-1 font-mono text-[11.5px] text-foreground-muted"
                  >
                    <Icon name="doc" size={11} /> {s}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        {msg.at && (
          <div className="ml-1 mt-1 font-mono text-[10.5px] text-foreground-subtle">{msg.at}</div>
        )}
      </div>
    </div>
  );
}
