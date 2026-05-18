import type { ToolModel } from '@platform/shared';

export interface ModelMeta {
  id: ToolModel;
  label: string;
  supportsVision: boolean;
  // Endast Large + Medium har robust stöd för Mistrals first-party
  // built-in tools (web_search, code_interpreter, m.fl.). Small och
  // Pixtral kan ge oförutsägbara tool-call-resultat.
  supportsBuiltinTools: boolean;
  priceInPerMillion: number; // USD per 1M input tokens
  priceOutPerMillion: number; // USD per 1M output tokens
  blurb: string;
}

export const AVAILABLE_MODELS: ModelMeta[] = [
  {
    id: 'mistral-large-latest',
    label: 'Mistral Large',
    supportsVision: false,
    supportsBuiltinTools: true,
    priceInPerMillion: 2.0,
    priceOutPerMillion: 6.0,
    blurb: 'Djup analys, högst kvalitet'
  },
  {
    id: 'mistral-medium-latest',
    label: 'Mistral Medium',
    supportsVision: true,
    supportsBuiltinTools: true,
    priceInPerMillion: 0.4,
    priceOutPerMillion: 1.2,
    blurb: 'Balans — multimodal'
  },
  {
    id: 'mistral-small-latest',
    label: 'Mistral Small',
    supportsVision: false,
    supportsBuiltinTools: false,
    priceInPerMillion: 0.1,
    priceOutPerMillion: 0.3,
    blurb: 'Snabb och billig'
  },
  {
    id: 'pixtral-large-latest',
    label: 'Pixtral Large',
    supportsVision: true,
    supportsBuiltinTools: false,
    priceInPerMillion: 2.0,
    priceOutPerMillion: 6.0,
    blurb: 'Vision-specialist'
  }
];

export const DEFAULT_MODEL: ToolModel = 'mistral-medium-latest';

const MODEL_INDEX = new Map<string, ModelMeta>(
  AVAILABLE_MODELS.map((m) => [m.id, m])
);

export function isAllowedModel(id: string | undefined | null): id is ToolModel {
  return !!id && MODEL_INDEX.has(id);
}

export function getModelMeta(id: ToolModel | string | undefined): ModelMeta {
  if (id && MODEL_INDEX.has(id)) return MODEL_INDEX.get(id)!;
  return MODEL_INDEX.get(DEFAULT_MODEL)!;
}

export function modelSupportsVision(id: ToolModel | string | undefined): boolean {
  return getModelMeta(id).supportsVision;
}

export function modelSupportsBuiltinTools(
  id: ToolModel | string | undefined
): boolean {
  return getModelMeta(id).supportsBuiltinTools;
}

/**
 * Hittar lämplig default-modell när användaren öppnar en connector-chatt.
 * Vi väljer den billigaste modellen som stödjer built-in tools (Medium).
 */
export function defaultModelForConnectors(): ToolModel {
  const candidate = AVAILABLE_MODELS.find((m) => m.supportsBuiltinTools);
  return candidate?.id ?? DEFAULT_MODEL;
}
