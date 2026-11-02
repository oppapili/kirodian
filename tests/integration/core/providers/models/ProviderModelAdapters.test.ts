import { modelCatalogCases } from '@test/helpers/providerModelCatalogs';

import { SettingsCoordinator } from '@/app/settings/SettingsCoordinator';
import type { ProviderModelCatalog } from '@/core/providers/models/ProviderModelCatalog';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import { createKiroModels } from '@/providers/kiro/runtime/KiroModels';

const browseOrders = {
  kiro: ['sonnet', 'unselected-catalog-entry'],
};

it.each(modelCatalogCases)('$id keeps native selection, aliases and metadata behind the common catalog', async ({id, populate, read}) => {
  const settings: Record<string, unknown> = {};
  populate(settings);
  const persist = jest.fn(async () => undefined);
  const coordinator = new SettingsCoordinator(settings, persist);
  const host = { settings, mutateSettings: coordinator.mutate.bind(coordinator), mutateSettingsConditionally: coordinator.mutateConditionally.bind(coordinator), notifyProviderChatOptionsChanged: jest.fn() } as unknown as ProviderHost;
  const discovery = jest.fn(async () => ({
    catalog: null,
    changed: false,
    kind: 'completed' as const,
    persistedSettingsChanged: false,
  }));
  const factories: Record<string, () => ProviderModelCatalog> = {
    kiro: () => createKiroModels(host, { refresh: discovery }),
  };
  const catalog = factories[id]();
  const discoveredModels = structuredClone(read(settings));
  expect(catalog.getSnapshot().models.map(model => model.id)).toEqual(browseOrders[id]);
  expect(read(settings)).toEqual(discoveredModels);
  const selectedId = catalog.getSnapshot().selectedIds[0];
  expect(catalog.getSnapshot().defaultModelId).toBe(selectedId);
  await catalog.refresh();
  const calls = discovery.mock.calls.length;
  catalog.markStale();
  await catalog.refresh();
  expect(discovery).toHaveBeenCalledTimes(calls);
  expect(catalog.getSnapshot()).toMatchObject({ stale: true, discoveredCount: 2, selectedIds: [selectedId] });
  await catalog.refresh({ force: true });
  expect(discovery).toHaveBeenCalledTimes(calls + 1);
  await catalog.setAlias(selectedId, 'My selected model');
  expect(catalog.getSnapshot().aliases[selectedId]).toBe('My selected model');
  await catalog.changeSelection({ type: 'clear' });
  expect(catalog.getSnapshot().selectedIds).toEqual([]);
  await catalog.changeSelection({ type: 'set', modelId: selectedId, selected: true });
  const before = structuredClone(settings);
  persist.mockRejectedValueOnce(new Error('disk full'));
  await expect(catalog.changeSelection({ type: 'clear' })).rejects.toThrow('disk full');
  expect(settings).toEqual(before);
  expect(catalog.getSnapshot().selectedIds).toEqual([selectedId]);
  await catalog.dispose();
});
