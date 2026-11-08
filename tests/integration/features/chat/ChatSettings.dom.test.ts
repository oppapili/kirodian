/** @vitest-environment jsdom */
import '@/providers';

import { deserialize, serialize } from 'node:v8';

import { installSessionRuntimePool } from '@test/helpers/features/chat/SessionRuntimePoolHarness';
import { createHarness, releaseSideChatHarnesses } from '@test/helpers/features/chat/SideChatDOMHarness';
import { FakeSideSession } from '@test/helpers/features/chat/SideChatSessionHarness';
import { modelCatalogCases } from '@test/helpers/providerModelCatalogs';
import { fireEvent, waitFor, within } from '@testing-library/dom';
import { App, Component } from 'obsidian';

import { ChatModelSelectionCoordinator } from '@/app/settings/ChatModelSelectionCoordinator';
import { DEFAULT_CLAUDIAN_SETTINGS } from '@/app/settings/defaultSettings';
import { SettingsCoordinator } from '@/app/settings/SettingsCoordinator';
import { ProviderExecutionLifecycleRegistry } from '@/core/execution';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { formatReasoningValueLabel } from '@/core/providers/reasoning';
import type { ProviderId } from '@/core/providers/types';
import type { ClaudianSettings, Conversation } from '@/core/types';
import type { ChatFeatureHost } from '@/features/chat/ChatFeatureHost';
import { getChatSettingsSnapshot } from '@/features/chat/ChatSettings';
import { updateSessionProviderSettings } from '@/features/chat/sessions/sessionSettings';
import { destroyTab } from '@/features/chat/tabs/TabLifecycle';
import { refreshTabProviderUI } from '@/features/chat/tabs/tabProviderUI';
import { createTabRuntime } from '@/features/chat/tabs/TabRuntimeFactory';
import type { AssembledTabRuntime } from '@/features/chat/tabs/types';
import { updateCurrentKiroCatalog } from '@/providers/kiro/settings';
import { VaultMentionDataProvider } from '@/shared/mention/VaultMentionDataProvider';

const originalResizeObserver = globalThis.ResizeObserver;
const originalStructuredClone = globalThis.structuredClone;
beforeEach(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.structuredClone = value => deserialize(serialize(value));
});
afterEach(async () => {
  globalThis.ResizeObserver = originalResizeObserver;
  globalThis.structuredClone = originalStructuredClone;
  ProviderWorkspaceRegistry.clear();
  vi.restoreAllMocks();
  await releaseSideChatHarnesses();
});

function createSettings({ id, populate }: typeof modelCatalogCases[number], advertisesHigh = true): ClaudianSettings {
  const settings = JSON.parse(JSON.stringify(DEFAULT_CLAUDIAN_SETTINGS)) as typeof DEFAULT_CLAUDIAN_SETTINGS;
  populate(settings);
  const levels = advertisesHigh ? ['low', 'medium', 'high'] : ['low', 'medium'];
  if (id === 'kiro') {
    // Advertise the selected model's reasoning efforts through the kiro catalog.
    updateCurrentKiroCatalog(settings, {
      defaultModelId: null,
      fingerprint: 'test-fingerprint',
      refreshedAt: 0,
      models: [
        {
          rawId: 'sonnet',
          displayName: 'Selected label',
          description: 'Selected metadata',
          reasoningEfforts: levels.map(value => ({ label: value, value })),
          supportsReasoning: true,
        },
        {
          rawId: 'unselected-catalog-entry',
          displayName: 'Unselected',
          description: '',
          reasoningEfforts: [],
          supportsReasoning: false,
        },
      ],
    });
  }
  settings.savedProviderModel = { [id]: 'old-model' };
  settings.savedProviderEffort = { [id]: 'high' };
  return settings;
}

function createChatHarness(settings: ClaudianSettings, id: ProviderId, selected: string) {
  const harness = createHarness({ settings });
  ProviderWorkspaceRegistry.setServices(id, {});
  const app = new App();
  Object.assign(app.vault.adapter, { basePath: '/vault' });
  Object.assign(app.vault, { on: () => ({}), offref: () => undefined });
  // A blank draft tab resets its auto-linked content from the active file on model creation.
  Object.assign(app.workspace, { getActiveFile: () => null });
  const conversations: Conversation[] = [];
  const tabs: AssembledTabRuntime[] = [];
  const sessions: FakeSideSession[] = [];
  const persist = vi.fn(async () => undefined);
  const settingsCoordinator = new SettingsCoordinator(settings, persist);
  vi.spyOn(ProviderRegistry, 'createExecutionBackend').mockImplementation((_host, providerId = 'kiro') => ({
    providerId,
    createSession: config => {
      const session = new FakeSideSession(config);
      Object.defineProperty(session, 'providerId', { value: providerId });
      sessions.push(session);
      return session;
    },
  }));
  const plugin = {
    ...(harness.plugin as ChatFeatureHost), app, settings,
    chatModelSelection: new ChatModelSelectionCoordinator(settingsCoordinator),
    providerHost: { executionLifecycleRegistry: new ProviderExecutionLifecycleRegistry() },
    executionPersistence: {
      registerExecutionBinding: () => undefined,
      releaseExecutionBinding: () => undefined,
      persistExecutionSnapshot: async () => true,
      assertConversationExecutionAuthority: async () => undefined,
      recordConversationActivity: async () => undefined,
    },
    getActiveEnvironmentVariables: () => '',
    getConversationSummary(id: string) { return (this as unknown as { getConversationSync: (id: string) => any }).getConversationSync(id); },
    getConversationSync: (conversationId: string) => conversations.find(entry => entry.id === conversationId),
    getConversationById: async (conversationId: string) => conversations.find(entry => entry.id === conversationId),
    getConversationList: () => conversations,
    updateConversation: async (conversationId: string, patch: Partial<Conversation>) =>
      Object.assign(conversations.find(entry => entry.id === conversationId)!, patch),
    mutateSettings: settingsCoordinator.mutate.bind(settingsCoordinator),
    getCommittedSettings: settingsCoordinator.getCommittedSettings.bind(settingsCoordinator),
  } as unknown as ChatFeatureHost;
  // The merged tab factory acquires a real session runtime from the plugin's pool;
  // a blank tab stays a draft so selectDraft can retarget its provider.
  const createTab = async (blank = false, existingId?: string) => {
    const conversation = conversations.find(entry => entry.id === existingId) ?? {
      id: `conversation-${conversations.length}`, providerId: id, selectedModel: selected,
      messages: [...harness.tab.state.messages], sessionId: `session-${conversations.length}`,
    } as unknown as Conversation;
    if (!blank && !existingId) conversations.push(conversation);
    if (!plugin.sessionRuntimes) installSessionRuntimePool(plugin);
    const tab = await createTabRuntime({
      plugin,
      component: Object.assign(new Component(), { registerDomEvent: () => undefined, registerEvent: () => undefined }) as never,
      containerEl: document.body.appendChild(document.createElement('div')),
      mentionDataProvider: new VaultMentionDataProvider(plugin.app),
      conversation: blank ? undefined : conversation, providerId: id, draftModel: selected,
      getProviderCatalogConfig: () => null, isRuntimeLive: () => true,
      openConversation: async () => {}, startNewConversation: async () => {},
    });
    if (!blank) {
      tab.state.currentConversationId = conversation.id;
      tab.state.messages = conversation.messages;
    }
    tabs.push(tab);
    return tab;
  };
  return { createTab, tabs, sessions, persist, plugin };
}

function reasoningList(tab: AssembledTabRuntime): HTMLElement | null {
  // The levels live in the model popover, which stays closed in these tests.
  return within(tab.dom.inputComposerEl).queryByRole('listbox', { name: 'Thinking', hidden: true });
}

function reasoningLevels(tab: AssembledTabRuntime): HTMLElement[] {
  return within(reasoningList(tab)!).getAllByRole('option', { hidden: true });
}

function levelLabel(level: HTMLElement): string {
  return level.querySelector('.claudian-toolbar-popover-option-label')?.textContent ?? '';
}

/** Picks the level named `label`, which commits it. */
function chooseReasoning(tab: AssembledTabRuntime, label: string): void {
  const level = reasoningLevels(tab).find(item => levelLabel(item) === label);
  expect(level).toBeDefined();
  fireEvent.click(level!);
}

async function selectReasoning(tab: AssembledTabRuntime, reasoning: string) {
  const ui = within(tab.dom.inputComposerEl);
  const label = formatReasoningValueLabel(reasoning);
  chooseReasoning(tab, label);
  await waitFor(() => expect(ui.getByText(label, { selector: '.claudian-thinking-current' })).toBeDefined());
  // Let the commit settle even when the level was already selected.
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(reasoningLevels(tab).filter(level => level.getAttribute('aria-selected') === 'true').map(levelLabel)).toEqual([label]);
}

async function expectSubmission(
  tab: AssembledTabRuntime,
  sessions: FakeSideSession[],
  model: string,
  reasoning: string,
) {
  const ui = within(tab.dom.inputComposerEl);
  const label = formatReasoningValueLabel(reasoning);
  expect(ui.getByText(label, { selector: '.claudian-thinking-current' })).toBeDefined();
  const text = `Send ${tab.state.messages.length} with ${reasoning}`;
  (ui.getByRole('textbox') as HTMLTextAreaElement).value = text;
  const previousRequests = new Set(sessions.flatMap(session => session.requests));
  const pending = tab.controllers.inputController.sendMessage();
  const findSession = () => sessions.find(session => {
    const request = session.requests.at(-1);
    return request && !previousRequests.has(request)
      && request.input.some(part => part.type === 'text' && part.text === text);
  });
  await waitFor(() => expect(findSession()).toBeDefined());
  const session = findSession()!;
  try {
    expect(session.requests.at(-1)?.configuration).toMatchObject({ model, reasoning });
  } finally {
    session.complete();
    await pending;
  }
  expect(ui.getByText(label, { selector: '.claudian-thinking-current' })).toBeDefined();
}

it.each(modelCatalogCases.flatMap(entry => [true, false].map(advertisesHigh => ({ ...entry, advertisesHigh }))))(
  '$id displays and submits the same settings (native High advertised: $advertisesHigh)', async (entry) => {
    const { id, selected, advertisesHigh } = entry;
    const settings = createSettings(entry, advertisesHigh);
    const { createTab, sessions, tabs } = createChatHarness(settings, id, selected);
    try {
      const tab = await createTab();
      expect(getChatSettingsSnapshot(settings, id, selected).reasoning).toBe('high');
      expect(settings).not.toHaveProperty('reasoning');
      const permissionButton = within(tab.dom.inputComposerEl).queryByRole('button', { name: /^Permission mode:/ });
      expect(permissionButton).not.toBeNull();
      for (const reasoning of ['high', 'low']) {
        if (reasoning !== 'high') await selectReasoning(tab, reasoning);
        await expectSubmission(tab, sessions, getChatSettingsSnapshot(settings, id, selected).model, reasoning);
        expect(settings).not.toHaveProperty('reasoning');
      }
    } finally {
      for (const tab of tabs) await destroyTab(tab);
    }
  },
);

it.each(modelCatalogCases)('$id keeps displayed and submitted reasoning independent across tabs', async (entry) => {
  const { id, selected } = entry;
  const settings = createSettings(entry);
  const { createTab, sessions, tabs } = createChatHarness(settings, id, selected);
  const model = getChatSettingsSnapshot(settings, id, selected).model;
  const otherReasoning = 'low';
  try {
    const tabA = await createTab();
    const tabB = await createTab();
    await selectReasoning(tabA, 'high');
    await selectReasoning(tabB, otherReasoning);
    expect(within(tabA.dom.inputComposerEl).getByText('High', { selector: '.claudian-thinking-current' })).toBeDefined();
    await expectSubmission(tabA, sessions, model, 'high');
    await expectSubmission(tabB, sessions, model, otherReasoning);
    const tabC = await createTab();
    await expectSubmission(tabC, sessions, model, otherReasoning);
    await selectReasoning(tabA, 'high');
    // Ordinary refreshes must not replace a tab's selection with the future-tab seed.
    refreshTabProviderUI(tabB);
    refreshTabProviderUI(tabC);
    await expectSubmission(tabA, sessions, model, 'high');
    await expectSubmission(tabB, sessions, model, otherReasoning);
    await expectSubmission(tabC, sessions, model, otherReasoning);
  } finally {
    for (const tab of tabs) await destroyTab(tab);
  }
});

test.each(['provider switch', 'switch back', 'closing'] as const)('queued toolbar changes cannot survive %s', async transition => {
  const entry = modelCatalogCases.find(entry => entry.id === 'kiro')!;
  const settings = createSettings(entry);
  const { plugin, createTab } = createChatHarness(settings, entry.id, entry.selected);
  const tab = await createTab(true);
  tab.session.selectDraft(entry.id, entry.selected);
  try {
    let release!: () => void;
    const blocker = plugin.mutateSettings(() => new Promise<void>(resolve => { release = resolve; }));
    await Promise.resolve();
    const before = structuredClone(settings);
    // Queue a real permission-mode change ('yolo' differs from kiro's 'normal' default),
    // held behind the in-flight settings mutation.
    const pending = updateSessionProviderSettings(tab.session.runtime, plugin, snapshot => { snapshot.permissionMode = 'yolo'; });
    if (transition === 'closing') tab.session.beginClose();
    else {
      // Kirodian registers only kiro, so a draft "switch" retargets the model within kiro.
      tab.session.selectDraft('kiro', 'kiro/unselected-catalog-entry');
      if (transition === 'switch back') tab.session.selectDraft(entry.id, entry.selected);
    }
    release();
    await Promise.all([blocker, pending]);
    // The queued change survives only when it commits before the tab closes. On closing it
    // reaches both the session selection and committed settings as kiro's 'yolo'. A provider
    // switch (or switch back) discards it: the session selection falls back to kiro's resolved
    // default ('normal') and committed settings keep their untouched pre-queue mode.
    expect(tab.session.runtime.providerSelections.get(entry.id)?.permissionMode)
      .toBe(transition === 'closing' ? 'yolo' : 'normal');
    expect(settings.permissionMode).toBe(transition === 'closing' ? 'yolo' : before.permissionMode);
  } finally { await destroyTab(tab); }
});
