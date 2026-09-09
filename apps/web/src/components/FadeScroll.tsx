'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Inline scroll-yta utan box: innehållet scrollar inuti en begränsad höjd och
 * kanterna tonas ut (mask) BARA åt det håll det finns mer att scrolla — en
 * kort lista visas alltså helt otonad. Ren klientkomponent, ingen dataväg.
 */
export function FadeScroll({
  children,
  className = '',
  maxHeight = 520,
  fade = 28
}: {
  children: ReactNode;
  className?: string;
  /** Maxhöjd i px innan innehållet börjar scrolla. */
  maxHeight?: number;
  /** Fade-zonens höjd i px. */
  fade?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const top = el.scrollTop > 2;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
      setEdges((cur) => (cur.top === top && cur.bottom === bottom ? cur : { top, bottom }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    // Innehållet byts när filter ändras (scrollHeight ändras utan att ytan
    // själv ändrar storlek) — lyssna därför även på DOM-ändringar.
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(update) : null;
    mo?.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, []);

  const topPx = edges.top ? fade : 0;
  const bottomPx = edges.bottom ? fade : 0;
  const mask = `linear-gradient(to bottom, transparent 0, #000 ${topPx}px, #000 calc(100% - ${bottomPx}px), transparent 100%)`;

  return (
    <div
      ref={ref}
      className={`mx-fade-scroll overflow-y-auto ${className}`}
      style={{ maxHeight, WebkitMaskImage: mask, maskImage: mask }}
    >
      {children}
    </div>
  );
}
