import '@/providers';

import { createTabSession } from '@test/helpers/ConversationPorts';

import type { ClaudianSettings, UsageInfo } from '@/core/types';
import type { ChatFeatureHost } from '@/features/chat/ChatFeatureHost';
import { refreshTabContextUsage } from '@/features/chat/tabs/tabProviderUI';
import type { AssembledTabRuntime } from '@/features/chat/tabs/types';

function createTab(model: string, customContextLimits: Record<string, number>, usageOverrides: Partial<UsageInfo> = {}) {
  const usage: UsageInfo = {
    model,
    inputTokens: 50_000,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    contextTokens: 50_000,
    contextWindow: 0,
    percentage: 0,
    ...usageOverrides,
  };
  const update = jest.fn();
  const tab = {
    conversationId: null,
    providerId: 'kiro',
    draftModel: model,
    state: { usage },
    ui: { contextUsageMeter: { update } },
  } as unknown as AssembledTabRuntime;
  Object.assign(tab, { session: createTabSession({ id: 'test', lifecycleState: 'open', conversationId: null, providerId: 'claude', draftModel: model }, {} as never) });
  const plugin = {
    getCommittedSettings: () => plugin.settings,
    settings: {
      model,
      customContextLimits,
      providerConfigs: { kiro: { enabled: true, discoveredModels: [], visibleModels: [] } },
    } as unknown as ClaudianSettings,
  } as ChatFeatureHost;
  return { tab, plugin, update };
}

describe('tab context usage projection', () => {
  it('uses an exact custom-limit key without interpreting retired aliases', () => {
    const { tab, plugin, update } = createTab('kiro-model-a', {
      'kiro-model-a': 100_000,
      'model-a': 500_000,
    });

    refreshTabContextUsage(tab, plugin);

    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ contextWindow: 100_000, percentage: 50 }));
  });

  it('uses a reported window even when custom limits belong to another model', () => {
    const { tab, plugin, update } = createTab('kiro-model-a', { 'model-a': 500_000 }, {
      contextWindow: 200_000,
    });

    refreshTabContextUsage(tab, plugin);

    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ contextWindow: 200_000, percentage: 25 }));
  });

  it.each([
    { model: 'kiro-model-a', reportedModel: 'model-a' },
    { model: 'kiro-sonnet', reportedModel: 'sonnet' },
  ])('keeps the report from $reportedModel when $model is selected', ({ model, reportedModel }) => {
    const { tab, plugin, update } = createTab(model, {}, {
      model: reportedModel,
      contextWindow: 200_000,
    });

    refreshTabContextUsage(tab, plugin);

    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ model: reportedModel, contextWindow: 200_000, percentage: 25 }));
  });
});
