import {
  type AcpMetadata,
  type AcpModelInfo,
  type AcpSessionConfigOption,
  type AcpSessionModelState,
  extractAcpSessionModelState,
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
  _meta?: AcpMetadata | null;
  configOptions?: AcpSessionConfigOption[] | null;
  models?: AcpSessionModelState | null;
}): NormalizedKiroSessionModels {
  const state = extractAcpSessionModelState(response);
  const rawModelsById = new Map(
    (response.models?.availableModels ?? []).flatMap(model => {
      const id = resolveAcpModelId(model);
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
  metadata: AcpMetadata | null | undefined,
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
): AcpSessionModelState | null {
  if (!isRecord(value)) return null;
  const candidate = isRecord(value.models) ? value.models : value;
  if (
    !Array.isArray(candidate.availableModels)
    || typeof candidate.currentModelId !== 'string'
    || !candidate.currentModelId.trim()
    || !candidate.availableModels.every(isAcpModelInfo)
  ) {
    return null;
  }

  return candidate as unknown as AcpSessionModelState;
}

function isAcpModelInfo(value: unknown): value is AcpModelInfo {
  return isRecord(value)
    && typeof value.name === 'string'
    && readModelId(value) !== null;
}

function resolveAcpModelId(model: AcpModelInfo): string | null {
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
