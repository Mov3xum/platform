/**
 * Impact Navigator — körläge för AI-stegen (CLAUDE.md § 56), motsvarar
 * originalets `isMockMode`/`getAiRuntimeStatus` i `src/lib/ai/client.ts`.
 *
 * Originalet körde mock om `AI_MOCK_MODE !== "false"` ELLER nyckeln saknades.
 * Plattformen har redan en Mistral-nyckel i drift, så semantiken är
 * anpassad: mock när `IMPACT_AI_MOCK_MODE=true` uttryckligen, eller när
 * `MISTRAL_API_KEY` saknas UTANFÖR produktion (lokal dev, tester, staging
 * utan nyckel — flödet ska gå att köra ändå). I produktion utan nyckel felar
 * steget tydligt som "konfiguration" (§ 10.4: degraderat läge felar aldrig
 * tyst). Mockläget syns alltid: `model_name = 'mock'` på jobb och analys.
 */
export type ImpactAiMode = 'mock' | 'mistral';

export const IMPACT_MOCK_MODEL = 'mock';

export function isImpactMockMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const forced = (env.IMPACT_AI_MOCK_MODE ?? '').trim().toLowerCase();
  if (forced === 'true' || forced === '1') return true;
  if (forced === 'false' || forced === '0') return false;
  const hasKey = Boolean(env.MISTRAL_API_KEY?.trim());
  return !hasKey && env.NODE_ENV !== 'production';
}

export function getImpactAiRuntimeStatus(env: NodeJS.ProcessEnv = process.env): {
  mode: ImpactAiMode;
  hasApiKey: boolean;
  forcedMock: boolean;
  model: string;
} {
  const forced = (env.IMPACT_AI_MOCK_MODE ?? '').trim().toLowerCase();
  const mode: ImpactAiMode = isImpactMockMode(env) ? 'mock' : 'mistral';
  return {
    mode,
    hasApiKey: Boolean(env.MISTRAL_API_KEY?.trim()),
    forcedMock: forced === 'true' || forced === '1',
    model: mode === 'mock' ? IMPACT_MOCK_MODEL : 'mistral-large-latest'
  };
}
