const mockGetHostnameKey = jest.fn(() => 'device:current');

jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => mockGetHostnameKey(),
}));

import type { ProviderHost } from '@/core/providers/ProviderHost';
import type { KiroDiscoveredAgent } from '@/providers/kiro/agents';
import { KiroAgentCatalogCoordinator } from '@/providers/kiro/runtime/KiroAgentCatalogCoordinator';
import type {
  KiroAgentCatalogDiscoveryResult,
  KiroAgentCatalogServiceLike,
} from '@/providers/kiro/runtime/KiroAgentCatalogService';
import {
  DEFAULT_KIRO_PROVIDER_SETTINGS,
  getCurrentKiroAgentCatalog,
} from '@/providers/kiro/settings';

function makeAgent(id: string, scope: KiroDiscoveredAgent['scope'] = 'built-in'): KiroDiscoveredAgent {
  return { id, scope };
}

function makeHost(options: { enabled?: boolean } = {}): ProviderHost {
  const { enabled = true } = options;
  const settings = {
    providerConfigs: {
      kiro: {
        ...DEFAULT_KIRO_PROVIDER_SETTINGS,
        enabled,
      },
    },
  } as unknown as Record<string, unknown>;

  return {
    app: {},
    mutateSettingsConditionally: jest.fn(async (mutation: (value: unknown) => boolean) => {
      mutation(settings);
    }),
    notifyProviderChatOptionsChanged: jest.fn(),
    settings,
  } as unknown as ProviderHost;
}

function makeService(
  result: KiroAgentCatalogDiscoveryResult,
): KiroAgentCatalogServiceLike {
  return {
    discoverCatalog: jest.fn(async () => result),
  };
}

describe('KiroAgentCatalogCoordinator', () => {
  it('persists discovered agents host-scoped and notifies on change', async () => {
    const host = makeHost();
    const coordinator = new KiroAgentCatalogCoordinator(
      host,
      makeService({
        agents: [makeAgent('kiro_default'), makeAgent('taskmaster', 'global')],
        currentAgentId: 'kiro_default',
        fingerprint: 'fp-1',
        kind: 'completed',
      }),
    );

    const result = await coordinator.refresh();

    expect(result.kind).toBe('completed');
    expect(result.changed).toBe(true);
    const persisted = getCurrentKiroAgentCatalog(host.settings);
    expect(persisted?.agents.map((agent) => agent.id)).toEqual([
      'kiro_default',
      'taskmaster',
    ]);
    expect(persisted?.currentAgentId).toBe('kiro_default');
    expect(host.notifyProviderChatOptionsChanged).toHaveBeenCalledWith('kiro');
  });

  it('skips discovery when the provider is disabled', async () => {
    const host = makeHost({ enabled: false });
    const service = makeService({ kind: 'skipped', reason: 'provider-disabled' });
    const coordinator = new KiroAgentCatalogCoordinator(host, service);

    const result = await coordinator.refresh();

    expect(result.kind).toBe('skipped');
    expect(service.discoverCatalog).not.toHaveBeenCalled();
    expect(getCurrentKiroAgentCatalog(host.settings)).toBeNull();
  });

  it('does not persist and keeps the selector hidden on empty output with diagnostics', async () => {
    const host = makeHost();
    const coordinator = new KiroAgentCatalogCoordinator(
      host,
      makeService({
        agents: [],
        currentAgentId: null,
        diagnostics: 'Kiro agent list could not be started',
        fingerprint: 'fp-empty',
        kind: 'completed',
      }),
    );

    const result = await coordinator.refresh();

    expect(result.diagnostics).toBe('Kiro agent list could not be started');
    expect(getCurrentKiroAgentCatalog(host.settings)).toBeNull();
    expect(host.notifyProviderChatOptionsChanged).not.toHaveBeenCalled();
  });

  it('reports no change when the discovered catalog matches the persisted one', async () => {
    const host = makeHost();
    const coordinator = new KiroAgentCatalogCoordinator(
      host,
      makeService({
        agents: [makeAgent('kiro_default')],
        currentAgentId: 'kiro_default',
        fingerprint: 'fp-1',
        kind: 'completed',
      }),
    );

    await coordinator.refresh();
    (host.notifyProviderChatOptionsChanged as jest.Mock).mockClear();
    const second = await coordinator.refresh();

    expect(second.changed).toBe(false);
    expect(host.notifyProviderChatOptionsChanged).not.toHaveBeenCalled();
  });
});
