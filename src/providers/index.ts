import { ProviderRegistry } from '../core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '../core/providers/ProviderWorkspaceRegistry';
import { kiroProviderRegistration } from './kiro/registration';

let builtInProvidersRegistered = false;

export const BUILT_IN_PROVIDER_MODULES = [kiroProviderRegistration] as const;

export function registerBuiltInProviders(): void {
  if (builtInProvidersRegistered) {
    return;
  }

  for (const providerModule of BUILT_IN_PROVIDER_MODULES) {
    ProviderRegistry.register(providerModule.id, providerModule);
    ProviderWorkspaceRegistry.register(providerModule.id, providerModule.workspace);
  }
  builtInProvidersRegistered = true;
}

registerBuiltInProviders();
