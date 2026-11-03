import {
  ProviderModelCatalogController,
  type ProviderModelCatalogStore,
} from '../../../core/providers/models/ProviderModelCatalog';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import {
  getKiroProviderSettings,
  getOrderedKiroVisibleModelIds,
  updateKiroProviderSettings,
} from '../settings';
import type { KiroModelCatalogCoordinator } from './KiroModelCatalogCoordinator';

/**
 * A model-catalog store over Kiro's own provider settings. Kiro keeps the
 * settings-document configuration model (it has not migrated to the
 * `config`/`selection` runtime-host contract), so this bridges that store shape
 * onto the host's settings mutation and change notifications.
 */
function createKiroCatalogStore(host: ProviderHost): ProviderModelCatalogStore {
  return {
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
    async write(change) {
      await host.mutateSettings(settings => {
        updateKiroProviderSettings(settings, change(this.read()));
      });
    },
    notifyChatOptionsChanged: () => host.notifyProviderChatOptionsChanged('kiro'),
  };
}

/**
 * Build the shared model-catalog controller for the Kiro provider. The
 * controller owns the common selection/alias/staleness policy while discovery,
 * native metadata, and persistence remain the coordinator's responsibility.
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
    providerName: 'Kiro',
    store: createKiroCatalogStore(host),
    discover: async () => {
      const result = await native.refresh();
      return { changed: result.changed, diagnostics: result.diagnostics };
    },
  });
}
