import type { ImpactFailureKind } from '@/lib/ai/impact-analysis';

/**
 * Impact Navigator — felmeddelanden per yta, ordagrant från originalets
 * `materialityErrorMessages` / `analysisErrorMessages` / `updateErrorMessages`
 * (sidorna visade dem via `?error=<kod>`; här returneras texten direkt från
 * server-actionen och visas inline). Kodernas betydelse är densamma:
 * running = ett lease är aktivt, timeout/configuration/refusal/invalid-output/
 * unavailable = AI-stegets utfall, de övriga = validering av underlaget.
 */
export type ImpactErrorCode =
  | 'analysis-running'
  | 'analysis-timeout'
  | 'analysis-configuration'
  | 'analysis-refusal'
  | 'analysis-invalid-output'
  | 'analysis-unavailable'
  | 'gap-document-empty'
  | 'final-document-empty'
  | 'update-empty'
  | 'update-document-empty'
  | 'update-concurrent'
  | 'update-version-conflict';

export type ImpactErrorSurface = 'materiality' | 'analysis' | 'update';

const MATERIALITY: Partial<Record<ImpactErrorCode, string>> = {
  'analysis-running': 'En annan analyskörning är redan aktiv.',
  'analysis-timeout': 'Analysen hann inte bli klar inom tidsgränsen. Underlaget är sparat och du kan försöka igen.',
  'analysis-configuration': 'AI-tjänsten är inte korrekt konfigurerad. Underlaget är sparat; kontakta en administratör innan du försöker igen.',
  'analysis-refusal': 'AI-tjänsten kunde inte analysera underlaget. Underlaget är sparat och du kan kontrollera innehållet och försöka igen.',
  'analysis-invalid-output': 'AI-tjänsten returnerade inget användbart analysresultat. Underlaget är sparat och du kan försöka igen.',
  'analysis-unavailable': 'AI-tjänsten är tillfälligt otillgänglig. Underlaget är sparat och du kan försöka igen.'
};

const ANALYSIS: Partial<Record<ImpactErrorCode, string>> = {
  'gap-document-empty': 'Ingen läsbar text kunde hämtas från de uppladdade dokumenten. Kontrollera filerna eller komplettera frågorna med text och försök igen.',
  'final-document-empty': 'Dashboarden kunde inte skapas eftersom dokumentkompletteringen saknade läsbar text. Kontrollera filerna eller skriv det ni vet i svarsfälten.',
  'analysis-running': 'En analyskörning pågår redan. Vänta tills den är klar eller ladda om sidan om en stund.',
  'analysis-timeout': 'Analysen hann inte bli klar inom tidsgränsen. Dina uppgifter är sparade och du kan försöka igen.',
  'analysis-configuration': 'AI-tjänsten är inte korrekt konfigurerad. Dina uppgifter är sparade; kontakta en administratör innan du försöker igen.',
  'analysis-refusal': 'AI-tjänsten kunde inte analysera underlaget. Dina uppgifter är sparade och du kan kontrollera innehållet och försöka igen.',
  'analysis-invalid-output': 'AI-tjänsten returnerade inget användbart analysresultat. Dina uppgifter är sparade och du kan försöka igen.',
  'analysis-unavailable': 'AI-tjänsten är tillfälligt otillgänglig. Dina uppgifter är sparade och du kan försöka igen.'
};

const UPDATE: Partial<Record<ImpactErrorCode, string>> = {
  'update-empty': 'Beskriv vad som har hänt sedan sist eller ladda upp minst ett nytt dokument.',
  'update-document-empty': 'Ingen läsbar text kunde hämtas från de nya dokumenten. Kontrollera filerna eller lägg till en kort beskrivning och försök igen.',
  'update-concurrent': 'En annan uppdatering av bolaget pågår redan. Vänta tills den är klar och försök sedan igen.',
  'update-version-conflict': 'En ny analysversion hann skapas. Ladda om dashboarden och försök igen utifrån den senaste versionen.',
  'analysis-timeout': 'Uppdateringsanalysen hann inte bli klar inom tidsgränsen. Den tidigare analysversionen är oförändrad och du kan försöka igen.',
  'analysis-configuration': 'AI-tjänsten är inte korrekt konfigurerad. Den tidigare analysversionen är oförändrad; kontakta en administratör.',
  'analysis-refusal': 'AI-tjänsten kunde inte analysera den nya informationen. Den tidigare analysversionen är oförändrad.',
  'analysis-invalid-output': 'AI-tjänsten returnerade inget användbart resultat. Den tidigare analysversionen är oförändrad och du kan försöka igen.',
  'analysis-unavailable': 'AI-tjänsten är tillfälligt otillgänglig. Den tidigare analysversionen är oförändrad och du kan försöka igen.'
};

const SURFACES: Record<ImpactErrorSurface, Partial<Record<ImpactErrorCode, string>>> = { materiality: MATERIALITY, analysis: ANALYSIS, update: UPDATE };

export function impactErrorMessage(code: ImpactErrorCode, surface: ImpactErrorSurface): string {
  return SURFACES[surface][code] ?? MATERIALITY[code] ?? ANALYSIS[code] ?? UPDATE[code] ?? 'Något gick fel. Försök igen.';
}

/** Originalets `redirectOnAiFailure`: AI-stegets felkategori → felkod. */
export function impactFailureCode(kind: ImpactFailureKind | undefined): ImpactErrorCode {
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

export function impactFailureMessage(kind: ImpactFailureKind | undefined, surface: ImpactErrorSurface): string {
  return impactErrorMessage(impactFailureCode(kind), surface);
}
