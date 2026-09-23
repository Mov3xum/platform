import { Logo } from '@/components/Logo';
import { PublicModuleRunner } from './PublicModuleRunner';
import { moduleHeroImageUrl, moduleHeroVideoUrl } from '@/lib/compass/media';
import type { CompassModule, CompassQuestion, NextModuleLink } from '@/lib/compass/types';
import type { PublicTenantBranding } from '@/lib/compass/public';
import { COMPASS_LAYOUT_META, normalizeCompassLayout } from '@platform/shared';
import type { CompassLayout } from '@platform/shared';

interface Props {
  module: CompassModule;
  questions: CompassQuestion[];
  branding: PublicTenantBranding;
  nextModule: NextModuleLink | null;
}

const FLOW_WORD: Record<string, string> = {
  chat: 'AI-chatt',
  quiz: 'Quiz',
  wizard: 'Formulär'
};

/**
 * Den publika modulsidans presentationsskal (CLAUDE.md § 23.7 "Mallar").
 *
 * Mallen (`module.layout`, normaliserad) väljer kompositionen — bild till
 * vänster/höger, heltäckande omslag, färgpanel, klassisk banner eller
 * minimal typografi. Själva flödet (`PublicModuleRunner`) är identiskt i alla
 * mallar: mallen är ren presentation och rör varken datainsamling, samtycke
 * eller lead-garantin. All styling bor i prototype.css under
 * "Startupkompassen — publik landningssida" och nycklas på `data-layout`.
 */
export function PublicModuleLayout({ module, questions, branding, nextModule }: Props) {
  const layout: CompassLayout = normalizeCompassLayout(module.layout);
  const meta = COMPASS_LAYOUT_META[layout];
  const hasTenantLogo = Boolean(branding.logoLightUrl || branding.logoDarkUrl);

  const accent =
    module.theme_color && /^#[0-9a-fA-F]{3,8}$/.test(module.theme_color)
      ? module.theme_color
      : '#002c40';
  const imageUrl = meta.media === 'none' ? null : moduleHeroImageUrl(module);
  const videoUrl = meta.media === 'none' ? null : moduleHeroVideoUrl(module);
  const hasMedia = Boolean(imageUrl || videoUrl);
  const isChat = module.flow_type === 'chat';

  const title = module.welcome_title || module.name;
  const eyebrow = module.hero_eyebrow || 'STARTUPKOMPASSEN';
  // Undvik dubblerad rubrik när eyebrow råkar vara identisk med titeln.
  const showEyebrow = eyebrow.trim().toLowerCase() !== (title || '').trim().toLowerCase();
  const body = module.welcome_body || module.description;

  // Heltäckande: vit wordmark på mörk bakgrund. Övriga mallar är ljusa.
  const onDark = layout === 'cover';

  const topbar = (
    <header className="mx-compass-topbar">
      <span className="mx-compass-brand">
        <Logo
          variant={onDark ? 'dark' : 'light'}
          href="/"
          height={hasTenantLogo ? 52 : 40}
          width={hasTenantLogo ? 260 : 200}
          logoLightUrl={branding.logoLightUrl}
          logoDarkUrl={branding.logoDarkUrl}
        />
      </span>
      {module.target_audience && <span className="mx-compass-aud">{module.target_audience}</span>}
    </header>
  );

  const head = (
    <div className="mx-compass-head">
      {showEyebrow && <div className="mx-compass-eyebrow">{eyebrow}</div>}
      <h1 className="mx-compass-title">{title}</h1>
      {body && <p className="mx-compass-body">{body}</p>}
    </div>
  );

  // Bild/video — video vinner när båda finns (bilden blir startbild).
  const media = hasMedia ? (
    <figure className="mx-compass-media">
      {videoUrl ? (
        <video
          src={videoUrl}
          className="mx-compass-media-el"
          controls={layout !== 'cover'}
          autoPlay={layout === 'cover'}
          muted={layout === 'cover'}
          loop={layout === 'cover'}
          playsInline
          preload="metadata"
          poster={imageUrl ?? undefined}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl ?? ''} alt="" className="mx-compass-media-el" />
      )}
    </figure>
  ) : null;

  // Brand-panel när mallen är byggd runt en bild men ingen laddats upp —
  // ren dekoration i accentfärgen så sidan aldrig ser "tom" ut.
  const fallbackVisual = (
    <div className="mx-compass-visual-fallback" aria-hidden>
      <svg viewBox="0 0 400 400" className="mx-compass-rings">
        <circle cx="200" cy="200" r="190" />
        <circle cx="200" cy="200" r="140" />
        <circle cx="200" cy="200" r="90" />
        <circle cx="200" cy="200" r="40" />
        <path d="M200 40 L214 186 L360 200 L214 214 L200 360 L186 214 L40 200 L186 186 Z" className="mx-compass-needle" />
      </svg>
      <div className="mx-compass-visual-tag">
        <span>{eyebrow}</span>
        <span>{FLOW_WORD[module.flow_type]}</span>
      </div>
    </div>
  );

  const card = (
    <section
      className={`mx-compass-card${isChat ? ' mx-compass-card-chat' : ''}`}
      aria-label={FLOW_WORD[module.flow_type]}
    >
      <PublicModuleRunner
        module={module}
        questions={questions}
        brandName={branding.name}
        nextModule={nextModule}
      />
    </section>
  );

  const foot = (
    <footer className="mx-compass-foot">
      {isChat
        ? 'Drivs av Mistral / Le Chat (EU-suveränt) · Genererat av AI – verifiera innan delning'
        : 'Dina svar hanteras inom EU och delas aldrig vidare.'}
    </footer>
  );

  const style = { ['--mx-accent' as string]: accent } as React.CSSProperties;

  // ── Heltäckande ──────────────────────────────────────────────────────────
  if (layout === 'cover') {
    return (
      <main className="mx-compass-landing" data-layout="cover" style={style}>
        <div className="mx-compass-cover-bg" aria-hidden>
          {media}
          <div className="mx-compass-cover-veil" />
        </div>
        <div className="mx-compass-wrap">
          {topbar}
          <div className="mx-compass-stage">
            <div className="mx-compass-content">
              {head}
              {card}
            </div>
          </div>
          {foot}
        </div>
      </main>
    );
  }

  // ── Bild till vänster / höger ────────────────────────────────────────────
  if (layout === 'split_left' || layout === 'split_right') {
    return (
      <main className="mx-compass-landing" data-layout={layout} style={style}>
        <div className="mx-compass-wrap">
          {topbar}
          <div className="mx-compass-stage">
            <aside className="mx-compass-visual">{media ?? fallbackVisual}</aside>
            <div className="mx-compass-content">
              {head}
              {card}
            </div>
          </div>
          {foot}
        </div>
      </main>
    );
  }

  // ── Färgpanel ────────────────────────────────────────────────────────────
  if (layout === 'panel') {
    return (
      <main className="mx-compass-landing" data-layout="panel" style={style}>
        <div className="mx-compass-wrap">
          {topbar}
          <div className="mx-compass-stage">
            <div className={`mx-compass-panel${hasMedia ? ' has-media' : ''}`}>
              <div className="mx-compass-panel-glow" aria-hidden />
              {head}
              {media && <aside className="mx-compass-visual">{media}</aside>}
            </div>
            <div className="mx-compass-content">{card}</div>
          </div>
          {foot}
        </div>
      </main>
    );
  }

  // ── Minimal ──────────────────────────────────────────────────────────────
  if (layout === 'minimal') {
    return (
      <main className="mx-compass-landing" data-layout="minimal" style={style}>
        <div className="mx-compass-wrap">
          {topbar}
          <div className="mx-compass-stage">
            <div className="mx-compass-content">
              {head}
              {card}
            </div>
          </div>
          {foot}
        </div>
      </main>
    );
  }

  // ── Klassisk (default) ───────────────────────────────────────────────────
  return (
    <main className="mx-compass-landing" data-layout="classic" style={style}>
      <div className="mx-compass-wrap">
        {topbar}
        <div className="mx-compass-stage">
          {media && <aside className="mx-compass-visual">{media}</aside>}
          <div className="mx-compass-content">
            {head}
            {card}
          </div>
        </div>
        {foot}
      </div>
    </main>
  );
}
