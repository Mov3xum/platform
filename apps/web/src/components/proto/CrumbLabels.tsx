'use client';

import { useEffect } from 'react';
import { registerCrumbLabels } from '@/lib/crumb-labels';

/**
 * Talar om för topbarens brödsmulor vad sidans dynamiska sökvägar heter,
 * t.ex. `{ '/impactnavigator/<id>': 'AdMetals AB' }`. Renderar inget;
 * etiketterna tas bort när sidan lämnas.
 */
export function CrumbLabels({ labels }: { labels: Record<string, string> }) {
  const key = JSON.stringify(labels);
  useEffect(() => registerCrumbLabels(JSON.parse(key) as Record<string, string>), [key]);
  return null;
}
