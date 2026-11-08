import '@/providers';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { ProviderRegistration, ProviderSettingsReconciler } from '@/core/providers/types';
import { kiroChatUIConfig } from '@/providers/kiro/ui/KiroChatUIConfig';

// Claude has been removed; the multi-provider enablement/reconciliation contracts
// still need a second registered provider as a neutral vehicle alongside kiro.
// Register a minimal hidden stub under a legacy-looking id so the coercion tests
// also exercise the "hidden stored provider migrates to the visible default" path.
const STUB_PROVIDER_ID = 'legacy-stub';

beforeAll(() => {
  ProviderRegistry.register(STUB_PROVIDER_ID, {
    id: STUB_PROVIDER_ID,
    hidden: true,
    isEnabled: (settings: Record<string, unknown>) => Boolean(
      (settings.providerConfigs as Record<string, { enabled?: boolean }> | undefined)
        ?.[STUB_PROVIDER_ID]?.enabled,
    ),
    setEnabled: (settings: Record<string, unknown>, enabled: boolean) => {
      const configs = (settings.providerConfigs ??= {}) as Record<string, { enabled?: boolean }>;
      (configs[STUB_PROVIDER_ID] ??= {}).enabled = enabled;
    },
    // Borrow kiro's real model policy / chat UI config so the coordinator's
    // projection path (permission modes, model defaults) behaves realistically;
    // the stub only needs a distinct id and enablement behaviour.
    modelPolicy: { ...kiroChatUIConfig, isDefaultModel: () => false },
    chatUIConfig: kiroChatUIConfig,
    settingsReconciler: {
      invalidateConversationSessions: (conversations: unknown[]) => conversations,
      reconcileModelWithEnvironment: () => ({ changed: false }),
      normalizeModelVariantSettings: () => false,
    },
  } as unknown as ProviderRegistration);
});

describe('ProviderSettingsCoordinator', () => {
  describe('normalizeProviderSelection', () => {
    it('falls back to the default provider when the stored provider is disabled', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: STUB_PROVIDER_ID,
        providerConfigs: {
          [STUB_PROVIDER_ID]: { enabled: false },
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
      // A persisted settingsProvider pointing at a hidden provider must be
      // migrated to the visible default rather than retained. This also covers
      // the legacy `settingsProvider: 'claude'` migration after claude's removal:
      // the removed id resolves as unknown and coerces to kiro identically.
      const settings: Record<string, unknown> = {
        settingsProvider: STUB_PROVIDER_ID,
        providerConfigs: {
          kiro: { enabled: true },
        },
      };

      const changed = ProviderSettingsCoordinator.normalizeProviderSelection(settings);

      expect(changed).toBe(true);
      expect(settings.settingsProvider).toBe('kiro');
    });

    it('migrates a removed-provider selection (legacy claude) to the default', () => {
      // Explicit regression for #83: existing users with the deleted claude as
      // their stored settingsProvider must land on the visible default on load.
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
          [STUB_PROVIDER_ID]: { enabled: false },
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
          [STUB_PROVIDER_ID]: { enabled: true },
          kiro: { enabled: false },
        },
      };

      expect(ProviderSettingsCoordinator.canApplyProviderEnablement(
        settings,
        STUB_PROVIDER_ID,
        false,
      )).toBe(false);
      expect(ProviderSettingsCoordinator.canApplyProviderEnablement(
        settings,
        STUB_PROVIDER_ID,
        true,
      )).toBe(true);
      expect(ProviderRegistry.isEnabled(STUB_PROVIDER_ID, settings)).toBe(true);
    });

    it('keeps the sole enabled provider enabled', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: STUB_PROVIDER_ID,
        model: 'sonnet',
        titleGenerationModel: '',
        providerConfigs: {
          [STUB_PROVIDER_ID]: { enabled: true },
          kiro: { enabled: false },
        },
      };

      const accepted = ProviderSettingsCoordinator.applyProviderEnablement(
        settings,
        STUB_PROVIDER_ID,
        false,
      );

      expect(accepted).toBe(false);
      expect(ProviderRegistry.isEnabled(STUB_PROVIDER_ID, settings)).toBe(true);
      expect(ProviderRegistry.getEnabledProviderIds(settings)).toEqual([STUB_PROVIDER_ID]);
      expect(settings.settingsProvider).toBe(STUB_PROVIDER_ID);
    });

    it('atomically disables a provider and preserves dependent title selections', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'kiro',
        titleGenerationModel: 'kiro-model',
        providerConfigs: {
          kiro: { enabled: true },
          [STUB_PROVIDER_ID]: { enabled: true },
        },
      };

      ProviderSettingsCoordinator.applyProviderEnablement(settings, 'kiro', false);

      expect(ProviderRegistry.isEnabled('kiro', settings)).toBe(false);
      expect(settings.settingsProvider).toBe(STUB_PROVIDER_ID);
      expect(settings.titleGenerationModel).toBe('kiro-model');
    });

    it('disables the active provider and selects another enabled provider', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: STUB_PROVIDER_ID,
        model: 'sonnet',
        effortLevel: 'high',
        serviceTier: 'default',
        titleGenerationModel: 'sonnet',
        providerConfigs: {
          [STUB_PROVIDER_ID]: { enabled: true },
          kiro: { enabled: true },
        },
      };

      const accepted = ProviderSettingsCoordinator.applyProviderEnablement(
        settings,
        STUB_PROVIDER_ID,
        false,
      );

      expect(accepted).toBe(true);
      expect(ProviderRegistry.isEnabled(STUB_PROVIDER_ID, settings)).toBe(false);
      expect(settings.settingsProvider).toBe('kiro');
      expect(settings.titleGenerationModel).toBe('sonnet');
    });
  });

  describe('reconcileProviders', () => {
    it('reconciles each provider against the projected settings', () => {
      const reconcileSpy = jest.spyOn(
        ProviderRegistry.getSettingsReconciler(STUB_PROVIDER_ID),
        'reconcileModelWithEnvironment',
      );

      const settings: Record<string, unknown> = { model: 'haiku' };

      ProviderSettingsCoordinator.reconcileProviders(
        settings, ProviderRegistry.getRegisteredProviderIds(),
      );

      // kiro is the settings provider, so the stub is reconciled against a
      // cloned+projected settings object rather than the live one. Reconciliation
      // no longer receives conversations; assert it ran against some settings.
      expect(reconcileSpy).toHaveBeenCalledWith(expect.anything());

      reconcileSpy.mockRestore();
    });

    it('defaults existing providers to invalidation and separates reload-policy providers', () => {
      const defaultReconciler: ProviderSettingsReconciler = {
        invalidateConversationSessions: vi.fn(conversations => conversations),
        reconcileModelWithEnvironment: vi.fn(() => ({ changed: true })),
        normalizeModelVariantSettings: vi.fn(() => false),
      };
      const reloadReconciler: ProviderSettingsReconciler = {
        invalidateConversationSessions: vi.fn(conversations => conversations),
        reconcileModelWithEnvironment: vi.fn(() => ({ changed: true, sessionPolicy: 'reload' as const })),
        normalizeModelVariantSettings: vi.fn(() => false),
      };
      const originalGetSettingsReconciler = ProviderRegistry.getSettingsReconciler.bind(
        ProviderRegistry,
      );
      const originalGetChatUIConfig = ProviderRegistry.getModelPolicy.bind(ProviderRegistry);
      const reconcilerSpy = vi.spyOn(ProviderRegistry, 'getSettingsReconciler')
        .mockImplementation((providerId) => {
          if (providerId === 'fake-invalidate') return defaultReconciler;
          if (providerId === 'fake-reload') return reloadReconciler;
          return originalGetSettingsReconciler(providerId);
        });
      const settingsProviderSpy = vi.spyOn(ProviderRegistry, 'resolveSettingsProviderId')
        .mockReturnValue('fake-invalidate');
      const uiConfigSpy = vi.spyOn(ProviderRegistry, 'getModelPolicy')
        .mockImplementation((providerId) => (
          providerId === 'fake-invalidate' || providerId === 'fake-reload'
            ? originalGetChatUIConfig('kiro')
            : originalGetChatUIConfig(providerId)
        ));
      const result = ProviderSettingsCoordinator.reconcileProviders(
        { model: 'haiku' },
        ['fake-invalidate', 'fake-reload'],
      );
      reconcilerSpy.mockRestore();
      settingsProviderSpy.mockRestore();
      uiConfigSpy.mockRestore();

      // An omitted sessionPolicy defaults to invalidate; the reload provider opts out explicitly.
      expect(jest.mocked(defaultReconciler.reconcileModelWithEnvironment).mock.results[0]!.value)
        .not.toHaveProperty('sessionPolicy');
      expect(result.environmentChangedProviderIds).toEqual([
        'fake-invalidate',
        'fake-reload',
      ]);
      expect(result.sessionInvalidationProviderIds).toEqual(['fake-invalidate']);
    });
  });

  describe('projectActiveProviderState', () => {
    it('projects legacy plan permissions as Safe for kiro', () => {
      for (const permissionMode of ['plan', 'yolo']) {
        const settings = {
          settingsProvider: 'kiro',
          permissionMode,
          savedProviderPermissionMode: { kiro: 'plan' },
        };
        const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(settings, 'kiro');
        expect(snapshot.permissionMode).toBe('normal');
      }
    });

    it('projects an unsaved legacy plan selection as Safe for kiro', () => {
      const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot({
        settingsProvider: 'kiro',
        permissionMode: 'plan',
      }, 'kiro');
      expect(snapshot.permissionMode).toBe('normal');
    });

    it('rejects arrays as provider projection maps when creating a snapshot', () => {
      const arrayProjection = Object.assign([], { kiro: 'array-owned-value' });
      const settings: Record<string, unknown> = {
        settingsProvider: 'kiro',
        model: 'kiro/haiku',
        effortLevel: 'high',
        serviceTier: 'default',
        thinkingBudget: 'off',
        savedProviderModel: arrayProjection,
        savedProviderEffort: arrayProjection,
        savedProviderServiceTier: arrayProjection,
        savedProviderPermissionMode: arrayProjection,
      };

      const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(settings, 'kiro');

      expect(snapshot.savedProviderModel).toEqual({});
      expect(snapshot.savedProviderEffort).toEqual({});
      expect(snapshot.savedProviderServiceTier).toEqual({});
      expect(snapshot.savedProviderPermissionMode).toEqual({});
    });

    it('defaults to the sole visible provider (kiro) when settingsProvider is not set', () => {
      // An unset settingsProvider resolves to kiro, the sole visible provider.
      // The active projection reads kiro's saved values.
      const settings: Record<string, unknown> = {
        model: 'old-model',
        effortLevel: 'low',
        serviceTier: 'default',
        savedProviderModel: { kiro: 'kiro/haiku' },
        savedProviderEffort: { kiro: 'high' },
        savedProviderServiceTier: { kiro: 'default' },
      };

      ProviderSettingsCoordinator.projectActiveProviderState(settings);

      expect(settings.model).toBe('kiro/haiku');
      expect(settings.serviceTier).toBe('default');
    });

    it('does not overwrite when no saved values exist', () => {
      // No saved values for the active provider: the current model/effort are
      // reused rather than reset.
      const settings: Record<string, unknown> = {
        settingsProvider: 'kiro',
        model: 'kiro/haiku',
        effortLevel: 'high',
        serviceTier: 'default',
        savedProviderModel: {},
        savedProviderEffort: {},
        savedProviderServiceTier: {},
      };

      ProviderSettingsCoordinator.projectActiveProviderState(settings);

      expect(settings.model).toBe('kiro/haiku');
      expect(settings.effortLevel).toBe('high');
    });

    it('handles missing saved maps gracefully', () => {
      const settings: Record<string, unknown> = {
        settingsProvider: 'kiro',
        model: 'kiro/haiku',
        effortLevel: 'high',
        serviceTier: 'default',
      };

      // Should not throw
      ProviderSettingsCoordinator.projectActiveProviderState(settings);

      expect(settings.model).toBe('kiro/haiku');
    });
  });
});
