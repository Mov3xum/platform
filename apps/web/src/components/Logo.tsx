/*
 * Movexum-logotyp.
 *
 * Båda dark/light-varianterna finns som SVG i `/public/brand`. Vi använder
 * dem via separata <img>-element som visas/döljs med dark-variant — så
 * att rätt färgad bild används utan färgglapp vid theme-switch.
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
  return (
    <Link
      href={href}
      aria-label="Movexum – startsida"
      className={'inline-flex items-center ' + className}
    >
      {variant === 'auto' ? (
        <>
          {/* Light mode: svart wordmark */}
          <img
            src="/brand/movexum-wordmark-light.svg"
            alt="Movexum"
            width={width}
            height={height}
            className="block dark:hidden"
          />
          {/* Dark mode: vit wordmark */}
          <img
            src="/brand/movexum-wordmark-dark.svg"
            alt="Movexum"
            width={width}
            height={height}
            className="hidden dark:block"
          />
        </>
      ) : variant === 'light' ? (
        <img
          src="/brand/movexum-wordmark-light.svg"
          alt="Movexum"
          width={width}
          height={height}
        />
      ) : variant === 'dark' ? (
        <img
          src="/brand/movexum-wordmark-dark.svg"
          alt="Movexum"
          width={width}
          height={height}
        />
      ) : (
        <img
          src="/brand/movexum-wordmark.svg"
          alt="Movexum"
          width={width}
          height={height}
        />
      )}
    </Link>
  );
}
