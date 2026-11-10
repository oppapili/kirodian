import { parseCLIVersion } from '@/core/providers/cli/CLIInstallationProbe';

import {
  type KiroCatalogCommandRunner,
  SpawnKiroCatalogCommandRunner,
} from './KiroModelCatalogService';

// `--agent-engine` and the `acp.agentEngine` setting arrived in kiro-cli 2.36
// (https://kiro.dev/docs/cli/acp/). Older CLIs reject unknown flags and fail to start.
const AGENT_ENGINE_FLAG_MIN_VERSION: readonly [number, number, number] = [2, 36, 0];
const VERSION_COMMAND_TIMEOUT_MS = 5_000;

export interface KiroACPLaunchContext {
  readonly command: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

/**
 * Builds `kiro-cli acp` arguments that pin the V2 engine (the one Kirodian is written against)
 * whenever the CLI accepts `--agent-engine`. Without the pin, a user-level `acp.agentEngine=v3`
 * silently moves Kirodian to V3. An unknown version is treated as new enough: a missing or
 * unparsable `--version` is far more likely on a current CLI than on one older than 2.36.
 */
export function buildKiroACPArgs(versionOutput: string | null): string[] {
  const version = parseCLIVersion(versionOutput);
  if (version && !isAtLeast(version, AGENT_ENGINE_FLAG_MIN_VERSION)) return ['acp'];
  return ['acp', '--agent-engine', 'v2'];
}

/** Reads `kiro-cli --version` and builds the `acp` arguments for it. */
export async function resolveKiroACPArgs(
  context: KiroACPLaunchContext,
  signal?: AbortSignal,
  runner: KiroCatalogCommandRunner = new SpawnKiroCatalogCommandRunner(),
): Promise<string[]> {
  try {
    const result = await runner.run({
      args: ['--version'],
      command: context.command,
      cwd: context.cwd,
      env: context.env,
      signal,
      timeoutMs: VERSION_COMMAND_TIMEOUT_MS,
    });
    return buildKiroACPArgs(result.exitCode === 0 && !result.termination ? result.stdout : null);
  } catch {
    return buildKiroACPArgs(null);
  }
}

function isAtLeast(version: string, minimum: readonly [number, number, number]): boolean {
  const parts = version.split(/[-+]/u)[0].split('.').map(Number);
  for (let index = 0; index < minimum.length; index += 1) {
    if (parts[index] !== minimum[index]) return parts[index] > minimum[index];
  }
  return true;
}
