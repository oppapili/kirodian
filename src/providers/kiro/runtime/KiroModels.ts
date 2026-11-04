import {
  createConfigCatalogStore,
  ProviderModelCatalogController,
  type ProviderModelCatalogPatch,
  type ProviderModelCatalogState,
} from '../../../core/providers/models/ProviderModelCatalog';
import type { ProviderRuntimeHost, ProviderSelectionInputs } from '../../../core/providers/ProviderRuntimeHost';
import {
  decodeKiroConfig,
  getOrderedKiroVisibleModelIds,
  updateKiroConfig,
} from '../config';
import type { KiroModelCatalogCoordinator } from './KiroModelCatalogCoordinator';

/**
 * Build the shared model-catalog controller for the Kiro provider. The
 * controller owns the common selection/alias/staleness policy while discovery,
 * native metadata, and persistence remain the coordinator's responsibility.
 *
 * @param host - Provider runtime host used for config decode, mutation and change notifications.
 * @param native - The Kiro model-catalog coordinator, narrowed to its `refresh` hook.
 * @returns A {@link ProviderModelCatalogController} for the Kiro provider.
 */
export function createKiroModels(
  host: ProviderRuntimeHost,
  native: Pick<KiroModelCatalogCoordinator, 'refresh'>,
): ProviderModelCatalogController {
  return new ProviderModelCatalogController({
    providerName: 'Kiro',
    store: createConfigCatalogStore(host, {
      read: (config, selection): ProviderModelCatalogState => {
        const current = decodeKiroConfig(config, selection);
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
      update: (
        config: Record<string, unknown>,
        selection: ProviderSelectionInputs,
        patch: ProviderModelCatalogPatch,
      ): void => {
        updateKiroConfig(config, selection, patch);
      },
    }),
    discover: async () => {
      const result = await native.refresh();
      return { changed: result.changed, diagnostics: result.diagnostics };
    },
  });
}
