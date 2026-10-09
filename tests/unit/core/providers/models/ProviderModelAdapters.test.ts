import { modelCatalogCases } from '@test/helpers/providerModelCatalogs';

import { SettingsCoordinator } from '@/app/settings/SettingsCoordinator';
import type { ProviderModelCatalog } from '@/core/providers/models/ProviderModelCatalog';
import { ProviderModelUnavailableError } from '@/core/providers/models/ProviderModelUnavailableError';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import { assertClaudeModelAvailable } from '@/providers/claude/runtime/ClaudeModelAvailability';
import { createClaudeModels } from '@/providers/claude/runtime/ClaudeModels';

const assertions = { claude: assertClaudeModelAvailable };

it.each(modelCatalogCases)('$id keeps native selection, aliases and metadata behind the common catalog', async ({id, selected, populate, read: _read}) => {
  const settings: Record<string, unknown> = {};
  populate(settings);
  const persist = jest.fn(async () => undefined);
  const coordinator = new SettingsCoordinator(settings, persist);
  const host = { settings, mutateSettings: coordinator.mutate.bind(coordinator), mutateSettingsConditionally: coordinator.mutateConditionally.bind(coordinator), notifyProviderChatOptionsChanged: jest.fn() } as unknown as ProviderHost;
  const discovery = jest.fn(async () => ({ changed: true, refreshed: true, kind: 'completed' as const, catalog: null, models: [], persistedSettingsChanged: false }));
  const factories: Record<string, () => ProviderModelCatalog> = {
    claude: () => createClaudeModels(host, { refresh: discovery }),
  };
  const catalog = factories[id]();
  const selectedId = catalog.getSnapshot().selectedIds[0];
  expect(() => assertions[id](settings, selected)).not.toThrow();
  await catalog.refresh();
  const discover = discovery;
  const calls = discover.mock.calls.length;
  catalog.markStale();
  await catalog.refresh();
  expect(discover).toHaveBeenCalledTimes(calls);
  expect(catalog.getSnapshot()).toMatchObject({ stale: true, discoveredCount: 2, selectedIds: [selectedId] });
  await catalog.refresh({ force: true });
  expect(discover).toHaveBeenCalledTimes(calls + 1);
  await catalog.setAliases({ [selectedId]: 'My selected model' });
  expect(catalog.getSnapshot().aliases[selectedId]).toBe('My selected model');
  await catalog.select([]);
  expect(catalog.getSnapshot().selectedIds).toEqual([]);
  expect(() => assertions[id](settings, selected)).toThrow(ProviderModelUnavailableError);
  await catalog.select([selectedId]);
  const before = structuredClone(settings);
  persist.mockRejectedValueOnce(new Error('disk full'));
  await expect(catalog.select([])).rejects.toThrow('disk full');
  expect(settings).toEqual(before);
  expect(catalog.getSnapshot().selectedIds).toEqual([selectedId]);
  await catalog.dispose();
});
