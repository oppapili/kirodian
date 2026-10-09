import '@/providers';

import { claudeCatalogFixture } from '@test/helpers/claudeModels';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderId,
  TitleGenerationService,
} from '@/core/providers/types';

describe('ProviderRegistry', () => {
  beforeEach(() => {
    ProviderWorkspaceRegistry.clear();
    ProviderWorkspaceRegistry.setServices('claude', {
    } as any);
    jest.spyOn(ProviderWorkspaceRegistry, 'ensureInitialized')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns capabilities for the default provider', () => {
    const caps = ProviderRegistry.getCapabilities();
    expect(caps.providerId).toBe('kiro');
    expect(caps).toHaveProperty('supportsFork');
  });

  it('throws when an unknown provider is requested', () => {
    expect(() => ProviderRegistry.getCapabilities(
      'nonexistent' as any,
    )).toThrow('Provider "nonexistent" is not registered.');
  });

  it('returns Claude capabilities', () => {
    const caps = ProviderRegistry.getCapabilities('claude');
    expect(caps.providerId).toBe('claude');
    expect(caps.supportsFork).toBe(true);
    expect(caps.supportsRewind).toBe(true);
    expect(caps.reasoningControl).toBe('effort');
  });

  it('returns Kiro capabilities', () => {
    const caps = ProviderRegistry.getCapabilities('kiro');
    expect(caps.providerId).toBe('kiro');
    expect(caps.supportsProviderCommands).toBe(true);
    expect(caps.supportsImageAttachments).toBe(true);
    expect(caps.supportsFork).toBe(false);
    expect(caps.supportsRewind).toBe(false);
  });

  it('registers provider-owned subagent protocols outside the capability matrix', () => {
    const claudeAdapter = ProviderRegistry.getSubagentAdapter('claude');
    expect(claudeAdapter).toMatchObject({
      protocol: 'managed-agent',
    });
    expect(ProviderRegistry.getSubagentAdapter('kiro')).toMatchObject({
      protocol: 'lifecycle',
    });

    expect(claudeAdapter?.isSpawnTool('Agent')).toBe(true);
    expect(claudeAdapter?.isSpawnTool('Task')).toBe(false);

    for (const providerId of ['claude', 'kiro'] as const) {
      expect(ProviderRegistry.getCapabilities(providerId)).not.toHaveProperty(
        'supportsLegacySubagentTools',
      );
    }
  });

  it('lists registered provider ids', () => {
    const ids = ProviderRegistry.getRegisteredProviderIds();
    expect(ids).toContain('claude');
    expect(ids).toContain('kiro');
  });

  it('filters enabled provider ids using registration metadata', () => {
    expect(ProviderRegistry.getEnabledProviderIds({
      providerConfigs: {
        kiro: { enabled: false },
      },
    })).toEqual(['claude']);
    expect(ProviderRegistry.getEnabledProviderIds({
      providerConfigs: {
        kiro: { enabled: true },
      },
    })).toEqual(['kiro', 'claude']);
    expect(ProviderRegistry.getEnabledProviderIds({
      providerConfigs: {
        claude: { enabled: false },
        kiro: { enabled: true },
      },
    })).toEqual(['kiro']);
  });

  it('exposes the blank-tab provider order from top to bottom', () => {
    // Claude is hidden (code retained, removed from UI), so it never appears in
    // the blank-tab picker even while enabled. Kiro (blankTabOrder 12) is the
    // only visible built-in that remains.
    expect(ProviderRegistry.getBlankTabProviderIds({
      providerConfigs: {
        kiro: { enabled: true },
      },
    })).toEqual(['kiro']);
  });

  it('defaults to kiro as the chat provider', () => {
    expect(ProviderRegistry.getCapabilities().providerId).toBe('kiro');
  });

  it('keeps a hidden provider enabled but out of the visible set', () => {
    const settings = { providerConfigs: { kiro: { enabled: true } } };
    // Claude is enabled-by-default yet hidden: present in enabled, absent from visible.
    expect(ProviderRegistry.getEnabledProviderIds(settings)).toContain('claude');
    expect(ProviderRegistry.getVisibleProviderIds(settings)).not.toContain('claude');
    expect(ProviderRegistry.isVisible('claude', settings)).toBe(false);
    expect(ProviderRegistry.isVisible('kiro', settings)).toBe(true);
    expect(ProviderRegistry.getVisibleProviderIds(settings)).toContain('kiro');
  });

  it('resolves the settings provider to kiro when the stored selection is hidden', () => {
    expect(ProviderRegistry.resolveSettingsProviderId({
      settingsProvider: 'claude',
      providerConfigs: { kiro: { enabled: true } },
    })).toBe('kiro');
  });

  it('exposes title generation models only from enabled providers', () => {
    const disabledSettings = {
      providerConfigs: {
        claude: {
          discoveredModels: [{ value: 'sonnet', label: 'Sonnet', description: '' }],
          visibleModels: ['sonnet'],
          enabled: false,
        },
      },
    };
    const enabledSettings = {
      providerConfigs: {
        claude: {
          discoveredModels: [{ value: 'sonnet', label: 'Sonnet', description: '' }],
          visibleModels: ['sonnet'],
          enabled: true,
        },
      },
    };

    expect(
      ProviderRegistry.getTitleGenerationModelOptions(disabledSettings)
        .some(option => option.value === 'sonnet'),
    ).toBe(false);
    expect(
      ProviderRegistry.getTitleGenerationModelOptions(enabledSettings)
        .some(option => option.value === 'sonnet'),
    ).toBe(true);
  });

  it('prefixes title generation model labels with their provider names', () => {
    const options = ProviderRegistry.getTitleGenerationModelOptions({
      providerConfigs: {
        claude: {
          discoveredModels: [{ value: 'sonnet', label: 'Sonnet', description: '' }],
          visibleModels: ['sonnet'],
          enabled: true,
        },
      },
    });



    expect(options.find(option => option.value === 'sonnet')?.label)
      .toBe('Claude Code: Sonnet');
  });

  it('returns the display name from provider registration metadata', () => {
    expect(ProviderRegistry.getProviderDisplayName('claude')).toBe('Claude Code');
    expect(ProviderRegistry.getProviderDisplayName('kiro')).toBe('Kiro');
  });

  it('requires an explicit title model instead of selecting Claude automatically', async () => {
    const providerCalls: ProviderId[] = [];
    const originalCreate = ProviderRegistry.createTitleGenerationService.bind(ProviderRegistry);
    jest.spyOn(ProviderRegistry, 'createTitleGenerationService')
      .mockImplementation((plugin: any, providerId?: ProviderId) => {
        if (!providerId) {
          return originalCreate(plugin);
        }
        providerCalls.push(providerId);
        return createMockTitleService(providerId);
      });

    const service = ProviderRegistry.createTitleGenerationService({
      settings: {
        titleGenerationModel: '',
        providerConfigs: {
          claude: { enabled: true },
        },
      },
    } as any);
    const callback = jest.fn();

    await service.generateTitle('conv-1', 'hello', callback);

    expect(providerCalls).toEqual([]);
    expect(ProviderWorkspaceRegistry.ensureInitialized).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith('conv-1', {
      success: false,
      error: expect.stringContaining('Select an available title model'),
    });
  });

  it('routes explicit title model selections to the owning provider', async () => {
    const providerCalls: ProviderId[] = [];
    const originalCreate = ProviderRegistry.createTitleGenerationService.bind(ProviderRegistry);
    jest.spyOn(ProviderRegistry, 'createTitleGenerationService')
      .mockImplementation((plugin: any, providerId?: ProviderId) => {
        if (!providerId) {
          return originalCreate(plugin);
        }
        providerCalls.push(providerId);
        return createMockTitleService(providerId);
      });

    const service = ProviderRegistry.createTitleGenerationService({
      settings: {
        titleGenerationModel: 'claude-code/sonnet',
        providerConfigs: {
          claude: {
            ...claudeCatalogFixture(['sonnet']),
            enabled: true,
          },
        },
      },
    } as any);
    const callback = jest.fn();

    await service.generateTitle('conv-1', 'hello', callback);

    expect(providerCalls).toEqual(['claude']);
    expect(callback).toHaveBeenCalledWith('conv-1', {
      success: true,
      title: 'claude title',
    });
  });

  it('rechecks title availability after provider initialization', async () => {
    const settings = {
      titleGenerationModel: 'claude-code/sonnet',
      providerConfigs: {
        claude: { ...claudeCatalogFixture(['sonnet']), enabled: true },
      },
    };
    jest.mocked(ProviderWorkspaceRegistry.ensureInitialized).mockImplementation(async () => {
      settings.providerConfigs.claude.enabled = false;
    });
    const createService = jest.spyOn(ProviderRegistry, 'createTitleGenerationService');
    const service = ProviderRegistry.createTitleGenerationService({ settings } as any);
    const callback = jest.fn();
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
    cancel: jest.fn(),
    generateTitle: jest.fn(async (conversationId, _userMessage, callback) => {
      await callback(conversationId, {
        success: true,
        title: `${providerId} title`,
      });
    }),
  };
}
