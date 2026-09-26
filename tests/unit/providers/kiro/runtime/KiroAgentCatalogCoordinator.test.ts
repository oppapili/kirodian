import type { ProviderHost } from '@/core/providers/ProviderHost';
import { KiroAgentCatalogCoordinator } from '@/providers/kiro/runtime/KiroAgentCatalogCoordinator';
import type {
  KiroAgentCatalogDiscoveryResult,
  KiroAgentCatalogServiceLike,
  KiroDiscoveredAgent,
} from '@/providers/kiro/runtime/KiroAgentCatalogService';
import {
  getCurrentKiroAgentModes,
  updateKiroProviderSettings,
} from '@/providers/kiro/settings';

/**
 * Minimal ProviderHost stub covering only the surface the coordinator touches: the
 * settings bag it reads/persists into, the conditional mutation used to persist the
 * prefetched modes, and the toolbar re-render notification. Nothing here drives a CLI
 * or the Obsidian app.
 *
 * NOTE ON SCOPE: main's `KiroAgentCatalogCoordinator` is intentionally the simple
 * variant — `refresh` (best-effort, in-flight de-duplicated), `getCachedAgentModes`,
 * and `dispose`. It has no TTL/`ensureFresh`, no `beginEnvironmentTransition` /
 * `quiesceForEnvironmentChange`, and no `getState`; environment-transition re-prefetch
 * is wired at the workspace-services layer via the execution-lifecycle transition hook
 * (covered in `KiroWorkspaceServices.test.ts`), not inside the coordinator. These tests
 * therefore exercise the branches this coordinator actually owns.
 */
function createTestHost(enabled: boolean): {
  host: ProviderHost;
  settings: Record<string, unknown>;
  notified: string[];
} {
  const settings: Record<string, unknown> = {};
  if (enabled) {
    updateKiroProviderSettings(settings, { enabled: true });
  }
  const notified: string[] = [];

  const host = {
    settings,
    async mutateSettingsConditionally(
      mutation: (settings: Record<string, unknown>) => boolean | Promise<boolean>,
    ): Promise<void> {
      await mutation(settings);
    },
    notifyProviderChatOptionsChanged(providerId: string): void {
      notified.push(providerId);
    },
  } as unknown as ProviderHost;

  return { host, settings, notified };
}

function agent(
  id: string,
  scope: KiroDiscoveredAgent['scope'] = 'built-in',
  isCurrent = false,
  description = '',
): KiroDiscoveredAgent {
  return { description, id, isCurrent, scope };
}

/** A controllable stub service: records calls and resolves discovery on demand. */
function createDeferredService(): KiroAgentCatalogServiceLike & {
  calls: number;
  resolve: (result: KiroAgentCatalogDiscoveryResult) => void;
} {
  let resolveNext: (result: KiroAgentCatalogDiscoveryResult) => void = () => undefined;
  const service = {
    calls: 0,
    discoverCatalog(): Promise<KiroAgentCatalogDiscoveryResult> {
      this.calls += 1;
      return new Promise<KiroAgentCatalogDiscoveryResult>((resolve) => {
        resolveNext = resolve;
      });
    },
    resolve(result: KiroAgentCatalogDiscoveryResult): void {
      resolveNext(result);
    },
  };
  return service as KiroAgentCatalogServiceLike & {
    calls: number;
    resolve: (result: KiroAgentCatalogDiscoveryResult) => void;
  };
}

/** A stub service that returns a fixed result immediately and counts calls. */
function createFixedService(
  result: KiroAgentCatalogDiscoveryResult,
): KiroAgentCatalogServiceLike & { calls: number } {
  return {
    calls: 0,
    async discoverCatalog(): Promise<KiroAgentCatalogDiscoveryResult> {
      (this as { calls: number }).calls += 1;
      return result;
    },
  } as KiroAgentCatalogServiceLike & { calls: number };
}

describe('KiroAgentCatalogCoordinator', () => {
  it('persists discovered modes host-scoped and notifies on change', async () => {
    const { host, settings, notified } = createTestHost(true);
    const coordinator = new KiroAgentCatalogCoordinator(
      host,
      createFixedService({
        agents: [
          agent('kiro_default', 'built-in', true, 'Default agent'),
          agent('taskmaster', 'global'),
        ],
        currentAgentId: 'kiro_default',
        kind: 'completed',
      }),
    );

    const result = await coordinator.refresh();

    expect(result).toEqual({ changed: true, kind: 'completed' });
    expect(getCurrentKiroAgentModes(settings)?.modes.map((mode) => mode.id)).toEqual([
      'kiro_default',
      'taskmaster',
    ]);
    expect(getCurrentKiroAgentModes(settings)?.currentModeId).toBe('kiro_default');
    expect(notified).toEqual(['kiro']);
  });

  it('reads back the persisted snapshot via getCachedAgentModes', async () => {
    const { host } = createTestHost(true);
    const coordinator = new KiroAgentCatalogCoordinator(
      host,
      createFixedService({
        agents: [agent('kiro_default', 'built-in', true, 'Default agent')],
        currentAgentId: 'kiro_default',
        kind: 'completed',
      }),
    );

    expect(coordinator.getCachedAgentModes()).toBeNull();
    await coordinator.refresh();
    expect(coordinator.getCachedAgentModes()?.modes.map((mode) => mode.id)).toEqual([
      'kiro_default',
    ]);
  });

  it('skips discovery entirely while the provider is disabled', async () => {
    const { host, settings, notified } = createTestHost(false);
    const service = createFixedService({
      agents: [agent('kiro_default')],
      currentAgentId: 'kiro_default',
      kind: 'completed',
    });
    const coordinator = new KiroAgentCatalogCoordinator(host, service);

    const result = await coordinator.refresh();

    expect(result).toEqual({ changed: false, kind: 'skipped' });
    expect(service.calls).toBe(0);
    expect(getCurrentKiroAgentModes(settings)).toBeNull();
    expect(notified).toEqual([]);
  });

  it('does not persist or notify when discovery yields no agents', async () => {
    const { host, settings, notified } = createTestHost(true);
    const coordinator = new KiroAgentCatalogCoordinator(
      host,
      createFixedService({ agents: [], currentAgentId: null, kind: 'completed' }),
    );

    const result = await coordinator.refresh();

    expect(result).toEqual({ changed: false, kind: 'completed' });
    expect(getCurrentKiroAgentModes(settings)).toBeNull();
    expect(notified).toEqual([]);
  });

  it('reports no change and does not re-notify when the snapshot is unchanged', async () => {
    const { host, notified } = createTestHost(true);
    const coordinator = new KiroAgentCatalogCoordinator(
      host,
      createFixedService({
        agents: [agent('kiro_default', 'built-in', true, 'Default agent')],
        currentAgentId: 'kiro_default',
        kind: 'completed',
      }),
    );

    await coordinator.refresh();
    const second = await coordinator.refresh();

    expect(second).toEqual({ changed: false, kind: 'completed' });
    // Notified exactly once — the first (changing) refresh only.
    expect(notified).toEqual(['kiro']);
  });

  it('de-duplicates concurrent refreshes into a single discovery run', async () => {
    const { host } = createTestHost(true);
    const service = createDeferredService();
    const coordinator = new KiroAgentCatalogCoordinator(host, service);

    const first = coordinator.refresh();
    const second = coordinator.refresh();
    // Both callers share the one in-flight promise while discovery is pending.
    expect(second).toBe(first);
    expect(service.calls).toBe(1);

    service.resolve({
      agents: [agent('kiro_default', 'built-in', true, 'Default agent')],
      currentAgentId: 'kiro_default',
      kind: 'completed',
    });
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual({ changed: true, kind: 'completed' });
    expect(b).toEqual(a);

    // The in-flight slot is released, so a later refresh spawns a fresh discovery.
    const third = coordinator.refresh();
    await Promise.resolve();
    expect(service.calls).toBe(2);
    service.resolve({
      agents: [agent('kiro_default', 'built-in', true, 'Default agent')],
      currentAgentId: 'kiro_default',
      kind: 'completed',
    });
    await third;
  });

  it('returns a skipped result immediately once disposed', async () => {
    const { host, settings } = createTestHost(true);
    const service = createFixedService({
      agents: [agent('kiro_default')],
      currentAgentId: 'kiro_default',
      kind: 'completed',
    });
    const coordinator = new KiroAgentCatalogCoordinator(host, service);

    coordinator.dispose();
    const result = await coordinator.refresh();

    expect(result).toEqual({ changed: false, kind: 'skipped' });
    expect(service.calls).toBe(0);
    expect(getCurrentKiroAgentModes(settings)).toBeNull();
  });

  it('does not persist a refresh that was disposed while its discovery was in flight', async () => {
    const { host, settings, notified } = createTestHost(true);
    const service = createDeferredService();
    const coordinator = new KiroAgentCatalogCoordinator(host, service);

    const pending = coordinator.refresh();
    await Promise.resolve();
    expect(service.calls).toBe(1);

    // Dispose after discovery started but before it resolved.
    coordinator.dispose();
    service.resolve({
      agents: [agent('kiro_default', 'built-in', true, 'Default agent')],
      currentAgentId: 'kiro_default',
      kind: 'completed',
    });
    const result = await pending;

    // The post-discovery disposed check fences the persist and the notify.
    expect(result.changed).toBe(false);
    expect(getCurrentKiroAgentModes(settings)).toBeNull();
    expect(notified).toEqual([]);
  });
});
