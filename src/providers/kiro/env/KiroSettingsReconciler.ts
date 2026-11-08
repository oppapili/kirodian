import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import {
  decodeKiroModelId,
  encodeKiroModelId,
} from '../models';
import { computeKiroRuntimeInputHash } from '../runtime/KiroRuntimeEnvironment';
import {
  clearCurrentKiroCatalog,
  getKiroProviderSettings,
  updateKiroProviderSettings,
} from '../settings';

/**
 * Integration-side environment fingerprint: reads the Kiro runtime environment text
 * from the settings document, then delegates to the runtime-safe
 * {@link computeKiroRuntimeInputHash} so the hashing stays a single source of truth.
 */
export function computeKiroEnvironmentHash(settings: Record<string, unknown>): string {
  return computeKiroRuntimeInputHash(
    getKiroProviderSettings(settings),
    getRuntimeEnvironmentText(settings, 'kiro'),
  );
}

export const kiroSettingsReconciler: ProviderSettingsReconciler = {
  invalidateConversationSessions: () => [],

  reconcileModelWithEnvironment(settings) {
    if (!getKiroProviderSettings(settings).enabled) {
      return { changed: false, invalidatedConversations: [] };
    }

    const environmentHash = computeKiroEnvironmentHash(settings);
    if (getKiroProviderSettings(settings).environmentHash === environmentHash) {
      return { changed: false, invalidatedConversations: [] };
    }

    clearCurrentKiroCatalog(settings);
    updateKiroProviderSettings(settings, { environmentHash });
    // Kiro recycles its process and session/loads the same native session on
    // environment changes rather than invalidating conversations.
    return { changed: true, invalidatedConversations: [], sessionPolicy: 'reload' };
  },

  normalizeModelVariantSettings(settings): boolean {
    let changed = false;
    changed = normalizeSelectionAt(settings, 'model') || changed;
    changed = normalizeSelectionAt(settings, 'titleGenerationModel') || changed;

    const savedProviderModel = settings.savedProviderModel;
    if (savedProviderModel && typeof savedProviderModel === 'object' && !Array.isArray(savedProviderModel)) {
      changed = normalizeSelectionAt(
        savedProviderModel as Record<string, unknown>,
        'kiro',
      ) || changed;
    }
    return changed;
  },
};

function normalizeSelectionAt(settings: Record<string, unknown>, key: string): boolean {
  const current = settings[key];
  if (typeof current !== 'string') {
    return false;
  }

  const trimmed = current.trim();
  let normalized: string | null = null;
  const rawModelId = decodeKiroModelId(trimmed);
  if (rawModelId) {
    normalized = encodeKiroModelId(rawModelId);
  }

  if (normalized === null || normalized === current) {
    return false;
  }
  settings[key] = normalized;
  return true;
}
