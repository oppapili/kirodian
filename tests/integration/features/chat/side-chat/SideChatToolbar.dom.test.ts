/** @vitest-environment jsdom */
import '@/providers';

import { installSessionRuntimePool } from '@test/helpers/features/chat/SessionRuntimePoolHarness';
import { createHarness, releaseSideChatHarnesses, startSideChat } from '@test/helpers/features/chat/SideChatDOMHarness';
import { fireEvent, waitFor, within } from '@testing-library/dom';
import { App, Component } from 'obsidian';

import type { Conversation } from '@/core/types';
import type { ChatFeatureHost } from '@/features/chat/ChatFeatureHost';
import { destroyTab } from '@/features/chat/tabs/TabLifecycle';
import { createTabRuntime } from '@/features/chat/tabs/TabRuntimeFactory';
import { updateCurrentKiroCatalog, updateKiroProviderSettings } from '@/providers/kiro/settings';
import { VaultMentionDataProvider } from '@/shared/mention/VaultMentionDataProvider';

const originalResizeObserver = globalThis.ResizeObserver;
beforeEach(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(async () => {
  globalThis.ResizeObserver = originalResizeObserver;
  await releaseSideChatHarnesses();
});

it('refreshes destination settings when the side panel collapses, expands, and is discarded', async () => {
  const harness = createHarness();
  const app = new App();
  Object.assign(app.vault.adapter, { basePath: '/vault' });
  Object.assign(app.vault, { on: () => ({}), offref: () => undefined });
  const conversation = {
    id: 'conversation-1', providerId: 'kiro', selectedModel: 'kiro/sonnet',
    sessionId: 'main-session', messages: harness.tab.state.messages,
  } as Conversation;
  const settings: Record<string, unknown> = {
    settingsProvider: 'kiro',
    // Kiro offers only Safe (normal) and YOLO permission modes (no Manual).
    model: 'kiro/opus', effortLevel: 'medium', permissionMode: 'normal',
    savedProviderModel: { kiro: 'kiro/opus' }, savedProviderEffort: { kiro: 'medium' },
  };
  // Advertise the main conversation's models + efforts through the kiro catalog.
  updateCurrentKiroCatalog(settings, {
    defaultModelId: null,
    fingerprint: 'test-fingerprint',
    refreshedAt: 0,
    models: [
      { rawId: 'sonnet', displayName: 'Sonnet', description: '',
        reasoningEfforts: [{ label: 'low', value: 'low' }, { label: 'high', value: 'high' }], supportsReasoning: true },
      { rawId: 'opus', displayName: 'Opus', description: '',
        reasoningEfforts: [{ label: 'medium', value: 'medium' }, { label: 'high', value: 'high' }], supportsReasoning: true },
    ],
  });
  updateKiroProviderSettings(settings, { enabled: true, visibleModels: ['sonnet', 'opus'] });
  const plugin = {
    ...(harness.plugin as ChatFeatureHost),
    app,
    getCommittedSettings: () => plugin.settings,
    settings,
    getActiveEnvironmentVariables: () => '',
    getConversationSummary(id: string) { return (this as unknown as { getConversationSync: (id: string) => any }).getConversationSync(id); },
    getConversationSync: () => conversation,
    getConversationList: () => [conversation],
  } as unknown as ChatFeatureHost;
  if (!plugin.sessionRuntimes) installSessionRuntimePool(plugin);
  const tab = await createTabRuntime({
    plugin,
    component: Object.assign(new Component(), { registerDomEvent: () => undefined, registerEvent: () => undefined }) as never,
    containerEl: document.body.appendChild(document.createElement('div')),
    mentionDataProvider: new VaultMentionDataProvider(plugin.app),
    conversation,
    getProviderCatalogConfig: () => null,
    isRuntimeLive: () => true,
    openConversation: async () => {}, startNewConversation: async () => {},
  });
  tab.state.messages = conversation.messages;
  const side = tab.controllers.sideChatController;
  try {
    const started = side.handleCommandSubmission('Explore settings', []);
    await waitFor(() => expect(harness.backend.sessions).toHaveLength(1));
    expect(harness.backend.latest.requests[0].configuration).toMatchObject({ model: 'kiro/sonnet', reasoning: 'high' });
    harness.backend.latest.establishChild('child-session');
    harness.backend.latest.complete();
    await started;
    const ui = within(tab.dom.inputComposerEl);
    side.updateSideSettings({ permissionMode: 'yolo', reasoning: 'low' });
    side.collapse();
    fireEvent.click(ui.getByRole('button', { name: 'Side chat' }));
    expect(ui.queryByRole('button', { name: 'Permission mode: YOLO' })).not.toBeNull();
    expect(ui.getByText('Low', { selector: '.claudian-thinking-current' })).toBeDefined();
    expect(ui.queryByRole('button', { name: 'Permission mode: Safe' })).toBeNull();

    fireEvent.click(ui.getByRole('button', { name: 'Collapse' }));
    expect(ui.queryByRole('button', { name: 'Permission mode: Safe' })).not.toBeNull();
    expect(ui.getByText('High', { selector: '.claudian-thinking-current' })).toBeDefined();
    expect(ui.queryByRole('button', { name: 'Permission mode: YOLO' })).toBeNull();

    fireEvent.click(ui.getByRole('button', { name: 'Side chat' }));
    expect(ui.queryByRole('button', { name: 'Permission mode: YOLO' })).not.toBeNull();
    expect(ui.getByText('Low', { selector: '.claudian-thinking-current' })).toBeDefined();
    expect(ui.queryByRole('button', { name: 'Permission mode: Safe' })).toBeNull();

    let finishDisposal!: () => void;
    const disposalGate = new Promise<void>(resolve => { finishDisposal = resolve; });
    const native = harness.backend.latest;
    const disposeNative = native.dispose.bind(native);
    native.dispose = async () => {
      await disposalGate;
      await disposeNative();
    };
    const discarded = side.discard();
    try {
      expect(side.destination).toBe('main');
      expect(ui.queryByRole('button', { name: 'Permission mode: Safe' })).not.toBeNull();
    expect(ui.getByText('High', { selector: '.claudian-thinking-current' })).toBeDefined();
      expect(ui.queryByRole('button', { name: 'Permission mode: YOLO' })).toBeNull();
    } finally {
      finishDisposal();
      await discarded;
    }
  } finally {
    await destroyTab(tab);
  }
});

it('side usage must carry the side model when native usage omits model', async () => {
  const settings: Record<string, unknown> = {
    model: 'kiro/opus', settingsProvider: 'kiro',
    savedProviderModel: { kiro: 'kiro/opus' },
  };
  updateKiroProviderSettings(settings, { enabled: true, visibleModels: ['sonnet', 'opus'] });
  const harness = createHarness({ settings });
  const { started } = await startSideChat(harness);
  harness.backend.latest.complete();
  await started;
  harness.controller.updateSideSettings({ model: 'kiro/sonnet', reasoning: 'high', permissionMode: 'normal', serviceTier: 'default' });
  const pending = harness.controller.submitToSide('second turn', []);
  await waitFor(() => expect(harness.backend.latest.requests).toHaveLength(2));
  expect(harness.backend.latest.requests[1].configuration.model).toBe('kiro/sonnet');
  harness.backend.latest.emitOutput({ type: 'usage_updated', usage: {
    inputTokens: 100, contextTokens: 100, contextWindow: 200000, percentage: 0,
  } });
  harness.backend.latest.complete();
  await pending;
  expect(harness.controller.runtime?.state.usage?.model).toBe('kiro/sonnet');
});
