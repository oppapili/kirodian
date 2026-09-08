import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import { STANDARD_REASONING_VALUES } from '../../core/providers/reasoning';
import { normalizeHostnameStringMap } from '../../core/providers/settings/HostnameStringMap';
import type { HostnameCliPaths } from '../../core/types/settings';
import { getHostnameKey } from '../../utils/env';
import {
  clearKiroReasoningMetadata,
  decodeKiroModelId,
  getKiroAvailableReasoningEfforts,
  type KiroDiscoveredModel,
  normalizeKiroDiscoveredModels,
} from './models';

export interface KiroCatalogSnapshot {
  models: KiroDiscoveredModel[];
  defaultModelId: string | null;
  fingerprint: string;
  refreshedAt: number;
}

export interface PersistedKiroProviderSettings {
  enabled: boolean;
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  catalogsByHost: Record<string, KiroCatalogSnapshot>;
  environmentVariables: string;
  environmentHash: string;
  visibleModels: string[] | null;
  modelAliases: Record<string, string>;
  planBasePermissionMode: 'normal' | 'yolo';
  preferredReasoningByModel: Record<string, string>;
}

export interface KiroProviderSettings extends PersistedKiroProviderSettings {
  currentCatalog: KiroCatalogSnapshot | null;
}

export const DEFAULT_KIRO_PROVIDER_SETTINGS: Readonly<PersistedKiroProviderSettings> = Object.freeze({
  catalogsByHost: {},
  cliPath: '',
  cliPathsByHost: {},
  enabled: false,
  environmentHash: '',
  environmentVariables: '',
  modelAliases: {},
  planBasePermissionMode: 'normal',
  preferredReasoningByModel: {},
  visibleModels: null,
});

export function getOrderedKiroVisibleModelIds(
  settings: KiroProviderSettings,
): string[] {
  if (settings.visibleModels !== null) {
    return [...settings.visibleModels];
  }

  const models = settings.currentCatalog?.models ?? [];
  const defaultModelId = settings.currentCatalog?.defaultModelId;
  if (!defaultModelId || !models.some(model => model.rawId === defaultModelId)) {
    return models.map(model => model.rawId);
  }

  return [
    defaultModelId,
    ...models.filter(model => model.rawId !== defaultModelId).map(model => model.rawId),
  ];
}

export function normalizeKiroCatalogSnapshot(value: unknown): KiroCatalogSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const defaultModelId = normalizeRawModelId(value.defaultModelId);
  const fingerprint = readTrimmedString(value.fingerprint);
  const refreshedAt = typeof value.refreshedAt === 'number'
    && Number.isFinite(value.refreshedAt)
    && value.refreshedAt >= 0
    ? Math.floor(value.refreshedAt)
    : 0;

  return {
    defaultModelId,
    fingerprint,
    models: normalizeKiroDiscoveredModels(value.models),
    refreshedAt,
  };
}

export function getKiroProviderSettings(
  settings: Record<string, unknown>,
): KiroProviderSettings {
  const config = getProviderConfig(settings, 'kiro');
  const currentHostKey = getHostnameKey();
  const cliPathsByHost = normalizeHostnameStringMap(config.cliPathsByHost);
  const catalogsByHost = normalizeKiroCatalogsByHost(config.catalogsByHost);
  const currentCatalog = catalogsByHost[currentHostKey] ?? null;
  const selectedModelIds = collectSelectedKiroRawModelIds(settings);
  const catalogModels = currentCatalog?.models ?? [];
  const allowedModelIds = new Set(catalogModels.map(model => model.rawId));
  for (const modelId of selectedModelIds) {
    allowedModelIds.add(modelId);
  }

  const visibleModels = normalizeKiroVisibleModels(
    config.visibleModels,
    allowedModelIds,
    catalogModels.length > 0,
  );
  const enabledModelIds = new Set(
    visibleModels ?? catalogModels.map(model => model.rawId),
  );

  return {
    catalogsByHost,
    cliPath: readTrimmedString(config.cliPath)
      || DEFAULT_KIRO_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost,
    currentCatalog,
    enabled: typeof config.enabled === 'boolean'
      ? config.enabled
      : DEFAULT_KIRO_PROVIDER_SETTINGS.enabled,
    environmentHash: readTrimmedString(config.environmentHash),
    environmentVariables: typeof config.environmentVariables === 'string'
      ? config.environmentVariables
      : getProviderEnvironmentVariables(settings, 'kiro')
        ?? DEFAULT_KIRO_PROVIDER_SETTINGS.environmentVariables,
    modelAliases: normalizeKiroModelAliases(
      config.modelAliases,
      allowedModelIds,
      catalogModels.length > 0,
    ),
    planBasePermissionMode: normalizeKiroBasePermissionMode(config.planBasePermissionMode),
    preferredReasoningByModel: normalizeKiroPreferredReasoningByModel(
      config.preferredReasoningByModel,
      enabledModelIds,
      catalogModels,
      true,
    ),
    visibleModels,
  };
}

export function updateKiroProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<PersistedKiroProviderSettings>,
): KiroProviderSettings {
  const current = getKiroProviderSettings(settings);
  const currentHostKey = getHostnameKey();
  const cliPathsByHost = updates.cliPathsByHost !== undefined
    ? normalizeHostnameStringMap(updates.cliPathsByHost)
    : { ...current.cliPathsByHost };
  let cliPath = updates.cliPathsByHost !== undefined
    ? readTrimmedString(updates.cliPath)
    : current.cliPath;

  if ('cliPath' in updates && updates.cliPathsByHost === undefined) {
    const hostCliPath = readTrimmedString(updates.cliPath);
    if (hostCliPath) {
      cliPathsByHost[currentHostKey] = hostCliPath;
    } else {
      delete cliPathsByHost[currentHostKey];
    }
    cliPath = DEFAULT_KIRO_PROVIDER_SETTINGS.cliPath;
  }

  const catalogsByHost = updates.catalogsByHost !== undefined
    ? normalizeKiroCatalogsByHost(updates.catalogsByHost)
    : { ...current.catalogsByHost };
  const currentCatalog = catalogsByHost[currentHostKey] ?? null;
  const catalogModels = currentCatalog?.models ?? [];
  const allowedModelIds = new Set(catalogModels.map(model => model.rawId));
  for (const modelId of collectSelectedKiroRawModelIds(settings)) {
    allowedModelIds.add(modelId);
  }
  const hasCatalog = catalogModels.length > 0;
  const visibleModels = normalizeKiroVisibleModels(
    updates.visibleModels === undefined ? current.visibleModels : updates.visibleModels,
    allowedModelIds,
    hasCatalog,
  );
  const enabledModelIds = new Set(
    visibleModels ?? catalogModels.map(model => model.rawId),
  );

  const next: PersistedKiroProviderSettings = {
    catalogsByHost,
    cliPath,
    cliPathsByHost,
    enabled: updates.enabled ?? current.enabled,
    environmentHash: updates.environmentHash !== undefined
      ? readTrimmedString(updates.environmentHash)
      : current.environmentHash,
    environmentVariables: updates.environmentVariables ?? current.environmentVariables,
    modelAliases: normalizeKiroModelAliases(
      updates.modelAliases ?? current.modelAliases,
      allowedModelIds,
      hasCatalog,
    ),
    planBasePermissionMode: updates.planBasePermissionMode !== undefined
      ? normalizeKiroBasePermissionMode(updates.planBasePermissionMode)
      : current.planBasePermissionMode,
    preferredReasoningByModel: normalizeKiroPreferredReasoningByModel(
      updates.preferredReasoningByModel ?? current.preferredReasoningByModel,
      enabledModelIds,
      catalogModels,
      true,
    ),
    visibleModels,
  };

  setProviderConfig(settings, 'kiro', next as unknown as Record<string, unknown>);
  return { ...next, currentCatalog };
}

export function updateKiroVisibleModels(
  settings: Record<string, unknown>,
  visibleModels: string[] | null,
): KiroProviderSettings {
  const current = getKiroProviderSettings(settings);
  const normalizedVisibleModels = normalizeKiroVisibleModels(
    visibleModels,
    new Set(current.currentCatalog?.models.map(model => model.rawId) ?? []),
    Boolean(current.currentCatalog?.models.length),
  );
  const enabledModelIds = new Set(
    normalizedVisibleModels
      ?? current.currentCatalog?.models.map(model => model.rawId)
      ?? [],
  );
  const catalogsByHost = Object.fromEntries(
    Object.entries(current.catalogsByHost).map(([hostKey, catalog]) => [
      hostKey,
      {
        ...catalog,
        models: catalog.models.map(model => (
          normalizedVisibleModels === null || enabledModelIds.has(model.rawId)
            ? model
            : clearKiroReasoningMetadata(model)
        )),
      },
    ]),
  );
  return updateKiroProviderSettings(settings, {
    catalogsByHost,
    preferredReasoningByModel: current.preferredReasoningByModel,
    visibleModels: normalizedVisibleModels,
  });
}

export function getCurrentKiroCatalog(
  settings: Record<string, unknown>,
): KiroCatalogSnapshot | null {
  return getKiroProviderSettings(settings).currentCatalog;
}

export function updateCurrentKiroCatalog(
  settings: Record<string, unknown>,
  snapshot: KiroCatalogSnapshot,
): KiroCatalogSnapshot | null {
  const normalized = normalizeKiroCatalogSnapshot(snapshot);
  if (!normalized) {
    return null;
  }
  const current = getKiroProviderSettings(settings);
  updateKiroProviderSettings(settings, {
    catalogsByHost: {
      ...current.catalogsByHost,
      [getHostnameKey()]: normalized,
    },
  });
  return normalized;
}

export function clearCurrentKiroCatalog(settings: Record<string, unknown>): boolean {
  const current = getKiroProviderSettings(settings);
  const currentHostKey = getHostnameKey();
  if (!current.catalogsByHost[currentHostKey]) {
    return false;
  }

  const catalogsByHost = { ...current.catalogsByHost };
  delete catalogsByHost[currentHostKey];
  updateKiroProviderSettings(settings, { catalogsByHost });
  return true;
}

export function normalizeKiroVisibleModels(
  value: unknown,
  allowedModelIds: ReadonlySet<string> = new Set(),
  restrictToAllowed = allowedModelIds.size > 0,
): string[] | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const rawModelId = normalizeRawModelId(entry);
    if (
      !rawModelId
      || seen.has(rawModelId)
      || (restrictToAllowed && !allowedModelIds.has(rawModelId))
    ) {
      continue;
    }
    seen.add(rawModelId);
    normalized.push(rawModelId);
  }
  return normalized;
}

export function normalizeKiroModelAliases(
  value: unknown,
  allowedModelIds: ReadonlySet<string> = new Set(),
  restrictToAllowed = allowedModelIds.size > 0,
): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [modelId, aliasValue] of Object.entries(value)) {
    const rawModelId = normalizeRawModelId(modelId);
    const alias = readTrimmedString(aliasValue);
    if (
      !rawModelId
      || !alias
      || (restrictToAllowed && !allowedModelIds.has(rawModelId))
    ) {
      continue;
    }
    normalized[rawModelId] = alias;
  }
  return normalized;
}

export function normalizeKiroPreferredReasoningByModel(
  value: unknown,
  allowedModelIds: ReadonlySet<string> = new Set(),
  catalogModels: KiroDiscoveredModel[] = [],
  restrictToAllowed = catalogModels.length > 0,
): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  const catalogById = new Map(catalogModels.map(model => [model.rawId, model] as const));
  const normalized: Record<string, string> = {};
  for (const [modelId, effortValue] of Object.entries(value)) {
    const rawModelId = normalizeRawModelId(modelId);
    const effort = readTrimmedString(effortValue);
    if (
      !rawModelId
      || !effort
      || (restrictToAllowed && !allowedModelIds.has(rawModelId))
    ) {
      continue;
    }

    const catalogModel = catalogById.get(rawModelId);
    const supportedEfforts = new Set(catalogModel
      ? getKiroAvailableReasoningEfforts(catalogModel).map(option => option.value)
      : STANDARD_REASONING_VALUES);
    if (!supportedEfforts.has(effort)) {
      continue;
    }
    normalized[rawModelId] = effort;
  }
  return normalized;
}

function normalizeKiroCatalogsByHost(
  value: unknown,
): Record<string, KiroCatalogSnapshot> {
  if (!isRecord(value)) {
    return {};
  }

  const normalized: Record<string, KiroCatalogSnapshot> = {};
  for (const [hostKey, snapshot] of Object.entries(value)) {
    const normalizedHostKey = hostKey.trim();
    const normalizedSnapshot = normalizeKiroCatalogSnapshot(snapshot);
    if (normalizedHostKey && normalizedSnapshot) {
      normalized[normalizedHostKey] = normalizedSnapshot;
    }
  }
  return normalized;
}

function collectSelectedKiroRawModelIds(settings: Record<string, unknown>): Set<string> {
  const selected = new Set<string>();
  addSelectedKiroRawModelId(selected, settings.model);
  addSelectedKiroRawModelId(selected, settings.titleGenerationModel);

  if (isRecord(settings.savedProviderModel)) {
    addSelectedKiroRawModelId(selected, settings.savedProviderModel.kiro);
  }
  return selected;
}

function addSelectedKiroRawModelId(target: Set<string>, value: unknown): void {
  if (typeof value !== 'string') {
    return;
  }
  const rawModelId = decodeKiroModelId(value.trim());
  if (rawModelId) {
    target.add(rawModelId);
  }
}

function normalizeRawModelId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  return decodeKiroModelId(normalized) ?? normalized;
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKiroBasePermissionMode(value: unknown): 'normal' | 'yolo' {
  return value === 'yolo' ? 'yolo' : 'normal';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
