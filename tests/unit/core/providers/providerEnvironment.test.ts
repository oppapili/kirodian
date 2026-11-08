import '@/providers';

import { runInNewContext } from 'vm';

import {
  classifyEnvironmentVariablesByOwnership,
  getEnvironmentReviewKeysForScope,
  getEnvironmentScopeUpdates,
  getProviderEnvironmentVariables,
  getRuntimeEnvironmentText,
  getRuntimeEnvironmentVariables,
  getSharedEnvironmentVariables,
  inferEnvironmentSnippetScope,
  resolveEnvironmentSnippetScope,
  setProviderEnvironmentVariables,
  setSharedEnvironmentVariables,
} from '@/core/providers/providerEnvironment';

describe('providerEnvironment', () => {
  describe('classifyEnvironmentVariablesByOwnership', () => {
    it('splits shared and Kiro vars by ownership', () => {
      const result = classifyEnvironmentVariablesByOwnership([
        'PATH=/usr/local/bin',
        'AWS_ACCESS_KEY_ID=kiro-key',
        'KIRO_SANDBOX=workspace-write',
        'CUSTOM_FLAG=1',
      ].join('\n'));

      expect(result.shared).toBe(['PATH=/usr/local/bin', 'CUSTOM_FLAG=1'].join('\n'));
      expect(result.providers.kiro).toBe([
        'AWS_ACCESS_KEY_ID=kiro-key',
        'KIRO_SANDBOX=workspace-write',
      ].join('\n'));
      expect(result.reviewKeys).toEqual(['CUSTOM_FLAG']);
    });

    it('keeps comments attached to the next owned variable when migrating', () => {
      const result = classifyEnvironmentVariablesByOwnership([
        '# shared comment',
        'PATH=/usr/local/bin',
        '',
        '# kiro comment',
        'KIRO_SANDBOX=workspace-write',
      ].join('\n'));

      expect(result.shared).toBe(['# shared comment', 'PATH=/usr/local/bin'].join('\n'));
      expect(result.providers.kiro).toBe(['', '# kiro comment', 'KIRO_SANDBOX=workspace-write'].join('\n'));
    });
  });

  describe('runtime env accessors', () => {
    it.each([
      ['ANTHROPIC_MODEL=custom-model', 'shared'],
      ['__proto__=provider', 'provider'],
      ['__proto__=', ''],
    ])('preserves explicit shared/provider keys with %s', (providerText, expectedValue) => {
      const settings = {
        sharedEnvironmentVariables: '__proto__=shared\nPATH=/usr/local/bin',
        providerConfigs: {
          claude: { environmentVariables: providerText },
        },
      };

      const result = getRuntimeEnvironmentVariables(settings, 'claude');

      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(true);
      expect(result['__proto__']).toBe(expectedValue);
      // Keep native spread semantics for the prototype-sensitive assertion.
      expect(runInNewContext('({ ...environment })', { environment: result })['__proto__'])
        .toBe(expectedValue);
      expect(result.PATH).toBe('/usr/local/bin');
    });

    it('reads split shared/provider env from settings', () => {
      const settings: Record<string, unknown> = {
        sharedEnvironmentVariables: 'PATH=/usr/local/bin',
        providerConfigs: {
          claude: { environmentVariables: 'ANTHROPIC_MODEL=custom-model' },
        },
      };

      expect(getSharedEnvironmentVariables(settings)).toBe('PATH=/usr/local/bin');
      expect(getProviderEnvironmentVariables(settings, 'claude')).toBe('ANTHROPIC_MODEL=custom-model');
      expect(getRuntimeEnvironmentText(settings, 'claude')).toBe([
        'PATH=/usr/local/bin',
        'ANTHROPIC_MODEL=custom-model',
      ].join('\n'));
    });

    it('ignores retired single-bag environment settings', () => {
      const settings = { environmentVariables: 'PATH=/retired\nANTHROPIC_MODEL=retired\nOPENAI_MODEL=retired' };
      expect(getSharedEnvironmentVariables(settings)).toBe('');
      expect(getProviderEnvironmentVariables(settings, 'claude')).toBe('');
      expect(getProviderEnvironmentVariables(settings, 'kiro')).toBe('');
    });

    it('updates split env settings through scoped setters', () => {
      const settings: Record<string, unknown> = {};

      setSharedEnvironmentVariables(settings, 'PATH=/usr/local/bin');
      setProviderEnvironmentVariables(settings, 'kiro', 'AWS_ACCESS_KEY_ID=test-key');

      expect(settings.sharedEnvironmentVariables).toBe('PATH=/usr/local/bin');
      expect(settings.providerConfigs).toEqual({
        kiro: { environmentVariables: 'AWS_ACCESS_KEY_ID=test-key' },
      });
    });
  });

  describe('getEnvironmentReviewKeysForScope', () => {
    it('flags unknown keys left in shared env for manual review', () => {
      const reviewKeys = getEnvironmentReviewKeysForScope([
        'PATH=/usr/local/bin',
        'CUSTOM_FLAG=1',
      ].join('\n'), 'shared');

      expect(reviewKeys).toEqual(['CUSTOM_FLAG']);
    });

    it('flags shared and foreign-provider keys in provider env sections', () => {
      const reviewKeys = getEnvironmentReviewKeysForScope([
        'PATH=/usr/local/bin',
        'AWS_ACCESS_KEY_ID=test-key',
        'CUSTOM_FLAG=1',
      ].join('\n'), 'provider:claude');

      expect(reviewKeys).toEqual(['PATH', 'AWS_ACCESS_KEY_ID', 'CUSTOM_FLAG']);
    });
  });

  describe('inferEnvironmentSnippetScope', () => {
    it('returns shared for neutral-only snippets', () => {
      expect(inferEnvironmentSnippetScope('PATH=/usr/local/bin')).toBe('shared');
    });

    it('returns provider scope for single-provider snippets', () => {
      expect(inferEnvironmentSnippetScope('AWS_PROFILE=kiro-profile')).toBe('provider:kiro');
    });

    it('keeps mixed-ownership legacy snippets unscoped', () => {
      expect(inferEnvironmentSnippetScope([
        'PATH=/usr/local/bin',
        'KIRO_SANDBOX=workspace-write',
      ].join('\n'))).toBeUndefined();
    });
  });

  describe('resolveEnvironmentSnippetScope', () => {
    it('normalizes mixed snippets back to unscoped even if a stale scope was saved', () => {
      expect(resolveEnvironmentSnippetScope([
        'PATH=/usr/local/bin',
        'KIRO_SANDBOX=workspace-write',
      ].join('\n'), 'shared')).toBeUndefined();
    });

    it('keeps the fallback scope only for empty snippets', () => {
      expect(resolveEnvironmentSnippetScope('', 'provider:kiro')).toBe('provider:kiro');
    });
  });

  describe('getEnvironmentScopeUpdates', () => {
    it('reclassifies mixed snippets into separate scope updates', () => {
      expect(getEnvironmentScopeUpdates([
        'PATH=/usr/local/bin',
        'KIRO_SANDBOX=workspace-write',
      ].join('\n'), 'shared')).toEqual([
        { scope: 'shared', envText: 'PATH=/usr/local/bin' },
        { scope: 'provider:kiro', envText: 'KIRO_SANDBOX=workspace-write' },
      ]);
    });

    it('uses the fallback scope only when there is no inferable content', () => {
      expect(getEnvironmentScopeUpdates('', 'provider:kiro')).toEqual([
        { scope: 'provider:kiro', envText: '' },
      ]);
    });
  });
});
