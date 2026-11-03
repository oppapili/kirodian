import { getEnhancedPath, parseEnvironmentVariables } from '@/core/process/env';

/**
 * Build the Kiro subprocess environment from the already-resolved runtime
 * environment text (shared plus Kiro-scoped). Runtime modules obtain this from
 * `ProviderRuntimeHost.environmentText`, so this never reads the settings document.
 */
export function buildKiroRuntimeEnv(
  environmentText: string,
  cliPath: string,
): NodeJS.ProcessEnv {
  const configuredEnvironment = parseEnvironmentVariables(environmentText);

  return {
    // Embedded vaults need native project discovery without a terminal trust prompt.
    // Explicit process or configured environment values retain precedence.
    GROK_FOLDER_TRUST: '0',
    ...process.env,
    ...configuredEnvironment,
    PATH: getEnhancedPath(configuredEnvironment.PATH, cliPath || undefined),
  };
}
