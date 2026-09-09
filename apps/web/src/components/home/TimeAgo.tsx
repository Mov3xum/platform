'use client';

import { useEffect, useState } from 'react';

/**
 * Relativ, svensk tidsangivelse ("nyss", "2 tim sedan", "igår"). Beräknas
 * EFTER mount — under server-renderingen skiljer sig texten annars från
 * klientens (klockskev/minutgräns/tidszon) och React kastar hydration-fel
 * (samma princip som aktivitetsloggen i DashboardChat).
 */
export function relativeTimeSv(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, now - then);
  const min = Math.round(diff / 60000);
  if (min < 1) return 'nyss';
  if (min < 60) return `${min} min sedan`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs} tim sedan`;
  const days = Math.round(hrs / 24);
  if (days === 1) return 'igår';
  if (days < 7) return `${days} dgr sedan`;
  return new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
}

export function TimeAgo({ iso, className }: { iso: string; className?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <time dateTime={iso} className={className} title={new Date(iso).toLocaleString('sv-SE')}>
      {now === null ? '' : relativeTimeSv(iso, now)}
    </time>
  );
}
