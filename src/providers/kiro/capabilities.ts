import type { ProviderCapabilities } from '../../core/providers/types';

// Kiro speaks standard ACP plus its own `_kiro.dev/*` extensions. It does NOT
// implement the `x.ai/*` fork, rewind, or interject extensions, so those
// capabilities are disabled here. Reasoning effort, image prompts, native
// history, and provider commands are all supported by the Kiro ACP agent.
// Kiro always persists native conversation history, so it has no ephemeral-session
// mode (`supportsEphemeralSessions: false`).
export const KIRO_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'kiro',
  reasoningControl: 'effort',
  supportsEphemeralSessions: false,
  supportsFork: false,
  supportsImageAttachments: true,
  supportsNativeHistory: true,
  supportsProviderCommands: true,
  supportsResponseThroughput: false,
  supportsRewind: false,
  supportsTurnSteer: false,
});
