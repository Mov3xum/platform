import type { ExportFailureKind } from '@/lib/ai/export-analysis';

/**
 * Export Lab — felmeddelanden per yta (samma koder som Impact Navigator,
 * § 56; sidorna visar `?error=<kod>` eller texten direkt från server-actionen).
 */
export type ExportErrorCode =
  | 'analysis-running'
  | 'analysis-timeout'
  | 'analysis-configuration'
  | 'analysis-invalid-output'
  | 'analysis-unavailable'
  | 'gap-document-empty'
  | 'update-empty'
  | 'update-document-empty'
  | 'update-concurrent'
  | 'update-version-conflict';

export type ExportErrorSurface = 'profile' | 'analysis' | 'update';

const PROFILE: Partial<Record<ExportErrorCode, string>> = {
  'analysis-running': 'En annan analyskörning är redan aktiv.',
  'analysis-timeout': 'Analysen hann inte bli klar inom tidsgränsen. Underlaget är sparat och du kan försöka igen.',
  'analysis-configuration': 'AI-tjänsten är inte korrekt konfigurerad. Underlaget är sparat; kontakta en administratör innan du försöker igen.',
  'analysis-invalid-output': 'AI-tjänsten returnerade inget användbart analysresultat. Underlaget är sparat och du kan försöka igen.',
  'analysis-unavailable': 'AI-tjänsten är tillfälligt otillgänglig. Underlaget är sparat och du kan försöka igen.'
};

const ANALYSIS: Partial<Record<ExportErrorCode, string>> = {
  'gap-document-empty': 'Ingen läsbar text kunde hämtas från de uppladdade dokumenten. Kontrollera filerna eller komplettera frågorna med text och försök igen.',
  'analysis-running': 'En analyskörning pågår redan. Vänta tills den är klar eller ladda om sidan om en stund.',
  'analysis-timeout': 'Analysen hann inte bli klar inom tidsgränsen. Dina uppgifter är sparade och du kan försöka igen.',
  'analysis-configuration': 'AI-tjänsten är inte korrekt konfigurerad. Dina uppgifter är sparade; kontakta en administratör innan du försöker igen.',
  'analysis-invalid-output': 'AI-tjänsten returnerade inget användbart analysresultat. Dina uppgifter är sparade och du kan försöka igen.',
  'analysis-unavailable': 'AI-tjänsten är tillfälligt otillgänglig. Dina uppgifter är sparade och du kan försöka igen.'
};

const UPDATE: Partial<Record<ExportErrorCode, string>> = {
  'update-empty': 'Beskriv vad som har hänt sedan sist eller ladda upp minst ett nytt dokument.',
  'update-document-empty': 'Ingen läsbar text kunde hämtas från de nya dokumenten. Kontrollera filerna eller lägg till en kort beskrivning och försök igen.',
  'update-concurrent': 'En annan uppdatering av exportplanen pågår redan. Vänta tills den är klar och försök sedan igen.',
  'update-version-conflict': 'En ny planversion hann skapas. Ladda om exportplanen och försök igen utifrån den senaste versionen.',
  'analysis-timeout': 'Uppdateringen hann inte bli klar inom tidsgränsen. Den tidigare planen är oförändrad och du kan försöka igen.',
  'analysis-configuration': 'AI-tjänsten är inte korrekt konfigurerad. Den tidigare planen är oförändrad; kontakta en administratör.',
  'analysis-invalid-output': 'AI-tjänsten returnerade inget användbart resultat. Den tidigare planen är oförändrad och du kan försöka igen.',
  'analysis-unavailable': 'AI-tjänsten är tillfälligt otillgänglig. Den tidigare planen är oförändrad och du kan försöka igen.'
};

const SURFACES: Record<ExportErrorSurface, Partial<Record<ExportErrorCode, string>>> = { profile: PROFILE, analysis: ANALYSIS, update: UPDATE };

export function exportErrorMessage(code: ExportErrorCode, surface: ExportErrorSurface): string {
  return SURFACES[surface][code] ?? PROFILE[code] ?? ANALYSIS[code] ?? UPDATE[code] ?? 'Något gick fel. Försök igen.';
}

export function exportFailureCode(kind: ExportFailureKind | undefined): ExportErrorCode {
  switch (kind) {
    case 'timeout':
      return 'analysis-timeout';
    case 'configuration':
      return 'analysis-configuration';
    case 'invalid_output':
    case 'empty_output':
      return 'analysis-invalid-output';
    default:
      return 'analysis-unavailable';
  }
}

export function exportFailureMessage(kind: ExportFailureKind | undefined, surface: ExportErrorSurface): string {
  return exportErrorMessage(exportFailureCode(kind), surface);
}
