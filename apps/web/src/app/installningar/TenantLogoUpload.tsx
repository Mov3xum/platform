'use client';

import Image from 'next/image';
import { useActionState, useRef, useState } from 'react';
import { Check, ImageIcon, Trash2, Upload } from 'lucide-react';
import {
  deleteTenantLogoAction,
  uploadTenantLogoAction,
  MAX_TENANT_LOGO_BYTES,
  type UploadTenantLogoState
} from '@/lib/actions/settings';

type Mode = 'light' | 'dark';

function LogoUploadPanel({
  mode,
  currentUrl
}: {
  mode: Mode;
  currentUrl?: string;
}) {
  const initialState: UploadTenantLogoState = {};
  const [uploadState, uploadAction, uploadPending] = useActionState(
    uploadTenantLogoAction,
    initialState
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteTenantLogoAction,
    initialState
  );

  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const isLight = mode === 'light';
  const label = isLight ? 'Light mode' : 'Dark mode';
  const bgClass = isLight
    ? 'bg-white border border-default'
    : 'bg-[#0a0a0a] border border-[#333]';
  const hintTextClass = isLight ? 'text-foreground-subtle' : 'text-[#888]';
  const displayUrl = preview || currentUrl;
  const hasLogo = Boolean(displayUrl);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
  }

  const anyError = uploadState?.error || deleteState?.error;
  const anySuccess = uploadState?.success || deleteState?.success;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium text-foreground">{label}</div>

      {/* Preview area */}
      <div
        className={`flex h-24 w-full items-center justify-center rounded-2xl ${bgClass}`}
        aria-label={`Logotyp för ${label}`}
      >
        {hasLogo ? (
          <Image
            src={displayUrl!}
            alt={`Logotyp ${label}`}
            width={160}
            height={60}
            className="max-h-16 w-auto object-contain"
            unoptimized
          />
        ) : (
          <span className={`flex flex-col items-center gap-1 ${hintTextClass}`}>
            <ImageIcon className="h-6 w-6 opacity-40" />
            <span className="text-xs opacity-60">Ingen logotyp</span>
          </span>
        )}
      </div>

      {/* Upload form */}
      <form action={uploadAction} className="flex items-center gap-2">
        <input type="hidden" name="mode" value={mode} />
        <input
          ref={fileRef}
          type="file"
          name="logo"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-full border border-default bg-canvas-subtle px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:border-brand hover:text-foreground"
        >
          <Upload className="h-3 w-3" />
          Välj fil
        </button>
        {preview && (
          <button
            type="submit"
            disabled={uploadPending}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60"
          >
            {uploadPending ? 'Sparar…' : 'Spara'}
          </button>
        )}
        {hasLogo && !preview && (
          <span className={`text-xs ${hintTextClass}`}>
            PNG, JPG, WEBP, SVG · max {MAX_TENANT_LOGO_BYTES / 1024 / 1024} MB
          </span>
        )}
      </form>

      {/* Delete form */}
      {currentUrl && !preview && (
        <form action={deleteAction}>
          <input type="hidden" name="mode" value={mode} />
          <button
            type="submit"
            disabled={deletePending}
            className="inline-flex items-center gap-1.5 rounded-full border border-default bg-canvas-subtle px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:border-movexum-morkorange hover:bg-movexum-pastell-orange hover:text-movexum-morkorange disabled:opacity-60"
          >
            <Trash2 className="h-3 w-3" />
            {deletePending ? 'Tar bort…' : 'Ta bort'}
          </button>
        </form>
      )}

      {anyError && (
        <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-xs text-movexum-morkorange">
          {anyError}
        </p>
      )}
      {anySuccess && (
        <p className="flex items-center gap-1.5 rounded-xl bg-movexum-pastell-gron px-3 py-2 text-xs text-movexum-morkgron">
          <Check className="h-3.5 w-3.5" /> Logotypen sparades!
        </p>
      )}
    </div>
  );
}

export function TenantLogoUpload({
  logoLightUrl,
  logoDarkUrl
}: {
  logoLightUrl?: string;
  logoDarkUrl?: string;
}) {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <LogoUploadPanel mode="light" currentUrl={logoLightUrl} />
      <LogoUploadPanel mode="dark" currentUrl={logoDarkUrl} />
    </div>
  );
}
