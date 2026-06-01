'use client';

// Global felgräns — sista skyddsnätet. Fångar fel som kastas i sjäva
// root-layouten (där route-segmentets error.tsx inte räcker). Måste rendera
// egen <html>/<body> och kan inte förlita sig på app-CSS:en, så all styling
// är inline med Movexums brand-färger (mörkblå/vit).

import { useEffect } from 'react';
import { attemptChunkReload, isChunkLoadError } from '@/lib/chunk-reload';

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sista skyddsnätet: en chunk som inte gick att ladda efter en deploy
    // läks med ett engångs-reload (loop-skyddat i attemptChunkReload).
    if (isChunkLoadError(error) && attemptChunkReload()) {
      return;
    }
    console.error('[global-error]', error);
  }, [error]);

  return (
    <html lang="sv">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#ffffff',
          color: '#0a0a0a',
          fontFamily: 'system-ui, sans-serif'
        }}
      >
        <div
          style={{
            maxWidth: 480,
            padding: 32,
            borderRadius: 24,
            border: '1px solid #e5e5e5',
            textAlign: 'center'
          }}
        >
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: '#002c40' }}>
            Något gick fel
          </h1>
          <p style={{ marginTop: 12, fontSize: 14, color: '#3f3f3f' }}>
            Ett oväntat fel inträffade. Försök ladda om sidan.
          </p>
          {error?.digest ? (
            <p style={{ marginTop: 16, fontSize: 12, color: '#737373', fontFamily: 'monospace' }}>
              Felreferens: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 24,
              padding: '10px 20px',
              borderRadius: 9999,
              border: 'none',
              background: '#002c40',
              color: '#ffffff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Försök igen
          </button>
        </div>
      </body>
    </html>
  );
}
