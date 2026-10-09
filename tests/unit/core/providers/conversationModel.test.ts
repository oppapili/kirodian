import {
  getConversationModelPersistenceTarget,
  resolveConversationModel,
  resolveNewConversationModel,
} from '@/core/providers/conversationModel';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { ProviderChatUIConfig, ProviderId } from '@/core/providers/types';

interface TestProviderConfig {
  defaultModel?: string | null;
  normalizations?: Record<string, string>;
  options: string[];
  variantFallback?: string;
}

function createUIConfig(config: TestProviderConfig): ProviderChatUIConfig {
  return {
    getModelOptions: () => config.options.map(value => ({ label: value, value })),
    getCustomModelIds: () => new Set(),
    getDefaultModel: () => config.defaultModel ?? null,
    ownsModel: model => config.options.includes(model),
    isAdaptiveReasoningModel: () => false,
    getReasoningOptions: () => [],
    getDefaultReasoningValue: () => 'off',
    isDefaultModel: () => false,
    applyModelDefaults: () => undefined,
    normalizeAvailableModelSelection: model => config.normalizations?.[model] ?? model,
    normalizeModelVariant: model => config.variantFallback ?? model,
  };
}

describe('conversation model resolution', () => {
  const providers: Record<ProviderId, TestProviderConfig> = {
    claude: { defaultModel: 'opus', options: ['haiku', 'opus'] },
    kiro: { defaultModel: 'kiro/model-a', options: ['kiro/model-a', 'kiro/model-b'] },
    empty: { defaultModel: null, options: [] },
  };

  beforeEach(() => {
    providers.claude = { defaultModel: 'opus', options: ['haiku', 'opus'] };
    providers.kiro = {
      defaultModel: 'kiro/model-a',
      options: ['kiro/model-a', 'kiro/model-b'],
    };
    providers.empty = { defaultModel: null, options: [] };
    jest.spyOn(ProviderRegistry, 'getRegisteredProviderIds')
      .mockReturnValue(Object.keys(providers));
    jest.spyOn(ProviderRegistry, 'getChatUIConfig')
      .mockImplementation(providerId => createUIConfig(providers[providerId ?? 'claude']!));
    jest.spyOn(ProviderRegistry, 'isEnabled')
      .mockImplementation((providerId, settings) => (
        ((settings.enabledProviders as string[] | undefined) ?? []).includes(providerId)
      ));
    jest.spyOn(ProviderRegistry, 'getBlankTabProviderIds')
      .mockImplementation(settings => (
        ((settings.displayOrder as string[] | undefined) ?? [])
          .filter(providerId => ProviderRegistry.isEnabled(providerId, settings))
      ));
  });

  it('preserves an unavailable last-selected model', () => {
    expect(resolveNewConversationModel({
      enabledProviders: ['claude', 'kiro'], displayOrder: ['claude', 'kiro'],
      lastSelectedChatModel: { providerId: 'claude', model: 'retired' },
    })).toEqual({ providerId: 'claude', model: 'retired', source: 'last-selected' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('resolveNewConversationModel', () => {
    it('uses the provider-qualified global selection when it is currently available', () => {
      const result = resolveNewConversationModel({
        displayOrder: ['claude', 'kiro'],
        enabledProviders: ['claude', 'kiro'],
        lastSelectedChatModel: { providerId: 'kiro', model: 'kiro/model-b' },
      });

      expect(result).toEqual({
        model: 'kiro/model-b',
        providerId: 'kiro',
        source: 'last-selected',
      });
    });

    it('applies provider normalization before treating the global selection as unavailable', () => {
      providers.claude.options = ['claude-code/claude-opus-enterprise'];
      providers.claude.normalizations = {
        opus: 'claude-code/claude-opus-enterprise',
      };

      expect(resolveNewConversationModel({
        displayOrder: ['claude'],
        enabledProviders: ['claude'],
        lastSelectedChatModel: { providerId: 'claude', model: 'opus' },
      })).toEqual({
        model: 'claude-code/claude-opus-enterprise',
        providerId: 'claude',
        source: 'last-selected',
      });

      providers.claude.options = ['haiku', 'opus'];
      providers.claude.normalizations = undefined;
    });

    it('preserves the unavailable last selected model', () => {
      const result = resolveNewConversationModel({
        displayOrder: ['claude', 'kiro'],
        enabledProviders: ['claude', 'kiro'],
        lastSelectedChatModel: { providerId: 'kiro', model: 'kiro/retired' },
      });

      expect(result).toEqual({
        model: 'kiro/retired',
        providerId: 'kiro',
        source: 'last-selected',
      });
    });

    it('preserves the unavailable last selected model over variant defaults', () => {
      providers.kiro.defaultModel = 'kiro/model-ordered';
      providers.kiro.options = ['kiro/model-ordered', 'kiro/model-native'];
      providers.kiro.variantFallback = 'kiro/model-native';

      expect(resolveNewConversationModel({
        displayOrder: ['kiro'],
        enabledProviders: ['kiro'],
        lastSelectedChatModel: { providerId: 'kiro', model: 'kiro/retired' },
      })).toEqual({
        model: 'kiro/retired',
        providerId: 'kiro',
        source: 'last-selected',
      });
    });

    it('falls back to the first available provider default in explicit display order', () => {
      const result = resolveNewConversationModel({
        displayOrder: ['claude', 'kiro'],
        enabledProviders: ['claude', 'kiro'],
        lastSelectedChatModel: { providerId: 'disabled', model: 'disabled/model' },
      });

      expect(result).toEqual({
        model: 'opus',
        providerId: 'claude',
        source: 'provider-fallback',
      });
    });

    it('preserves selection from an enabled provider with no available options', () => {
      const result = resolveNewConversationModel({
        displayOrder: ['empty', 'kiro'],
        enabledProviders: ['empty', 'kiro'],
        lastSelectedChatModel: { providerId: 'empty', model: 'empty/model' },
      });

      expect(result).toEqual({
        model: 'empty/model',
        providerId: 'empty',
        source: 'last-selected',
      });
    });

    it('returns null when no enabled provider exposes a model', () => {
      expect(resolveNewConversationModel({
        displayOrder: ['empty'],
        enabledProviders: ['empty'],
        lastSelectedChatModel: null,
      })).toBeNull();
    });
  });

  describe('resolveConversationModel', () => {
    it('exposes one persistence target for normalized and fallback replacements', () => {
      expect(getConversationModelPersistenceTarget({
        model: 'canonical-model',
        shouldPersist: true,
        source: 'selected',
      })).toBe('canonical-model');
      expect(getConversationModelPersistenceTarget({
        model: 'retired-model',
        modelToPersist: 'provider-default',
        shouldPersist: true,
        source: 'selected',
      })).toBe('provider-default');
    });

    it('keeps a stored conversation selection that is currently available', () => {
      expect(resolveConversationModel(
        {},
        'claude',
        { selectedModel: 'haiku' } as any,
      )).toEqual({
        model: 'haiku',
        shouldPersist: false,
        source: 'selected',
      });
    });

    it('applies provider normalization before replacing a stored conversation selection', () => {
      providers.claude.options = ['claude-code/claude-opus-enterprise'];
      providers.claude.normalizations = {
        opus: 'claude-code/claude-opus-enterprise',
      };

      expect(resolveConversationModel(
        {},
        'claude',
        { selectedModel: 'opus' } as any,
      )).toEqual({
        model: 'claude-code/claude-opus-enterprise',
        shouldPersist: true,
        source: 'selected',
      });

      providers.claude.options = ['haiku', 'opus'];
      providers.claude.normalizations = undefined;
    });

    it('persists a provider default for an unavailable usage-derived legacy model', () => {
      expect(resolveConversationModel(
        {},
        'claude',
        { usage: { model: 'retired-claude-model' } } as any,
      )).toEqual({
        model: 'opus',
        shouldPersist: true,
        source: 'usage',
      });
    });

    it('preserves an unavailable stored model without scheduling a fallback write', () => {
      expect(resolveConversationModel(
        {},
        'claude',
        { selectedModel: 'retired-claude-model' } as any,
      )).toEqual({
        model: 'retired-claude-model',
        shouldPersist: false,
        source: 'selected',
      });
    });

    it('preserves the stored model over ordered defaults and variant fallbacks', () => {
      providers.kiro.defaultModel = 'kiro/model-ordered';
      providers.kiro.options = ['kiro/model-ordered', 'kiro/model-native'];
      providers.kiro.variantFallback = 'kiro/model-native';

      expect(resolveConversationModel(
        {},
        'kiro',
        { selectedModel: 'kiro/retired' } as any,
      )).toEqual({
        model: 'kiro/retired',
        shouldPersist: false,
        source: 'selected',
      });
    });

    it('preserves a stored historical selection when the provider has no authoritative options', () => {
      expect(resolveConversationModel(
        {},
        'empty',
        { selectedModel: 'empty/historical' } as any,
      )).toEqual({
        model: 'empty/historical',
        shouldPersist: false,
        source: 'selected',
      });
    });

    it('preserves the stored model when the provider default is invalid', () => {
      providers.claude.defaultModel = 'retired-default';

      expect(resolveConversationModel(
        {},
        'claude',
        { selectedModel: 'retired-claude-model' } as any,
      )).toEqual({
        model: 'retired-claude-model',
        shouldPersist: false,
        source: 'selected',
      });

      providers.claude.defaultModel = 'opus';
    });
  });
});
