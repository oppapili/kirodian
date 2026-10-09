import '@/providers';

import { getEnabledProviderForModel, getProviderForModel } from '@/core/providers/modelRouting';

describe('getProviderForModel', () => {
  it('routes Claude default models to claude', () => {
    expect(getProviderForModel('haiku')).toBe('claude');
    expect(getProviderForModel('sonnet')).toBe('claude');
    expect(getProviderForModel('opus')).toBe('claude');
  });

  it('routes Claude extended models to claude', () => {
    expect(getProviderForModel('claude-sonnet-4-5-20250514')).toBe('claude');
    expect(getProviderForModel('claude-opus-4-6-20250616')).toBe('claude');
  });

  it('leaves unknown models unresolved', () => {
    expect(getProviderForModel('some-unknown-model')).toBeNull();
  });

  it('does not claim a manual environment model', () => {
    const settings = { environmentVariables: 'MANUAL_MODEL=my-custom-model' };
    expect(getProviderForModel('my-custom-model', settings)).toBeNull();
  });

  it('routes provider-qualified custom model ids without raw name collisions', () => {
    const settings = {
      providerConfigs: {
        claude: {
          customModels: 'deepseek-v4-pro',
        },
      },
    };

    expect(getProviderForModel('claude-code/deepseek-v4-pro', settings)).toBe('claude');
  });

  it('resolves ambiguous ownership within enabled providers only', () => {
    const settings = {
      settingsProvider: 'claude',
      providerConfigs: {
        claude: {
          environmentVariables: 'ANTHROPIC_MODEL=env-model',
        },
      },
    };

    expect(getEnabledProviderForModel('env-model', settings)).toBe('claude');
  });
});

it('leaves an unclaimed model unresolved instead of selecting the default provider', () => {
  expect(getProviderForModel('retired-endpoint-model', {
    providerConfigs: { claude: { enabled: true } },
  })).toBeNull();
});
