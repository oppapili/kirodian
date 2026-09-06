import type { ProviderCapabilities } from '../../core/providers/types';

// Kiro speaks standard ACP plus its own `_kiro.dev/*` extensions. It does NOT
// implement xAI's `x.ai/*` fork, rewind, or interject extensions that Grok relies
// on, so those capabilities are disabled here. Plan mode maps to ACP
// `session/set_mode`; reasoning effort, image prompts, native history, and provider
// commands are all supported by the Kiro ACP agent.
export const KIRO_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'kiro',
  reasoningControl: 'effort',
  supportsFork: false,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsNativeHistory: true,
  supportsPlanMode: true,
  supportsProviderCommands: true,
  supportsRewind: false,
  supportsTurnSteer: false,
});
