import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { ClaudianSettingTab } from '@/features/settings/ClaudianSettings';
import ClaudianPlugin from '@/main';

describe('agent skill host invalidation', () => {
  afterEach(() => {
    ProviderWorkspaceRegistry.setServices('codex', undefined);
  });

  it('publishes the new generation synchronously before Codex refresh settles', async () => {
    let finishRefresh!: () => void;
    const refresh = jest.fn().mockReturnValue(new Promise<void>(resolve => {
      finishRefresh = resolve;
    }));
    ProviderWorkspaceRegistry.setServices('codex', {
      commandCatalog: { refresh } as any,
    });
    const invalidateProviderResources = jest.fn();
    const plugin = {
      agentSkillResourceGeneration: 0,
      getAllViews: jest.fn().mockReturnValue([{ invalidateProviderResources }]),
    };

    const pending = ClaudianPlugin.prototype.notifyAgentSkillsChanged.call(plugin as any);

    expect(plugin.agentSkillResourceGeneration).toBe(1);
    expect(invalidateProviderResources).toHaveBeenCalledWith(
      ['codex', 'grok', 'pi', 'opencode'],
      1,
    );
    expect(refresh).toHaveBeenCalledTimes(1);

    finishRefresh();
    await expect(pending).resolves.toBeUndefined();
  });

  it('lazily constructs one coordinator per skills root on demand', () => {
    const adapter = {};
    const getAdapter = jest.fn().mockReturnValue(adapter);
    const plugin = {
      storage: { getAdapter },
      notifyAgentSkillsChanged: jest.fn(),
    };

    const tab = new ClaudianSettingTab({} as any, plugin as any) as any;

    // No coordinator (and no adapter fetch) until a provider tab asks for one.
    expect(getAdapter).not.toHaveBeenCalled();

    const shared = tab.getAgentSkillCoordinator('.agents/skills');
    expect(shared).toBeDefined();
    expect(getAdapter).toHaveBeenCalledTimes(1);

    // Same root reuses the cached coordinator without a second adapter fetch.
    expect(tab.getAgentSkillCoordinator('.agents/skills')).toBe(shared);
    expect(getAdapter).toHaveBeenCalledTimes(1);

    // A different root (Kiro's `.kiro/skills`) gets its own coordinator.
    const kiro = tab.getAgentSkillCoordinator('.kiro/skills');
    expect(kiro).not.toBe(shared);
    expect(getAdapter).toHaveBeenCalledTimes(2);
  });
});
