'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { compassUi, type CompassLocale, type CompassUiStrings } from '@platform/shared';

// Besökarens språk i Startupkompassens flöden (§ 23.13). Den publika sidan
// sätter `en` när besökaren valt engelska; allt annat (admin-förhandsgranskning,
// intern testchatt) får svenska som förut.
const CompassLocaleContext = createContext<CompassLocale>('sv');

export function CompassLocaleProvider({ locale, children }: { locale: CompassLocale; children: ReactNode }) {
  return <CompassLocaleContext.Provider value={locale}>{children}</CompassLocaleContext.Provider>;
}

export function useCompassLocale(): { locale: CompassLocale; t: CompassUiStrings } {
  const locale = useContext(CompassLocaleContext);
  return { locale, t: compassUi(locale) };
}
