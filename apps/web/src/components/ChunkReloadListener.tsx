'use client';

// Global lyssnare som fångar ChunkLoadError överallt — även när felet kastas
// UTANFÖR React-renderträdet (t.ex. en lazy-import som triggas i en
// event-handler eller ett bortfallande CSS-chunk). Felgränserna
// (error.tsx/global-error.tsx) täcker fel som bubblar upp via render; den här
// täcker `window.onerror`/`unhandledrejection`. Tillsammans gör de att en
// gammal flik som möter en ny deploy alltid läker sig själv via ett reload.

import { useEffect } from 'react';
import { attemptChunkReload, isChunkLoadError } from '@/lib/chunk-reload';

export function ChunkReloadListener() {
  useEffect(() => {
    function onError(event: ErrorEvent) {
      // event.error finns för JS-undantag; för resurs-/script-laddningsfel
      // (t.ex. <script src=…> som 404:ar) saknas det och vi tittar på message.
      if (isChunkLoadError(event.error) || isChunkLoadError(event.message)) {
        attemptChunkReload();
      }
    }

    function onRejection(event: PromiseRejectionEvent) {
      if (isChunkLoadError(event.reason)) {
        attemptChunkReload();
      }
    }

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
