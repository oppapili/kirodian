/** @vitest-environment jsdom */

import '@/providers';

import { axe } from '@test/helpers/accessibility';
import { fireEvent, waitFor, within } from '@testing-library/dom';

import { ClaudianSettingsStorage } from '@/app/settings/ClaudianSettingsStorage';
import { DEFAULT_CLAUDIAN_SETTINGS } from '@/app/settings/defaultSettings';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import { EnvSnippetManager } from '@/shared/settings/EnvSnippetManager';



vi.mock('obsidian', async () => (await vi.importActual<typeof import('../../../helpers/ObsidianSettingsDOM')>('../../../helpers/ObsidianSettingsDOM')));

afterEach(() => document.body.replaceChildren());

it('applies a snippet environment to its provider scope', async () => {
  const settings = JSON.parse(JSON.stringify(DEFAULT_CLAUDIAN_SETTINGS)) as typeof DEFAULT_CLAUDIAN_SETTINGS;
  settings.envSnippets = [{
    id: 'snippet', name: 'Custom endpoint', description: '', scope: 'provider:kiro',
    envVars: 'KIRO_MODEL=custom',
  }];
  const applyEnvironmentVariables = vi.fn().mockResolvedValue(undefined);
  const host = {
    notifyProviderChatOptionsChanged: vi.fn(),
    settings, applyEnvironmentVariables,
    app: { workspace: { getLeavesOfType: () => [] } },
    mutateSettings: async (mutate: Parameters<ProviderHost['mutateSettings']>[0]) => { await mutate(settings); },
  } as unknown as ProviderHost;
  const container = document.body.createEl('main');
  const onChanged = vi.fn();
  new EnvSnippetManager(container, host, 'provider:kiro', onChanged);
  fireEvent.click(within(container).getByRole('button', { name: 'Insert' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(applyEnvironmentVariables).toHaveBeenCalledWith('provider:kiro', 'KIRO_MODEL=custom');
  expect(settings).not.toHaveProperty('customModelAliases');
  expect(await axe(container)).toHaveNoViolations();
});

it('offers saving the current environment from the empty snippet state', async () => {
  const settings = JSON.parse(JSON.stringify(DEFAULT_CLAUDIAN_SETTINGS)) as typeof DEFAULT_CLAUDIAN_SETTINGS;
  settings.envSnippets = [];
  const host = {
    notifyProviderChatOptionsChanged: vi.fn(),
    settings,
    app: { workspace: { getLeavesOfType: () => [] } },
    getEnvironmentVariablesForScope: () => 'KIRO_MODEL=custom',
    mutateSettings: async (mutate: Parameters<ProviderHost['mutateSettings']>[0]) => { await mutate(settings); },
  } as unknown as ProviderHost;
  const container = document.body.createEl('main');
  new EnvSnippetManager(container, host, 'provider:kiro');

  expect(within(container).getAllByRole('button')).toHaveLength(1);
  expect(await axe(container)).toHaveNoViolations();
  fireEvent.click(within(container).getByRole('button', { name: 'Save current environment as a snippet' }));

  const dialog = within(document.body).getByRole('dialog', { name: 'Save snippet' });
  expect(within(dialog).getByDisplayValue('KIRO_MODEL=custom')).toBeTruthy();
});


it('saves, reloads and inserts snippet overrides for prototype-named custom models', async () => {
  const settings = structuredClone(DEFAULT_CLAUDIAN_SETTINGS);
  settings.envSnippets = [];
  const envVars = 'ANTHROPIC_MODEL=__proto__\nANTHROPIC_DEFAULT_SONNET_MODEL=constructor';
  let persisted = '';
  const adapter = {
    exists: async () => persisted !== '',
    read: async () => persisted,
    write: async (_path: string, content: string) => { persisted = content; },
  } as unknown as VaultFileAdapter;
  const storage = new ClaudianSettingsStorage(adapter, DEFAULT_CLAUDIAN_SETTINGS);
  const coordinator = new SettingsCoordinator(settings, value => storage.save(value));
  const onChanged = vi.fn();
  const host = {
    notifyProviderChatOptionsChanged: vi.fn(),
    settings, mutateSettings: coordinator.mutate.bind(coordinator),
    app: { workspace: { getLeavesOfType: () => [] } },
    getEnvironmentVariablesForScope: () => envVars,
    applyEnvironmentVariables: async () => undefined,
  } as unknown as ProviderHost;
  const container = document.body.createEl('main');
  new EnvSnippetManager(container, host, 'provider:claude', onChanged);
  const joinFocusTimers = captureModalFocusTimers(() => {
    fireEvent.click(within(container).getByRole('button', { name: 'Save current environment as a snippet' }));
  });
  await joinFocusTimers();
  const dialog = within(document.body).getByRole('dialog', { name: 'Save snippet' });
  const fields = within(dialog);
  const name = within(fields.getByText('Name').parentElement!).getByRole('textbox');
  fireEvent.input(name, { target: { value: 'Special model endpoint' } });
  for (const [modelId, alias, limit] of [
    ['__proto__', 'Prototype model', '200k'],
    ['constructor', 'Constructor model', '100k'],
  ]) {
    const aliasInput = fields.getByRole<HTMLInputElement>('textbox', { name: `Alias for ${modelId}` });
    const limitInput = fields.getByRole<HTMLInputElement>('textbox', { name: `Context window for ${modelId}` });
    expect(aliasInput.value).toBe('');
    expect(limitInput.value).toBe('');
    fireEvent.input(aliasInput, { target: { value: alias } });
    fireEvent.input(limitInput, { target: { value: limit } });
  }
  const overrideRow = fields.getByRole('textbox', { name: 'Alias for __proto__' }).parentElement!;
  expect(await axe(overrideRow)).toHaveNoViolations();
  fireEvent.click(fields.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(within(container).getByText('Special model endpoint')).toBeTruthy());
  const expectedAliases = Object.fromEntries([['__proto__', 'Prototype model'], ['constructor', 'Constructor model']]);
  const expectedLimits = Object.fromEntries([['__proto__', 200000], ['constructor', 100000]]);
  expect(settings.envSnippets[0]).toMatchObject({ modelAliases: expectedAliases, contextLimits: expectedLimits });
  const reloaded = await storage.load();
  expect(reloaded.envSnippets[0]).toMatchObject({ modelAliases: expectedAliases, contextLimits: expectedLimits });
  // Rebuild the real manager against decoded data, then run its Insert action.
  Object.assign(settings, reloaded);
  container.replaceChildren();
  new EnvSnippetManager(container, host, 'provider:claude', onChanged);
  fireEvent.click(within(container).getByRole('button', { name: 'Insert' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(getClaudeProviderSettings(settings).modelAliases).toEqual(expectedAliases);

  const joinEditFocus = captureModalFocusTimers(() => {
    fireEvent.click(within(container).getByRole('button', { name: 'Edit' }));
  });
  await joinEditFocus();
  const edit = within(within(document.body).getByRole('dialog', { name: 'Edit snippet' }));
  for (const [modelId, alias] of Object.entries(expectedAliases)) {
    const input = edit.getByRole<HTMLInputElement>('textbox', { name: `Alias for ${modelId}` });
    expect(input.value).toBe(alias);
    fireEvent.input(input, { target: { value: '' } });
  }
  fireEvent.click(edit.getByRole('button', { name: 'Update' }));
  await waitFor(() => expect(settings.envSnippets[0].modelAliases).toEqual({}));
  onChanged.mockClear();
  fireEvent.click(within(container).getByRole('button', { name: 'Insert' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(getClaudeProviderSettings(settings).modelAliases).toEqual({});
});


it('publishes inserted aliases to every mounted model selector', async () => {
  const settings = structuredClone(DEFAULT_CLAUDIAN_SETTINGS);
  settings.model = 'claude-code/custom';
  updateClaudeProviderSettings(settings, {
    discoveredModels: [{ value: 'custom', label: 'Native custom', description: '' }],
    visibleModels: ['custom'], modelAliases: { custom: 'Old alias' },
    environmentVariables: 'ANTHROPIC_MODEL=custom',
  });
  settings.envSnippets = [{ id: 'snippet', name: 'Alias only', description: '', scope: 'provider:claude',
    envVars: 'ANTHROPIC_MODEL=custom', modelAliases: { custom: 'New alias' } }];
  const containers = [document.body.createDiv(), document.body.createDiv()];
  const selectors = containers.map(container => new ModelSelector(container, {
    getSettings: () => getChatSettingsSnapshot(settings, 'claude', settings.model),
    getUIConfig: () => claudeChatUIConfig,
    onModelChange: async () => undefined,
    onEffortLevelChange: async () => undefined,
    getCapabilities: () => ProviderRegistry.getCapabilities('claude'),
  }));
  const views = selectors.map(selector => ({ refreshModelSelector() { selector.updateDisplay(); selector.renderOptions(); } }));
  const publisher = new ChatViewPublisher({
    views: { getAllViews: () => views as never }, zenMode: { reconcile() {} }, inactiveSessions: { request() {} },
    hasLoadedAllSessionMetadata: () => true,
  });
  let saved = '';
  const coordinator = new SettingsCoordinator(settings, async draft => { saved = JSON.stringify(draft); },
    (current, previous) => publisher.publishSettings(current, previous));
  const reconciler = new ProviderChatOptionsReconciler({
    settings: coordinator,
    providers: { getProviderDisplayName: () => 'Claude' }, providerSettings: ProviderSettingsCoordinator,
    reconcileConversationModels: async () => [], onSettingsReconciled() {}, onConversationsChanged() {},
    onReconciled: providerId => publisher.refreshModelSelector(providerId),
  });
  const host = {
    settings, app: { workspace: { getLeavesOfType: () => views.map(view => ({ view })) } },
    // The snippet uses the already-applied environment; this boundary has no runtime changes to publish.
    applyEnvironmentVariables: async () => undefined,
    mutateSettings: coordinator.mutate.bind(coordinator),
    notifyProviderChatOptionsChanged: (providerId: string) => { void reconciler.notifyChanged(providerId); },
  } as unknown as ProviderHost;
  for (const container of containers) expect(within(container).getByRole('button', { name: 'Model: Old alias' })).toBeTruthy();
  const manager = document.body.createDiv();
  new EnvSnippetManager(manager, host, 'provider:claude');

  fireEvent.click(within(manager).getByRole('button', { name: 'Insert' }));

  for (const container of containers) {
    await waitFor(() => expect(within(container).getByRole('button', { name: 'Model: New alias' })).toBeTruthy());
  }
  expect(getClaudeProviderSettings(JSON.parse(saved)).modelAliases).toMatchObject({ custom: 'New alias' });
  expect(await axe(manager)).toHaveNoViolations();
});
