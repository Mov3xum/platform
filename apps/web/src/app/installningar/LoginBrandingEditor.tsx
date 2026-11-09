'use client';

import { useActionState, useState } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import {
  LOGIN_ACCENTS,
  LOGIN_ACCENT_LABELS,
  LOGIN_CAPTION_MAX,
  LOGIN_CAPTION_MAX_LINES,
  LOGIN_HEADLINE_MAX,
  LOGIN_LAYOUTS,
  LOGIN_LAYOUT_META,
  LOGIN_TAGLINE_MAX,
  loginAccentVar,
  loginLayoutHasCaption
} from '@platform/shared';
import type { LoginAccent, LoginLayout } from '@platform/shared';
import { saveLoginBrandingAction, type SaveLoginBrandingState } from '@/lib/actions/settings';
import { HeroMediaUploader } from '@/components/compass/HeroMediaUploader';
import { LOGIN_MEDIA_UPLOAD_ENDPOINT, type LoginBrandingView } from '@/lib/login-branding';

/**
 * Inloggningssidans utseende (CLAUDE.md § 48): mall, accentfärg, rubrik,
 * underrubrik, bildtext + bild/video. Mall/färg/texter postas med "Spara"; media
 * laddas upp direkt vid val (route handler, stora videos ryms). Gäller
 * /login för ALLA användare i systemet.
 */
export function LoginBrandingEditor({
  initial,
  schemaMissing,
  isLoginTenant
}: {
  initial: LoginBrandingView;
  /** Fält som PB-schemat saknar (migration 1700000172/1700000175 inte körd). */
  schemaMissing: string[];
  /** null = kunde inte avgöras (ingen superuser); false = en annan tenant visas på /login. */
  isLoginTenant: boolean | null;
}) {
  const [state, action, pending] = useActionState<SaveLoginBrandingState, FormData>(
    saveLoginBrandingAction,
    {}
  );
  const [layout, setLayout] = useState<LoginLayout>(initial.layout);
  const [accent, setAccent] = useState<LoginAccent>(initial.accent);
  const meta = LOGIN_LAYOUT_META[layout];
  const captionApplies = loginLayoutHasCaption(layout);
  const captionPlaceholder = `${initial.headline}\n${initial.tagline}`;

  return (
    <div className="grid gap-6">
      {schemaMissing.length > 0 && (
        <p className="rounded-xl bg-movexum-pastell-gul px-4 py-3 text-xs text-movexum-morkgul">
          Databasen saknar fälten {schemaMissing.join(', ')} — PocketBase-migrationen 1700000172
          (bildtexten: 1700000175) är inte applicerad. Val som sparas här syns inte på
          inloggningssidan förrän den körts.
        </p>
      )}
      {isLoginTenant === false && (
        <p className="rounded-xl bg-movexum-pastell-gul px-4 py-3 text-xs text-movexum-morkgul">
          Inloggningssidan visar en annan organisations utseende (env{' '}
          <code>MOVEXUM_LOGIN_TENANT_SLUG</code> eller seed-tenanten). Det du sparar här gäller din
          organisation men visas inte på /login.
        </p>
      )}

      <form action={action} className="grid gap-6">
        <fieldset className="grid gap-3">
          <legend className="text-sm font-semibold text-foreground">Mall</legend>
          <div className="mx-layoutpick" role="radiogroup" aria-label="Mall för inloggningssidan">
            {LOGIN_LAYOUTS.map((l) => {
              const m = LOGIN_LAYOUT_META[l];
              const active = l === layout;
              return (
                <label key={l} className={`mx-layoutpick-item${active ? ' is-active' : ''}`}>
                  <input
                    type="radio"
                    name="layout"
                    value={l}
                    checked={active}
                    onChange={() => setLayout(l)}
                  />
                  <LoginLayoutThumb layout={l} active={active} accent={accent} />
                  <span className="mx-layoutpick-text">
                    <span className="mx-layoutpick-label">{m.label}</span>
                    <span className="mx-layoutpick-desc">{m.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="grid gap-3">
          <legend className="text-sm font-semibold text-foreground">Accentfärg</legend>
          <p className="text-xs text-foreground-subtle">
            Används för färgpanel, bakgrund utan bild och detaljer. Bara Movexums profilfärger.
          </p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Accentfärg">
            {LOGIN_ACCENTS.map((a) => {
              const active = a === accent;
              return (
                <label
                  key={a}
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    active
                      ? 'border-brand bg-canvas-subtle text-foreground'
                      : 'border-default bg-surface text-foreground-muted hover:border-strong'
                  }`}
                >
                  <input
                    type="radio"
                    name="accent"
                    value={a}
                    checked={active}
                    onChange={() => setAccent(a)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden
                    className="h-4 w-4 rounded-full border border-movexum-svart/10"
                    style={{ background: loginAccentVar(a) }}
                  />
                  {LOGIN_ACCENT_LABELS[a]}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <p className="text-xs text-foreground-subtle sm:col-span-2">
            Rubrik och underrubrik står vid inloggningsformuläret i alla mallar.
          </p>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-foreground">Rubrik</span>
            <input
              type="text"
              name="headline"
              defaultValue={initial.headline}
              maxLength={LOGIN_HEADLINE_MAX}
              placeholder="Välkommen tillbaka"
              className="block w-full rounded-xl border border-default bg-canvas-subtle px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:bg-surface focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-foreground">Underrubrik</span>
            <input
              type="text"
              name="tagline"
              defaultValue={initial.tagline}
              maxLength={LOGIN_TAGLINE_MAX}
              placeholder="Logga in för att fortsätta till din arbetsyta."
              className="block w-full rounded-xl border border-default bg-canvas-subtle px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:bg-surface focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-sm font-semibold text-foreground">Bildtext</span>
            <textarea
              name="caption"
              defaultValue={initial.caption}
              maxLength={LOGIN_CAPTION_MAX}
              rows={LOGIN_CAPTION_MAX_LINES}
              placeholder={captionPlaceholder}
              className="block w-full resize-y rounded-xl border border-default bg-canvas-subtle px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:bg-surface focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
            />
            <span className="mt-1.5 block text-xs text-foreground-subtle">
              {captionApplies
                ? `Texten som ligger över bilden i mallen ${meta.label}, oberoende av rubriken. Radbrytningar behålls (max ${LOGIN_CAPTION_MAX_LINES} rader). Lämna tom så visas rubrik och underrubrik även över bilden.`
                : `Mallen ${meta.label} har ingen text över bilden — bildtexten sparas men används bara av Bild till vänster/höger och Färgpanel.`}
            </span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-xs font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60"
          >
            {pending ? 'Sparar…' : 'Spara utseende'}
          </button>
          <a
            href="/login?forhandsgranska=1"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-default bg-canvas-subtle px-3 py-2 text-xs font-medium text-foreground-muted transition hover:border-brand hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" /> Förhandsgranska inloggningssidan
          </a>
          {state.error && (
            <span className="rounded-xl bg-movexum-pastell-orange px-3 py-1.5 text-xs text-movexum-morkorange">
              {state.error}
            </span>
          )}
          {state.success && !state.warning && (
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-movexum-pastell-gron px-3 py-1.5 text-xs text-movexum-morkgron">
              <Check className="h-3.5 w-3.5" /> Sparat — gäller alla som loggar in.
            </span>
          )}
        </div>
        {state.warning && (
          <p className="rounded-xl bg-movexum-pastell-gul px-4 py-3 text-xs text-movexum-morkgul">
            {state.warning}
          </p>
        )}
      </form>

      <div className="grid gap-3">
        <div className="text-sm font-semibold text-foreground">Bild eller video</div>
        <div className="mx-layoutpick-hint">
          <strong>{meta.label}:</strong> {meta.mediaHint} Finns både bild och video spelas videon
          (ljudlöst, i slinga) med bilden som startbild. Materialet är publikt — ladda inte upp
          personuppgifter.
        </div>
        <HeroMediaUploader
          endpoint={LOGIN_MEDIA_UPLOAD_ENDPOINT}
          initialImageUrl={initial.imageUrl}
          initialVideoUrl={initial.videoUrl}
        />
      </div>
    </div>
  );
}

/**
 * Skiss av mallen i 160×100: media (accent-toning), logotyp/rubrik (mörka
 * streck) och inloggningskortet (ljust kort med två fält + knapp).
 */
function LoginLayoutThumb({
  layout,
  active,
  accent
}: {
  layout: LoginLayout;
  active: boolean;
  accent: LoginAccent;
}) {
  const media = active ? loginAccentVar(accent) : 'var(--mx-muted-2)';
  const ink = active ? 'var(--mx-ink)' : 'var(--mx-ink-soft)';
  const card = 'var(--mx-paper)';
  const line = 'var(--mx-line-strong)';
  const paper = 'var(--mx-paper-2)';

  const Card = ({ x, y, w = 56, glass = false }: { x: number; y: number; w?: number; glass?: boolean }) => (
    <g>
      <rect x={x} y={y} width={w} height={44} rx={5} fill={card} stroke={line} opacity={glass ? 0.92 : 1} />
      <rect x={x + 7} y={y + 8} width={w * 0.5} height={3} rx={1.5} fill={ink} />
      <rect x={x + 7} y={y + 16} width={w - 14} height={6} rx={2} fill={paper} stroke={line} />
      <rect x={x + 7} y={y + 25} width={w - 14} height={6} rx={2} fill={paper} stroke={line} />
      <rect x={x + 7} y={y + 34} width={w - 14} height={6} rx={3} fill={media} />
    </g>
  );
  const Wordmark = ({ x, y, light = false }: { x: number; y: number; light?: boolean }) => (
    <rect x={x} y={y} width={22} height={4} rx={2} fill={light ? 'rgba(255,255,255,0.9)' : ink} />
  );
  const Title = ({ x, y, w, light = false }: { x: number; y: number; w: number; light?: boolean }) => (
    <g fill={light ? 'rgba(255,255,255,0.92)' : ink}>
      <rect x={x} y={y} width={w} height={6} rx={2} />
      <rect x={x} y={y + 10} width={w * 0.7} height={3} rx={1.5} opacity={0.5} />
    </g>
  );

  let body: React.ReactNode;
  switch (layout) {
    case 'split_left':
      body = (
        <>
          <rect x={0} y={0} width={80} height={100} fill={media} />
          <Wordmark x={8} y={8} light />
          <Title x={8} y={72} w={56} light />
          <Card x={94} y={28} />
        </>
      );
      break;
    case 'split_right':
      body = (
        <>
          <rect x={80} y={0} width={80} height={100} fill={media} />
          <Wordmark x={88} y={8} light />
          <Title x={88} y={72} w={56} light />
          <Card x={10} y={28} />
        </>
      );
      break;
    case 'cover':
      body = (
        <>
          <rect x={0} y={0} width={160} height={100} fill={media} />
          <rect x={0} y={0} width={160} height={100} fill="rgba(0,0,0,0.28)" />
          <Wordmark x={8} y={8} light />
          <Card x={52} y={28} glass />
        </>
      );
      break;
    case 'panel':
      body = (
        <>
          <rect x={0} y={0} width={66} height={100} fill={media} />
          <Wordmark x={8} y={8} light />
          <Title x={8} y={24} w={48} light />
          <rect x={8} y={56} width={50} height={34} rx={5} fill="rgba(255,255,255,0.28)" />
          <Card x={86} y={28} />
        </>
      );
      break;
    default:
      body = (
        <>
          <rect x={0} y={0} width={160} height={100} fill={paper} />
          <rect x={0} y={0} width={160} height={100} fill={media} opacity={0.12} />
          <Wordmark x={8} y={8} />
          <Card x={52} y={28} />
        </>
      );
  }

  return (
    <svg className="mx-layoutpick-thumb" viewBox="0 0 160 100" aria-hidden="true">
      <rect x={0} y={0} width={160} height={100} fill={paper} />
      {body}
    </svg>
  );
}
