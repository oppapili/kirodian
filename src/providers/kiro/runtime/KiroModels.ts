import { ProviderModelCatalogController } from '../../../core/providers/models/ProviderModelCatalog';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import {
  getKiroProviderSettings,
  getOrderedKiroVisibleModelIds,
  updateKiroProviderSettings,
} from '../settings';
import type { KiroModelCatalogCoordinator } from './KiroModelCatalogCoordinator';

/**
 * Build the shared model-catalog controller for the Kiro provider. Mirrors
 * `createGrokModels`: the controller owns the common settings policy (selection,
 * aliases, staleness) while discovery, native metadata, and persistence remain the
 * coordinator's responsibility.
 *
 * @param host - Provider host used for settings mutation and change notifications.
 * @param native - The Kiro model-catalog coordinator, narrowed to its `refresh` hook.
 * @returns A {@link ProviderModelCatalogController} for the Kiro provider.
 */
export function createKiroModels(
  host: ProviderHost,
  native: Pick<KiroModelCatalogCoordinator, 'refresh'>,
): ProviderModelCatalogController {
  return new ProviderModelCatalogController({
    providerId: 'kiro',
    host,
    update: updateKiroProviderSettings,
    providerName: 'Kiro',
    read: () => {
      const current = getKiroProviderSettings(host.settings);
      return {
        enabled: current.enabled,
        models: (current.currentCatalog?.models ?? []).map(model => ({
          id: model.rawId,
          name: model.displayName,
          description: model.description,
        })),
        selectedIds: getOrderedKiroVisibleModelIds(current),
        aliases: current.modelAliases,
      };
    },
    discover: async () => {
      const result = await native.refresh();
      return { changed: result.changed, diagnostics: result.diagnostics };
    },
  });
}
