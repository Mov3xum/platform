/**
 * Export Lab — körläge för AI-stegen (CLAUDE.md § 58), samma semantik som
 * Impact Navigators `impact-runtime.ts`: mock när `EXPORT_LAB_AI_MOCK_MODE=true`
 * uttryckligen, eller när `MISTRAL_API_KEY` saknas UTANFÖR produktion. I
 * produktion utan nyckel felar steget tydligt som "konfiguration" (§ 10.4).
 * Mockläget syns alltid: `model_name = 'mock'` på jobb och analys.
 */
export const EXPORT_MOCK_MODEL = 'mock';

export function isExportMockMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const forced = (env.EXPORT_LAB_AI_MOCK_MODE ?? '').trim().toLowerCase();
  if (forced === 'true' || forced === '1') return true;
  if (forced === 'false' || forced === '0') return false;
  const hasKey = Boolean(env.MISTRAL_API_KEY?.trim());
  return !hasKey && env.NODE_ENV !== 'production';
}
