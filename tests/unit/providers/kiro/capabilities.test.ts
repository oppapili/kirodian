import { KIRO_PROVIDER_CAPABILITIES } from '@/providers/kiro/capabilities';

describe('KIRO_PROVIDER_CAPABILITIES', () => {
  it('matches the 2.3.4 ProviderCapabilities contract with Kiro policy values', () => {
    expect(KIRO_PROVIDER_CAPABILITIES).toEqual({
      providerId: 'kiro',
      reasoningControl: 'effort',
      supportsResponseThroughput: false,
      supportsEphemeralSessions: false,
      supportsFork: false,
      supportsImageAttachments: true,
      supportsNativeHistory: true,
      supportsProviderCommands: true,
      supportsRewind: false,
      supportsTurnSteer: false,
    });
  });

  it('declares ephemeral session support explicitly', () => {
    expect(KIRO_PROVIDER_CAPABILITIES.supportsEphemeralSessions).toBe(false);
  });
});
