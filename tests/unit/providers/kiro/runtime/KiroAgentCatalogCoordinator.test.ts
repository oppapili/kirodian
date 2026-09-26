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
  updateCurrentKiroAgentCatalog,
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

  describe('TTL staleness (ensureFresh)', () => {
    it('serves the cached catalog without re-discovering while it is fresh', async () => {
      const host = makeHost();
      const service = makeService({
        agents: [makeAgent('kiro_default')],
        currentAgentId: 'kiro_default',
        fingerprint: 'fp-1',
        kind: 'completed',
      });
      const coordinator = new KiroAgentCatalogCoordinator(host, service);

      // First ensureFresh discovers and persists (nothing cached yet, so stale).
      await coordinator.ensureFresh('settings');
      expect(service.discoverCatalog).toHaveBeenCalledTimes(1);

      // The catalog was just refreshed and is within the TTL, so the second call
      // must reuse the cache instead of spawning discovery again.
      const second = await coordinator.ensureFresh('settings');
      expect(service.discoverCatalog).toHaveBeenCalledTimes(1);
      expect(second.kind).toBe('completed');
      expect(second.changed).toBe(false);
    });

    it('forces a refresh even when the cached catalog is fresh', async () => {
      const host = makeHost();
      const service = makeService({
        agents: [makeAgent('kiro_default')],
        currentAgentId: 'kiro_default',
        fingerprint: 'fp-1',
        kind: 'completed',
      });
      const coordinator = new KiroAgentCatalogCoordinator(host, service);

      await coordinator.ensureFresh('settings');
      expect(service.discoverCatalog).toHaveBeenCalledTimes(1);

      await coordinator.ensureFresh('manual', { force: true });
      expect(service.discoverCatalog).toHaveBeenCalledTimes(2);
    });

    it('treats a cached catalog older than the TTL as stale and re-discovers', async () => {
      const host = makeHost();
      const service = makeService({
        agents: [makeAgent('kiro_default')],
        currentAgentId: 'kiro_default',
        fingerprint: 'fp-1',
        kind: 'completed',
      });
      const coordinator = new KiroAgentCatalogCoordinator(host, service);

      await coordinator.ensureFresh('settings');
      expect(service.discoverCatalog).toHaveBeenCalledTimes(1);

      // Age the persisted catalog beyond the 5 minute TTL. `getCurrentKiroAgentCatalog`
      // returns a derived value, so re-persist an aged snapshot to make the cache stale.
      const cached = getCurrentKiroAgentCatalog(host.settings);
      expect(cached).not.toBeNull();
      updateCurrentKiroAgentCatalog(host.settings, {
        ...cached!,
        refreshedAt: Date.now() - (6 * 60 * 1000),
      });

      await coordinator.ensureFresh('settings');
      expect(service.discoverCatalog).toHaveBeenCalledTimes(2);
    });
  });

  describe('environment-transition fencing', () => {
    it('defers a non-owner refresh until the transition ends', async () => {
      const host = makeHost();
      const service = makeService({
        agents: [makeAgent('kiro_default')],
        currentAgentId: 'kiro_default',
        fingerprint: 'fp-1',
        kind: 'completed',
      });
      const coordinator = new KiroAgentCatalogCoordinator(host, service);

      coordinator.beginEnvironmentTransition();
      let settled = false;
      const pending = coordinator.refresh().then((result) => {
        settled = true;
        return result;
      });

      // While the transition is active the non-owner refresh must not run.
      await Promise.resolve();
      expect(service.discoverCatalog).not.toHaveBeenCalled();
      expect(settled).toBe(false);

      coordinator.endEnvironmentTransition();
      const result = await pending;
      expect(settled).toBe(true);
      expect(service.discoverCatalog).toHaveBeenCalledTimes(1);
      expect(result.kind).toBe('completed');
    });

    it('lets the transition owner refresh while a transition is active', async () => {
      const host = makeHost();
      const service = makeService({
        agents: [makeAgent('kiro_default')],
        currentAgentId: 'kiro_default',
        fingerprint: 'fp-1',
        kind: 'completed',
      });
      const coordinator = new KiroAgentCatalogCoordinator(host, service);

      coordinator.beginEnvironmentTransition();
      const result = await coordinator.refresh({ providerTransitionOwner: true });

      expect(result.kind).toBe('completed');
      expect(service.discoverCatalog).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancellation', () => {
    it('resets state and drops the in-flight refresh when quiescing for an environment change', async () => {
      const host = makeHost();
      let resolveDiscovery: (value: KiroAgentCatalogDiscoveryResult) => void = () => undefined;
      const service: KiroAgentCatalogServiceLike = {
        discoverCatalog: jest.fn(
          () => new Promise<KiroAgentCatalogDiscoveryResult>((resolve) => {
            resolveDiscovery = resolve;
          }),
        ),
      };
      const coordinator = new KiroAgentCatalogCoordinator(host, service);

      const pending = coordinator.refresh();
      await Promise.resolve();
      expect(coordinator.getState()).toBe('refreshing');

      const quiesced = coordinator.quiesceForEnvironmentChange();
      // Let the in-flight discovery settle so quiesce can complete.
      resolveDiscovery({
        agents: [makeAgent('kiro_default')],
        currentAgentId: 'kiro_default',
        fingerprint: 'fp-1',
        kind: 'completed',
      });
      await quiesced;
      const result = await pending;

      // The refresh was superseded (generation bumped), so it must not persist.
      expect(coordinator.getState()).toBe('idle');
      expect(result.kind).toBe('skipped');
      expect(getCurrentKiroAgentCatalog(host.settings)).toBeNull();
      expect(host.notifyProviderChatOptionsChanged).not.toHaveBeenCalled();
    });

    it('returns skipped results after dispose', async () => {
      const host = makeHost();
      const service = makeService({
        agents: [makeAgent('kiro_default')],
        currentAgentId: 'kiro_default',
        fingerprint: 'fp-1',
        kind: 'completed',
      });
      const coordinator = new KiroAgentCatalogCoordinator(host, service);

      coordinator.dispose();
      const result = await coordinator.ensureFresh('settings');

      expect(result.kind).toBe('skipped');
      expect(service.discoverCatalog).not.toHaveBeenCalled();
    });
  });
});
