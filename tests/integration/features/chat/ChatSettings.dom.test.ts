/** @jest-environment jsdom */
import '@/providers';

import { deserialize, serialize } from 'node:v8';

import { createHarness, releaseSideChatHarnesses } from '@test/helpers/features/chat/SideChatDOMHarness';
import { FakeSideSession } from '@test/helpers/features/chat/SideChatSessionHarness';
import { modelCatalogCases } from '@test/helpers/providerModelCatalogs';
import { fireEvent, waitFor, within } from '@testing-library/dom';
import { App, Component } from 'obsidian';

import { ChatModelSelectionCoordinator } from '@/app/settings/ChatModelSelectionCoordinator';
import { DEFAULT_CLAUDIAN_SETTINGS } from '@/app/settings/defaultSettings';
import { SettingsCoordinator } from '@/app/settings/SettingsCoordinator';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { formatReasoningValueLabel } from '@/core/providers/reasoning';
import type { ProviderId } from '@/core/providers/types';
import type { ClaudianSettings, Conversation } from '@/core/types';
import type { ChatFeatureHost } from '@/features/chat/ChatFeatureHost';
import { getChatSettingsSnapshot } from '@/features/chat/ChatSettings';
import { destroyTab } from '@/features/chat/tabs/TabLifecycle';
import { updateTabProviderSettings } from '@/features/chat/tabs/tabProviderSettings';
import { refreshTabProviderUI } from '@/features/chat/tabs/tabProviderUI';
import { createTabRuntime } from '@/features/chat/tabs/TabRuntimeFactory';
import type { AssembledTabRuntime } from '@/features/chat/tabs/types';
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
  jest.restoreAllMocks();
  await releaseSideChatHarnesses();
});

function createSettings({ id, populate }: typeof modelCatalogCases[number], advertisesHigh = true): ClaudianSettings {
  const settings = JSON.parse(JSON.stringify(DEFAULT_CLAUDIAN_SETTINGS)) as typeof DEFAULT_CLAUDIAN_SETTINGS;
  populate(settings);
  const config = settings.providerConfigs[id]!;
  const levels = advertisesHigh ? ['low', 'medium', 'high'] : ['low', 'medium'];
  if (id === 'claude') (config.discoveredModels as Array<Record<string, unknown>>)[0].supportedEffortLevels = levels;
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
  const conversations: Conversation[] = [];
  const tabs: AssembledTabRuntime[] = [];
  const sessions: FakeSideSession[] = [];
  const persist = jest.fn(async () => undefined);
  const settingsCoordinator = new SettingsCoordinator(settings, persist);
  jest.spyOn(ProviderRegistry, 'createExecutionBackend').mockImplementation((_host, providerId = 'claude') => ({
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
  const createTab = async () => {
    const conversation = {
      id: `conversation-${conversations.length}`, providerId: id, selectedModel: selected,
      messages: [...harness.tab.state.messages], sessionId: `session-${conversations.length}`,
    } as unknown as Conversation;
    conversations.push(conversation);
    const tab = await createTabRuntime({
      plugin,
      component: Object.assign(new Component(), { registerDomEvent: () => undefined, registerEvent: () => undefined }) as never,
      containerEl: document.body.appendChild(document.createElement('div')),
      mentionDataProvider: new VaultMentionDataProvider(plugin.app),
      conversation, getProviderCatalogConfig: () => null, isRuntimeLive: () => true,
    });
    tab.state.currentConversationId = conversation.id;
    tab.state.messages = conversation.messages;
    tabs.push(tab);
    return tab;
  };
  return { createTab, tabs, sessions, persist, plugin };
}

function reasoningSlider(tab: AssembledTabRuntime): HTMLInputElement {
  // The slider lives in the model popover, which stays closed in these tests.
  return within(tab.dom.inputComposerEl).getByRole('slider', { hidden: true }) as HTMLInputElement;
}

/** The labels the slider announces at each stop, read the way assistive technology hears them. */
function reasoningStops(tab: AssembledTabRuntime): string[] {
  const slider = reasoningSlider(tab);
  const original = slider.value;
  const labels: string[] = [];
  for (let index = Number(slider.min); index <= Number(slider.max); index++) {
    fireEvent.input(slider, { target: { value: String(index) } });
    labels.push(slider.getAttribute('aria-valuetext') ?? '');
  }
  fireEvent.input(slider, { target: { value: original } });
  return labels;
}

/** Moves the slider to the stop announcing `label` and releases it, which commits that level. */
function chooseReasoning(tab: AssembledTabRuntime, label: string): void {
  const index = reasoningStops(tab).indexOf(label);
  expect(index).toBeGreaterThanOrEqual(0);
  const slider = reasoningSlider(tab);
  fireEvent.input(slider, { target: { value: String(index) } });
  fireEvent.change(slider);
}

async function selectReasoning(tab: AssembledTabRuntime, reasoning: string) {
  const ui = within(tab.dom.inputComposerEl);
  const label = formatReasoningValueLabel(reasoning);
  chooseReasoning(tab, label);
  await waitFor(() => expect(ui.getByText(label, { selector: '.claudian-thinking-current' })).toBeDefined());
  // Let the commit settle even when the level was already selected.
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(reasoningSlider(tab).getAttribute('aria-valuetext')).toBe(label);
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
  const entry = modelCatalogCases.find(entry => entry.id === 'claude')!;
  const settings = createSettings(entry);
  const { plugin, createTab } = createChatHarness(settings, entry.id, entry.selected);
  const tab = await createTab();
  tab.session.startDraft(entry.id, entry.selected);
  try {
    let release!: () => void;
    const blocker = plugin.mutateSettings(() => new Promise<void>(resolve => { release = resolve; }));
    await Promise.resolve();
    const before = structuredClone(settings);
    const pending = updateTabProviderSettings(tab, plugin, snapshot => { snapshot.permissionMode = 'normal'; });
    if (transition === 'closing') tab.session.beginClose();
    else {
      tab.session.selectDraft('kiro', 'kiro:claude-sonnet-4');
      if (transition === 'switch back') tab.session.selectDraft(entry.id, entry.selected);
    }
    release();
    await Promise.all([blocker, pending]);
    expect(settings).toEqual(before);
  } finally { await destroyTab(tab); }
});
