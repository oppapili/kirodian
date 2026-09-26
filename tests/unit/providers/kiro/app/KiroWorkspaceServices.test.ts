import type { ProviderHost } from '@/core/providers/ProviderHost';
import { createKiroWorkspaceServices } from '@/providers/kiro/app/KiroWorkspaceServices';
import type {
  KiroAgentCatalogDiscoveryResult,
  KiroAgentCatalogServiceLike,
} from '@/providers/kiro/runtime/KiroAgentCatalogService';
import {
  getCurrentKiroAgentModes,
  updateKiroProviderSettings,
} from '@/providers/kiro/settings';

/**
 * Minimal ProviderHost stub covering only the surface
 * `createKiroWorkspaceServices` touches during construction: the transition-hook
 * registry, the settings bag read by the agent coordinator, the conditional
 * settings mutation used to persist the prefetched modes, and the toolbar
 * re-render notification. Nothing here drives a CLI or the Obsidian app.
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
    executionLifecycleRegistry: {
      registerTransitionHook: () => () => {},
    },
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

/** A stub agent-catalog service that records each discovery call and returns a fixed result. */
function createSpyService(
  result: KiroAgentCatalogDiscoveryResult,
): KiroAgentCatalogServiceLike & { calls: number } {
  return {
    calls: 0,
    async discoverCatalog(): Promise<KiroAgentCatalogDiscoveryResult> {
      this.calls += 1;
      return result;
    },
  };
}

/** Wait for the microtask-scheduled best-effort prefetch to settle. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('createKiroWorkspaceServices startup agent prefetch', () => {
  it('refreshes the agent catalog once at construction and persists the discovered modes', async () => {
    const { host, settings, notified } = createTestHost(true);
    const service = createSpyService({
      kind: 'completed',
      currentAgentId: 'kiro_default',
      agents: [
        { id: 'kiro_default', isCurrent: true, scope: 'built-in', description: 'Default agent' },
        { id: 'kirocrew', isCurrent: false, scope: 'global', description: '' },
      ],
    });

    const services = await createKiroWorkspaceServices(host, {
      agentCatalogService: service,
    });
    await flushMicrotasks();

    // The startup seam invoked discovery without waiting for the settings tab or a prompt.
    expect(service.calls).toBe(1);
    // The modes were persisted host-scoped so the selector survives once fetched.
    expect(getCurrentKiroAgentModes(settings)?.modes.map((mode) => mode.id)).toEqual([
      'kiro_default',
      'kirocrew',
    ]);
    // The toolbar was told to re-render so the selector appears with no user action.
    expect(notified).toContain('kiro');

    await services.dispose();
  });

  it('leaves the catalog empty and hidden when the provider is disabled', async () => {
    const { host, settings, notified } = createTestHost(false);
    const service = createSpyService({
      kind: 'completed',
      currentAgentId: 'kiro_default',
      agents: [
        { id: 'kiro_default', isCurrent: true, scope: 'built-in', description: 'Default agent' },
      ],
    });

    const services = await createKiroWorkspaceServices(host, {
      agentCatalogService: service,
    });
    await flushMicrotasks();

    // A disabled provider short-circuits before discovery; the selector stays hidden.
    expect(service.calls).toBe(0);
    expect(getCurrentKiroAgentModes(settings)).toBeNull();
    expect(notified).not.toContain('kiro');

    await services.dispose();
  });

  it('does not persist or notify when discovery yields no agents', async () => {
    const { host, settings, notified } = createTestHost(true);
    const service = createSpyService({
      kind: 'completed',
      currentAgentId: null,
      agents: [],
    });

    const services = await createKiroWorkspaceServices(host, {
      agentCatalogService: service,
    });
    await flushMicrotasks();

    // Best-effort: an empty result leaves the persisted snapshot untouched and hidden.
    expect(service.calls).toBe(1);
    expect(getCurrentKiroAgentModes(settings)).toBeNull();
    expect(notified).not.toContain('kiro');

    await services.dispose();
  });
});
