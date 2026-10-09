import type { ProviderConfigMap } from '../core/types/settings';
import { DEFAULT_CLAUDE_PROVIDER_SETTINGS } from './claude/settings';
import { DEFAULT_KIRO_PROVIDER_SETTINGS } from './kiro/settings';

export function getBuiltInProviderDefaultConfigs(): ProviderConfigMap {
  return {
    claude: { ...DEFAULT_CLAUDE_PROVIDER_SETTINGS },
    kiro: { ...DEFAULT_KIRO_PROVIDER_SETTINGS },
  };
}
