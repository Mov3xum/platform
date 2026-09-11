'use client';

import { useState, type ReactNode } from 'react';
import { HOME_TAB_PARAM, HOME_TAB_SLUGS, type OrgPostTab } from '@platform/shared';

/**
 * Flikarna på Hemmaplan (CLAUDE.md § 37): Anslagstavla · Så gör vi ·
 * Internutbildningar — som redaktionella avdelningsrubriker (stora Sora-ord i
 * rad, det aktiva i ink med ett kort brand-streck under, övriga tonade) i
 * stället för generiska flikar. Ren UI-kurering — innehållet är redan
 * RLS-filtrerat av servern; fliken speglas i URL:en (`?flik=…`) så att
 * länkar från chatten och aktivitetsloggen kan öppna rätt flik. Ingen dataväg.
 */

// OBS: slug-mappningen och `homeTabFromSlug` bor i @platform/shared (ren
// modul). Den låg tidigare här — men en funktion exporterad ur en
// 'use client'-modul får inte anropas från en serverkomponent (page.tsx
// gjorde det → "Attempted to call homeTabFromSlug() from the server",
// hela Hemmaplan föll i felvyn "Något gick fel", staging 2026-09).

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
      else url.searchParams.set(HOME_TAB_PARAM, HOME_TAB_SLUGS[id]);
      window.history.replaceState(window.history.state, '', url);
    } catch {
      /* URL-synk är bekvämlighet */
    }
  }

  return (
    <section className="min-w-0">
      <div role="tablist" aria-label="Från Movexum" className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        {tabs.map((t) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={on}
              onClick={() => select(t.id)}
              className={`group relative inline-flex items-baseline gap-1.5 pb-2 font-heading text-[20px] font-semibold tracking-tight transition md:text-[22px] ${
                on ? 'text-foreground' : 'text-foreground-subtle hover:text-foreground-muted'
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <sup className={`mx-tnum text-[11px] font-semibold ${on ? 'text-brand' : 'text-foreground-subtle'}`}>
                  {t.count}
                </sup>
              )}
              <span
                aria-hidden
                className={`absolute bottom-0 left-0 h-[3px] rounded-full bg-brand transition-all duration-300 ${
                  on ? 'w-8' : 'w-0 group-hover:w-4'
                }`}
              />
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[12.5px] text-foreground-subtle">{current?.description}</p>
      <div role="tabpanel" className="pt-5">
        {panels[active]}
      </div>
    </section>
  );
}
