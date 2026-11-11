import { Logo } from '@/components/Logo';
import { PublicModuleRunner } from './PublicModuleRunner';
import { moduleHeroImageUrl, moduleHeroVideoUrl } from '@/lib/compass/media';
import type { CompassQuestion, NextModuleLink } from '@/lib/compass/types';
import type { PublicCompassModule, PublicTenantBranding } from '@/lib/compass/public';
import {
  COMPASS_LAYOUT_META,
  COMPASS_LOCALES,
  COMPASS_LOCALE_LABEL,
  compassUi,
  normalizeCompassLayout
} from '@platform/shared';
import type { CompassLayout, CompassLocale } from '@platform/shared';

interface Props {
  module: PublicCompassModule;
  questions: CompassQuestion[];
  branding: PublicTenantBranding;
  nextModule: NextModuleLink | null;
  /** Enkätens subjekt ur `?om=<id>` (§ 43), redan validerat av sidan. */
  subject?: string | null;
  /** Språket sidan renderas på (§ 23.13) — `en` bara när engelskan är publicerad. */
  locale?: CompassLocale;
  /**
   * Länkar för språkväxlaren (samma sida på svenska resp. engelska, övriga
   * parametrar bevarade). Null ⇒ modulen har ingen publicerad engelsk
   * version och växlaren visas inte.
   */
  languageLinks?: Record<CompassLocale, string> | null;
}

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
export function PublicModuleLayout({
  module,
  questions,
  branding,
  nextModule,
  subject,
  locale = 'sv',
  languageLinks = null
}: Props) {
  const t = compassUi(locale);
  const FLOW_WORD = t.flowWord;
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
  // Eyebrow = BARA personalens egen text ("Liten text ovanför rubriken").
  // Tidigare föll sidan tillbaka på "STARTUPKOMPASSEN" när fältet var tomt,
  // så ordet gick inte att ta bort från en modul i admin (2026-11). Tomt ⇒
  // ingen eyebrow; logotypen i sidhuvudet bär avsändaren.
  const eyebrow = (module.hero_eyebrow || '').trim();
  // Undvik dubblerad rubrik när eyebrow råkar vara identisk med titeln.
  const showEyebrow = Boolean(eyebrow) && eyebrow.toLowerCase() !== (title || '').trim().toLowerCase();
  // Brickan i brand-panelen (mallar utan uppladdad bild): eyebrow, annars
  // avsändarens namn, annars bara flödesordet.
  const visualTag = eyebrow || branding.name || '';
  // Ingressen är BARA `welcome_body` (steg 2 i editorn). `description` är
  // modulens INTERNA beskrivning ("Visas bara för er — inte för besökaren")
  // och får aldrig renderas mot kund.
  const body = module.welcome_body;

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
      <div className="mx-compass-topbar-end">
        {module.target_audience && <span className="mx-compass-aud">{module.target_audience}</span>}
        {languageLinks && (
          <nav className="mx-compass-lang" aria-label={`${t.language} / ${locale === 'en' ? 'Språk' : 'Language'}`}>
            <span className="mx-compass-lang-ico" aria-hidden>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </span>
            {COMPASS_LOCALES.map((l) => (
              <a
                key={l}
                href={languageLinks[l]}
                hrefLang={l}
                lang={l}
                aria-current={l === locale ? 'true' : undefined}
              >
                {COMPASS_LOCALE_LABEL[l]}
              </a>
            ))}
          </nav>
        )}
      </div>
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
        {visualTag && <span>{visualTag}</span>}
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
        nextModule={nextModule}
        subject={subject}
        locale={locale}
      />
    </section>
  );

  const foot = (
    <footer className="mx-compass-foot">
      {isChat ? t.footChat : t.footForm}
    </footer>
  );

  const style = { ['--mx-accent' as string]: accent } as React.CSSProperties;

  // ── Heltäckande ──────────────────────────────────────────────────────────
  if (layout === 'cover') {
    return (
      <main lang={locale} className="mx-compass-landing" data-layout="cover" style={style}>
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
      <main lang={locale} className="mx-compass-landing" data-layout={layout} style={style}>
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
      <main lang={locale} className="mx-compass-landing" data-layout="panel" style={style}>
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
      <main lang={locale} className="mx-compass-landing" data-layout="minimal" style={style}>
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
    <main lang={locale} className="mx-compass-landing" data-layout="classic" style={style}>
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
