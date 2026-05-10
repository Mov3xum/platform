'use client';

import Image from 'next/image';
import { useActionState, useRef, useState } from 'react';
import { Camera, Check, Eye, EyeOff, KeyRound, User } from 'lucide-react';
import {
  changePasswordAction,
  updateProfileAction,
  type ChangePasswordState,
  type UpdateProfileState
} from '@/lib/actions/account';

const INPUT_CLASS =
  'block w-full rounded-xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

const LABEL_CLASS = 'mb-1.5 block text-sm font-medium text-foreground-muted';

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function ProfileForm({
  name,
  email,
  avatarUrl
}: {
  name: string;
  email: string;
  avatarUrl?: string;
}) {
  const initialState: UpdateProfileState = {};
  const [state, formAction, pending] = useActionState(updateProfileAction, initialState);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(avatarUrl ?? null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
  }

  return (
    <section className="rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-movexum-pastell-lila">
          <User className="h-4 w-4 text-movexum-lila" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">Profil</h2>
          <p className="text-xs text-foreground-subtle">Visningsnamn och profilbild</p>
        </div>
      </div>

      <form action={formAction} className="space-y-5">
        {/* Avatar */}
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="group relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-full border-2 border-default bg-canvas-subtle transition hover:border-brand"
            aria-label="Byt profilbild"
          >
            {preview ? (
              <Image
                src={preview}
                alt="Profilbild"
                fill
                className="object-cover"
                sizes="80px"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-xl font-semibold text-foreground-muted">
                {initials(name || email)}
              </span>
            )}
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-movexum-svart/40 opacity-0 transition group-hover:opacity-100">
              <Camera className="h-5 w-5 text-movexum-vit" />
            </span>
          </button>
          <div>
            <p className="text-sm font-medium text-foreground">Profilbild</p>
            <p className="mt-0.5 text-xs text-foreground-subtle">PNG, JPG, WEBP · max 5 MB</p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-2 text-xs font-medium text-link hover:underline"
            >
              Ladda upp ny bild
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            name="avatar"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {/* Display name */}
        <label className="block">
          <span className={LABEL_CLASS}>Visningsnamn</span>
          <input
            type="text"
            name="display_name"
            defaultValue={name}
            autoComplete="name"
            className={INPUT_CLASS}
          />
        </label>

        {/* Email (read-only) */}
        <label className="block">
          <span className={LABEL_CLASS}>E-post (kan ej ändras här)</span>
          <input
            type="email"
            value={email}
            disabled
            className="block w-full rounded-xl border border-default bg-canvas-subtle px-4 py-2.5 text-sm text-foreground-muted outline-none"
          />
        </label>

        {state?.error && (
          <p className="rounded-xl bg-movexum-pastell-orange px-4 py-2.5 text-sm text-movexum-morkorange">
            {state.error}
          </p>
        )}
        {state?.success && (
          <p className="flex items-center gap-2 rounded-xl bg-movexum-pastell-gron px-4 py-2.5 text-sm text-movexum-morkgron">
            <Check className="h-4 w-4" /> Profilen sparades!
          </p>
        )}

        <div className="pt-1">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-full bg-brand px-6 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60"
          >
            {pending ? 'Sparar…' : 'Spara ändringar'}
          </button>
        </div>
      </form>
    </section>
  );
}

export function PasswordForm() {
  const initialState: ChangePasswordState = {};
  const [state, formAction, pending] = useActionState(changePasswordAction, initialState);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  return (
    <section className="rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-movexum-pastell-lila">
          <KeyRound className="h-4 w-4 text-movexum-lila" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">Lösenord</h2>
          <p className="text-xs text-foreground-subtle">Ändra ditt lösenord</p>
        </div>
      </div>

      <form action={formAction} className="space-y-5">
        <label className="block">
          <span className={LABEL_CLASS}>Nuvarande lösenord</span>
          <div className="relative">
            <input
              type={showCurrent ? 'text' : 'password'}
              name="currentPassword"
              required
              autoComplete="current-password"
              className={INPUT_CLASS + ' pr-11'}
            />
            <button
              type="button"
              onClick={() => setShowCurrent((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-subtle hover:text-foreground"
              aria-label={showCurrent ? 'Dölj lösenord' : 'Visa lösenord'}
            >
              {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </label>

        <label className="block">
          <span className={LABEL_CLASS}>Nytt lösenord</span>
          <div className="relative">
            <input
              type={showNew ? 'text' : 'password'}
              name="newPassword"
              required
              autoComplete="new-password"
              minLength={8}
              className={INPUT_CLASS + ' pr-11'}
            />
            <button
              type="button"
              onClick={() => setShowNew((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-subtle hover:text-foreground"
              aria-label={showNew ? 'Dölj lösenord' : 'Visa lösenord'}
            >
              {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </label>

        <label className="block">
          <span className={LABEL_CLASS}>Bekräfta nytt lösenord</span>
          <input
            type="password"
            name="newPasswordConfirm"
            required
            autoComplete="new-password"
            minLength={8}
            className={INPUT_CLASS}
          />
        </label>

        {state?.error && (
          <p className="rounded-xl bg-movexum-pastell-orange px-4 py-2.5 text-sm text-movexum-morkorange">
            {state.error}
          </p>
        )}

        <p className="text-xs text-foreground-subtle">
          Du loggas ut och behöver logga in med det nya lösenordet.
        </p>

        <div className="pt-1">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-full bg-brand px-6 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60"
          >
            {pending ? 'Ändrar…' : 'Ändra lösenord'}
          </button>
        </div>
      </form>
    </section>
  );
}
