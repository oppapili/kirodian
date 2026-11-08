import '@/providers';

import { partialMock } from '@test/helpers/partialMock';
import type { App, Plugin } from 'obsidian';

import type { FeatureHost } from '@/features/FeatureHost';
import { ClaudianSettingTab } from '@/features/settings/ClaudianSettings';

function createSettingTab(host: object): ClaudianSettingTab {
  return new ClaudianSettingTab(partialMock<App>({}), partialMock<Plugin>({}), partialMock<FeatureHost>(host));
}

describe('ClaudianSettingTab model option updates', () => {
  it('refreshes provider-scoped chat selectors and the live title model menu together', () => {
    const refreshModelSelector = vi.fn();
    const notifyProviderChatOptionsChanged = vi.fn();
    const plugin = {
      getAllViews: vi.fn(() => [{ refreshModelSelector }]),
      notifyProviderChatOptionsChanged,
      notifyAgentSkillsChanged: vi.fn(),
      storage: {
        getAdapter: vi.fn(() => ({})),
      },
    };
    const tab = createSettingTab(plugin);
    const refreshTitleModelOptions = vi.fn();
    tab['refreshTitleModelOptions'] = refreshTitleModelOptions;

    tab['notifyProviderModelOptionsChanged']('kiro');

    expect(notifyProviderChatOptionsChanged).toHaveBeenCalledWith('kiro');
    expect(refreshModelSelector).not.toHaveBeenCalled();
    expect(refreshTitleModelOptions).toHaveBeenCalledTimes(1);
  });

  it('invalidates provider executions when prompt settings change', async () => {
    const runProviderExecutionTransition = vi.fn(async (
      _providerIds: string[],
      mutation: () => Promise<void>,
    ) => mutation());
    const plugin = {
      providerHost: { runProviderExecutionTransition },
      settings: {},
      storage: {
        getAdapter: vi.fn(() => ({})),
      },
    };
    const tab = createSettingTab(plugin);

    await tab['restartServiceForPromptChange']();

    expect(runProviderExecutionTransition).toHaveBeenCalledWith(
      expect.arrayContaining(['kiro']),
      expect.any(Function),
    );
  });
});

describe('ClaudianSettingTab agent-skill coordinator selection', () => {
  function makeTab() {
    const plugin = {
      notifyAgentSkillsChanged: vi.fn(),
      storage: { getAdapter: vi.fn(() => ({})) },
    };
    return createSettingTab(plugin);
  }

  it('reuses one coordinator per skills root', () => {
    const tab = makeTab();
    const first = tab['getAgentSkillCoordinator']('.agents/skills');
    const second = tab['getAgentSkillCoordinator']('.agents/skills');
    expect(second).toBe(first);
  });

  it('gives the Kiro root a distinct coordinator from the shared default root', () => {
    const tab = makeTab();
    const shared = tab['getAgentSkillCoordinator']('.agents/skills');
    const kiro = tab['getAgentSkillCoordinator']('.kiro/skills');
    expect(kiro).not.toBe(shared);
    // Each root is still cached independently.
    expect(tab['getAgentSkillCoordinator']('.kiro/skills')).toBe(kiro);
  });
});
