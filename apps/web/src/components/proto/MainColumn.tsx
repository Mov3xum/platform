'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { appZoneForPath } from '@/lib/app-zone';

/**
 * Huvudkolumnen (topbar + vy). Bär `data-zone` ur sökvägen så CSS:en kan
 * byta gradientens toner per modul (Impact Navigator = grön, § 56) — redan
 * vid server-renderingen, utan färgblink.
 */
export function MainColumn({ children }: { children: ReactNode }) {
  const zone = appZoneForPath(usePathname());
  return (
    <div className="mx-main-col" data-zone={zone ?? undefined}>
      {children}
    </div>
  );
}
