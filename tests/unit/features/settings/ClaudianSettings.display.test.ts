/** @vitest-environment jsdom */

import { axe } from '@test/helpers/accessibility';
import { DEFAULT_CLAUDIAN_SETTINGS } from '@test/helpers/defaultSettings';
import { controlChangeSettled } from '@test/helpers/ObsidianHost';
import { partialMock } from '@test/helpers/partialMock';
import { fireEvent, waitFor, within } from '@testing-library/dom';
import { App, type Plugin, type Setting } from 'obsidian';
import type { Mock } from 'vitest';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import type { ClaudianSettings } from '@/core/types';
import type { FeatureHost } from '@/features/FeatureHost';
import { ClaudianSettingTab } from '@/features/settings/ClaudianSettings';
import { t } from '@/i18n/i18n';

interface TestPlugin {
  settings: ClaudianSettings;
  mutateSettings: Mock;
  getAllViews: Mock;
  notifyAgentSkillsChanged: Mock;
  notifyProviderChatOptionsChanged?: Mock;
  storage: { getAdapter: Mock };
  providerHost: { settings: ClaudianSettings; getEnvironmentVariablesForScope: Mock; applyEnvironmentVariables: Mock };
}

function createTab(enableDualPane: boolean): { tab: ClaudianSettingTab; plugin: TestPlugin } {
  const settings = { ...structuredClone(DEFAULT_CLAUDIAN_SETTINGS), enableDualPane };
  const plugin: TestPlugin = {
    settings,
    mutateSettings: vi.fn(async (mutation: (value: ClaudianSettings) => void) => {
      mutation(settings);
    }),
    getAllViews: vi.fn(() => [{ refreshDualPaneLayout: vi.fn() }]),
    notifyAgentSkillsChanged: vi.fn(),
    storage: {
      getAdapter: vi.fn(() => ({})),
    },
    providerHost: {
      settings,
      getEnvironmentVariablesForScope: vi.fn(() => ''),
      applyEnvironmentVariables: vi.fn(),
    },
  };

  return {
    tab: new ClaudianSettingTab(new App(), partialMock<Plugin>({}), partialMock<FeatureHost>(plugin)),
    plugin,
  };
}

function renderSettingsTab(
  tab: ClaudianSettingTab,
  container = document.body.createDiv(),
): HTMLElement {
  const [definition] = tab.getSettingDefinitions();
  if (
    !definition
    || !('render' in definition)
    || typeof definition.render !== 'function'
  ) {
    throw new Error('Expected a declarative settings renderer');
  }

  definition.render(
    partialMock<Setting>({ settingEl: container }),
    partialMock<Parameters<typeof definition.render>[1]>({}),
  );
  return container;
}

function toggleOf(container: HTMLElement, name: string): HTMLElement {
  return within(container).getByRole('switch', { name });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('ClaudianSettingTab display settings', () => {
  it('shows title eligibility guidance and updates it after selection and catalog changes', async () => {
    vi.spyOn(ProviderRegistry, 'getTitleGenerationModelOptions').mockReturnValue([
      { value: 'claude-code/sonnet', label: 'Claude: Sonnet' },
    ]);
    const eligibility = vi.spyOn(ProviderRegistry, 'resolveTitleGenerationSelection')
      .mockImplementation(settings => settings.titleGenerationModel === 'claude-code/sonnet' ? { providerId: 'claude', model: 'claude-code/sonnet' } : null);
    const { tab, plugin } = createTab(true);
    plugin.settings.enableAutoTitleGeneration = true;
    plugin.settings.titleGenerationModel = '';
    renderSettingsTab(tab);
    expect(within(document.body).getByRole('status').textContent).toBe(t('settings.titleModel.unavailableWarning'));
    const menu = within(document.body).getByRole<HTMLSelectElement>('combobox', { name: t('settings.titleModel.name') });
    expect(within(menu).queryByRole('option', { name: /Auto/ })).toBeNull();
    expect(menu.value).toBe('');
    expect(menu.options[0].disabled).toBe(true);
    expect(menu.required).toBe(true);
    expect(plugin.mutateSettings).not.toHaveBeenCalled();
    expect((await axe(menu.parentElement!)).violations).toEqual([]);
    fireEvent.change(menu, { target: { value: 'claude-code/sonnet' } });
    await waitFor(() => expect(within(document.body).queryByRole('status')).toBeNull());
    await waitFor(() => expect(plugin.settings.titleGenerationModel).toBe('claude-code/sonnet'));
    eligibility.mockReturnValue(null);
    tab.refreshModelOptions();
    expect(within(document.body).getByRole('status').textContent).toBe(t('settings.titleModel.unavailableWarning'));
    eligibility.mockReturnValue({ providerId: 'claude', model: 'claude-code/sonnet' });
    tab.refreshModelOptions();
    expect(within(document.body).queryByRole('status')).toBeNull();
    expect(await axe(menu.parentElement!)).toHaveNoViolations();
  });

  it('does not show title guidance when automatic titles are disabled', () => {
    const { tab, plugin } = createTab(true);
    plugin.settings.enableAutoTitleGeneration = false;
    renderSettingsTab(tab);
    expect(within(document.body).queryByRole('status')).toBeNull();
  });

  it('renders the custom settings surface through a declarative definition', () => {
    const { tab } = createTab(true);
    const [definition] = tab.getSettingDefinitions();

    expect(definition).toEqual(expect.objectContaining({
      name: 'Kirodian',
      searchable: false,
    }));
    expect(Object.hasOwn(ClaudianSettingTab.prototype, 'display')).toBe(false);

    const container = renderSettingsTab(tab);

    expect(container.classList.contains('claudian-settings')).toBe(true);
    expect(within(container).getByRole('button', { name: t('settings.tabs.general') })).toBeDefined();
    expect(within(container).getByRole('button', { name: t('settings.tabs.providers') })).toBeDefined();
    expect(within(container).queryByRole('button', { name: t('settings.tabs.skills') })).toBeNull();
  });

  it('saves timestamp preferences through the application settings owner', async () => {
    const { tab, plugin } = createTab(true);
    const firstView = { refreshMessageTimestamps: vi.fn() };
    const secondView = { refreshMessageTimestamps: vi.fn() };
    plugin.getAllViews.mockReturnValue([firstView, secondView]);
    let finishSave!: () => void;
    plugin.mutateSettings.mockImplementation(async (mutation: (settings: ClaudianSettings) => void) => {
      mutation(plugin.settings);
      await new Promise<void>(resolve => { finishSave = resolve; });
    });
    const container = document.body.createDiv();
    tab['renderGeneralTab'](container);

    const toggle = toggleOf(container, t('settings.showMessageTimestamps.name'));
    fireEvent.click(toggle);
    await waitFor(() => expect(plugin.mutateSettings).toHaveBeenCalledTimes(1));
    expect(firstView.refreshMessageTimestamps).not.toHaveBeenCalled();
    expect(secondView.refreshMessageTimestamps).not.toHaveBeenCalled();
    finishSave();
    await controlChangeSettled(toggle);

    expect(plugin.settings.showMessageTimestamps).toBe(true);
    expect(plugin.mutateSettings).toHaveBeenCalledTimes(1);
  });

  it('renders the dual-pane position only while dual-pane mode is enabled', () => {
    const enabled = createTab(true);
    const enabledContainer = document.body.createDiv();
    enabled.tab['renderGeneralTab'](enabledContainer);

    expect(within(enabledContainer).getByText(t('settings.dualPaneSide.name'))).toBeDefined();

    const disabled = createTab(false);
    const disabledContainer = document.body.createDiv();
    disabled.tab['renderGeneralTab'](disabledContainer);

    expect(within(disabledContainer).queryByText(t('settings.dualPaneSide.name'))).toBeNull();
    expect(within(disabledContainer).getByText(t('settings.restoreTabsOnStartup.name'))).toBeDefined();
  });

  it('rerenders display settings after dual-pane mode changes', async () => {
    const { tab, plugin } = createTab(true);
    const update = vi.spyOn(tab, 'update').mockImplementation(() => undefined);
    const container = document.body.createDiv();
    tab['renderGeneralTab'](container);

    const toggle = toggleOf(container, t('settings.enableDualPane.name'));
    fireEvent.click(toggle);
    await controlChangeSettled(toggle);

    expect(plugin.settings.enableDualPane).toBe(false);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['restoreTabsOnStartup', 'settings.restoreTabsOnStartup.name'],
    ['enableZenMode', 'settings.enableZenMode.name'],
  ] as const)('renders and updates the %s toggle', async (key, name) => {
    const { tab, plugin } = createTab(true);
    const container = document.body.createDiv();
    tab['renderGeneralTab'](container);

    expect(plugin.settings[key]).toBe(true);

    const toggle = toggleOf(container, t(name));
    fireEvent.click(toggle);
    await controlChangeSettled(toggle);

    expect(plugin.settings[key]).toBe(false);
  });

  it('keeps Provider initialization lazy and does not mutate chat selection on navigation', async () => {
    vi.spyOn(ProviderRegistry, 'getRegisteredProviderIds')
      .mockReturnValue(['kiro', 'codex']);
    // Provider settings tabs now come from getVisibleProviderIds; stub it to the
    // same fixed list (including the default provider so it is the preferred
    // tab) so the real registry is not consulted in this isolated test.
    vi.spyOn(ProviderRegistry, 'getVisibleProviderIds')
      .mockReturnValue(['kiro', 'codex']);
    vi.spyOn(ProviderRegistry, 'getProviderDisplayName')
      .mockImplementation(providerId => providerId.toUpperCase());
    vi.spyOn(ProviderRegistry, 'getTitleGenerationModelOptions').mockReturnValue([]);
    const ensureInitialized = vi.spyOn(ProviderWorkspaceRegistry, 'ensureInitialized')
      .mockResolvedValue(undefined);
    ensureInitialized.mockClear();
    vi.spyOn(ProviderWorkspaceRegistry, 'getSettingsTabRenderer').mockReturnValue(null);
    const { tab, plugin } = createTab(true);
    renderSettingsTab(tab);
    expect(ensureInitialized).not.toHaveBeenCalled();

    tab['activeTab'] = 'providers';
    renderSettingsTab(tab);
    await Promise.resolve();
    await Promise.resolve();

    expect(ensureInitialized).toHaveBeenCalledWith(
      expect.anything(),
      plugin.settings.settingsProvider,
      'settings-tab',
    );
    expect(plugin.mutateSettings).not.toHaveBeenCalled();
  });

  it('initializes each Provider settings tab once and reuses its rendered content', async () => {
    vi.spyOn(ProviderRegistry, 'getRegisteredProviderIds')
      .mockReturnValue(['claude', 'codex']);
    // Provider settings tabs now come from getVisibleProviderIds; stub it to the
    // same fixed list so the real registry is not consulted in this isolated test.
    vi.spyOn(ProviderRegistry, 'getVisibleProviderIds')
      .mockReturnValue(['claude', 'codex']);
    vi.spyOn(ProviderRegistry, 'getProviderDisplayName')
      .mockImplementation(providerId => providerId.toUpperCase());
    vi.spyOn(ProviderRegistry, 'getTitleGenerationModelOptions').mockReturnValue([]);
    const ensureInitialized = vi.spyOn(ProviderWorkspaceRegistry, 'ensureInitialized')
      .mockResolvedValue(undefined);
    ensureInitialized.mockClear();
    vi.spyOn(ProviderWorkspaceRegistry, 'getSettingsTabRenderer').mockReturnValue(null);
    const { tab } = createTab(true);
    tab['activeTab'] = 'providers';

    const container = renderSettingsTab(tab);
    await Promise.resolve();
    await Promise.resolve();
    fireEvent.click(within(container).getByText('CODEX'));
    await Promise.resolve();
    await Promise.resolve();
    fireEvent.click(within(container).getByText('CLAUDE'));
    await Promise.resolve();

    expect(ensureInitialized).toHaveBeenCalledTimes(2);
    expect(ensureInitialized.mock.calls.map(([, providerId]) => providerId))
      .toEqual(['claude', 'codex']);
  });

  it('collapses a disabled Provider tab and follows later enablement changes', async () => {
    let enabled = false;
    vi.spyOn(ProviderRegistry, 'getRegisteredProviderIds').mockReturnValue(['kiro']);
    vi.spyOn(ProviderRegistry, 'getVisibleProviderIds').mockReturnValue(['kiro']);
    vi.spyOn(ProviderRegistry, 'getProviderDisplayName').mockReturnValue('Kiro');
    vi.spyOn(ProviderRegistry, 'getTitleGenerationModelOptions').mockReturnValue([]);
    vi.spyOn(ProviderRegistry, 'isEnabled').mockImplementation(() => enabled);
    vi.spyOn(ProviderWorkspaceRegistry, 'ensureInitialized').mockResolvedValue(undefined);
    let notify: ((providerId: 'kiro') => void) | null = null;
    vi.spyOn(ProviderWorkspaceRegistry, 'getSettingsTabRenderer').mockReturnValue({
      render: (_container, context) => { notify = context.notifyProviderModelOptionsChanged; },
    });
    const { tab, plugin } = createTab(true);
    plugin.notifyProviderChatOptionsChanged = vi.fn();
    tab['activeTab'] = 'providers';

    const container = renderSettingsTab(tab);
    await waitFor(() => expect(notify).not.toBeNull());
    const content = container.querySelector('.claudian-settings-provider-content')!;
    const disabledClass = 'claudian-settings-provider-content--disabled';
    expect(content.classList.contains(disabledClass)).toBe(true);

    enabled = true;
    notify!('kiro');
    expect(content.classList.contains(disabledClass)).toBe(false);
  });
});

it('batches a burst of text edits into one settings mutation and flushes on teardown', async () => {
  const { tab, plugin } = createTab(false);
  const container = document.body.createDiv();
  const cleanup = tab['renderSettings'](container);
  vi.useFakeTimers();
  try {
    const input = within(container).getByRole('textbox', { name: t('settings.userName.name') });
    for (let index = 0; index < 20; index++) fireEvent.input(input, { target: { value: `Name ${index}` } });
    expect(plugin.mutateSettings).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(plugin.mutateSettings).toHaveBeenCalledTimes(1);
    expect(plugin.settings.userName).toBe('Name 19');
    fireEvent.input(input, { target: { value: 'Last edit' } });
    cleanup();
    await Promise.resolve();
    expect(plugin.settings.userName).toBe('Last edit');
    await vi.advanceTimersByTimeAsync(1000);
    expect(plugin.mutateSettings).toHaveBeenCalledTimes(2);
  } finally { cleanup(); }
});

it('renders the General and Providers tabs, but no top-level Skills or Projects tab', () => {
  const { tab } = createTab(false);
  const container = document.body.createDiv();
  const cleanup = tab['renderSettings'](container);
  try {
    // Skills moved under the per-provider settings tab; the main settings has no
    // standalone Skills or Projects tab, and the doc folder is chosen per project.
    expect(container.querySelector('.claudian-settings-general')).not.toBeNull();
    expect(container.querySelector('.claudian-settings-provider-tabs')).not.toBeNull();
    expect(container.querySelector('.claudian-settings-skills')).toBeNull();
    expect(container.querySelector('.claudian-settings-projects')).toBeNull();
    expect(within(container).queryByText('Projects')).toBeNull();
  } finally { cleanup(); }
});
