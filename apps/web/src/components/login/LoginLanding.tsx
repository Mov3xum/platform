import Link from 'next/link';
import { loginAccentVar } from '@platform/shared';
import { Logo } from '@/components/Logo';
import { LoginForm } from '@/app/login/LoginForm';
import type { LoginBrandingView } from '@/lib/login-branding';

// Inloggningssidans mallar (CLAUDE.md § 48). Ren presentation av det
// admin valt under Inställningar → Logotyp & varumärke: mall, accentfärg
// (brand-token via CSS-variabel — aldrig hex i kod), rubrik/underrubrik
// (vid formuläret), bildtext (över bilden, för sig) och bild/video.
// `centered` utan media är exakt hur sidan såg ut före funktionen.
// Semantiska tokens överallt så dark mode följer med.

export interface LoginLandingProps {
  view: LoginBrandingView;
  next: string;
  /** Tenantens logotyper (valfria) — annars Movexum-wordmarken. */
  logoLightUrl?: string;
  logoDarkUrl?: string;
  /** Inloggad admin förhandsgranskar — visa en banner i stället för att redirecta. */
  preview?: boolean;
}

export function LoginLanding(props: LoginLandingProps) {
  const { view } = props;
  const body = (() => {
    switch (view.layout) {
      case 'split_left':
        return <SplitLayout {...props} side="left" />;
      case 'split_right':
        return <SplitLayout {...props} side="right" />;
      case 'cover':
        return <CoverLayout {...props} />;
      case 'panel':
        return <PanelLayout {...props} />;
      default:
        return <CenteredLayout {...props} />;
    }
  })();
  return (
    <>
      {props.preview && <PreviewBanner />}
      {body}
    </>
  );
}

function PreviewBanner() {
  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-movexum-pastell-gul px-4 py-2 text-xs text-movexum-morkgul shadow-md shadow-movexum-svart/10">
      <span>
        <strong>Förhandsgranskning</strong> — så här ser inloggningssidan ut för alla användare.
      </span>
      <Link href="/installningar/utseende" className="font-semibold underline">
        Tillbaka till inställningarna
      </Link>
    </div>
  );
}

/** Bild/video som täcker sin container; videon spelas ljudlöst i slinga med bilden som startbild. */
function Media({ view, className }: { view: LoginBrandingView; className: string }) {
  if (view.videoUrl) {
    return (
      <video
        className={className}
        src={view.videoUrl}
        poster={view.imageUrl ?? undefined}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden
      />
    );
  }
  if (view.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={className} src={view.imageUrl} alt="" aria-hidden />;
  }
  return null;
}

function hasMedia(view: LoginBrandingView): boolean {
  return Boolean(view.videoUrl || view.imageUrl);
}

/** Dekorativ accentpanel när en media-mall saknar bild. */
function AccentBackdrop({ view }: { view: LoginBrandingView }) {
  const accent = loginAccentVar(view.accent);
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: accent }} aria-hidden>
      <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-movexum-vit/10" />
      <div className="absolute -bottom-32 -right-16 h-[28rem] w-[28rem] rounded-full bg-movexum-svart/15" />
      <div className="absolute bottom-1/4 left-1/3 h-40 w-40 rotate-12 rounded-3xl bg-movexum-vit/10" />
    </div>
  );
}

function FormCard({
  view,
  next,
  glass = false,
  flat = false
}: {
  view: LoginBrandingView;
  next: string;
  glass?: boolean;
  flat?: boolean;
}) {
  const shell = glass
    ? 'rounded-3xl border border-movexum-vit/40 bg-surface/90 p-8 shadow-2xl shadow-movexum-svart/30 backdrop-blur-md sm:p-10'
    : flat
      ? 'p-2 sm:p-4'
      : 'rounded-3xl border border-default bg-surface p-8 shadow-xl shadow-movexum-svart/5 sm:p-10';
  return (
    <div className={shell}>
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">{view.headline}</h1>
      <p className="mt-2 text-sm text-foreground-muted">{view.tagline}</p>
      <div className="mt-8">
        <LoginForm next={next} />
      </div>
    </div>
  );
}

/**
 * Texten över bilden i split-/panelmallarna. Satt bildtext ⇒ bara den
 * (radbrytningar bevaras); tom ⇒ rubrik + underrubrik som före fältet, så en
 * instans utan migration 1700000175 ser likadan ut.
 */
function MediaCaption({ view, className = '' }: { view: LoginBrandingView; className?: string }) {
  const heading = 'font-heading text-3xl font-bold tracking-tight text-movexum-vit sm:text-4xl';
  if (view.caption) {
    return (
      <div className={`max-w-lg ${className}`}>
        <p className={`${heading} whitespace-pre-line`}>{view.caption}</p>
      </div>
    );
  }
  return (
    <div className={`max-w-lg ${className}`}>
      <p className={heading}>{view.headline}</p>
      <p className="mt-3 text-base text-movexum-vit/80">{view.tagline}</p>
    </div>
  );
}

function Footer({ light = false }: { light?: boolean }) {
  return (
    <p className={`mt-8 text-center text-xs ${light ? 'text-movexum-vit/70' : 'text-foreground-subtle'}`}>
      Drivs av Movexum · EU-suverän plattform
    </p>
  );
}

// ── Centrerad (standard) ────────────────────────────────────────────
function CenteredLayout({ view, next, logoLightUrl, logoDarkUrl }: LoginLandingProps) {
  const media = hasMedia(view);
  return (
    <main className="relative isolate flex min-h-[100svh] w-full items-center justify-center overflow-hidden px-4 py-24 sm:px-6">
      {media && (
        <div className="absolute inset-0 -z-10" aria-hidden>
          <Media view={view} className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-canvas/75 backdrop-blur-sm" />
        </div>
      )}
      <div className="absolute left-6 top-6 sm:left-8 sm:top-8">
        <Logo width={140} height={30} logoLightUrl={logoLightUrl} logoDarkUrl={logoDarkUrl} />
      </div>
      <div className="w-full max-w-md">
        <FormCard view={view} next={next} />
        <Footer />
      </div>
    </main>
  );
}

// ── Bild till vänster / höger ───────────────────────────────────────
function SplitLayout({
  view,
  next,
  logoLightUrl,
  logoDarkUrl,
  side
}: LoginLandingProps & { side: 'left' | 'right' }) {
  const media = hasMedia(view);
  return (
    <main className="grid min-h-[100svh] w-full lg:grid-cols-2">
      <aside
        className={`relative isolate min-h-[42svh] overflow-hidden lg:min-h-[100svh] ${
          side === 'right' ? 'lg:order-2' : ''
        }`}
      >
        {media ? (
          <Media view={view} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <AccentBackdrop view={view} />
        )}
        <div
          className="absolute inset-0 bg-gradient-to-t from-movexum-svart/75 via-movexum-svart/20 to-movexum-svart/10"
          aria-hidden
        />
        <div className="relative flex h-full min-h-[42svh] flex-col justify-between p-6 sm:p-10 lg:min-h-[100svh]">
          <Logo width={140} height={30} variant="dark" logoLightUrl={logoLightUrl} logoDarkUrl={logoDarkUrl} />
          <MediaCaption view={view} />
        </div>
      </aside>
      <section className="flex items-center justify-center px-6 py-16 sm:px-10">
        <div className="w-full max-w-md">
          <FormCard view={view} next={next} flat />
          <Footer />
        </div>
      </section>
    </main>
  );
}

// ── Heltäckande ─────────────────────────────────────────────────────
function CoverLayout({ view, next, logoLightUrl, logoDarkUrl }: LoginLandingProps) {
  const media = hasMedia(view);
  return (
    <main className="relative isolate flex min-h-[100svh] w-full items-center justify-center overflow-hidden px-4 py-24 sm:px-6">
      <div className="absolute inset-0 -z-10" aria-hidden>
        {media ? (
          <Media view={view} className="h-full w-full object-cover" />
        ) : (
          <AccentBackdrop view={view} />
        )}
        <div className="absolute inset-0 bg-movexum-svart/50" />
      </div>
      <div className="absolute left-6 top-6 sm:left-8 sm:top-8">
        <Logo width={140} height={30} variant="dark" logoLightUrl={logoLightUrl} logoDarkUrl={logoDarkUrl} />
      </div>
      <div className="w-full max-w-md">
        <FormCard view={view} next={next} glass />
        <Footer light />
      </div>
    </main>
  );
}

// ── Färgpanel ───────────────────────────────────────────────────────
function PanelLayout({ view, next, logoLightUrl, logoDarkUrl }: LoginLandingProps) {
  const media = hasMedia(view);
  const accent = loginAccentVar(view.accent);
  return (
    <main className="grid min-h-[100svh] w-full lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside
        className="relative isolate flex flex-col justify-between gap-10 overflow-hidden p-6 sm:p-10 lg:min-h-[100svh]"
        style={{ background: accent }}
      >
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-movexum-vit/10" aria-hidden />
        <div className="absolute -bottom-28 -left-20 h-72 w-72 rounded-full bg-movexum-svart/15" aria-hidden />
        <div className="relative">
          <Logo width={140} height={30} variant="dark" logoLightUrl={logoLightUrl} logoDarkUrl={logoDarkUrl} />
          <MediaCaption view={view} className="mt-10" />
        </div>
        {media && (
          <div className="relative aspect-video w-full max-w-xl overflow-hidden rounded-3xl shadow-2xl shadow-movexum-svart/30">
            <Media view={view} className="h-full w-full object-cover" />
          </div>
        )}
      </aside>
      <section className="flex items-center justify-center px-6 py-16 sm:px-10">
        <div className="w-full max-w-md">
          <FormCard view={view} next={next} />
          <Footer />
        </div>
      </section>
    </main>
  );
}
