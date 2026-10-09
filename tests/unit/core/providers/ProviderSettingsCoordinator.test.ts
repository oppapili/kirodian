import '@/providers';

import { claudeCatalogFixture } from '@test/helpers/claudeModels';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { ProviderSettingsReconciler } from '@/core/providers/types';
import type { Conversation } from '@/core/types';
import { DEFAULT_CLAUDE_PROVIDER_SETTINGS } from '@/providers/claude/settings';

describe('ProviderSettingsCoordinator', () => {
  describe('normalizeProviderSelection', () => {
    it('falls back to the default provider when the stored provider is disabled', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'claude',
        providerConfigs: {
          claude: { enabled: false },
          kiro: { enabled: true },
        },
      };

      const changed = ProviderSettingsCoordinator.normalizeProviderSelection(settings);

      expect(changed).toBe(true);
      expect(settings.settingsProvider).toBe('kiro');
    });

    it('falls back to the default provider for unknown providers', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'mystery-provider',
        providerConfigs: {
          kiro: { enabled: true },
        },
      };

      const changed = ProviderSettingsCoordinator.normalizeProviderSelection(settings);

      expect(changed).toBe(true);
      expect(settings.settingsProvider).toBe('kiro');
    });

    it('normalizes a hidden stored provider away to the default', () => {
      // Claude is hidden: a persisted settingsProvider pointing at it must be
      // migrated to the visible default rather than retained.
      const settings: Record<string, unknown> = {
        settingsProvider: 'claude',
        providerConfigs: {
          kiro: { enabled: true },
        },
      };

      const changed = ProviderSettingsCoordinator.normalizeProviderSelection(settings);

      expect(changed).toBe(true);
      expect(settings.settingsProvider).toBe('kiro');
    });

    it('returns false when already normalized (no-op)', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'kiro',
        providerConfigs: {
          claude: { enabled: false },
          kiro: { enabled: true },
        },
      };
      expect(ProviderSettingsCoordinator.normalizeProviderSelection(settings)).toBe(false);
    });
  });

  describe('applyProviderEnablement', () => {
    it('preflights the sole enabled provider without mutating settings', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          claude: { ...DEFAULT_CLAUDE_PROVIDER_SETTINGS, enabled: true },
          kiro: { enabled: false },
        },
      };

      expect(ProviderSettingsCoordinator.canApplyProviderEnablement(
        settings,
        'claude',
        false,
      )).toBe(false);
      expect(ProviderSettingsCoordinator.canApplyProviderEnablement(
        settings,
        'claude',
        true,
      )).toBe(true);
      expect(ProviderRegistry.isEnabled('claude', settings)).toBe(true);
    });

    it('keeps the sole enabled provider enabled', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'claude',
        model: 'sonnet',
        titleGenerationModel: '',
        providerConfigs: {
          claude: { ...DEFAULT_CLAUDE_PROVIDER_SETTINGS, enabled: true },
          kiro: { enabled: false },
        },
      };

      const accepted = ProviderSettingsCoordinator.applyProviderEnablement(
        settings,
        'claude',
        false,
      );

      expect(accepted).toBe(false);
      expect(ProviderRegistry.isEnabled('claude', settings)).toBe(true);
      expect(ProviderRegistry.getEnabledProviderIds(settings)).toEqual(['claude']);
      expect(settings.settingsProvider).toBe('claude');
    });

    it('atomically disables a provider and preserves dependent title selections', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'kiro',
        titleGenerationModel: 'kiro-model',
        providerConfigs: {
          kiro: { enabled: true },
          claude: { ...DEFAULT_CLAUDE_PROVIDER_SETTINGS, enabled: true },
        },
      };

      ProviderSettingsCoordinator.applyProviderEnablement(settings, 'kiro', false);

      expect(ProviderRegistry.isEnabled('kiro', settings)).toBe(false);
      expect(settings.settingsProvider).toBe('claude');
      expect(settings.titleGenerationModel).toBe('kiro-model');
    });

    it('disables Claude and selects another enabled provider', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'claude',
        model: 'sonnet',
        effortLevel: 'high',
        serviceTier: 'default',
        thinkingBudget: 'off',
        titleGenerationModel: 'sonnet',
        providerConfigs: {
          claude: { ...DEFAULT_CLAUDE_PROVIDER_SETTINGS, enabled: true },
          kiro: { enabled: true },
        },
      };

      const accepted = ProviderSettingsCoordinator.applyProviderEnablement(
        settings,
        'claude',
        false,
      );

      expect(accepted).toBe(true);
      expect(ProviderRegistry.isEnabled('claude', settings)).toBe(false);
      expect(settings.settingsProvider).toBe('kiro');
      expect(settings.titleGenerationModel).toBe('sonnet');
    });
  });

  describe('reconcileProviders', () => {
    it('filters conversations per provider', () => {
      const reconcileSpy = jest.spyOn(
        ProviderRegistry.getSettingsReconciler('claude'),
        'reconcileModelWithEnvironment',
      );

      const claudeConv = { providerId: 'claude', messages: [] } as unknown as Conversation;
      const otherConv = { providerId: 'kiro', messages: [] } as unknown as Conversation;
      const settings: Record<string, unknown> = { model: 'haiku' };

      ProviderSettingsCoordinator.reconcileProviders(
        settings, [claudeConv, otherConv], ProviderRegistry.getRegisteredProviderIds(),
      );

      // Claude reconciler should only receive claude conversations
      expect(reconcileSpy).toHaveBeenCalledWith(
        settings,
        [claudeConv],
      );

      reconcileSpy.mockRestore();
    });

    it('defaults existing providers to invalidation and separates reload-policy providers', () => {
      const defaultReconciler: ProviderSettingsReconciler = {
        invalidateConversationSessions: jest.fn(conversations => conversations),
        reconcileModelWithEnvironment: jest.fn((_settings, conversations) => ({
          changed: true,
          invalidatedConversations: conversations,
        })),
        normalizeModelVariantSettings: jest.fn(() => false),
      };
      const reloadReconciler: ProviderSettingsReconciler = {
        environmentSessionPolicy: 'reload',
        invalidateConversationSessions: jest.fn(conversations => conversations),
        reconcileModelWithEnvironment: jest.fn(() => ({
          changed: true,
          invalidatedConversations: [],
        })),
        normalizeModelVariantSettings: jest.fn(() => false),
      };
      const originalGetSettingsReconciler = ProviderRegistry.getSettingsReconciler.bind(
        ProviderRegistry,
      );
      const originalGetChatUIConfig = ProviderRegistry.getChatUIConfig.bind(ProviderRegistry);
      const reconcilerSpy = jest.spyOn(ProviderRegistry, 'getSettingsReconciler')
        .mockImplementation((providerId) => {
          if (providerId === 'fake-invalidate') return defaultReconciler;
          if (providerId === 'fake-reload') return reloadReconciler;
          return originalGetSettingsReconciler(providerId);
        });
      const settingsProviderSpy = jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId')
        .mockReturnValue('fake-invalidate');
      const uiConfigSpy = jest.spyOn(ProviderRegistry, 'getChatUIConfig')
        .mockImplementation((providerId) => (
          providerId === 'fake-invalidate' || providerId === 'fake-reload'
            ? originalGetChatUIConfig('claude')
            : originalGetChatUIConfig(providerId)
        ));
      const invalidatedConversation = {
        id: 'invalidate-conversation',
        providerId: 'fake-invalidate',
        messages: [],
      } as unknown as Conversation;
      const preservedConversation = {
        id: 'reload-conversation',
        providerId: 'fake-reload',
        messages: [],
      } as unknown as Conversation;

      const result = ProviderSettingsCoordinator.reconcileProviders(
        { model: 'haiku' },
        [invalidatedConversation, preservedConversation],
        ['fake-invalidate', 'fake-reload'],
      );
      reconcilerSpy.mockRestore();
      settingsProviderSpy.mockRestore();
      uiConfigSpy.mockRestore();

      expect(defaultReconciler.environmentSessionPolicy).toBeUndefined();
      expect(result.environmentChangedProviderIds).toEqual([
        'fake-invalidate',
        'fake-reload',
      ]);
      expect(result.sessionInvalidationProviderIds).toEqual(['fake-invalidate']);
      expect(result.invalidatedConversations).toEqual([invalidatedConversation]);
    });
  });

  describe('reconcileTitleGenerationModelSelection', () => {
    it('stores a Claude title model without inferring environment provenance', () => {
      const settings: Record<string, unknown> = {
        titleGenerationModel: '',
        providerConfigs: {
          claude: {
            ...DEFAULT_CLAUDE_PROVIDER_SETTINGS,
            environmentVariables: 'ANTHROPIC_DEFAULT_FABLE_MODEL=gpt-4.1',
          },
        },
      };

      ProviderSettingsCoordinator.applyTitleGenerationModelSelection(
        settings,
        'claude-code/gpt-4.1',
      );

      expect(settings.titleGenerationModel).toBe('claude-code/gpt-4.1');
    });

    it('migrates available Claude custom title models to provider-qualified ids', () => {
      const settings: Record<string, unknown> = {
        titleGenerationModel: 'claude-opus-4-6',
        providerConfigs: {
          claude: {
            ...DEFAULT_CLAUDE_PROVIDER_SETTINGS,
            discoveredModels: [{ value: 'claude-opus-4-6', label: 'Opus', description: '' }],
            visibleModels: ['claude-opus-4-6'],
          },
        },
      };

      expect(
        ProviderSettingsCoordinator.reconcileTitleGenerationModelSelection(settings),
      ).toBe(true);
      expect(settings.titleGenerationModel).toBe('claude-code/claude-opus-4-6');
    });

    it('preserves titleGenerationModel when no provider exposes the saved model', () => {
      const settings: Record<string, unknown> = {
        titleGenerationModel: 'claude-opus-4-6',
        providerConfigs: {
          claude: {
            ...DEFAULT_CLAUDE_PROVIDER_SETTINGS,
            customModels: '',
          },
        },
      };

      expect(
        ProviderSettingsCoordinator.reconcileTitleGenerationModelSelection(settings),
      ).toBe(false);
      expect(settings.titleGenerationModel).toBe('claude-opus-4-6');
    });

    it('preserves stale provider-qualified custom title models', () => {
      const settings: Record<string, unknown> = {
        titleGenerationModel: 'legacy-provider/my-custom-model',
        providerConfigs: {
          claude: {
            ...DEFAULT_CLAUDE_PROVIDER_SETTINGS,
            customModels: '',
          },
        },
      };

      expect(
        ProviderSettingsCoordinator.reconcileTitleGenerationModelSelection(settings),
      ).toBe(false);
      expect(settings.titleGenerationModel).toBe('legacy-provider/my-custom-model');
    });

    it('preserves unavailable raw custom title IDs', () => {
      const settings: Record<string, unknown> = {
        titleGenerationModel: 'my-custom-model',
        providerConfigs: {
          claude: {
            ...DEFAULT_CLAUDE_PROVIDER_SETTINGS,
            customModels: 'my-custom-model',
          },
        },
      };

      expect(
        ProviderSettingsCoordinator.reconcileTitleGenerationModelSelection(settings),
      ).toBe(false);
      expect(settings.titleGenerationModel).toBe('my-custom-model');
    });
  });

  describe('Claude environment reconciliation', () => {
    it('preserves an inactive Claude selection across environment changes', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'kiro',
        model: 'haiku',
        effortLevel: 'high',
        serviceTier: 'default',
        thinkingBudget: 'off',
        savedProviderModel: {
          claude: 'claude-code/fable-v1',
        },
        providerConfigs: {
          claude: {
            ...DEFAULT_CLAUDE_PROVIDER_SETTINGS,
            environmentVariables: [
              'ANTHROPIC_DEFAULT_HAIKU_MODEL=haiku-v2',
              'ANTHROPIC_DEFAULT_FABLE_MODEL=fable-v2',
            ].join('\n'),
            environmentHash: [
              'ANTHROPIC_DEFAULT_FABLE_MODEL=fable-v1',
              'ANTHROPIC_DEFAULT_HAIKU_MODEL=haiku-v1',
            ].join('|'),
          },
          kiro: { enabled: true },
        },
      };

      ProviderSettingsCoordinator.reconcileProviders(settings, [], ['claude']);

      expect(settings.savedProviderModel).toMatchObject({
        claude: 'claude-code/fable-v1',
      });
    });

    it('preserves a title model while environment configuration changes', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'claude',
        model: 'claude-code/custom-haiku',
        titleGenerationModel: 'claude-code/fable-old',
        providerConfigs: {
          claude: {
            ...DEFAULT_CLAUDE_PROVIDER_SETTINGS,
            environmentVariables: 'ANTHROPIC_DEFAULT_HAIKU_MODEL=custom-haiku',
            environmentHash: [
              'ANTHROPIC_DEFAULT_FABLE_MODEL=fable-old',
              'ANTHROPIC_DEFAULT_HAIKU_MODEL=custom-haiku',
            ].join('|'),
          },
        },
      };

      ProviderSettingsCoordinator.reconcileProviders(settings, [], ['claude']);

      expect(settings.titleGenerationModel).toBe('claude-code/fable-old');

      (settings.providerConfigs as Record<string, Record<string, unknown>>).claude.environmentVariables = [
        'ANTHROPIC_DEFAULT_HAIKU_MODEL=custom-haiku',
        'ANTHROPIC_DEFAULT_FABLE_MODEL=fable-new',
      ].join('\n');

      ProviderSettingsCoordinator.reconcileProviders(settings, [], ['claude']);

      expect(settings.titleGenerationModel).toBe('claude-code/fable-old');
    });
  });

  describe('projectActiveProviderState', () => {
    it.each(['claude', 'kiro'] as const)(
      'projects legacy plan permissions as Safe for %s',
      (providerId) => {
        for (const permissionMode of ['plan', 'yolo']) {
          const settings = {
            settingsProvider: providerId,
            permissionMode,
            savedProviderPermissionMode: { [providerId]: 'plan' },
          };
          const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(settings, providerId);
          expect(snapshot.permissionMode).toBe('normal');
        }
      },
    );

    it.each(['claude', 'kiro'] as const)(
      'projects an unsaved legacy plan selection as Safe for %s',
      (providerId) => {
        const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot({
          settingsProvider: providerId,
          permissionMode: 'plan',
        }, providerId);
        expect(snapshot.permissionMode).toBe('normal');
      },
    );

    it('rejects arrays as provider projection maps when creating a snapshot', () => {
      const arrayProjection = Object.assign([], { claude: 'array-owned-value' });
      const settings: Record<string, unknown> = {
        settingsProvider: 'claude',
        model: 'haiku',
        effortLevel: 'high',
        serviceTier: 'default',
        thinkingBudget: 'off',
        savedProviderModel: arrayProjection,
        savedProviderEffort: arrayProjection,
        savedProviderServiceTier: arrayProjection,
        savedProviderThinkingBudget: arrayProjection,
        savedProviderPermissionMode: arrayProjection,
      };

      const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(settings, 'claude');

      expect(snapshot.savedProviderModel).toEqual({});
      expect(snapshot.savedProviderEffort).toEqual({});
      expect(snapshot.savedProviderServiceTier).toEqual({});
      expect(snapshot.savedProviderThinkingBudget).toEqual({});
      expect(snapshot.savedProviderPermissionMode).toEqual({});
    });

    it('defaults to claude when settingsProvider is not set', () => {
      const settings: Record<string, unknown> = {
        model: 'old-model',
        effortLevel: 'low',
        serviceTier: 'default',
        thinkingBudget: '500',
        savedProviderModel: { claude: 'sonnet' },
        savedProviderEffort: { claude: 'high' },
        savedProviderServiceTier: { claude: 'default' },
        savedProviderThinkingBudget: { claude: 'off' },
      };

      ProviderSettingsCoordinator.projectActiveProviderState(settings);

      expect(settings.model).toBe('sonnet');
      expect(settings.effortLevel).toBe('high');
      expect(settings.serviceTier).toBe('default');
      expect(settings.thinkingBudget).toBe('500');
    });

    it('does not overwrite when no saved values exist', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'claude',
        model: 'haiku',
        effortLevel: 'high',
        serviceTier: 'default',
        thinkingBudget: 'off',
        savedProviderModel: {},
        savedProviderEffort: {},
        savedProviderServiceTier: {},
        savedProviderThinkingBudget: {},
      };

      ProviderSettingsCoordinator.projectActiveProviderState(settings);

      expect(settings.model).toBe('haiku');
      expect(settings.effortLevel).toBe('high');
      expect(settings.thinkingBudget).toBe('off');
    });

    it('handles missing saved maps gracefully', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'claude',
        model: 'haiku',
        effortLevel: 'high',
        serviceTier: 'default',
        thinkingBudget: 'off',
      };

      // Should not throw
      ProviderSettingsCoordinator.projectActiveProviderState(settings);

      expect(settings.model).toBe('haiku');
    });

    it('normalizes saved effort values that the projected Claude model no longer supports', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'claude',
        providerConfigs: { claude: claudeCatalogFixture(['claude-sonnet-4-5'], ['low', 'medium', 'high']) },
        model: 'claude-sonnet-4-5',
        effortLevel: 'xhigh',
        serviceTier: 'default',
        thinkingBudget: 'off',
        savedProviderModel: { claude: 'claude-sonnet-4-5' },
        savedProviderEffort: { claude: 'xhigh' },
        savedProviderServiceTier: { claude: 'default' },
        savedProviderThinkingBudget: { claude: 'off' },
      };

      ProviderSettingsCoordinator.projectActiveProviderState(settings);

      expect(settings.model).toBe('claude-code/claude-sonnet-4-5');
      expect(settings.effortLevel).toBe('high');
    });
  });
});
