import { buildSystemPrompt } from '@/core/prompt/mainAgent';
import {
  buildKiroSystemPrompt,
  type KiroSystemPromptSettings,
} from '@/providers/kiro/prompt/KiroSystemPrompt';

/**
 * The Kiro provider's system-prompt builder delegates to the shared main-agent prompt.
 * These tests keep the provider's prompt path covered (and the CI dependency graph's
 * provider -> core/prompt/mainAgent edge intact), asserting the delegation rather than
 * re-testing the shared builder's full output.
 */
describe('buildKiroSystemPrompt', () => {
  const settings: KiroSystemPromptSettings = {
    customPrompt: 'Be concise.',
    userName: 'Ada',
    vaultPath: '/vault',
  };

  it('delegates verbatim to the shared main-agent system prompt builder', () => {
    expect(buildKiroSystemPrompt(settings)).toBe(buildSystemPrompt(settings));
  });

  it('includes the user-authored custom prompt in the built text', () => {
    expect(buildKiroSystemPrompt(settings)).toContain('Be concise.');
  });

  it('builds a non-empty prompt from empty settings', () => {
    expect(buildKiroSystemPrompt({}).length).toBeGreaterThan(0);
  });
});
