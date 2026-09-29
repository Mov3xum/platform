/**
 * Sökvägar för Inställningar → AI-analys (§ 36.1). Ren modul — delas av
 * sidan, vyerna och redirect-shims för `/insights`, `/admin/ai-miljo` och
 * `/installningar/ai-kostnad`.
 */
export const AI_ANALYS_PATH = '/installningar/ai-analys';

export const AI_ANALYS_VIEWS = ['kostnadstak', 'anvandning', 'miljo'] as const;
export type AiAnalysView = (typeof AI_ANALYS_VIEWS)[number];

export const AI_ANALYS_VIEW_LABELS: Record<AiAnalysView, string> = {
  kostnadstak: 'Kostnadstak',
  anvandning: 'Användning',
  miljo: 'Miljöpåverkan'
};

export function isAiAnalysView(value: string | undefined): value is AiAnalysView {
  return (AI_ANALYS_VIEWS as readonly string[]).includes(value ?? '');
}

/** Länk till en vy, med valfri period (`range`) bevarad. */
export function aiAnalysHref(view: AiAnalysView, range?: string): string {
  const params = new URLSearchParams();
  if (view !== 'kostnadstak') params.set('vy', view);
  if (range) params.set('range', range);
  const qs = params.toString();
  return qs ? `${AI_ANALYS_PATH}?${qs}` : AI_ANALYS_PATH;
}
