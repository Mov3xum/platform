import type { Metadata } from 'next';
import { Logo } from '@/components/Logo';

export const metadata: Metadata = { title: 'Offline — Movexum' };

/**
 * Offline-fallback som service workern (public/sw.js) förcachar och visar
 * när en navigering inte når servern. Ren, statisk sida utan data.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center gap-5 px-6 text-center">
      <Logo href="/hem" variant="auto" width={140} height={32} />
      <h1 className="text-xl font-semibold text-foreground">Du är offline</h1>
      <p className="max-w-sm text-sm text-foreground-muted">
        Movexum behöver en internetanslutning för att visa bolagsdata och chatten.
        Sidan laddas om automatiskt när du är uppkopplad igen.
      </p>
      <a
        href="/hem"
        className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-5 text-sm font-medium text-brand-foreground transition hover:bg-brand-hover"
      >
        Försök igen
      </a>
    </main>
  );
}
