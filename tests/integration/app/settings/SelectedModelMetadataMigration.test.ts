import '@/providers';

import { DEFAULT_CLAUDIAN_SETTINGS } from '@test/helpers/defaultSettings';
import { modelCatalogCases as cases } from '@test/helpers/providerModelCatalogs';

import { ClaudianSettingsStorage } from '@/app/settings/ClaudianSettingsStorage';
import { migrateSelectedModelMetadata } from '@/app/settings/SelectedModelMetadataMigration';
import { SettingsCoordinator } from '@/app/settings/SettingsCoordinator';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { updateKiroProviderSettings } from '@/providers/kiro/settings';

function makeHost() {
  const settings = structuredClone(DEFAULT_CLAUDIAN_SETTINGS);
  for (const id of ProviderRegistry.getRegisteredProviderIds()) ProviderRegistry.setEnabled(id, settings, false);
  let content = '';
  const storage = new ClaudianSettingsStorage({
    exists: async () => Boolean(content), read: async () => content,
    write: async (_path: string, value: string) => { content = value; }, delete: async () => undefined,
  } as unknown as VaultFileAdapter, DEFAULT_CLAUDIAN_SETTINGS);
  const coordinator = new SettingsCoordinator(settings, value => storage.save(value));
  const host = {
    settings, mutateSettings: coordinator.mutate.bind(coordinator),
    mutateSettingsConditionally: coordinator.mutateConditionally.bind(coordinator),
    notifyProviderChatOptionsChanged: vi.fn(),
  } as unknown as ProviderHost;
  return { host, storage, read: () => JSON.parse(content) };
}

beforeEach(() => {
  vi.spyOn(ProviderWorkspaceRegistry, 'ensureInitialized').mockResolvedValue();
});
afterEach(() => {
  for (const { id } of cases) ProviderWorkspaceRegistry.setServices(id, undefined);
  vi.restoreAllMocks();
});

// No provider currently requests reasoning-metadata backfill
// (needsReasoningMetadata is unimplemented after the claude removal), so the
// startup migration must not initialize any provider workspace.
it.each([
  { label: 'enabled providers with no selected models', enabled: true, selected: false },
  { label: 'enabled providers with selected models but no metadata gate', enabled: true, selected: true },
  { label: 'disabled providers', enabled: false, selected: true },
])('does not initialize $label', async ({ enabled, selected }) => {
  const { host } = makeHost();
  updateKiroProviderSettings(host.settings, {
    enabled, visibleModels: selected ? ['sonnet'] : [],
  });
  expect(ProviderRegistry.isEnabled('kiro', host.settings)).toBe(enabled);

  await migrateSelectedModelMetadata(host, new AbortController().signal);

  expect(ProviderWorkspaceRegistry.ensureInitialized).not.toHaveBeenCalled();
});

it('completes without error for a fully populated provider catalog', async () => {
  const { host } = makeHost();
  cases[0].populate(host.settings);
  const refresh = vi.fn();
  ProviderWorkspaceRegistry.setServices('kiro', { modelCatalog: { refresh } as any });

  await migrateSelectedModelMetadata(host, new AbortController().signal);

  // Without a metadata gate, startup never forces a discovery refresh.
  expect(refresh).not.toHaveBeenCalled();
});
