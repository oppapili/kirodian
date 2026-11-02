import '@/providers';

import { getEnabledProviderForModel, getProviderForModel } from '@/core/providers/modelRouting';
import { updateCurrentKiroCatalog, updateKiroProviderSettings } from '@/providers/kiro/settings';

/** Settings with a kiro catalog that advertises the given raw model ids. */
function kiroSettingsWithModels(rawIds: string[]): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  updateCurrentKiroCatalog(settings, {
    defaultModelId: null,
    fingerprint: 'test-fingerprint',
    refreshedAt: 0,
    models: rawIds.map(rawId => ({
      rawId,
      displayName: rawId,
      description: '',
      reasoningEfforts: [],
      supportsReasoning: false,
    })),
  });
  updateKiroProviderSettings(settings, { enabled: true, visibleModels: rawIds });
  return settings;
}

describe('getProviderForModel', () => {
  it('routes kiro catalog models to kiro', () => {
    const settings = kiroSettingsWithModels(['sonnet', 'opus']);
    expect(getProviderForModel('kiro/sonnet', settings)).toBe('kiro');
    expect(getProviderForModel('kiro/opus', settings)).toBe('kiro');
  });

  it('leaves unknown models unresolved', () => {
    expect(getProviderForModel('some-unknown-model')).toBeNull();
  });

  it('does not claim a model absent from the kiro catalog', () => {
    const settings = kiroSettingsWithModels(['sonnet']);
    expect(getProviderForModel('kiro/not-in-catalog', settings)).toBeNull();
  });

  it('resolves ownership within enabled providers only', () => {
    const settings = kiroSettingsWithModels(['sonnet']);
    expect(getEnabledProviderForModel('kiro/sonnet', settings)).toBe('kiro');
  });
});

it('leaves an unclaimed model unresolved instead of selecting the default provider', () => {
  expect(getProviderForModel('retired-endpoint-model', {
    providerConfigs: { kiro: { enabled: true } },
  })).toBeNull();
});
