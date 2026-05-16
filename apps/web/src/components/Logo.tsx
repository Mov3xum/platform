/*
 * Movexum-logotyp.
 *
 * Renderar wordmark "movexum" som inline HTML-text med Sora Variable.
 * Self-hosted fonten laddas via fonts.css, vilket garanterar korrekt
 * rendering oavsett kontext.
 */

import Link from 'next/link';

type LogoProps = {
  href?: string;
  className?: string;
  width?: number;
  height?: number;
  variant?: 'auto' | 'light' | 'dark' | 'flex';
};

export function Logo({
  href = '/',
  className = '',
  width = 140,
  height = 32,
  variant = 'auto'
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

  return (
    <Link
      href={href}
      aria-label="Movexum – startsida"
      className={'inline-flex items-center ' + className}
      style={{ textDecoration: 'none' }}
    >
      {variant === 'auto' ? (
        <>
          {/* Light mode: svart wordmark */}
          <span style={{ ...baseStyle, color: '#121212' }} className="block dark:hidden">
            movexum
          </span>
          {/* Dark mode: vit wordmark */}
          <span style={{ ...baseStyle, color: '#f2f2f2' }} className="hidden dark:block">
            movexum
          </span>
        </>
      ) : variant === 'light' ? (
        <span style={{ ...baseStyle, color: '#121212' }}>movexum</span>
      ) : variant === 'dark' ? (
        <span style={{ ...baseStyle, color: '#f2f2f2' }}>movexum</span>
      ) : (
        /* flex — currentColor */
        <span style={{ ...baseStyle, color: 'currentColor' }}>movexum</span>
      )}
    </Link>
  );
}
