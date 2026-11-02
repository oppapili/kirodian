/** @jest-environment jsdom */
import '@/providers';

import { FakeSideBackend } from '@test/helpers/features/chat/SideChatSessionHarness';
import { fireEvent, waitFor, within } from '@testing-library/dom';
import { App, Component } from 'obsidian';

import { ProviderExecutionLifecycleRegistry } from '@/core/execution';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { ClaudianSettings, Conversation } from '@/core/types';
import type { ChatFeatureHost } from '@/features/chat/ChatFeatureHost';
import { activateTab, deactivateTab, destroyTab } from '@/features/chat/tabs/TabLifecycle';
import { createTabRuntime } from '@/features/chat/tabs/TabRuntimeFactory';
import { updateCurrentKiroCatalog, updateKiroProviderSettings } from '@/providers/kiro/settings';
import { VaultMentionDataProvider } from '@/shared/mention/VaultMentionDataProvider';

const originalResizeObserver = globalThis.ResizeObserver;
beforeEach(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Object.assign(HTMLElement.prototype, {
    hasClass(this: HTMLElement, name: string) { return this.classList.contains(name); },
    addClass(this: HTMLElement, ...names: string[]) { this.classList.add(...names); },
    removeClass(this: HTMLElement, ...names: string[]) { this.classList.remove(...names); },
    empty(this: HTMLElement) { this.replaceChildren(); },
    setText(this: HTMLElement, text: string) { this.textContent = text; },
    appendText(this: HTMLElement, text: string) { this.appendChild(this.ownerDocument.createTextNode(text)); },
    setCssProps(this: HTMLElement, props: Record<string, string>) {
      for (const [key, value] of Object.entries(props)) this.style.setProperty(key, value);
    },
    toggleClass(this: HTMLElement, name: string, enabled: boolean) { this.classList.toggle(name, enabled); },
    scrollIntoView() {},
  });
});
afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  jest.restoreAllMocks();
  document.body.replaceChildren();
});

async function createView(fakeBackend?: FakeSideBackend) {
  if (fakeBackend) jest.spyOn(ProviderRegistry, 'createExecutionBackend').mockReturnValue(fakeBackend);
  const app = new App();
  Object.assign(app.vault.adapter, { basePath: '/vault' });
  Object.assign(app.vault, { on: () => ({}), offref() {} });
  Object.assign(app.workspace, { getActiveViewOfType: () => null });
  const lifecycleRegistry = new ProviderExecutionLifecycleRegistry();
  const settings = {
    model: 'kiro/claude-sonnet-4-5', effortLevel: 'high', permissionMode: 'normal',
    enableAutoTitleGeneration: false, excludedTags: [], mediaFolder: '', systemPrompt: '', userName: '',
  } as unknown as ClaudianSettings;
  updateCurrentKiroCatalog(settings as unknown as Record<string, unknown>, {
    defaultModelId: null,
    fingerprint: 'test-fingerprint',
    refreshedAt: 0,
    models: ['claude-sonnet-4-5', 'claude-opus-4-6'].map(rawId => ({
      rawId,
      displayName: rawId,
      description: 'SDK model',
      reasoningEfforts: [
        { label: 'Low', value: 'low' },
        { label: 'High', value: 'high' },
      ],
      supportsReasoning: true,
    })),
  });
  updateKiroProviderSettings(settings as unknown as Record<string, unknown>, {
    enabled: true,
    visibleModels: ['claude-sonnet-4-5', 'claude-opus-4-6'],
  });
  const conversation = {
    id: 'conversation-1', providerId: 'kiro', selectedModel: 'kiro/claude-sonnet-4-5',
    sessionId: 'main-session', messages: [],
  } as unknown as Conversation;
  const saved: unknown[] = [];
  const plugin = {
    app, settings,
    providerHost: {
      app, settings, executionLifecycleRegistry: lifecycleRegistry,
      getResolvedProviderCliPath: async () => '/bin/claude',
      getActiveEnvironmentVariables: () => '',
    },
    executionPersistence: {
      registerExecutionBinding() {}, releaseExecutionBinding() {},
      assertConversationExecutionAuthority: async () => {},
      persistExecutionSnapshot: async (...args: unknown[]) => { saved.push(args); return true; },
      recordConversationActivity: async () => {},
    },
    getSessionSnapshotDirectory: () => '/tmp/claudian-sessions',
    getCommittedSettings: () => settings,
    getActiveEnvironmentVariables: () => '',
    getConversationSummary: () => conversation,
    getConversationSync: () => conversation,
    getConversationById: async () => conversation,
    getConversationList: () => [conversation],
    renameConversation: async () => {},
    updateConversation: async (_id: string, patch: unknown) => { saved.push(structuredClone(patch)); },
    mutateSettings: async (mutate: (settings: ClaudianSettings) => void) => mutate(settings),
    chatModelSelection: { beginIntent: () => 1, commitIntent: async () => true },
  } as unknown as ChatFeatureHost;
  const tab = await createTabRuntime({
    plugin, conversation, component: new Component(),
    containerEl: document.body.createDiv(),
    mentionDataProvider: new VaultMentionDataProvider(plugin.app),
    getProviderCatalogConfig: () => null, isRuntimeLive: () => true,
  });
  tab.hydrationState = 'ready';
  await tab.executionCoordinator.bindConversation({ conversationId: conversation.id, providerId: 'kiro' });
  await tab.executionCoordinator.prepare();
  activateTab(tab);
  tab.dom.inputEl.focus();
  return { tab, conversation, saved, plugin,
    dispose: async () => { await destroyTab(tab); await lifecycleRegistry.dispose(); },
  };
}

type View = Awaited<ReturnType<typeof createView>>;

async function finishFakeTurn(view: View, backend: FakeSideBackend) {
  view.tab.dom.inputEl.value = 'Do the work';
  const pending = view.tab.controllers.inputController.sendMessage();
  await waitFor(() => expect(backend.latest.requests).toHaveLength(1));
  const turnId = backend.latest.activeTurnId;
  backend.latest.emitText('Done.');
  backend.latest.complete();
  await pending;
  return turnId;
}

/** The open picker also hides the ghost, so callers observe the composer after it closes. */
async function selectToolbarModel(view: View, name: RegExp): Promise<HTMLElement> {
  const modelButton = within(view.tab.dom.inputWrapper).getByRole('button', { name: /Model: / });
  fireEvent.click(modelButton);
  fireEvent.click(within(view.tab.dom.inputWrapper).getByRole('option', { name }));
  fireEvent.keyDown(modelButton, { key: 'Escape' });
  await waitFor(() => expect(modelButton.getAttribute('aria-expanded')).toBe('false'));
  return modelButton;
}

/** Composer activity that neither starts a main turn nor changes the main tab's model. */
const retainingActivity = {
  'rewind in progress': async (view: View) => {
    jest.spyOn(view.tab.state, 'isRewinding', 'get').mockReturnValue(true);
    view.tab.dom.inputEl.value = 'Retry later';
    await view.tab.controllers.inputController.sendMessage();
    jest.spyOn(view.tab.state, 'isRewinding', 'get').mockReturnValue(false);
    expect(view.tab.dom.inputEl.value).toBe('Retry later');
  },
  'rejected side command': async (view: View) => {
    view.tab.dom.inputEl.value = '/side';
    await view.tab.controllers.inputController.sendMessage();
    expect(view.tab.dom.inputEl.value).toBe('/side');
  },
};

it('routes a native post-result suggestion to the composer without persisting it', async () => {
  const backend = new FakeSideBackend();
  const view = await createView(backend);
  try {
    const turnId = await finishFakeTurn(view, backend);
    expect(backend.latest.requests[0].configuration.promptSuggestions).toBe(true);
    backend.latest.emitSessionEvent({ type: 'prompt_suggestion', originatingTurnId: turnId, suggestion: 'Add tests next' });
    await waitFor(() => expect(within(view.tab.dom.inputEl).getByText('Add tests next')).toBeDefined());
    expect(view.tab.dom.inputEl.value).toBe('');
    expect(JSON.stringify(view.saved)).not.toContain('Add tests next');
    expect(JSON.stringify(view.tab.state.messages)).not.toContain('Add tests next');
    const send = jest.spyOn(view.tab.controllers.inputController, 'sendMessage');
    fireEvent.keyDown(within(view.tab.dom.inputEl).getByRole('textbox'), { key: 'Tab' });
    expect(view.tab.dom.inputEl.value).toBe('Add tests next');
    expect(send).not.toHaveBeenCalled();
  } finally { await view.dispose(); }
});

it.each(['tab', 'conversation', 'provider', 'model', 'send'] as const)(
  'discards a suggestion after a %s change, including delayed delivery', async change => {
    const backend = new FakeSideBackend();
    const view = await createView(backend);
    try {
      const turnId = await finishFakeTurn(view, backend);
      const deliver = () => backend.latest.emitSessionEvent({
        type: 'prompt_suggestion', originatingTurnId: turnId, suggestion: 'Old suggestion',
      });
      deliver();
      expect(within(view.tab.dom.inputEl).getByText('Old suggestion')).toBeDefined();
      // Existing drafts hide the prediction; clearing after invalidation must not revive it.
      view.tab.dom.inputEl.value = 'A draft';
      fireEvent.input(view.tab.dom.inputEl);
      if (change === 'tab') {
        deactivateTab(view.tab); activateTab(view.tab);
      } else if (change === 'conversation' || change === 'provider') {
        view.tab.session.bindConversation(change === 'conversation' ? 'other-conversation' : view.conversation.id,
          change === 'provider' ? 'other' : 'kiro');
      } else if (change === 'model') {
        await selectToolbarModel(view, /opus/i);
      } else {
        const pending = view.tab.controllers.inputController.sendMessage();
        await waitFor(() => { if (backend.latest.requests.length !== 2) throw new Error('Next turn has not started'); });
        backend.latest.emitText('Next answer'); backend.latest.complete();
        await pending;
      }
      deliver();
      view.tab.dom.inputEl.value = '';
      fireEvent.input(view.tab.dom.inputEl);
      expect(within(view.tab.dom.inputEl).queryByText('Old suggestion')).toBeNull();
      expect(within(view.tab.dom.inputEl).getByRole('textbox')).toBeDefined();
    } finally { await view.dispose(); }
  },
);

it.each(Object.keys(retainingActivity) as (keyof typeof retainingActivity)[])(
  'retains a suggestion when the main tab starts no turn and keeps its model (%s)', async activity => {
    const backend = new FakeSideBackend();
    const view = await createView(backend);
    try {
      const turnId = await finishFakeTurn(view, backend);
      const mainSession = backend.latest;
      mainSession.emitSessionEvent({ type: 'prompt_suggestion', originatingTurnId: turnId, suggestion: 'Kept suggestion' });
      const input = view.tab.dom.inputEl;
      expect(within(input).getByText('Kept suggestion')).toBeDefined();
      await retainingActivity[activity](view);
      expect(mainSession.requests).toHaveLength(1);
      input.value = '';
      fireEvent.input(input);
      expect(within(input).getByText('Kept suggestion')).toBeDefined();
    } finally { await view.dispose(); }
  },
);

it('keeps content present on arrival, hides for text and attachments, then restores the ghost', async () => {
  const backend = new FakeSideBackend();
  const view = await createView(backend);
  try {
    const turnId = await finishFakeTurn(view, backend);
    const input = view.tab.dom.inputEl;
    input.value = 'Unsent draft';
    fireEvent.input(input);
    backend.latest.emitSessionEvent({ type: 'prompt_suggestion', originatingTurnId: turnId, suggestion: 'Try the tests' });
    expect(input.value).toBe('Unsent draft');
    expect(within(input).queryByText('Try the tests')).toBeNull();
    input.value = '';
    fireEvent.input(input);
    expect(within(input).getByText('Try the tests')).toBeDefined();
    view.tab.ui.imageContextManager.setImages([{ id: 'image', name: 'image.png', mediaType: 'image/png', data: 'aGVsbG8=', size: 5, source: 'paste' }]);
    expect(within(input).queryByText('Try the tests')).toBeNull();
    view.tab.ui.imageContextManager.clearImages();
    expect(within(input).getByText('Try the tests')).toBeDefined();
    for (const text of ['Typing', 'Pasted text', '$skill']) {
      input.value = text;
      fireEvent.input(input);
      expect(within(input).queryByText('Try the tests')).toBeNull();
      input.value = '';
      fireEvent.input(input);
      expect(within(input).getByText('Try the tests')).toBeDefined();
    }
    input.value = '/';
    fireEvent.input(input);
    await waitFor(() => expect(view.tab.ui.composerDropdown.isVisible()).toBe(true));
    fireEvent.keyDown(within(input).getByRole('textbox'), { key: 'Tab', isComposing: true });
    expect(input.value).toBe('/');
    fireEvent.keyDown(within(input).getByRole('textbox'), { key: 'Tab' });
    expect(input.value).not.toBe('/');
    expect(input.value).not.toBe('Try the tests');
    input.value = '';
    fireEvent.input(input);
    await waitFor(() => expect(within(input).getByText('Try the tests')).toBeDefined());
  } finally { await view.dispose(); }
});

it.each(['before', 'after'] as const)('drops a trailing prediction while its originating tab is inactive (turn started %s switching away)', async started => {
  const backend = new FakeSideBackend();
  const view = await createView(backend);
  try {
    // A queued follow-up can start a main turn after its tab was switched away.
    if (started === 'after') deactivateTab(view.tab);
    const turnId = await finishFakeTurn(view, backend);
    if (started === 'before') deactivateTab(view.tab);
    backend.latest.emitSessionEvent({ type: 'prompt_suggestion', originatingTurnId: turnId, suggestion: 'Late prediction' });
    activateTab(view.tab);
    fireEvent.input(view.tab.dom.inputEl);
    expect(within(view.tab.dom.inputEl).getByRole('textbox')).toBeDefined();
    expect(within(view.tab.dom.inputEl).queryByText('Late prediction')).toBeNull();
  } finally { await view.dispose(); }
});

it('hides a prediction while a toolbar dropdown is open and restores it on Escape', async () => {
  const backend = new FakeSideBackend();
  const view = await createView(backend);
  try {
    const turnId = await finishFakeTurn(view, backend);
    backend.latest.emitSessionEvent({ type: 'prompt_suggestion', originatingTurnId: turnId, suggestion: 'Try the tests' });
    expect(within(view.tab.dom.inputEl).getByText('Try the tests')).toBeDefined();
    const modelButton = within(view.tab.dom.inputWrapper).getByRole('button', { name: /Model: / });
    fireEvent.click(modelButton);
    await waitFor(() => expect(within(view.tab.dom.inputEl).queryByText('Try the tests')).toBeNull());
    fireEvent.keyDown(modelButton, { key: 'Escape' });
    await waitFor(() => expect(within(view.tab.dom.inputEl).getByText('Try the tests')).toBeDefined());
  } finally { await view.dispose(); }
});

it.each(['', 'Unsent draft'])('discards the prediction when an automatic turn starts (draft: %p)', async draft => {
  const backend = new FakeSideBackend();
  const view = await createView(backend);
  try {
    const turnId = await finishFakeTurn(view, backend);
    backend.latest.emitSessionEvent({ type: 'prompt_suggestion', originatingTurnId: turnId, suggestion: 'Previous prediction' });
    expect(within(view.tab.dom.inputEl).getByText('Previous prediction')).toBeDefined();
    view.tab.dom.inputEl.value = draft;
    fireEvent.input(view.tab.dom.inputEl);
    backend.latest.emitBackgroundEvent({ type: 'background_turn_started' });
    view.tab.dom.inputEl.value = '';
    fireEvent.input(view.tab.dom.inputEl);
    expect(within(view.tab.dom.inputEl).queryByText('Previous prediction')).toBeNull();
    expect(within(view.tab.dom.inputEl).getByRole('textbox')).toBeDefined();
    backend.latest.emitBackgroundEvent({ type: 'background_turn_completed', reason: 'completed' });
  } finally { await view.dispose(); }
});
