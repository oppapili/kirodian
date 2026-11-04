import {
  getProviderConfig,
  getProviderSelectionInputs,
  setProviderConfig,
} from '../../core/providers/providerConfig';
import type {
  KiroAgentModeSnapshot,
  KiroCatalogSnapshot,
  KiroProviderSettings,
  PersistedKiroProviderSettings,
} from './config';
import {
  clearCurrentKiroCatalogConfig,
  decodeKiroConfig,
  getCurrentKiroAgentModesConfig,
  getCurrentKiroCatalogConfig,
  reconcileKiroSessionAgentModesConfig,
  resolveKiroSelectedAgentModeConfig,
  updateCurrentKiroAgentModesConfig,
  updateCurrentKiroCatalogConfig,
  updateKiroConfig,
  updateKiroVisibleModelsConfig,
} from './config';

// The runtime-safe config shape, defaults, decode/update API, and the plain
// predicates live in `./config` so provider runtime modules can read them through
// `ProviderRuntimeHost` without importing this settings-document adapter. This module
// is the integration adapter: each function reads/writes the application settings
// document and delegates the actual decoding to `./config`.
export {
  DEFAULT_KIRO_PROVIDER_SETTINGS,
  getOrderedKiroVisibleModelIds,
  isKiroProviderEnabled,
  type KiroAgentModeSnapshot,
  type KiroCatalogSnapshot,
  type KiroProviderSettings,
  normalizeKiroCatalogSnapshot,
  normalizeKiroModelAliases,
  normalizeKiroPreferredReasoningByModel,
  normalizeKiroSelectedAgentMode,
  normalizeKiroVisibleModels,
  type PersistedKiroProviderSettings,
} from './config';

/** Reads Kiro's configuration from the settings document. */
export function getKiroProviderSettings(
  settings: Record<string, unknown>,
): KiroProviderSettings {
  return decodeKiroConfig(
    getProviderConfig(settings, 'kiro'),
    getProviderSelectionInputs(settings, 'kiro'),
  );
}

/** Writes Kiro's configuration into the settings document. */
export function updateKiroProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<PersistedKiroProviderSettings>,
): KiroProviderSettings {
  const config = getProviderConfig(settings, 'kiro');
  const next = updateKiroConfig(config, getProviderSelectionInputs(settings, 'kiro'), updates);
  setProviderConfig(settings, 'kiro', config);
  return next;
}

export function updateKiroVisibleModels(
  settings: Record<string, unknown>,
  visibleModels: string[] | null,
): KiroProviderSettings {
  const config = getProviderConfig(settings, 'kiro');
  const next = updateKiroVisibleModelsConfig(
    config,
    getProviderSelectionInputs(settings, 'kiro'),
    visibleModels,
  );
  setProviderConfig(settings, 'kiro', config);
  return next;
}

export function getCurrentKiroCatalog(
  settings: Record<string, unknown>,
): KiroCatalogSnapshot | null {
  return getCurrentKiroCatalogConfig(
    getProviderConfig(settings, 'kiro'),
    getProviderSelectionInputs(settings, 'kiro'),
  );
}

export function updateCurrentKiroCatalog(
  settings: Record<string, unknown>,
  snapshot: KiroCatalogSnapshot,
): KiroCatalogSnapshot | null {
  const config = getProviderConfig(settings, 'kiro');
  const result = updateCurrentKiroCatalogConfig(
    config,
    getProviderSelectionInputs(settings, 'kiro'),
    snapshot,
  );
  if (result !== null) {
    setProviderConfig(settings, 'kiro', config);
  }
  return result;
}

export function clearCurrentKiroCatalog(settings: Record<string, unknown>): boolean {
  const config = getProviderConfig(settings, 'kiro');
  const changed = clearCurrentKiroCatalogConfig(
    config,
    getProviderSelectionInputs(settings, 'kiro'),
  );
  if (changed) {
    setProviderConfig(settings, 'kiro', config);
  }
  return changed;
}

export function getCurrentKiroAgentModes(
  settings: Record<string, unknown>,
): KiroAgentModeSnapshot | null {
  return getCurrentKiroAgentModesConfig(
    getProviderConfig(settings, 'kiro'),
    getProviderSelectionInputs(settings, 'kiro'),
  );
}

/** Persists the live session's agent-mode snapshot for the current host. */
export function updateCurrentKiroAgentModes(
  settings: Record<string, unknown>,
  snapshot: KiroAgentModeSnapshot,
): KiroAgentModeSnapshot | null {
  const config = getProviderConfig(settings, 'kiro');
  const result = updateCurrentKiroAgentModesConfig(
    config,
    getProviderSelectionInputs(settings, 'kiro'),
    snapshot,
  );
  if (result !== null) {
    setProviderConfig(settings, 'kiro', config);
  }
  return result;
}

export function reconcileKiroSessionAgentModes(
  settings: Record<string, unknown>,
  session: KiroAgentModeSnapshot,
): KiroAgentModeSnapshot | null {
  const config = getProviderConfig(settings, 'kiro');
  const result = reconcileKiroSessionAgentModesConfig(
    config,
    getProviderSelectionInputs(settings, 'kiro'),
    session,
  );
  if (result !== null) {
    setProviderConfig(settings, 'kiro', config);
  }
  return result;
}

export function resolveKiroSelectedAgentMode(
  settings: Record<string, unknown>,
  availableModeIds?: ReadonlySet<string>,
): string | null {
  return resolveKiroSelectedAgentModeConfig(
    getProviderConfig(settings, 'kiro'),
    getProviderSelectionInputs(settings, 'kiro'),
    availableModeIds,
  );
}
