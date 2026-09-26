import { ProviderModelCatalogController } from '../../../core/providers/models/ProviderModelCatalog';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { getKiroProviderSettings, getOrderedKiroVisibleModelIds, updateKiroProviderSettings } from '../settings';
import type { KiroModelCatalogCoordinator } from './KiroModelCatalogCoordinator';

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
          id: model.rawId, name: model.displayName, description: model.description,
        })),
        selectedIds: getOrderedKiroVisibleModelIds(current),
        aliases: current.modelAliases,
      };
    },
    discover: async () => {
      const result = await native.refresh();
      return { changed: result.changed, ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}) };
    },
  });
}
