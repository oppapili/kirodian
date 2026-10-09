import '@/providers';

import { ClaudianSettingTab } from '@/features/settings/ClaudianSettings';

describe('ClaudianSettingTab model option updates', () => {
  it('refreshes provider-scoped chat selectors and the live title model menu together', () => {
    const refreshModelSelector = jest.fn();
    const notifyProviderChatOptionsChanged = jest.fn();
    const plugin = {
      getAllViews: jest.fn(() => [{ refreshModelSelector }]),
      notifyProviderChatOptionsChanged,
      notifyAgentSkillsChanged: jest.fn(),
      storage: {
        getAdapter: jest.fn(() => ({})),
      },
    };
    const tab = new ClaudianSettingTab({} as any, {} as any, plugin as any);
    const refreshTitleModelOptions = jest.fn();
    (tab as any).refreshTitleModelOptions = refreshTitleModelOptions;

    (tab as any).notifyProviderModelOptionsChanged('kiro');

    expect(notifyProviderChatOptionsChanged).toHaveBeenCalledWith('kiro');
    expect(refreshModelSelector).not.toHaveBeenCalled();
    expect(refreshTitleModelOptions).toHaveBeenCalledTimes(1);
  });

  it('invalidates provider executions when prompt settings change', async () => {
    const runProviderExecutionTransition = jest.fn(async (
      _providerIds: string[],
      mutation: () => Promise<void>,
    ) => mutation());
    const plugin = {
      providerHost: { runProviderExecutionTransition },
      settings: {},
      storage: {
        getAdapter: jest.fn(() => ({})),
      },
    };
    const tab = new ClaudianSettingTab({} as any, {} as any, plugin as any);

    await (tab as any).restartServiceForPromptChange();

    expect(runProviderExecutionTransition).toHaveBeenCalledWith(
      expect.arrayContaining(['claude', 'kiro']),
      expect.any(Function),
    );
  });
});

describe('ClaudianSettingTab agent-skill coordinator selection', () => {
  function makeTab() {
    const plugin = {
      notifyAgentSkillsChanged: jest.fn(),
      storage: { getAdapter: jest.fn(() => ({})) },
    };
    return new ClaudianSettingTab({} as any, plugin as any);
  }

  it('reuses one coordinator per skills root', () => {
    const tab = makeTab() as any;
    const first = tab.getAgentSkillCoordinator('.agents/skills');
    const second = tab.getAgentSkillCoordinator('.agents/skills');
    expect(second).toBe(first);
  });

  it('gives the Kiro root a distinct coordinator from the shared default root', () => {
    const tab = makeTab() as any;
    const shared = tab.getAgentSkillCoordinator('.agents/skills');
    const kiro = tab.getAgentSkillCoordinator('.kiro/skills');
    expect(kiro).not.toBe(shared);
    // Each root is still cached independently.
    expect(tab.getAgentSkillCoordinator('.kiro/skills')).toBe(kiro);
  });
});
