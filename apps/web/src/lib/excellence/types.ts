import type {
  ExcellenceScreeningResult,
  ScreeningFinancialsYear,
  ScreeningFounderRow,
  ScreeningManualFacts
} from '@platform/shared';
import type { RegistryCostEstimate } from '@/lib/integrations/company-registry/pricing';

// Resultatet av "Bedömning excellens" (CLAUDE.md § 51). Ren typmodul (ingen
// 'use server') så PDF-byggaren, server-actionen och klientvyn delar samma
// form utan att importera en action-modul.

export interface ExcellenceAssessmentSubject {
  name?: string;
  orgNr: string;
  startupId?: string;
  bolagsform?: string;
  registeredAt?: string;
  kommun?: string;
  industri?: string;
  bolagStatus?: string;
}

/** Den sparade PDF:en i den inloggades Filer (§ 51.3). */
export interface ExcellenceAssessmentFile {
  id: string;
  filename: string;
  /** Nedladdning via samma-origin-proxyn (`/api/files/<id>`). */
  href: string;
  /** Bolagsmappen i Filer (bara när bedömningen gällde ett portföljbolag). */
  startupId?: string;
}

export interface ExcellenceAssessment {
  mode: 'register' | 'saved';
  providerName?: string;
  subject: ExcellenceAssessmentSubject;
  result: ExcellenceScreeningResult;
  /** Bokslut per bolag i koncernen (org-nr → årsrader). */
  financialsByOrg: Record<string, ScreeningFinancialsYear[]>;
  /** Grundarna bedömningen räknade på (teamet på bolagskortet eller manuellt inmatade). */
  founders: ScreeningFounderRow[] | null;
  foundersSource: 'platform' | 'manual';
  /** De manuella svar som vägdes in (§ 51.4) — förifyller panelen "Manuella svar". */
  facts: ScreeningManualFacts;
  /** Sant när svaren kunde sparas på bolagskortet (portföljbolag). */
  factsSaved?: boolean;
  /** Fältet `screening_facts` saknas i schemat — svaren vägdes in men sparades inte. */
  factsSchemaMissing?: boolean;
  /**
   * Underlaget serialiserat för omräkning med nya manuella svar UTAN nya
   * leverantörsanrop (`lib/excellence/context.ts`).
   */
  context: string;
  /** PII-fria noteringar från tolkningen, per bolag. */
  notes: Array<{ orgNr: string; name?: string; notes: string[] }>;
  /** Uppslag som inte kunde göras (anknutna bolag) — PII-fritt. */
  lookupWarnings: string[];
  /** Registerläget: uppskattad kostnad för ALLA uppslag i bedömningen (startup + koncernbolag), § 11.8. */
  cost?: RegistryCostEstimate;
  assessedAt: string;
  /** Vem som körde bedömningen (visningsnamn — skrivs i PDF:en). */
  assessedBy?: string;
  /** Sparad PDF (sätts av actionen efter lagring). */
  file?: ExcellenceAssessmentFile;
  /** Lagringen misslyckades — bedömningen visas ändå (fail-soft). */
  fileError?: string;
}
