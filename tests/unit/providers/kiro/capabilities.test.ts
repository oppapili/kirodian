import { KIRO_PROVIDER_CAPABILITIES } from '@/providers/kiro/capabilities';

describe('KIRO_PROVIDER_CAPABILITIES', () => {
  // Kiro does not implement xAI's fork/rewind/interject ACP extensions, so these
  // must stay disabled; enabling them would drive calls Kiro cannot answer.
  it('disables the xAI-only fork, rewind, and turn-steer capabilities', () => {
    expect(KIRO_PROVIDER_CAPABILITIES.supportsFork).toBe(false);
    expect(KIRO_PROVIDER_CAPABILITIES.supportsRewind).toBe(false);
    expect(KIRO_PROVIDER_CAPABILITIES.supportsTurnSteer).toBe(false);
  });

  it('keeps the capabilities Kiro does support', () => {
    expect(KIRO_PROVIDER_CAPABILITIES.providerId).toBe('kiro');
    expect(KIRO_PROVIDER_CAPABILITIES.reasoningControl).toBe('effort');
    expect(KIRO_PROVIDER_CAPABILITIES.supportsImageAttachments).toBe(true);
    expect(KIRO_PROVIDER_CAPABILITIES.supportsPlanMode).toBe(true);
    expect(KIRO_PROVIDER_CAPABILITIES.supportsNativeHistory).toBe(true);
  });
});
