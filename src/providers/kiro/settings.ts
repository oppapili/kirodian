import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import { STANDARD_REASONING_VALUES } from '../../core/providers/reasoning';
import { normalizeHostnameStringMap } from '../../core/providers/settings/HostnameStringMap';
import type { HostnameCLIPaths } from '../../core/types/settings';
import { getHostnameKey } from '../../utils/env';
import type { KiroAgentMode } from './execution/KiroSessionModeMetadata';
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

/** Runtime snapshot of the agent modes advertised by the live ACP session. */
export interface KiroAgentModeSnapshot {
  modes: KiroAgentMode[];
  currentModeId: string | null;
}

export interface PersistedKiroProviderSettings {
  enabled: boolean;
  cliPath: string;
  cliPathsByHost: HostnameCLIPaths;
  catalogsByHost: Record<string, KiroCatalogSnapshot>;
  environmentVariables: string;
  environmentHash: string;
  visibleModels: string[] | null;
  modelAliases: Record<string, string>;
  preferredReasoningByModel: Record<string, string>;
  /** Runtime snapshot of the live session's agent modes, keyed by host. Not user-authored. */
  agentModesByHost: Record<string, KiroAgentModeSnapshot>;
  /** The user's explicitly chosen agent mode id, independent of the permission toggle. */
  selectedAgentMode: string | null;
}

export interface KiroProviderSettings extends PersistedKiroProviderSettings {
  currentCatalog: KiroCatalogSnapshot | null;
  /** Agent modes for the current host, resolved from `agentModesByHost`. */
  currentAgentModes: KiroAgentModeSnapshot | null;
}

export const DEFAULT_KIRO_PROVIDER_SETTINGS: Readonly<PersistedKiroProviderSettings> = Object.freeze({
  agentModesByHost: {},
  catalogsByHost: {},
  cliPath: '',
  cliPathsByHost: {},
  enabled: false,
  environmentHash: '',
  environmentVariables: '',
  modelAliases: {},
  preferredReasoningByModel: {},
  selectedAgentMode: null,
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
  const agentModesByHost = normalizeKiroAgentModesByHost(config.agentModesByHost);
  const currentAgentModes = agentModesByHost[currentHostKey] ?? null;
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
    agentModesByHost,
    currentAgentModes,
    selectedAgentMode: normalizeKiroSelectedAgentMode(config.selectedAgentMode),
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

  const agentModesByHost = updates.agentModesByHost !== undefined
    ? normalizeKiroAgentModesByHost(updates.agentModesByHost)
    : { ...current.agentModesByHost };
  const currentAgentModes = agentModesByHost[currentHostKey] ?? null;
  const selectedAgentMode = normalizeKiroSelectedAgentMode(
    updates.selectedAgentMode === undefined
      ? current.selectedAgentMode
      : updates.selectedAgentMode,
  );

  const next: PersistedKiroProviderSettings = {
    agentModesByHost,
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
    preferredReasoningByModel: normalizeKiroPreferredReasoningByModel(
      updates.preferredReasoningByModel ?? current.preferredReasoningByModel,
      enabledModelIds,
      catalogModels,
      true,
    ),
    selectedAgentMode,
    visibleModels,
  };

  setProviderConfig(settings, 'kiro', next as unknown as Record<string, unknown>);
  return { ...next, currentAgentModes, currentCatalog };
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

export function getCurrentKiroAgentModes(
  settings: Record<string, unknown>,
): KiroAgentModeSnapshot | null {
  return getKiroProviderSettings(settings).currentAgentModes;
}

/** Persists the live session's agent-mode snapshot for the current host. */
export function updateCurrentKiroAgentModes(
  settings: Record<string, unknown>,
  snapshot: KiroAgentModeSnapshot,
): KiroAgentModeSnapshot | null {
  const normalized = normalizeKiroAgentModeSnapshot(snapshot);
  if (!normalized) {
    return null;
  }
  const current = getKiroProviderSettings(settings);
  updateKiroProviderSettings(settings, {
    agentModesByHost: {
      ...current.agentModesByHost,
      [getHostnameKey()]: normalized,
    },
  });
  return normalized;
}

/**
 * Reconciles a live session's advertised modes against the CLI-prefetched catalog, treating
 * the session as a SUPPLEMENT rather than the option source (the prefetch is the primary
 * source; see issue #2). When a prefetched catalog already exists, its mode list is preserved
 * as the selector's options and only the `currentModeId` is refreshed from the session, with
 * any session-only mode appended so a live mode absent from the CLI list is still selectable.
 * When no catalog exists yet (prefetch unavailable), the session modes populate it as a
 * fallback, matching the pre-prefetch behaviour. Returns the persisted snapshot, or null when
 * the session advertised nothing usable and no change was made.
 */
export function reconcileKiroSessionAgentModes(
  settings: Record<string, unknown>,
  session: KiroAgentModeSnapshot,
): KiroAgentModeSnapshot | null {
  const normalizedSession = normalizeKiroAgentModeSnapshot(session);
  if (!normalizedSession || normalizedSession.modes.length === 0) {
    return null;
  }
  const existing = getCurrentKiroAgentModes(settings);
  if (!existing || existing.modes.length === 0) {
    return updateCurrentKiroAgentModes(settings, normalizedSession);
  }

  const knownIds = new Set(existing.modes.map(mode => mode.id));
  const supplementalModes = normalizedSession.modes.filter(mode => !knownIds.has(mode.id));
  const currentModeId = normalizedSession.currentModeId ?? existing.currentModeId;
  const reconciled: KiroAgentModeSnapshot = {
    currentModeId,
    modes: supplementalModes.length > 0
      ? [...existing.modes, ...supplementalModes]
      : existing.modes,
  };
  if (
    reconciled.currentModeId === existing.currentModeId
    && supplementalModes.length === 0
  ) {
    return existing;
  }
  return updateCurrentKiroAgentModes(settings, reconciled);
}

/**
 * Resolves the agent mode id to drive `session/set_mode` with. Precedence: the user's
 * explicit `selectedAgentMode` (when it still exists in the live modes), then the session's
 * advertised `currentModeId`, then null (leave the session on its native default). Never
 * returns an id absent from `availableModeIds`, since Kiro rejects unknown ids with an error.
 */
export function resolveKiroSelectedAgentMode(
  settings: Record<string, unknown>,
  availableModeIds?: ReadonlySet<string>,
): string | null {
  const kiroSettings = getKiroProviderSettings(settings);
  const snapshot = kiroSettings.currentAgentModes;
  const known = availableModeIds
    ?? new Set((snapshot?.modes ?? []).map(mode => mode.id));
  const selected = kiroSettings.selectedAgentMode;
  if (selected && known.has(selected)) {
    return selected;
  }
  const current = snapshot?.currentModeId ?? null;
  if (current && known.has(current)) {
    return current;
  }
  return null;
}

export function normalizeKiroSelectedAgentMode(value: unknown): string | null {
  const normalized = readTrimmedString(value);
  return normalized || null;
}

function normalizeKiroAgentModesByHost(
  value: unknown,
): Record<string, KiroAgentModeSnapshot> {
  if (!isRecord(value)) {
    return {};
  }
  const normalized: Record<string, KiroAgentModeSnapshot> = {};
  for (const [hostKey, snapshot] of Object.entries(value)) {
    const normalizedHostKey = hostKey.trim();
    const normalizedSnapshot = normalizeKiroAgentModeSnapshot(snapshot);
    if (normalizedHostKey && normalizedSnapshot) {
      normalized[normalizedHostKey] = normalizedSnapshot;
    }
  }
  return normalized;
}

function normalizeKiroAgentModeSnapshot(value: unknown): KiroAgentModeSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }
  const rawModes = Array.isArray(value.modes) ? value.modes : [];
  const modes: KiroAgentMode[] = [];
  const seen = new Set<string>();
  for (const entry of rawModes) {
    if (!isRecord(entry)) {
      continue;
    }
    const id = readTrimmedString(entry.id);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const name = readTrimmedString(entry.name) || id;
    const description = readTrimmedString(entry.description);
    modes.push({
      id,
      name,
      ...(description ? { description } : {}),
    });
  }
  const currentModeId = readTrimmedString(value.currentModeId) || null;
  return { currentModeId, modes };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
