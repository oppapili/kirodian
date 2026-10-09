import { getBuiltInProviderDefaultConfigs } from '@/providers/defaultProviderConfigs';

describe('getBuiltInProviderDefaultConfigs', () => {
  it('returns fresh built-in provider config objects', () => {
    const first = getBuiltInProviderDefaultConfigs();
    const second = getBuiltInProviderDefaultConfigs();

    expect(first).toHaveProperty('claude');
    expect(first).toHaveProperty('kiro');
    expect(first).not.toBe(second);
    expect(first.claude).not.toBe(second.claude);
    expect(first.kiro).not.toBe(second.kiro);
  });
});
