'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SUPPORT_CHECK_SECTIONS, SUPPORT_CHECK_SECTION_LABELS, type SupportCheckSection } from '@platform/shared';
import { addCommentAction, resolveCommentAction } from '@/lib/actions/support-checks';
import { Icon } from '@/components/proto';
import { Notice, btnGhost, btnPrimary, inputClass, labelClass } from '../ui';

export interface CommentView {
  id: string;
  authorName: string;
  section: string;
  body: string;
  visibleToApplicant: boolean;
  revision: number;
  resolved: boolean;
  createdAt: string;
  mine: boolean;
}

/**
 * Kompletteringspunkter per avsnitt (§ 46.5). Granskaren markerar avsnitt och
 * om bolaget ska se punkten; bolaget svarar i samma lista; granskaren bockar
 * av. Ansökan kan inte skickas in på nytt med olösta synliga punkter.
 */
export function CommentsPanel({ applicationId, comments, isStaff, canComment, currentRevision }: { applicationId: string; comments: CommentView[]; isStaff: boolean; canComment: boolean; currentRevision: number }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [section, setSection] = useState<SupportCheckSection>('general');
  const [visible, setVisible] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const open = comments.filter((c) => !c.resolved && c.visibleToApplicant).length;

  return (
    <div className="space-y-3">
      {error && <Notice kind="error">{error}</Notice>}
      {open > 0 && <p className="text-xs text-movexum-morkgul dark:text-movexum-pastell-gul">{open} olösta punkter synliga för bolaget.</p>}
      {comments.length === 0 ? (
        <p className="text-sm text-foreground-subtle">Inga kommentarer än.</p>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className={`rounded-xl border border-default p-3 text-sm ${c.resolved ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-subtle">
                <span className="font-semibold text-foreground">{c.authorName}</span>
                <span>· {SUPPORT_CHECK_SECTION_LABELS[c.section as SupportCheckSection] ?? c.section}</span>
                <span>· {c.createdAt}</span>
                {c.revision < currentRevision && <span>· version {c.revision}</span>}
                {!c.visibleToApplicant && <span className="rounded-full bg-canvas-muted px-2 py-0.5">internt</span>}
                {c.resolved && <span className="rounded-full bg-movexum-pastell-gron px-2 py-0.5 text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">löst</span>}
                <span className="flex-1" />
                {isStaff && (
                  <button
                    type="button"
                    className="text-link hover:underline"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const res = await resolveCommentAction(c.id, !c.resolved);
                        if (res.error) setError(res.error);
                        router.refresh();
                      })
                    }
                  >
                    {c.resolved ? 'Öppna igen' : 'Markera löst'}
                  </button>
                )}
              </div>
              <p className="mt-1 whitespace-pre-line text-foreground">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canComment && (
        <form
          className="space-y-2 rounded-2xl border border-default bg-canvas-subtle p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const res = await addCommentAction(applicationId, { section, body, visibleToApplicant: isStaff ? visible : true });
              if (res.error) {
                setError(res.error);
                return;
              }
              setBody('');
              router.refresh();
            });
          }}
        >
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className={labelClass}>Avsnitt</label>
              <select className={inputClass} value={section} onChange={(e) => setSection(e.target.value as SupportCheckSection)}>
                {SUPPORT_CHECK_SECTIONS.filter((s) => isStaff || s !== 'funding').map((s) => (
                  <option key={s} value={s}>
                    {SUPPORT_CHECK_SECTION_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            {isStaff && (
              <label className="flex items-center gap-2 pb-2 text-xs text-foreground-muted">
                <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Synlig för bolaget (kompletteringspunkt)
              </label>
            )}
          </div>
          <textarea className={`${inputClass} min-h-[70px]`} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} placeholder={isStaff ? 'Vad ska kompletteras eller rättas?' : 'Svar eller fråga till Movexum'} />
          <button type="submit" className={isStaff ? btnGhost : btnPrimary} disabled={pending || !body.trim()}>
            <Icon name="send" size={12} /> Skicka
          </button>
        </form>
      )}
    </div>
  );
}
