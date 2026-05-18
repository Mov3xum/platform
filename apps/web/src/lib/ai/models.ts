import type { ToolModel } from '@platform/shared';

export interface ModelMeta {
  id: ToolModel;
  label: string;
  supportsVision: boolean;
  priceInPerMillion: number; // USD per 1M input tokens
  priceOutPerMillion: number; // USD per 1M output tokens
  blurb: string;
}

export const AVAILABLE_MODELS: ModelMeta[] = [
  {
    id: 'mistral-large-latest',
    label: 'Mistral Large',
    supportsVision: false,
    priceInPerMillion: 2.0,
    priceOutPerMillion: 6.0,
    blurb: 'Djup analys, högst kvalitet'
  },
  {
    id: 'mistral-medium-latest',
    label: 'Mistral Medium',
    supportsVision: true,
    priceInPerMillion: 0.4,
    priceOutPerMillion: 1.2,
    blurb: 'Balans — multimodal'
  },
  {
    id: 'mistral-small-latest',
    label: 'Mistral Small',
    supportsVision: false,
    priceInPerMillion: 0.1,
    priceOutPerMillion: 0.3,
    blurb: 'Snabb och billig'
  },
  {
    id: 'pixtral-large-latest',
    label: 'Pixtral Large',
    supportsVision: true,
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
