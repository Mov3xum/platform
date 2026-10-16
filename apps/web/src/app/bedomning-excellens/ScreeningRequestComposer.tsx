'use client';

import Link from 'next/link';
import { useActionState, useEffect, useMemo, useState } from 'react';
import {
  SCREENING_REQUEST_KIND_LABEL,
  SCREENING_REQUEST_RECIPIENT_LABEL,
  screeningRequestItemsFor,
  screeningRequestText,
  type ScreeningRequestItem,
  type ScreeningRequestRecipient
} from '@platform/shared';
import { createScreeningRequestAction, type CreateScreeningRequestState } from '@/lib/actions/screening-requests';
import type { ExcellenceAssessment } from '@/lib/actions/excellence';

// "Begär komplettering" (CLAUDE.md § 51.6): punkterna ur bedömningens
// "Saknat underlag" blir en förfrågan till coachen eller till bolaget, som
// svarar direkt i systemet (/komplettering/<id>). Samma lista går att
// kopiera som text för ett mejl eller ett möte.

interface Props {
  assessment: ExcellenceAssessment;
  coaches: Array<{ id: string; name: string }>;
  senderName?: string;
}

const inputCls =
  'block w-full rounded-xl border border-default bg-canvas px-3 py-1.5 text-[12.5px] text-foreground outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
const OK_TONE = 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron';
const WARN_TONE = 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul';
const initialState: CreateScreeningRequestState = {};
const QUICK_MESSAGE =
  'Inför bedömningen av statsstöd (art. 22 GBER / de minimis) och Vinnovas målgrupp behöver vi uppgifterna nedan. Svara direkt i systemet — det går att spara delvis. Inga personnummer.';

export function ScreeningRequestComposer({ assessment, coaches, senderName }: Props) {
  const [state, formAction, pending] = useActionState(createScreeningRequestAction, initialState);
  const all = assessment.requestItems;
  const [recipient, setRecipient] = useState<ScreeningRequestRecipient>('coach');
  const [coachId, setCoachId] = useState(coaches[0]?.id ?? '');
  const eligible = useMemo(() => screeningRequestItemsFor(all, recipient), [all, recipient]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(eligible.map((i) => i.key)));
  const [message, setMessage] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [copied, setCopied] = useState(false);

  // Nytt underlag eller ny mottagare ⇒ förvalet följer.
  useEffect(() => {
    setSelected(new Set(eligible.map((i) => i.key)));
  }, [eligible]);

  const chosen: ScreeningRequestItem[] = eligible.filter((i) => selected.has(i.key));
  const startupId = assessment.subject.startupId;
  const subjectName = assessment.subject.name || assessment.subject.orgNr;

  const text = screeningRequestText({
    subjectName,
    recipient,
    items: chosen,
    message: message.trim() || undefined,
    dueDate: dueDate || undefined,
    answerUrl: state.created ? `${typeof window !== 'undefined' ? window.location.origin : ''}${state.created.href}` : undefined,
    senderName
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* visas i textrutan ändå */
    }
  };

  if (all.length === 0) {
    return (
      <section className="rounded-2xl border border-default bg-surface px-5 py-4">
        <h3 className="text-[14px] font-semibold text-foreground">Begär komplettering</h3>
        <p className="mt-1 text-[12.5px] text-foreground-muted">Inget saknat underlag att fråga om.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-default bg-surface px-5 py-5">
      <h3 className="text-[14px] font-semibold text-foreground">Begär komplettering</h3>
      {!startupId && (
        <p className="mt-1 text-[12.5px] text-foreground-muted">Bolaget finns inte i plattformen — kopiera listan som text.</p>
      )}

      {/* Ett klick: alla punkter mottagaren kan svara på, med standardtext. */}
      {startupId && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {coaches[0] && screeningRequestItemsFor(all, 'coach').length > 0 && (
            <form action={formAction}>
              <input type="hidden" name="startup_id" value={startupId} />
              <input type="hidden" name="screening_id" value={assessment.history?.runId ?? ''} />
              <input type="hidden" name="recipient" value="coach" />
              <input type="hidden" name="recipient_user" value={coachId || coaches[0].id} />
              <input type="hidden" name="items" value={JSON.stringify(screeningRequestItemsFor(all, 'coach'))} />
              <input type="hidden" name="message" value={QUICK_MESSAGE} />
              <button type="submit" disabled={pending} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground hover:bg-brand-hover disabled:opacity-60">
                Skicka allt till coachen ({coaches.find((c) => c.id === coachId)?.name ?? coaches[0].name}) — {screeningRequestItemsFor(all, 'coach').length} punkter
              </button>
            </form>
          )}
          {screeningRequestItemsFor(all, 'startup').length > 0 && (
            <form action={formAction}>
              <input type="hidden" name="startup_id" value={startupId} />
              <input type="hidden" name="screening_id" value={assessment.history?.runId ?? ''} />
              <input type="hidden" name="recipient" value="startup" />
              <input type="hidden" name="items" value={JSON.stringify(screeningRequestItemsFor(all, 'startup'))} />
              <input type="hidden" name="message" value={QUICK_MESSAGE} />
              <button type="submit" disabled={pending} className="rounded-full border border-strong px-4 py-2 text-sm font-semibold text-foreground hover:bg-canvas-subtle disabled:opacity-60">
                Skicka allt till bolaget — {screeningRequestItemsFor(all, 'startup').length} punkter
              </button>
            </form>
          )}
          <span className="text-[12px] text-foreground-subtle">Vill du välja punkter, kollega eller datum — använd formuläret nedan.</span>
        </div>
      )}

      <form action={formAction} className="mt-3 space-y-3">
        <input type="hidden" name="startup_id" value={startupId ?? ''} />
        <input type="hidden" name="screening_id" value={assessment.history?.runId ?? ''} />
        <input type="hidden" name="items" value={JSON.stringify(chosen)} />
        <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)_170px]">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">Till</span>
            <select name="recipient" value={recipient} onChange={(e) => setRecipient(e.target.value as ScreeningRequestRecipient)} className={`${inputCls} mt-1`}>
              <option value="coach">{SCREENING_REQUEST_RECIPIENT_LABEL.coach} (kollega)</option>
              <option value="startup">{SCREENING_REQUEST_RECIPIENT_LABEL.startup} (Mitt bolag)</option>
            </select>
          </label>
          {recipient === 'coach' ? (
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">Vilken kollega</span>
              <select name="recipient_user" value={coachId} onChange={(e) => setCoachId(e.target.value)} className={`${inputCls} mt-1`}>
                {coaches.length === 0 && <option value="">Inga kollegor att välja</option>}
                {coaches.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span aria-hidden />
          )}
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">Svar senast</span>
            <input type="date" name="due_date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`${inputCls} mt-1 mx-tnum`} />
          </label>
        </div>

        <fieldset className="rounded-xl border border-default bg-canvas-subtle px-3 py-2">
          <legend className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">
            Punkter ({chosen.length} av {eligible.length} valda)
          </legend>
          <ul className="mt-1 space-y-1.5">
            {eligible.map((i) => (
              <li key={i.key}>
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(i.key)}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(i.key);
                        else next.delete(i.key);
                        return next;
                      })
                    }
                    className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
                  />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-medium text-foreground">{i.label}</span>
                    <span className="block text-[11px] text-foreground-subtle">
                      {SCREENING_REQUEST_KIND_LABEL[i.kind]}
                      {i.hint ? ` · ${i.hint}` : ''}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">Meddelande (valfritt)</span>
          <textarea
            name="message"
            rows={2}
            maxLength={2000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="T.ex. varför det behövs och när beslutet ska tas. Inga personuppgifter."
            className={`${inputCls} mt-1`}
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending || chosen.length === 0 || !startupId || (recipient === 'coach' && !coachId)}
            className="inline-flex items-center justify-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'Skickar…' : `Skicka till ${SCREENING_REQUEST_RECIPIENT_LABEL[recipient].toLowerCase()} i systemet`}
          </button>
          <button type="button" onClick={copy} disabled={chosen.length === 0} className="rounded-full border border-strong px-4 py-2 text-sm font-semibold text-foreground hover:bg-canvas-subtle disabled:opacity-50">
            {copied ? 'Kopierat!' : 'Kopiera som text (mejl)'}
          </button>
        </div>
      </form>

      {state.created && (
        <p className={`mt-3 rounded-xl px-3 py-2 text-[12.5px] ${OK_TONE}`}>
          Förfrågan skickad till {SCREENING_REQUEST_RECIPIENT_LABEL[state.created.recipient].toLowerCase()} ({state.created.items} punkter).{' '}
          <Link href={state.created.href} className="font-semibold underline">
            Öppna förfrågan
          </Link>
          {startupId && (
            <>
              {' · '}
              <Link href={`/startups/${startupId}/ekonomi#statsstod`} className="font-semibold underline">
                Bolagskortet
              </Link>
            </>
          )}
          {state.created.warnings.length > 0 && <span className="block">{state.created.warnings.join(' ')}</span>}
        </p>
      )}
      {state.error && (
        <p className="mt-3 rounded-xl bg-movexum-pastell-orange px-3 py-2 text-[12.5px] text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange">
          {state.error}
        </p>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-[12px] font-semibold text-foreground-muted">Förhandsgranska texten</summary>
        <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-default bg-canvas px-3 py-2 text-[12px] text-foreground">{text}</pre>
      </details>
      {chosen.length === 0 && <p className={`mt-2 inline-block rounded-full px-2.5 py-1 text-[12px] ${WARN_TONE}`}>Välj minst en punkt.</p>}
    </section>
  );
}
