import { getKiroProviderSettings } from '@/providers/kiro/settings';
import { kiroChatUIConfig } from '@/providers/kiro/ui/KiroChatUIConfig';
import { KIRO_PROVIDER_ICON } from '@/shared/icons';

const catalog = {
  defaultModelId: 'kiro-code-fast-1',
  fingerprint: 'catalog-fingerprint',
  models: [
    {
      contextWindow: 256_000,
      defaultReasoningEffort: 'medium',
      description: 'Kiro coding model',
      displayName: 'Kiro Code Fast 1',
      rawId: 'kiro-code-fast-1',
      reasoningMetadataResolved: true,
      reasoningEfforts: [
        { description: 'Fastest', label: 'Minimal Effort', value: 'minimal' },
        { label: 'High Effort', value: 'high' },
        { label: 'Extra High Effort', value: 'xhigh' },
      ],
      supportsReasoning: true,
    },
  ],
  refreshedAt: 100,
};

function makeSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    providerConfigs: {
      kiro: {
        catalogsByHost: {
          'device:current': catalog,
        },
        preferredReasoningByModel: {
          'kiro-code-fast-1': 'high',
        },
        visibleModels: ['kiro-code-fast-1'],
      },
    },
    ...overrides,
  };
}

jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => 'device:current',
}));

describe('KiroChatUIConfig', () => {
  it('owns provider-qualified Kiro models and exposes discovered options', () => {
    expect(kiroChatUIConfig.ownsModel('kiro/kiro-code-fast-1', makeSettings())).toBe(true);
    expect(kiroChatUIConfig.ownsModel('kiro-code-fast-1', {})).toBe(false);
    expect(kiroChatUIConfig.getDefaultModel?.(makeSettings())).toBe('kiro/kiro-code-fast-1');
    expect(kiroChatUIConfig.getProviderIcon?.()).toBe(KIRO_PROVIDER_ICON);
    expect(kiroChatUIConfig.getModelOptions(makeSettings())).toEqual([
      expect.objectContaining({
        description: 'Kiro coding model',
        label: 'Kiro Code Fast 1',
        value: 'kiro/kiro-code-fast-1',
      }),
    ]);
  });

  it('projects reasoning options and persists a selection from model metadata', () => {
    const settings = makeSettings();
    expect(kiroChatUIConfig.isAdaptiveReasoningModel('kiro/kiro-code-fast-1', settings)).toBe(true);
    expect(kiroChatUIConfig.getDefaultReasoningValue('kiro/kiro-code-fast-1', settings)).toBe('high');

    kiroChatUIConfig.applyReasoningSelection?.('kiro/kiro-code-fast-1', 'xhigh', settings);
    expect(getKiroProviderSettings(settings).preferredReasoningByModel).toEqual({
      'kiro-code-fast-1': 'xhigh',
    });
  });

  it('exposes a two-value Safe/YOLO permission toggle without a plan value', () => {
    expect(kiroChatUIConfig.getPermissionModeToggle?.()).toEqual({
      activeLabel: 'YOLO',
      activeValue: 'yolo',
      inactiveLabel: 'Safe',
      inactiveValue: 'normal',
    });
  });

  it('does not expose a Kiro-native mode selector', () => {
    expect(kiroChatUIConfig.getModeSelector?.({})).toBeNull();
  });

  it('resolves and applies only Safe and YOLO permission modes', () => {
    const settings: Record<string, unknown> = {
      permissionMode: 'yolo',
      providerConfigs: { kiro: { enabled: true } },
    };

    // Obsolete plan selections collapse to Safe.
    kiroChatUIConfig.applyPermissionMode?.('plan', settings);
    expect(settings.permissionMode).toBe('normal');
    expect(kiroChatUIConfig.resolvePermissionMode?.(settings)).toBe('normal');

    kiroChatUIConfig.applyPermissionMode?.('yolo', settings);
    expect(settings.permissionMode).toBe('yolo');
    expect(kiroChatUIConfig.resolvePermissionMode?.(settings)).toBe('yolo');
  });
});
