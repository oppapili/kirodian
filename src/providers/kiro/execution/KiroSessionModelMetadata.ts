import {
  type ACPMetadata,
  type ACPModelInfo,
  type ACPSessionConfigOption,
  type ACPSessionModelState,
  extractACPSessionModelState,
} from '../../acp';
import {
  type KiroDiscoveredModel,
  normalizeKiroDiscoveredModels,
} from '../models';

export interface NormalizedKiroSessionModels {
  currentModelId: string | null;
  models: KiroDiscoveredModel[];
}

export function normalizeKiroSessionModelMetadata(response: {
  _meta?: ACPMetadata | null;
  configOptions?: ACPSessionConfigOption[] | null;
  models?: ACPSessionModelState | null;
}): NormalizedKiroSessionModels {
  const state = extractACPSessionModelState(response);
  const rawModelsById = new Map(
    (response.models?.availableModels ?? []).flatMap(model => {
      const id = resolveACPModelId(model);
      return id ? [[id, model] as const] : [];
    }),
  );
  const models = state.availableModels.flatMap(model => {
    const rawModel = rawModelsById.get(model.id);
    const metadata = {
      ...(model.id === state.currentModelId && isRecord(response._meta)
        ? response._meta
        : {}),
      ...(isRecord(rawModel?._meta) ? rawModel._meta : {}),
      ...(isRecord(model._meta) ? model._meta : {}),
    };
    return normalizeKiroDiscoveredModels([{
      ...metadata,
      description: model.description ?? rawModel?.description ?? undefined,
      displayName: model.name,
      rawId: model.id,
      reasoningMetadataResolved: true,
    }]);
  });

  return {
    currentModelId: state.currentModelId,
    models,
  };
}

export function normalizeKiroSetModelMetadata(
  rawModelId: string,
  metadata: ACPMetadata | null | undefined,
): KiroDiscoveredModel | null {
  if (!isRecord(metadata?.model)) return null;
  return normalizeKiroDiscoveredModels([{
    ...metadata.model,
    rawId: readModelId(metadata.model) ?? rawModelId,
    reasoningMetadataResolved: true,
  }])[0] ?? null;
}

export function normalizeKiroModelUpdateMetadata(
  value: unknown,
): NormalizedKiroSessionModels | null {
  const state = parseKiroModelUpdateState(value);
  return state ? normalizeKiroSessionModelMetadata({ models: state }) : null;
}

export function parseKiroModelUpdateState(
  value: unknown,
): ACPSessionModelState | null {
  if (!isRecord(value)) return null;
  const candidate = isRecord(value.models) ? value.models : value;
  if (
    !Array.isArray(candidate.availableModels)
    || typeof candidate.currentModelId !== 'string'
    || !candidate.currentModelId.trim()
    || !candidate.availableModels.every(isACPModelInfo)
  ) {
    return null;
  }

  return candidate as unknown as ACPSessionModelState;
}

function isACPModelInfo(value: unknown): value is ACPModelInfo {
  return isRecord(value)
    && typeof value.name === 'string'
    && readModelId(value) !== null;
}

function resolveACPModelId(model: ACPModelInfo): string | null {
  return readModelId(model);
}

function readModelId(value: Record<string, unknown>): string | null {
  const id = typeof value.modelId === 'string'
    ? value.modelId
    : typeof value.id === 'string'
      ? value.id
      : '';
  return id.trim() || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
