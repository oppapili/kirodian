import {
ensureProviderProjectionMap,
normalizeProviderProjectionMap
} from '@/core/providers/settings/ProviderProjectionMap';

describe('ProviderProjectionMap', () => {

  it.each([null, undefined, 'model', 1, true, []])(
    'rejects non-map input %p',
    (value) => {
      expect(normalizeProviderProjectionMap(value)).toEqual({});
    },
  );

  it('preserves string values and filters mixed persisted types', () => {
    expect(normalizeProviderProjectionMap({
      claude: '',
      kiro: 'gpt-test',
      alpha: null,
      beta: 42,
      gamma: false,
    })).toEqual({
      claude: '',
      kiro: 'gpt-test',
    });
  });

  it('returns a fresh, safely-owned object and ignores inherited values', () => {
    const persisted = Object.create({ inherited: 'bad' }) as Record<string, unknown>;
    persisted.kiro = 'gpt-test';
    Object.defineProperty(persisted, '__proto__', {
      enumerable: true,
      value: 'saved-value',
    });

    const normalized = normalizeProviderProjectionMap(persisted);

    expect(normalized).not.toBe(persisted);
    expect(normalized.kiro).toBe('gpt-test');
    expect(normalized.__proto__).toBe('saved-value');
    expect(Object.keys(normalized)).toEqual(['kiro', '__proto__']);
    expect(Object.getPrototypeOf(normalized)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(normalized, '__proto__')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(normalized, 'inherited')).toBe(false);
  });

  it('normalizes and replaces the persisted map when ensuring ownership', () => {
    const settings: Record<string, unknown> = {
      savedProviderModel: ['array-entry'],
    };

    const ensured = ensureProviderProjectionMap(settings, 'savedProviderModel');
    ensured.kiro = 'gpt-test';

    expect(settings.savedProviderModel).toBe(ensured);
    expect(settings.savedProviderModel).toEqual({ kiro: 'gpt-test' });
  });
});
