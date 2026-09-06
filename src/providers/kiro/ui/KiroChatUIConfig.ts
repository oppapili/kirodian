import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { KIRO_PROVIDER_ICON } from '../../../shared/icons';
import {
  decodeKiroModelId,
  encodeKiroModelId,
  findKiroModel,
  getKiroAvailableReasoningEfforts,
  isKiroModelSelectionId,
  resolveKiroContextWindow,
  resolveKiroDefaultReasoningEffort,
} from '../models';
import {
  getKiroProviderSettings,
  getOrderedKiroVisibleModelIds,
  updateKiroProviderSettings,
} from '../settings';

const KIRO_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'yolo',
  activeLabel: 'YOLO',
  planValue: 'plan',
  planLabel: 'PLAN',
};

export const kiroChatUIConfig: ProviderChatUIConfig = {
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

  isAdaptiveReasoningModel(model, settings): boolean {
    return getKiroAvailableReasoningEfforts(
      getExplicitlySelectedKiroModel(model, settings),
    ).length > 0;
  },

  getReasoningOptions(model, settings): ProviderReasoningOption[] {
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

  getContextWindowSize(model, customLimits = {}, settings = {}): number {
    const rawId = resolveSelectedKiroRawModelId(model, settings);
    return resolveKiroContextWindow(
      rawId ? encodeKiroModelId(rawId) : model,
      getKiroProviderSettings(settings).currentCatalog?.models ?? [],
      customLimits,
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

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return KIRO_PERMISSION_MODE_TOGGLE;
  },

  resolvePermissionMode(settings): string {
    if (settings.permissionMode === 'plan') return 'plan';
    return settings.permissionMode === 'yolo' ? 'yolo' : 'normal';
  },

  applyPermissionMode(value, settings): void {
    if (isRecord(settings)) {
      const currentMode = settings.permissionMode;
      if (value === 'plan') {
        if (currentMode === 'normal' || currentMode === 'yolo') {
          updateKiroProviderSettings(settings, { planBasePermissionMode: currentMode });
        }
        settings.permissionMode = 'plan';
        return;
      }
      const baseMode = value === 'yolo' ? 'yolo' : 'normal';
      updateKiroProviderSettings(settings, { planBasePermissionMode: baseMode });
      settings.permissionMode = baseMode;
    }
  },

  getModeSelector(): null {
    return null;
  },

  getProviderIcon() {
    return KIRO_PROVIDER_ICON;
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

function resolveSelectedKiroRawModelId(
  model: string,
  settings: Record<string, unknown>,
): string | null {
  return decodeKiroModelId(model);
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
