import type { ProviderConfigMap } from '../core/types/settings';
import { DEFAULT_KIRO_PROVIDER_SETTINGS } from './kiro/settings';

export function getBuiltInProviderDefaultConfigs(): ProviderConfigMap {
  return {
    kiro: { ...DEFAULT_KIRO_PROVIDER_SETTINGS },
  };
}
