import {
  decodeProviderModelSelectionId,
  encodeProviderModelSelectionId,
  isProviderModelSelectionId,
  toProviderRuntimeModelId,
} from '@/core/providers/modelSelection';

// After the claude provider removal, no built-in provider registers a
// model-selection prefix (kiro uses its own encode/decode). The namespacing
// helpers therefore treat every id as unprefixed; this suite pins that
// behaviour so a future prefixed provider re-registration is a deliberate change.
describe('model selection namespacing (no registered prefixes)', () => {
  describe('encodeProviderModelSelectionId', () => {
    it('trims surrounding whitespace and leaves an unprefixed provider id untouched', () => {
      expect(encodeProviderModelSelectionId('kiro', '  deepseek-v4-pro  ')).toBe('deepseek-v4-pro');
    });

    it('returns an empty string for empty or whitespace-only input', () => {
      expect(encodeProviderModelSelectionId('kiro', '')).toBe('');
      expect(encodeProviderModelSelectionId('kiro', '   ')).toBe('');
    });

    it('leaves the id untouched for any provider when no prefix is registered', () => {
      expect(encodeProviderModelSelectionId('unknown-provider', 'deepseek-v4-pro')).toBe('deepseek-v4-pro');
      expect(encodeProviderModelSelectionId('kiro', 'other-ns/gpt-5')).toBe('other-ns/gpt-5');
    });
  });

  describe('decodeProviderModelSelectionId', () => {
    it('returns null for empty or whitespace-only input', () => {
      expect(decodeProviderModelSelectionId('')).toBeNull();
      expect(decodeProviderModelSelectionId('   ')).toBeNull();
    });

    it('returns null for a non-namespaced model id', () => {
      expect(decodeProviderModelSelectionId('deepseek-v4-pro')).toBeNull();
      expect(decodeProviderModelSelectionId('sonnet')).toBeNull();
    });

    it('returns null for a namespaced-looking id when no prefix is registered', () => {
      expect(decodeProviderModelSelectionId('other-ns/gpt-5')).toBeNull();
    });
  });

  describe('isProviderModelSelectionId', () => {
    it('is false for any value when no prefix is registered', () => {
      expect(isProviderModelSelectionId('kiro', 'other-ns/gpt-5')).toBe(false);
      expect(isProviderModelSelectionId('kiro', 'deepseek-v4-pro')).toBe(false);
      expect(isProviderModelSelectionId('kiro', '')).toBe(false);
    });
  });

  describe('toProviderRuntimeModelId', () => {
    it('leaves a bare model id unchanged', () => {
      expect(toProviderRuntimeModelId('kiro', 'deepseek-v4-pro')).toBe('deepseek-v4-pro');
    });

    it('leaves a namespaced-looking value unchanged when no prefix is registered', () => {
      expect(toProviderRuntimeModelId('kiro', 'other-ns/gpt-5')).toBe('other-ns/gpt-5');
    });

    it('returns an empty string unchanged', () => {
      expect(toProviderRuntimeModelId('kiro', '')).toBe('');
    });
  });
});
