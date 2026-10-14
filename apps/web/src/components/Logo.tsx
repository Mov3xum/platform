/*
 * Movexum-logotyp (CLAUDE.md § 2.1).
 *
 * Renderar wordmark "movexum" som inline HTML-text med Sora Variable,
 * eller en anpassad tenant-logotyp om logoLightUrl/logoDarkUrl är satta.
 * Self-hosted fonten laddas via fonts.css, vilket garanterar korrekt
 * rendering oavsett kontext.
 *
 * Varianter:
 *   - `auto` (default): följer dark mode via `.dark`-klassen på <html> —
 *     svart wordmark/`logoLightUrl` på ljus yta, vit wordmark/`logoDarkUrl`
 *     på mörk. Använd denna överallt där ytan följer temat (rail, header).
 *   - `light` / `dark`: tvingar läget — BARA för ytor som alltid är ljusa
 *     respektive mörka oavsett tema (t.ex. en mörk bildpanel på login).
 *   - `flex`: `currentColor`.
 *
 * Varje läge visar sin EGEN tenant-logotyp om den finns, annars Movexum-
 * wordmarken i rätt färg. Vi lånar aldrig det andra lägets bild: en vit
 * dark-mode-logotyp på vit canvas (eller tvärtom) blir osynlig, medan
 * wordmarken alltid syns.
 */

import Link from 'next/link';
import Image from 'next/image';

type LogoProps = {
  href?: string;
  className?: string;
  width?: number;
  height?: number;
  variant?: 'auto' | 'light' | 'dark' | 'flex';
  logoLightUrl?: string;
  logoDarkUrl?: string;
};

// Neutrala wordmark-färger ur grafiska profilen (§ 2.2) — fasta hex, inte
// semantiska tokens, eftersom varianten själv avgör ytan.
const WORDMARK_ON_LIGHT = '#121212';
const WORDMARK_ON_DARK = '#f2f2f2';

export function Logo({
  href = '/',
  className = '',
  width = 140,
  height = 32,
  variant = 'auto',
  logoLightUrl,
  logoDarkUrl
}: LogoProps) {
  // Scale font-size from the height prop (wordmark text sits ~70% of height)
  const fontSize = Math.round(height * 0.72);

  const baseStyle: React.CSSProperties = {
    fontFamily: 'var(--font-heading, "Sora Variable", Sora, system-ui, sans-serif)',
    fontWeight: 700,
    fontSize: `${fontSize}px`,
    letterSpacing: '-0.025em',
    lineHeight: 1,
    display: 'block',
    userSelect: 'none',
    // Reserve horizontal space so layout stays stable if font hasn't loaded
    minWidth: width ? `${width}px` : undefined
  };

  const imgStyle: React.CSSProperties = {
    width: 'auto',
    maxWidth: `${width}px`,
    maxHeight: `${height}px`,
    objectFit: 'contain',
    display: 'block'
  };

  const renderMode = (mode: 'light' | 'dark') => {
    const src = mode === 'light' ? logoLightUrl : logoDarkUrl;
    if (src) {
      return (
        <Image src={src} alt="Logotyp" width={width} height={height} style={imgStyle} unoptimized />
      );
    }
    return (
      <span style={{ ...baseStyle, color: mode === 'light' ? WORDMARK_ON_LIGHT : WORDMARK_ON_DARK }}>
        movexum
      </span>
    );
  };

  const flexSrc = logoLightUrl || logoDarkUrl || '';

  return (
    <Link
      href={href}
      aria-label="Movexum – startsida"
      className={'inline-flex items-center ' + className}
      style={{ textDecoration: 'none' }}
    >
      {variant === 'auto' ? (
        <>
          {/* Ljust läge — döljs av `.dark` på <html> */}
          <span className="block dark:hidden">{renderMode('light')}</span>
          {/* Mörkt läge */}
          <span className="hidden dark:block">{renderMode('dark')}</span>
        </>
      ) : variant === 'light' ? (
        renderMode('light')
      ) : variant === 'dark' ? (
        renderMode('dark')
      ) : flexSrc ? (
        /* flex — tenant-logotyp om någon finns, annars currentColor-wordmark */
        <Image src={flexSrc} alt="Logotyp" width={width} height={height} style={imgStyle} unoptimized />
      ) : (
        <span style={{ ...baseStyle, color: 'currentColor' }}>movexum</span>
      )}
    </Link>
  );
}
