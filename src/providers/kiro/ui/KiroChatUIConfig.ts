import type {
  ProviderChatUIConfig,
  ProviderModelPolicy,
  ProviderModelSelectorLock,
  ProviderModeSelectorConfig,
  ProviderPermissionModeOption,
  ProviderPermissionModePolicy,
  ProviderUIOption,
} from '../../../core/providers/types';
import { KIRO_PROVIDER_ICON } from '../../../shared/icons';
import {
  decodeKiroModelId,
  encodeKiroModelId,
  findKiroModel,
  getKiroAvailableReasoningEfforts,
  isKiroModelSelectionId,
  resolveKiroDefaultReasoningEffort,
} from '../models';
import { readKiroAgentModelLock } from '../runtime/KiroAgentModelLock';
import {
  getKiroProviderSettings,
  getOrderedKiroVisibleModelIds,
  resolveKiroSelectedAgentMode,
  updateKiroProviderSettings,
} from '../settings';

const KIRO_PERMISSION_MODE_OPTIONS: readonly ProviderPermissionModeOption[] = Object.freeze([
  { value: 'normal', label: 'Safe', description: 'Ask before running actions' },
  {
    value: 'yolo',
    label: 'YOLO',
    description: 'Accept all permissions without asking',
    bypassesApprovals: true,
  },
]);

// Kiro offers only Safe (`normal`) and YOLO. Retired upstream modes such as
// `plan` are not Kiro values; a stored legacy mode fails closed to Safe.
const KIRO_PERMISSION_MODE_POLICY: ProviderPermissionModePolicy = Object.freeze({
  values: ['normal', 'yolo'],
  fallbackValue: 'normal',
  defaultValue: 'normal',
});

export const kiroChatUIConfig: ProviderChatUIConfig & Pick<ProviderModelPolicy, 'permissionModes'> = {
  permissionModes: KIRO_PERMISSION_MODE_POLICY,
  getModelOptions(settings): ProviderUIOption[] {
    const kiroSettings = getKiroProviderSettings(settings);
    const catalogModels = kiroSettings.currentCatalog?.models ?? [];
    const catalogById = new Map(catalogModels.map(model => [model.rawId, model] as const));
    const visibleModelIds = [...getOrderedKiroVisibleModelIds(kiroSettings)].reverse();
    const options: ProviderUIOption[] = [];
    const seen = new Set<string>();

    for (const rawId of visibleModelIds) {
      pushModelOption(options, seen, rawId, catalogById, kiroSettings.modelAliases);
    }

    return options;
  },

  getDefaultModel(settings): string | null {
    const kiroSettings = getKiroProviderSettings(settings);
    const firstVisibleModelId = getOrderedKiroVisibleModelIds(kiroSettings)[0];
    return firstVisibleModelId ? encodeKiroModelId(firstVisibleModelId) : null;
  },

  ownsModel(model, settings): boolean {
    return isKiroModelSelectionId(model)
      && this.getModelOptions(settings)
        .some(option => option.value === model.trim());
  },

  supportsReasoningEffort(model, settings): boolean {
    return getKiroAvailableReasoningEfforts(
      getExplicitlySelectedKiroModel(model, settings),
    ).length > 0;
  },

  getReasoningOptions(model, settings): ProviderUIOption[] {
    return getKiroAvailableReasoningEfforts(
      getExplicitlySelectedKiroModel(model, settings),
    ).map(option => ({
      ...(option.description ? { description: option.description } : {}),
      label: option.label,
      value: option.value,
    }));
  },

  getDefaultReasoningValue(model, settings): string {
    const kiroSettings = getKiroProviderSettings(settings);
    const rawId = decodeKiroModelId(model);
    if (!rawId) {
      return '';
    }
    const selectedModel = getExplicitlySelectedKiroModel(model, settings);
    const efforts = getKiroAvailableReasoningEfforts(selectedModel);
    if (efforts.length === 0) {
      return '';
    }
    return resolveKiroDefaultReasoningEffort(
      selectedModel ? { ...selectedModel, reasoningEfforts: [...efforts] } : null,
      kiroSettings.preferredReasoningByModel[rawId],
    );
  },

  isDefaultModel(): boolean {
    return false;
  },

  applyModelDefaults(model, settings): void {
    if (!isRecord(settings)) {
      return;
    }
    const normalizedModel = normalizeSelection(model);
    if (!isKiroModelSelectionId(normalizedModel)) {
      return;
    }
    clearSavedKiroEffortProjection(settings);
    settings.model = normalizedModel;
    settings.effortLevel = this.getDefaultReasoningValue(normalizedModel, settings);
  },

  applyModelProjectionDefaults(model, settings): void {
    if (!isRecord(settings)) {
      return;
    }
    clearSavedKiroEffortProjection(settings);
    const rawId = decodeKiroModelId(model);
    if (!rawId) {
      delete settings.effortLevel;
      return;
    }
    settings.effortLevel = this.getDefaultReasoningValue(model, settings);
  },

  applyReasoningSelection(model, value, settings): void {
    if (!isRecord(settings)) {
      return;
    }
    const rawId = decodeKiroModelId(model);
    if (!rawId) {
      clearSavedKiroEffortProjection(settings);
      delete settings.effortLevel;
      return;
    }
    const kiroSettings = getKiroProviderSettings(settings);
    const supportedValues = new Set(getKiroAvailableReasoningEfforts(
      getExplicitlySelectedKiroModel(model, settings),
    ).map(option => option.value));
    const preferredReasoningByModel = { ...kiroSettings.preferredReasoningByModel };
    if (supportedValues.has(value)) {
      preferredReasoningByModel[rawId] = value;
    } else {
      delete preferredReasoningByModel[rawId];
    }
    updateKiroProviderSettings(settings, { preferredReasoningByModel });
  },

  normalizeModelVariant(model): string {
    return normalizeSelection(model);
  },

  getCustomModelIds(): Set<string> {
    return new Set();
  },

  getPermissionModeOptions(): readonly ProviderPermissionModeOption[] {
    return KIRO_PERMISSION_MODE_OPTIONS;
  },

  resolvePermissionMode(settings): string {
    return settings.permissionMode === 'yolo' ? 'yolo' : 'normal';
  },

  applyPermissionMode(value, settings): void {
    if (isRecord(settings)) {
      settings.permissionMode = value === 'yolo' ? 'yolo' : 'normal';
    }
  },

  getModeSelector(settings): ProviderModeSelectorConfig | null {
    const kiroSettings = getKiroProviderSettings(settings);
    // Primary source: the CLI-prefetched agent catalog. On startup the coordinator
    // persists the prefetched agents into `currentAgentModes`, and a live session's
    // advertised modes are folded into that SAME snapshot as a supplement (see
    // `reconcileKiroSessionAgentModes`), so `currentAgentModes.modes` already carries the
    // union of catalog ids and session ids with the catalog kept as the primary source.
    const modes = kiroSettings.currentAgentModes?.modes ?? [];
    if (modes.length === 0) {
      return null;
    }
    const options: ProviderUIOption[] = modes.map(mode => ({
      value: mode.id,
      label: mode.name,
      ...(mode.description ? { description: mode.description } : {}),
    }));
    // The set of ids actually rendered — the catalog ∪ session union. Resolve and
    // validate the displayed value against exactly this set so the shown value is always
    // a real, sendable id: the user's explicit choice when it still exists, else the
    // session's current mode (only when it is one of the listed options), else the first
    // advertised mode. Guarding the `currentModeId` fallback against `known` means a stale
    // current id that is not in the option list can never be surfaced as selectable.
    const known = new Set(options.map(option => option.value));
    const currentModeId = kiroSettings.currentAgentModes?.currentModeId;
    const value = resolveKiroSelectedAgentMode(settings, known)
      ?? (currentModeId && known.has(currentModeId) ? currentModeId : undefined)
      ?? options[0].value;
    return {
      label: 'Agent',
      options,
      value,
    };
  },

  applyModeSelection(value, settings): void {
    if (!isRecord(settings)) {
      return;
    }
    const kiroSettings = getKiroProviderSettings(settings);
    // Only persist ids Kiro actually advertises — the catalog ∪ session union carried by
    // `currentAgentModes.modes`; ignore anything else so the execution layer never drives
    // `session/set_mode` with an id absent from both the prefetched catalog and the session.
    const known = new Set((kiroSettings.currentAgentModes?.modes ?? []).map(mode => mode.id));
    updateKiroProviderSettings(settings, {
      selectedAgentMode: known.has(value) ? value : null,
    });
  },

  getProviderIcon() {
    return KIRO_PROVIDER_ICON;
  },

  getModelSelectorLock(settings): ProviderModelSelectorLock | null {
    const kiroSettings = getKiroProviderSettings(settings);
    const snapshot = kiroSettings.currentAgentModes;
    const directories = snapshot?.directories;
    // No prefetched agent directories means we cannot resolve a `<dir>/<id>.json`, so there
    // is nothing to lock (best-effort: absence is "no lock", never a disabled selector).
    if (!directories) {
      return null;
    }
    const known = new Set((snapshot?.modes ?? []).map(mode => mode.id));
    const selectedAgentId = resolveKiroSelectedAgentMode(settings, known);
    if (!selectedAgentId) {
      return null;
    }
    // Built-in agents have no json and read back as null; custom agents pinning a `"model"`
    // (including `"auto"`) return the pinned value, which locks the selector.
    const pinnedModel = readKiroAgentModelLock(selectedAgentId, directories);
    if (!pinnedModel) {
      return null;
    }
    const agentName = snapshot?.modes.find(mode => mode.id === selectedAgentId)?.name
      ?? selectedAgentId;
    return {
      lockedToModelId: encodeKiroModelId(pinnedModel),
      reason: `Model is fixed to "${pinnedModel}" by agent "${agentName}"`,
    };
  },
};

function pushModelOption(
  options: ProviderUIOption[],
  seen: Set<string>,
  rawId: string,
  catalogById: ReadonlyMap<string, { description?: string; displayName: string }>,
  aliases: Record<string, string>,
): void {
  const value = encodeKiroModelId(rawId);
  if (seen.has(value)) {
    return;
  }
  seen.add(value);
  const model = catalogById.get(rawId);
  options.push({
    value,
    label: aliases[rawId] ?? model?.displayName ?? rawId,
    description: model?.description ?? 'Selected in an existing session',
  });
}

function normalizeSelection(model: string): string {
  const normalized = model.trim();
  const rawId = decodeKiroModelId(normalized);
  return rawId ? encodeKiroModelId(rawId) : model;
}

function getExplicitlySelectedKiroModel(
  model: string,
  settings: Record<string, unknown>,
) {
  const rawId = decodeKiroModelId(model);
  if (!rawId) {
    return null;
  }
  const kiroSettings = getKiroProviderSettings(settings);
  const catalogModels = kiroSettings.currentCatalog?.models ?? [];
  const visibleModels = kiroSettings.visibleModels
    ?? catalogModels.map(entry => entry.rawId);
  if (!visibleModels.includes(rawId)) {
    return null;
  }
  return findKiroModel(catalogModels, rawId) ?? {
    displayName: rawId,
    rawId,
    reasoningEfforts: [],
    supportsReasoning: false,
  };
}

function clearSavedKiroEffortProjection(settings: Record<string, unknown>): void {
  if (isRecord(settings.savedProviderEffort)) {
    delete settings.savedProviderEffort.kiro;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
