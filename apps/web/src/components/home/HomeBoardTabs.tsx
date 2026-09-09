'use client';

import { useState, type ReactNode } from 'react';
import { Icon } from '@/components/proto/Icon';
import type { OrgPostTab } from '@platform/shared';

/**
 * Flikarna på Hemmaplan (CLAUDE.md § 37): Anslagstavla · Så gör vi ·
 * Internutbildningar. Ren UI-kurering — innehållet är redan RLS-filtrerat av
 * servern; fliken speglas i URL:en (`?flik=…`) så att länkar från chatten och
 * aktivitetsloggen kan öppna rätt flik direkt. Ingen dataväg.
 */

export const HOME_TAB_PARAM = 'flik';

const TAB_SLUGS: Record<OrgPostTab, string> = {
  board: 'anslagstavla',
  instruction: 'sa-gor-vi',
  training: 'internutbildningar'
};

export function homeTabFromSlug(slug: string | undefined): OrgPostTab {
  const hit = (Object.keys(TAB_SLUGS) as OrgPostTab[]).find((k) => TAB_SLUGS[k] === slug);
  return hit ?? 'board';
}

export interface HomeTabDef {
  id: OrgPostTab;
  label: string;
  icon: string;
  count: number;
  description: string;
}

export function HomeBoardTabs({
  tabs,
  initial,
  panels
}: {
  tabs: HomeTabDef[];
  initial: OrgPostTab;
  panels: Record<OrgPostTab, ReactNode>;
}) {
  const [active, setActive] = useState<OrgPostTab>(initial);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  function select(id: OrgPostTab) {
    setActive(id);
    try {
      const url = new URL(window.location.href);
      if (id === 'board') url.searchParams.delete(HOME_TAB_PARAM);
      else url.searchParams.set(HOME_TAB_PARAM, TAB_SLUGS[id]);
      window.history.replaceState(window.history.state, '', url);
    } catch {
      /* URL-synk är bekvämlighet */
    }
  }

  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-default">
        <div role="tablist" aria-label="Från Movexum" className="-mb-px flex gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const on = t.id === active;
            return (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={on}
                onClick={() => select(t.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium transition ${
                  on
                    ? 'border-brand text-foreground'
                    : 'border-transparent text-foreground-subtle hover:text-foreground'
                }`}
              >
                <Icon name={t.icon} size={13} className={on ? 'text-brand' : ''} />
                {t.label}
                {t.count > 0 && (
                  <span
                    className={`mx-tnum rounded-full px-1.5 py-px text-[10.5px] font-semibold ${
                      on ? 'bg-brand/10 text-brand' : 'bg-canvas-muted text-foreground-subtle'
                    }`}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="hidden pb-2 text-[12px] text-foreground-subtle md:block">{current?.description}</p>
      </div>
      <div role="tabpanel" className="pt-4">
        {panels[active]}
      </div>
    </section>
  );
}
