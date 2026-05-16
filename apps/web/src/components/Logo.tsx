/*
 * Movexum-logotyp.
 *
 * Renderar wordmark "movexum" som inline HTML-text med Sora Variable,
 * eller en anpassad tenant-logotyp om logoLightUrl/logoDarkUrl är satta.
 * Self-hosted fonten laddas via fonts.css, vilket garanterar korrekt
 * rendering oavsett kontext.
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
    minWidth: width ? `${width}px` : undefined,
  };

  const imgStyle: React.CSSProperties = {
    width: 'auto',
    maxWidth: `${width}px`,
    maxHeight: `${height}px`,
    objectFit: 'contain',
    display: 'block',
  };

  return (
    <Link
      href={href}
      aria-label="Movexum – startsida"
      className={'inline-flex items-center ' + className}
      style={{ textDecoration: 'none' }}
    >
      {variant === 'auto' ? (
        <>
          {/* Light mode */}
          <span className="block dark:hidden">
            {logoLightUrl ? (
              <Image
                src={logoLightUrl}
                alt="Logotyp"
                width={width}
                height={height}
                style={imgStyle}
                unoptimized
              />
            ) : (
              <span style={{ ...baseStyle, color: '#121212' }}>movexum</span>
            )}
          </span>
          {/* Dark mode */}
          <span className="hidden dark:block">
            {(logoDarkUrl || logoLightUrl) ? (
              <Image
                src={logoDarkUrl || logoLightUrl!}
                alt="Logotyp"
                width={width}
                height={height}
                style={imgStyle}
                unoptimized
              />
            ) : (
              <span style={{ ...baseStyle, color: '#f2f2f2' }}>movexum</span>
            )}
          </span>
        </>
      ) : variant === 'light' ? (
        (logoLightUrl || logoDarkUrl) ? (
          <Image
            src={logoLightUrl || logoDarkUrl!}
            alt="Logotyp"
            width={width}
            height={height}
            style={imgStyle}
            unoptimized
          />
        ) : (
          <span style={{ ...baseStyle, color: '#121212' }}>movexum</span>
        )
      ) : variant === 'dark' ? (
        (logoDarkUrl || logoLightUrl) ? (
          <Image
            src={logoDarkUrl || logoLightUrl!}
            alt="Logotyp"
            width={width}
            height={height}
            style={imgStyle}
            unoptimized
          />
        ) : (
          <span style={{ ...baseStyle, color: '#f2f2f2' }}>movexum</span>
        )
      ) : (
        /* flex — currentColor */
        (logoLightUrl || logoDarkUrl) ? (
          <Image
            src={logoLightUrl || logoDarkUrl!}
            alt="Logotyp"
            width={width}
            height={height}
            style={imgStyle}
            unoptimized
          />
        ) : (
          <span style={{ ...baseStyle, color: 'currentColor' }}>movexum</span>
        )
      )}
    </Link>
  );
}
