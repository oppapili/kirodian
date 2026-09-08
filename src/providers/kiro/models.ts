import {
  formatReasoningValueLabel,
  resolvePreferredReasoningDefault,
  STANDARD_REASONING_VALUES,
} from '../../core/providers/reasoning';

export interface KiroReasoningEffort {
  description?: string;
  label: string;
  value: string;
}

export interface KiroDiscoveredModel {
  agentType?: string;
  contextWindow?: number;
  defaultReasoningEffort?: string;
  description?: string;
  displayName: string;
  rawId: string;
  reasoningMetadataResolved?: boolean;
  reasoningEfforts: KiroReasoningEffort[];
  supportsReasoning: boolean;
}

export const KIRO_MODEL_PREFIX = 'kiro/';
export const KIRO_CONTEXT_WINDOW_FALLBACK = 200_000;
const KIRO_REASONING_EFFORT_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;
const KIRO_FALLBACK_REASONING_EFFORTS: readonly KiroReasoningEffort[] = Object.freeze(
  STANDARD_REASONING_VALUES.map(value => Object.freeze({
    label: formatReasoningValueLabel(value),
    value,
  })),
);

export function isKiroModelSelectionId(model: string): boolean {
  return decodeKiroModelId(model.trim()) !== null;
}

export function encodeKiroModelId(rawModelId: string): string {
  const normalized = rawModelId.trim();
  if (!normalized || normalized === KIRO_MODEL_PREFIX) {
    return '';
  }
  return normalized.startsWith(KIRO_MODEL_PREFIX)
    ? normalized
    : `${KIRO_MODEL_PREFIX}${normalized}`;
}

export function decodeKiroModelId(model: string): string | null {
  const normalized = model.trim();
  if (!normalized.startsWith(KIRO_MODEL_PREFIX)) {
    return null;
  }
  const rawModelId = normalized.slice(KIRO_MODEL_PREFIX.length).trim();
  return rawModelId || null;
}

export function normalizeKiroDiscoveredModels(value: unknown): KiroDiscoveredModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalizedById = new Map<string, KiroDiscoveredModel>();
  for (const entry of value) {
    const model = normalizeKiroDiscoveredModel(entry);
    if (!model) {
      continue;
    }

    const current = normalizedById.get(model.rawId);
    normalizedById.set(
      model.rawId,
      current ? mergeKiroModelMetadata(current, model) : model,
    );
  }
  return Array.from(normalizedById.values());
}

export function mergeKiroDiscoveredModels(
  catalogModels: KiroDiscoveredModel[],
  liveModels: KiroDiscoveredModel[],
): KiroDiscoveredModel[] {
  const merged = normalizeKiroDiscoveredModels(catalogModels);
  const indexes = new Map(merged.map((model, index) => [model.rawId, index] as const));

  for (const incoming of normalizeKiroDiscoveredModels(liveModels)) {
    const index = indexes.get(incoming.rawId);
    if (index === undefined) {
      indexes.set(incoming.rawId, merged.length);
      merged.push(incoming);
      continue;
    }
    merged[index] = mergeKiroModelMetadata(merged[index], incoming);
  }

  return merged;
}

export function findKiroModel(
  models: KiroDiscoveredModel[],
  modelId: string,
): KiroDiscoveredModel | null {
  const rawModelId = decodeKiroModelId(modelId) ?? modelId.trim();
  if (!rawModelId) {
    return null;
  }
  return models.find(model => model.rawId === rawModelId) ?? null;
}

export function getKiroAvailableReasoningEfforts(
  model: KiroDiscoveredModel | null | undefined,
): readonly KiroReasoningEffort[] {
  if (!model) {
    return [];
  }
  if (model.reasoningMetadataResolved === true) {
    return model.reasoningEfforts;
  }
  return KIRO_FALLBACK_REASONING_EFFORTS;
}

export function clearKiroReasoningMetadata(
  model: KiroDiscoveredModel,
): KiroDiscoveredModel {
  const cleared = { ...model };
  delete cleared.defaultReasoningEffort;
  delete cleared.reasoningMetadataResolved;
  cleared.reasoningEfforts = [];
  cleared.supportsReasoning = false;
  return cleared;
}

export function resolveKiroDefaultReasoningEffort(
  model: KiroDiscoveredModel | null | undefined,
  preferredEffort?: string,
): string {
  const availableValues = model?.reasoningEfforts.map(effort => effort.value) ?? [];
  const normalizedPreferred = preferredEffort?.trim();
  if (normalizedPreferred && availableValues.includes(normalizedPreferred)) {
    return normalizedPreferred;
  }

  const declaredDefault = model?.defaultReasoningEffort?.trim();
  if (declaredDefault && availableValues.includes(declaredDefault)) {
    return declaredDefault;
  }

  return resolvePreferredReasoningDefault(availableValues, 'high');
}

export function resolveKiroContextWindow(
  modelId: string,
  models: KiroDiscoveredModel[],
  customContextLimits: Record<string, number> = {},
): number {
  const model = findKiroModel(models, modelId);
  if (model?.contextWindow !== undefined) {
    return model.contextWindow;
  }

  const rawModelId = decodeKiroModelId(modelId);
  const customLimit = customContextLimits[modelId]
    ?? (rawModelId ? customContextLimits[rawModelId] : undefined);
  return isPositiveFiniteNumber(customLimit)
    ? customLimit
    : KIRO_CONTEXT_WINDOW_FALLBACK;
}

export function normalizeKiroReasoningMetadata(value: unknown): Pick<
  KiroDiscoveredModel,
  'defaultReasoningEffort' | 'reasoningEfforts' | 'supportsReasoning'
> {
  if (!isRecord(value)) {
    return { reasoningEfforts: [], supportsReasoning: false };
  }
  const sessionConfig = isRecord(value['x.ai/sessionConfig'])
    ? value['x.ai/sessionConfig']
    : null;
  const sessionOptions = normalizeKiroSessionReasoningOptions(sessionConfig?.options);
  const explicitEfforts = normalizeKiroReasoningEfforts(
    value.reasoningEfforts ?? value.reasoning_efforts,
  );
  const reasoningEfforts = explicitEfforts.length > 0
    ? explicitEfforts
    : sessionOptions.efforts;
  const defaultReasoningEffort = readTrimmedString(
    value.reasoningEffort
      ?? value.reasoning_effort
      ?? value.defaultReasoningEffort
      ?? value.default_reasoning_effort,
  ) ?? sessionOptions.selected;
  const supportsReasoning = value.supportsReasoning === true
    || value.supports_reasoning === true
    || value.supportsReasoningEffort === true
    || value.supports_reasoning_effort === true
    || reasoningEfforts.length > 0
    || Boolean(defaultReasoningEffort);
  return {
    ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
    reasoningEfforts,
    supportsReasoning,
  };
}

function normalizeKiroDiscoveredModel(value: unknown): KiroDiscoveredModel | null {
  if (!isRecord(value)) {
    return null;
  }

  const rawId = readTrimmedString(value.rawId ?? value.modelId ?? value.id);
  if (!rawId) {
    return null;
  }

  const reasoning = normalizeKiroReasoningMetadata(value);
  const agentType = readTrimmedString(value.agentType ?? value.agent_type);
  const contextWindow = readPositiveFiniteNumber(
    value.contextWindow
      ?? value.context_window
      ?? value.totalContextTokens
      ?? value.total_context_tokens,
  );
  const description = readTrimmedString(value.description);
  const displayName = readTrimmedString(
    value.displayName ?? value.display_name ?? value.name ?? value.label,
  ) || rawId;
  return {
    ...(agentType ? { agentType } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(reasoning.defaultReasoningEffort
      ? { defaultReasoningEffort: reasoning.defaultReasoningEffort }
      : {}),
    ...(description ? { description } : {}),
    displayName,
    rawId,
    ...(value.reasoningMetadataResolved === true
      ? { reasoningMetadataResolved: true }
      : {}),
    reasoningEfforts: reasoning.reasoningEfforts,
    supportsReasoning: reasoning.supportsReasoning,
  };
}

function normalizeKiroSessionReasoningOptions(value: unknown): {
  efforts: KiroReasoningEffort[];
  selected?: string;
} {
  if (!Array.isArray(value)) return { efforts: [] };
  const rows = value.filter((entry): entry is Record<string, unknown> => (
    isRecord(entry) && entry.category === 'mode'
  ));
  const efforts = normalizeKiroReasoningEfforts(rows).sort((left, right) => {
    const leftIndex = KIRO_REASONING_EFFORT_ORDER.indexOf(
      left.value as (typeof KIRO_REASONING_EFFORT_ORDER)[number],
    );
    const rightIndex = KIRO_REASONING_EFFORT_ORDER.indexOf(
      right.value as (typeof KIRO_REASONING_EFFORT_ORDER)[number],
    );
    if (leftIndex === -1) return rightIndex === -1 ? 0 : 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
  const selected = rows.find(row => row.selected === true);
  return {
    efforts,
    ...(selected ? { selected: readTrimmedString(selected.id ?? selected.value) } : {}),
  };
}

function normalizeKiroReasoningEfforts(value: unknown): KiroReasoningEffort[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const efforts: KiroReasoningEffort[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const record = isRecord(entry) ? entry : null;
    const effortValue = readTrimmedString(record?.value ?? record?.id ?? entry);
    if (!effortValue || seen.has(effortValue)) {
      continue;
    }
    seen.add(effortValue);
    const label = readTrimmedString(record?.label ?? record?.name)
      || formatReasoningValueLabel(effortValue);
    const description = readTrimmedString(record?.description);
    efforts.push({
      ...(description ? { description } : {}),
      label,
      value: effortValue,
    });
  }
  return efforts;
}

function mergeKiroModelMetadata(
  current: KiroDiscoveredModel,
  incoming: KiroDiscoveredModel,
): KiroDiscoveredModel {
  const incomingReasoningIsAuthoritative = incoming.reasoningMetadataResolved === true;
  const reasoningEfforts = incomingReasoningIsAuthoritative
    ? incoming.reasoningEfforts
    : incoming.reasoningEfforts.length > 0
      ? incoming.reasoningEfforts
      : current.reasoningEfforts;
  const defaultReasoningEffort = incomingReasoningIsAuthoritative
    ? incoming.defaultReasoningEffort
    : incoming.defaultReasoningEffort ?? current.defaultReasoningEffort;
  const incomingDisplayNameIsRich = incoming.displayName !== incoming.rawId;

  return {
    ...(incoming.agentType ?? current.agentType
      ? { agentType: incoming.agentType ?? current.agentType }
      : {}),
    ...(incoming.contextWindow ?? current.contextWindow
      ? { contextWindow: incoming.contextWindow ?? current.contextWindow }
      : {}),
    ...(defaultReasoningEffort
      ? { defaultReasoningEffort }
      : {}),
    ...(incoming.description ?? current.description
      ? { description: incoming.description ?? current.description }
      : {}),
    displayName: incomingDisplayNameIsRich ? incoming.displayName : current.displayName,
    rawId: current.rawId,
    ...(incoming.reasoningMetadataResolved || current.reasoningMetadataResolved
      ? { reasoningMetadataResolved: true }
      : {}),
    reasoningEfforts,
    supportsReasoning: incomingReasoningIsAuthoritative
      ? incoming.supportsReasoning || reasoningEfforts.length > 0
      : incoming.supportsReasoning
        || current.supportsReasoning
        || reasoningEfforts.length > 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readPositiveFiniteNumber(value: unknown): number | undefined {
  return isPositiveFiniteNumber(value) ? Math.floor(value) : undefined;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
