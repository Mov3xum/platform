'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { Icon } from '@/components/proto/Icon';
import { signAgreementAction, deleteAgreementAction } from '@/lib/actions/agreements';
import {
  AGREEMENT_KIND_LABELS,
  AGREEMENT_STATUS_LABELS,
  SIGNATURE_INTENT_TEXT,
  type AgreementKind,
  type AgreementParty,
  type AgreementStatus
} from '@platform/shared';

export interface AgreementView {
  id: string;
  title: string;
  kind: AgreementKind;
  status: AgreementStatus;
  hasFile: boolean;
  requiresCompany: boolean;
  requiresMovexum: boolean;
  companySignedAt?: string;
  movexumSignedAt?: string;
  expiresAt?: string;
  createdAt: string;
}

interface Props {
  startupId: string;
  startupName: string;
  agreements: AgreementView[];
  /** Staff (admin/incubator_lead/coach/mentor) — får tilldela/ladda upp avtal. */
  canManage: boolean;
  /** admin/incubator_lead — får radera avtal. */
  canDelete: boolean;
  /** Vilken part den inloggade kan signera som (eller null). */
  signParty: AgreementParty | null;
  defaultSignerName: string;
}

const AGREEMENT_KINDS: AgreementKind[] = [
  'nda',
  'incubator_agreement',
  'ip_assignment',
  'addendum',
  'other'
];

function fmt(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('sv-SE');
}

function statusVariant(status: AgreementStatus): string {
  if (status === 'signed') return 'bg-movexum-pastell-gron text-movexum-morkgron';
  if (status === 'partially_signed') return 'bg-movexum-pastell-bla text-movexum-morkbla';
  if (status === 'expired' || status === 'terminated')
    return 'bg-movexum-pastell-orange text-movexum-morkorange';
  return 'bg-canvas-muted text-foreground-muted';
}

export function AgreementsSection({
  startupId,
  startupName,
  agreements,
  canManage,
  canDelete,
  signParty,
  defaultSignerName
}: Props) {
  const [signTarget, setSignTarget] = useState<AgreementView | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:opacity-90"
          >
            <Icon name="plus" size={13} /> Tilldela avtal
          </button>
        </div>
      )}

      {agreements.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-default p-6 text-center text-sm text-foreground-subtle">
          Inga avtal registrerade.
        </p>
      ) : (
        <ul className="space-y-3">
          {agreements.map((a) => {
            const partySigned = signParty === 'company' ? a.companySignedAt : a.movexumSignedAt;
            const partyRequired =
              signParty === 'company' ? a.requiresCompany : signParty === 'movexum' ? a.requiresMovexum : false;
            const canSignThis =
              signParty !== null &&
              partyRequired &&
              !partySigned &&
              a.status !== 'expired' &&
              a.status !== 'terminated';
            return (
              <li key={a.id} className="rounded-2xl border border-default p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{a.title}</p>
                    <p className="text-xs text-foreground-subtle">
                      {AGREEMENT_KIND_LABELS[a.kind]}
                      {a.expiresAt ? ` · går ut ${fmt(a.expiresAt)}` : ''}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${statusVariant(a.status)}`}
                  >
                    {AGREEMENT_STATUS_LABELS[a.status]}
                  </span>
                </div>

                {/* Signaturstatus per part */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {a.requiresCompany && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-default px-2 py-0.5 text-[11px] text-foreground-muted">
                      <Icon
                        name={a.companySignedAt ? 'check' : 'clock'}
                        size={11}
                        className={a.companySignedAt ? 'text-movexum-gron' : 'text-foreground-subtle'}
                      />
                      Bolaget {a.companySignedAt ? `signerade ${fmt(a.companySignedAt)}` : 'ej signerat'}
                    </span>
                  )}
                  {a.requiresMovexum && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-default px-2 py-0.5 text-[11px] text-foreground-muted">
                      <Icon
                        name={a.movexumSignedAt ? 'check' : 'clock'}
                        size={11}
                        className={a.movexumSignedAt ? 'text-movexum-gron' : 'text-foreground-subtle'}
                      />
                      Movexum {a.movexumSignedAt ? `signerade ${fmt(a.movexumSignedAt)}` : 'ej signerat'}
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {a.hasFile && (
                    <a
                      href={`/api/agreements/${a.id}/file`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-default px-2.5 py-1.5 text-[11.5px] text-foreground-muted hover:bg-canvas-muted"
                    >
                      <Icon name="doc" size={12} /> Visa avtal
                    </a>
                  )}
                  {canSignThis && (
                    <button
                      type="button"
                      onClick={() => setSignTarget(a)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[11.5px] font-medium text-brand-foreground hover:opacity-90"
                    >
                      <Icon name="check" size={12} /> Signera
                    </button>
                  )}
                  {canDelete && (
                    <DeleteAgreementButton agreementId={a.id} title={a.title} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {signParty && (
        <SignModal
          target={signTarget}
          party={signParty}
          defaultName={defaultSignerName}
          onClose={() => setSignTarget(null)}
        />
      )}
      {canManage && (
        <UploadModal
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          startupId={startupId}
          startupName={startupName}
          kinds={AGREEMENT_KINDS}
        />
      )}
    </div>
  );
}

function DeleteAgreementButton({ agreementId, title }: { agreementId: string; title: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (!confirm(`Radera avtalet "${title}"? Signeringsbevisen tas också bort.`)) return;
        startTransition(async () => {
          const res = await deleteAgreementAction(agreementId);
          if (res.error) alert(res.error);
          else router.refresh();
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-default px-2.5 py-1.5 text-[11.5px] text-foreground-muted hover:bg-canvas-muted disabled:opacity-50"
    >
      <Icon name="trash" size={12} /> {isPending ? 'Raderar…' : 'Radera'}
    </button>
  );
}

function SignModal({
  target,
  party,
  defaultName,
  onClose
}: {
  target: AgreementView | null;
  party: AgreementParty;
  defaultName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (target) {
      setName(defaultName);
      setConfirmed(false);
      setError(null);
    }
  }, [target, defaultName]);

  function submit() {
    if (!target) return;
    if (!name.trim()) {
      setError('Ange ditt fullständiga namn.');
      return;
    }
    if (!confirmed) {
      setError('Bekräfta avsikten att signera.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await signAgreementAction(target.id, {
        party,
        fullName: name,
        intentConfirmed: confirmed
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog.Root open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-movexum-svart/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[70] flex max-h-[90vh] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-default bg-surface shadow-xl shadow-movexum-svart/20">
          <div className="flex items-center justify-between border-b border-default px-5 py-4">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                Elektronisk signering
              </div>
              <Dialog.Title className="mt-0.5 truncate font-heading text-[16px] font-semibold text-foreground">
                {target?.title || 'Avtal'}
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-subtle hover:bg-canvas-muted"
                aria-label="Stäng"
              >
                <Icon name="x" size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="space-y-4 overflow-y-auto px-5 py-4">
            {target?.hasFile && (
              <a
                href={`/api/agreements/${target.id}/file`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-default px-2.5 py-1.5 text-[12px] text-link hover:bg-canvas-muted"
              >
                <Icon name="doc" size={13} /> Läs avtalet innan du signerar
              </a>
            )}

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-subtle">
                Fullständigt namn
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                className="w-full rounded-lg border border-default bg-canvas-subtle px-3 py-2 text-[13px] outline-none focus:border-brand"
                placeholder="För- och efternamn"
              />
            </label>

            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-default bg-canvas-subtle/40 p-3 text-[12.5px] text-foreground">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 accent-brand"
              />
              <span>{SIGNATURE_INTENT_TEXT}</span>
            </label>

            <p className="text-[11px] leading-relaxed text-foreground-subtle">
              Din identitet, tidpunkt och en kryptografisk hash (SHA-256) av dokumentet
              lagras som juridiskt signeringsbevis (avancerad elektronisk signatur,
              eIDAS art. 25). Signaturen kan inte ångras.
            </p>

            {error && (
              <div className="rounded-lg bg-movexum-pastell-orange px-3 py-2 text-[12.5px] text-movexum-morkorange">
                {error}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-default px-5 py-3">
            <Dialog.Close asChild>
              <button type="button" className="rounded-lg px-3 py-1.5 text-[12.5px] hover:bg-canvas-muted">
                Avbryt
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={submit}
              disabled={isPending || !confirmed || !name.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? 'Signerar…' : 'Signera avtalet'} <Icon name="check" size={12} />
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function UploadModal({
  open,
  onClose,
  startupId,
  startupName,
  kinds
}: {
  open: boolean;
  onClose: () => void;
  startupId: string;
  startupName: string;
  kinds: AgreementKind[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<AgreementKind>('incubator_agreement');
  const [requiresCompany, setRequiresCompany] = useState(true);
  const [requiresMovexum, setRequiresMovexum] = useState(true);
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      setTitle('');
      setKind('incubator_agreement');
      setRequiresCompany(true);
      setRequiresMovexum(true);
      setExpiresAt('');
      setError(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [open]);

  function submit() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Välj en PDF-fil.');
      return;
    }
    if (!title.trim()) {
      setError('Ange en titel.');
      return;
    }
    if (!requiresCompany && !requiresMovexum) {
      setError('Minst en part måste signera.');
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', title.trim());
    fd.append('startup', startupId);
    fd.append('kind', kind);
    fd.append('requires_company_signature', requiresCompany ? 'true' : 'false');
    fd.append('requires_movexum_signature', requiresMovexum ? 'true' : 'false');
    if (expiresAt) fd.append('expires_at', expiresAt);

    startTransition(async () => {
      try {
        const res = await fetch('/api/agreements', { method: 'POST', body: fd });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(data.error || 'Uppladdningen misslyckades.');
          return;
        }
        onClose();
        router.refresh();
      } catch {
        setError('Uppladdningen misslyckades.');
      }
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-movexum-svart/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[70] flex max-h-[90vh] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-default bg-surface shadow-xl shadow-movexum-svart/20">
          <div className="flex items-center justify-between border-b border-default px-5 py-4">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                Tilldela avtal
              </div>
              <Dialog.Title className="mt-0.5 truncate font-heading text-[16px] font-semibold text-foreground">
                {startupName}
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-subtle hover:bg-canvas-muted"
                aria-label="Stäng"
              >
                <Icon name="x" size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="space-y-4 overflow-y-auto px-5 py-4">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-subtle">
                Titel
              </span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                className="w-full rounded-lg border border-default bg-canvas-subtle px-3 py-2 text-[13px] outline-none focus:border-brand"
                placeholder="t.ex. Inkubatoravtal 2026"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-subtle">
                Typ
              </span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as AgreementKind)}
                className="w-full rounded-lg border border-default bg-canvas-subtle px-2.5 py-2 text-[13px] outline-none focus:border-brand"
              >
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {AGREEMENT_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-subtle">
                Avtals-PDF
              </span>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                className="w-full rounded-lg border border-default bg-canvas-subtle px-3 py-2 text-[12.5px] outline-none file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-1 file:text-[12px] file:font-medium file:text-brand-foreground"
              />
            </label>

            <div className="space-y-2">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-subtle">
                Parter som ska signera
              </span>
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
                <input
                  type="checkbox"
                  checked={requiresCompany}
                  onChange={(e) => setRequiresCompany(e.target.checked)}
                  className="accent-brand"
                />
                Bolaget
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
                <input
                  type="checkbox"
                  checked={requiresMovexum}
                  onChange={(e) => setRequiresMovexum(e.target.checked)}
                  className="accent-brand"
                />
                Movexum
              </label>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-subtle">
                Går ut (valfritt)
              </span>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full rounded-lg border border-default bg-canvas-subtle px-2.5 py-2 font-mono text-[13px] outline-none focus:border-brand"
              />
            </label>

            {error && (
              <div className="rounded-lg bg-movexum-pastell-orange px-3 py-2 text-[12.5px] text-movexum-morkorange">
                {error}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-default px-5 py-3">
            <Dialog.Close asChild>
              <button type="button" className="rounded-lg px-3 py-1.5 text-[12.5px] hover:bg-canvas-muted">
                Avbryt
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={submit}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? 'Laddar upp…' : 'Tilldela avtal'} <Icon name="send" size={12} />
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
