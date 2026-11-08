import '@/providers';

import { partialMock } from '@test/helpers/partialMock';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderId,
  ProviderWorkspaceServices,
  TitleGenerationService,
} from '@/core/providers/types';
import { updateCurrentKiroCatalog, updateKiroProviderSettings } from '@/providers/kiro/settings';

type TitleHost = Parameters<typeof ProviderRegistry.createTitleGenerationService>[0];

/** Build settings whose kiro catalog advertises the given raw model ids. */
function kiroSettingsWithModels(
  rawIds: string[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  updateCurrentKiroCatalog(settings, {
    defaultModelId: null,
    fingerprint: 'test-fingerprint',
    refreshedAt: 0,
    models: rawIds.map(rawId => ({
      rawId,
      displayName: rawId.charAt(0).toUpperCase() + rawId.slice(1),
      description: '',
      reasoningEfforts: [],
      supportsReasoning: false,
    })),
  });
  updateKiroProviderSettings(settings, { enabled: true, visibleModels: rawIds, ...overrides });
  return settings;
}

describe('ProviderRegistry', () => {
  beforeEach(() => {
    ProviderWorkspaceRegistry.clear();
    ProviderWorkspaceRegistry.setServices('kiro', partialMock<ProviderWorkspaceServices>({
    }));
    vi.spyOn(ProviderWorkspaceRegistry, 'ensureInitialized')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns capabilities for the default provider', () => {
    const caps = ProviderRegistry.getCapabilities();
    expect(caps.providerId).toBe('kiro');
    expect(caps).toHaveProperty('supportsFork');
  });

  it('throws when an unknown provider is requested', () => {
    expect(() => ProviderRegistry.getCapabilities(
      'nonexistent',
    )).toThrow('Provider "nonexistent" is not registered.');
  });

  it('returns Kiro capabilities', () => {
    const caps = ProviderRegistry.getCapabilities('kiro');
    expect(caps.providerId).toBe('kiro');
    expect(caps.supportsProviderCommands).toBe(true);
    expect(caps.supportsImageAttachments).toBe(true);
    expect(caps.supportsFork).toBe(false);
    expect(caps.supportsRewind).toBe(false);
  });

  it('registers the kiro subagent protocol outside the capability matrix', () => {
    expect(ProviderRegistry.getSubagentAdapter('kiro')).toMatchObject({
      protocol: 'lifecycle',
    });

    expect(ProviderRegistry.getCapabilities('kiro')).not.toHaveProperty(
      'supportsLegacySubagentTools',
    );
  });

  it('lists registered provider ids', () => {
    const ids = ProviderRegistry.getRegisteredProviderIds();
    expect(ids).toEqual(['kiro']);
  });

  it('filters enabled provider ids using registration metadata', () => {
    expect(ProviderRegistry.getEnabledProviderIds({
      providerConfigs: {
        kiro: { enabled: false },
      },
    })).toEqual([]);
    expect(ProviderRegistry.getEnabledProviderIds({
      providerConfigs: {
        kiro: { enabled: true },
      },
    })).toEqual(['kiro']);
  });

  it('exposes the blank-tab provider order from top to bottom', () => {
    // Kiro (blankTabOrder 12) is the only visible built-in that remains after
    // the claude provider removal.
    expect(ProviderRegistry.getBlankTabProviderIds({
      providerConfigs: {
        kiro: { enabled: true },
      },
    })).toEqual(['kiro']);
  });

  it('defaults to kiro as the chat provider', () => {
    expect(ProviderRegistry.getCapabilities().providerId).toBe('kiro');
  });

  it('shows kiro in the visible set on a fresh install with no stored provider config', () => {
    // Regression for the initial-install blank provider menu (#88): with no
    // persisted settings, kiro must default to enabled so the provider menu
    // renders. An empty settings object must yield exactly the kiro entry.
    const settings = {};
    expect(ProviderRegistry.getVisibleProviderIds(settings)).toEqual(['kiro']);
    expect(ProviderRegistry.isVisible('kiro', settings)).toBe(true);
  });

  it('resolves the settings provider to kiro when the stored selection is a removed provider', () => {
    expect(ProviderRegistry.resolveSettingsProviderId({
      settingsProvider: 'claude',
      providerConfigs: { kiro: { enabled: true } },
    })).toBe('kiro');
  });

  it('exposes title generation models only from enabled providers', () => {
    const disabledSettings = kiroSettingsWithModels(['sonnet'], { enabled: false });
    const enabledSettings = kiroSettingsWithModels(['sonnet'], { enabled: true });

    expect(
      ProviderRegistry.getTitleGenerationModelOptions(disabledSettings)
        .some(option => option.value === 'kiro/sonnet'),
    ).toBe(false);
    expect(
      ProviderRegistry.getTitleGenerationModelOptions(enabledSettings)
        .some(option => option.value === 'kiro/sonnet'),
    ).toBe(true);
  });

  it('prefixes title generation model labels with their provider names', () => {
    const options = ProviderRegistry.getTitleGenerationModelOptions(
      kiroSettingsWithModels(['sonnet'], { enabled: true }),
    );

    expect(options.find(option => option.value === 'kiro/sonnet')?.label)
      .toBe('Kiro: Sonnet');
  });

  it('returns the display name from provider registration metadata', () => {
    expect(ProviderRegistry.getProviderDisplayName('kiro')).toBe('Kiro');
  });

  it('requires an explicit title model instead of selecting a provider automatically', async () => {
    const providerCalls: ProviderId[] = [];
    const originalCreate = ProviderRegistry.createTitleGenerationService.bind(ProviderRegistry);
    vi.spyOn(ProviderRegistry, 'createTitleGenerationService')
      .mockImplementation((plugin, providerId?: ProviderId) => {
        if (!providerId) {
          return originalCreate(plugin);
        }
        providerCalls.push(providerId);
        return createMockTitleService(providerId);
      });

    const service = ProviderRegistry.createTitleGenerationService(partialMock<TitleHost>({
      settings: {
        titleGenerationModel: '',
        providerConfigs: {
          kiro: { enabled: true },
        },
      },
    }));
    const callback = vi.fn();

    await service.generateTitle('conv-1', 'hello', callback);

    expect(providerCalls).toEqual([]);
    expect(ProviderWorkspaceRegistry.ensureInitialized).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith('conv-1', {
      success: false,
      error: expect.stringContaining('Select an available title model'),
    });
  });

  it('routes explicit title model selections to the owning provider', async () => {
    // Upstream routes through RoutedTitleGenerationService, which resolves the
    // owning provider and initializes it before creating the per-provider
    // service. Assert the routing decision (kiro) and that the owner is
    // initialized for title generation.
    const settings = {
      ...kiroSettingsWithModels(['sonnet'], { enabled: true }),
      titleGenerationModel: 'kiro/sonnet',
    };

    expect(ProviderRegistry.resolveTitleGenerationSelection(settings))
      .toEqual({ providerId: 'kiro', model: 'kiro/sonnet' });

    const service = ProviderRegistry.createTitleGenerationService(partialMock<TitleHost>({ settings }));
    const callback = vi.fn();
    await service.generateTitle('conv-1', 'hello', callback);

    expect(ProviderWorkspaceRegistry.ensureInitialized).toHaveBeenCalledWith(
      expect.anything(),
      'kiro',
      'title-generation',
    );
  });

  it('rechecks title availability after provider initialization', async () => {
    const settings = {
      ...kiroSettingsWithModels(['sonnet'], { enabled: true }),
      titleGenerationModel: 'kiro/sonnet',
    };
    vi.mocked(ProviderWorkspaceRegistry.ensureInitialized).mockImplementation(async () => {
      updateKiroProviderSettings(settings, { enabled: false });
    });
    const createService = vi.spyOn(ProviderRegistry, 'createTitleGenerationService');
    const service = ProviderRegistry.createTitleGenerationService(partialMock<TitleHost>({ settings }));
    const callback = vi.fn();
    await service.generateTitle('conversation', 'hello', callback);
    expect(createService).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('conversation', {
      success: false,
      error: expect.stringContaining('became unavailable'),
    });
  });

});

function createMockTitleService(providerId: ProviderId): TitleGenerationService {
  return {
    cancel: vi.fn(),
    generateTitle: vi.fn(async (conversationId, _userMessage, callback) => {
      await callback(conversationId, {
        success: true,
        title: `${providerId} title`,
      });
    }),
  };
}
