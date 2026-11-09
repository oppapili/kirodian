import { registerProviderModules } from '../core/providers/registerProviderModules';
import { kiroProviderRegistration } from './kiro/registration';

let builtInProvidersRegistered = false;

export const BUILT_IN_PROVIDER_MODULES = [kiroProviderRegistration] as const;

export function registerBuiltInProviders(): void {
  if (builtInProvidersRegistered) {
    return;
  }

  registerProviderModules(BUILT_IN_PROVIDER_MODULES);
  builtInProvidersRegistered = true;
}

registerBuiltInProviders();
