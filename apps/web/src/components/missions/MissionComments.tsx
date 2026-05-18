import { Icon } from '@/components/proto';
import type { MissionComment } from '@platform/shared';
import {
  createMissionCommentFormAction,
  deleteMissionCommentFormAction
} from '@/lib/actions/mission-comments';
import { MentionInput, type MentionUser } from './MentionInput';

const MENTION_REGEX = /@\[([^\]]+)\]\(([a-zA-Z0-9]+)\)/g;

interface MissionCommentsProps {
  missionId: string;
  comments: MissionComment[];
  users: MentionUser[];
  currentUserId: string;
  canComment: boolean;
}

function renderBody(body: string) {
  const out: Array<string | { name: string; userId: string }> = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(MENTION_REGEX.source, 'g');
  while ((match = re.exec(body)) !== null) {
    if (match.index > last) out.push(body.slice(last, match.index));
    out.push({ name: match[1], userId: match[2] });
    last = match.index + match[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}

function fmtTime(s: string) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
}

function initials(name?: string, fallback = '?') {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function MissionComments({
  missionId,
  comments,
  users,
  currentUserId,
  canComment
}: MissionCommentsProps) {
  return (
    <section
      className="rounded-2xl border border-default bg-surface"
      style={{ overflow: 'hidden' }}
    >
      <header
        className="flex items-center gap-2 border-b border-default px-4 py-3"
      >
        <Icon name="message" size={14} />
        <h3 className="font-heading text-[14px] font-semibold text-foreground">
          Diskussion
        </h3>
        <span className="ml-auto text-[10.5px] font-mono uppercase tracking-[0.14em] text-foreground-subtle">
          {comments.length}
        </span>
      </header>

      <div className="px-4 py-4">
        {comments.length === 0 ? (
          <p className="text-[12.5px] text-foreground-subtle">
            Inga kommentarer ännu. Starta diskussionen med teamet.
          </p>
        ) : (
          <ol className="space-y-3">
            {comments.map((c) => {
              const author = c.expand?.author;
              const displayName = author?.display_name || author?.email || 'Användare';
              const isOwn = c.author === currentUserId;
              return (
                <li
                  key={c.id}
                  id={`kommentar-${c.id}`}
                  className="rounded-xl border border-default bg-canvas-subtle p-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-movexum-pastell-lila text-[11px] font-semibold uppercase text-movexum-lila">
                      {initials(displayName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="font-semibold text-foreground">{displayName}</span>
                        <span className="text-foreground-subtle">{fmtTime(c.created)}</span>
                        {c.edited_at && (
                          <span className="text-foreground-subtle">· redigerad</span>
                        )}
                      </div>
                      <div
                        className={
                          'mt-1 whitespace-pre-wrap text-[13px] leading-relaxed ' +
                          (c.deleted ? 'italic text-foreground-subtle' : 'text-foreground')
                        }
                      >
                        {renderBody(c.body).map((part, i) =>
                          typeof part === 'string' ? (
                            <span key={i}>{part}</span>
                          ) : (
                            <span
                              key={i}
                              className="inline-flex items-center rounded-md bg-movexum-pastell-lila px-1.5 py-0.5 text-[12px] font-medium text-movexum-lila"
                            >
                              @{part.name}
                            </span>
                          )
                        )}
                      </div>
                      {isOwn && !c.deleted && (
                        <form
                          action={deleteMissionCommentFormAction}
                          className="mt-1"
                        >
                          <input type="hidden" name="comment_id" value={c.id} />
                          <button
                            type="submit"
                            className="text-[11px] text-foreground-subtle hover:text-movexum-orange"
                          >
                            Radera
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {canComment ? (
        <form
          action={createMissionCommentFormAction}
          className="border-t border-default bg-canvas px-4 py-3"
        >
          <input type="hidden" name="mission_id" value={missionId} />
          <MentionInput
            name="body"
            placeholder="Skriv en kommentar. Använd @ för att tagga någon."
            users={users}
          />
          <div className="mt-2 flex items-center justify-end">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-brand-foreground transition hover:bg-brand-hover"
            >
              <Icon name="send" size={12} /> Publicera
            </button>
          </div>
        </form>
      ) : (
        <div className="border-t border-default bg-canvas-subtle px-4 py-3 text-[11.5px] text-foreground-subtle">
          Du saknar behörighet att kommentera i det här uppdraget.
        </div>
      )}
    </section>
  );
}
