import { getRuntimeEnvironmentVariables } from '../../../core/providers/providerEnvironment';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type { ProviderTransitionOwnerContext } from '../../../core/providers/types';
import { getVaultPath } from '../../../utils/path';
import {
  type KiroDiscoveredAgent,
  normalizeKiroAgentScopeToken,
  normalizeKiroDiscoveredAgents,
} from '../agents';
import { getKiroProviderSettings } from '../settings';
import {
  buildKiroCatalogFingerprint,
  type KiroCatalogCommandResult,
  type KiroCatalogCommandRunner,
  SpawnKiroCatalogCommandRunner,
} from './KiroModelCatalogService';
import { buildKiroRuntimeEnv } from './KiroRuntimeEnvironment';

const AGENT_COMMAND_TIMEOUT_MS = 20_000;
const VERSION_COMMAND_TIMEOUT_MS = 5_000;
const ANSI_ESCAPE_SEQUENCE = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  'g',
);
// Scope tokens as printed by `kiro-cli agent list`.
const SCOPE_TOKEN_PATTERN = /\(Built-in\)|\bGlobal\b|\bLocal\b/u;

export interface KiroAgentListParseResult {
  agents: KiroDiscoveredAgent[];
  currentAgentId: string | null;
}

export type KiroAgentCatalogDiscoveryResult =
  | {
    agents: KiroDiscoveredAgent[];
    currentAgentId: string | null;
    diagnostics?: string;
    fingerprint: string;
    kind: 'completed';
  }
  | {
    kind: 'skipped';
    reason: 'provider-disabled';
  };

export interface KiroAgentCatalogServiceLike {
  discoverCatalog(
    signal?: AbortSignal,
    context?: ProviderTransitionOwnerContext,
  ): Promise<KiroAgentCatalogDiscoveryResult>;
}

export interface KiroAgentCatalogServiceOptions {
  agentCommandTimeoutMs?: number;
  runner?: KiroCatalogCommandRunner;
  versionCommandTimeoutMs?: number;
}

interface KiroResolvedAgentCommandContext {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  environmentKeys: string[];
}

/**
 * Parses the PLAIN formatted text of `kiro-cli agent list` (there is NO
 * `--format json`). Each agent row is `<id>  <scope>  <description>` where scope
 * is one of `(Built-in)`, `Global`, or `Local`; a leading `*` marks the current
 * agent. Descriptions may wrap onto indented continuation lines (empty id column)
 * which are joined into the preceding agent's description. Header/noise lines such
 * as a leading `Error: File URI not found ...` (WSL URI resolution failure) and
 * `Workspace:` / `Global:` section headers are excluded. Duplicate ids collapse to
 * the first occurrence and blank ids are dropped.
 */
export function parseKiroAgentListOutput(output: string): KiroAgentListParseResult {
  const agents: KiroDiscoveredAgent[] = [];
  const seen = new Set<string>();
  let currentAgentId: string | null = null;
  let lastAgent: KiroDiscoveredAgent | null = null;

  for (const rawLine of stripAnsi(output).split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+$/u, '');
    if (!line.trim()) {
      continue;
    }
    if (isNoiseLine(line)) {
      continue;
    }

    // Continuation lines are indented and carry no id/scope: append to the
    // preceding agent's description.
    if (/^\s/u.test(rawLine) && !SCOPE_TOKEN_PATTERN.test(line) && lastAgent) {
      const continuation = line.trim();
      if (continuation) {
        lastAgent.description = lastAgent.description
          ? `${lastAgent.description} ${continuation}`
          : continuation;
      }
      continue;
    }

    const parsed = parseAgentRow(line);
    if (!parsed) {
      continue;
    }
    if (parsed.current) {
      currentAgentId = parsed.id;
    }
    if (seen.has(parsed.id)) {
      continue;
    }
    seen.add(parsed.id);
    const agent: KiroDiscoveredAgent = {
      ...(parsed.description ? { description: parsed.description } : {}),
      id: parsed.id,
      scope: parsed.scope,
    };
    agents.push(agent);
    lastAgent = agent;
  }

  return {
    agents: normalizeKiroDiscoveredAgents(agents),
    currentAgentId: currentAgentId && seen.has(currentAgentId) ? currentAgentId : null,
  };
}

function parseAgentRow(line: string): {
  current: boolean;
  description?: string;
  id: string;
  scope: KiroDiscoveredAgent['scope'];
} | null {
  const scopeMatch = SCOPE_TOKEN_PATTERN.exec(line);
  if (!scopeMatch || scopeMatch.index === undefined) {
    return null;
  }
  const scope = normalizeKiroAgentScopeToken(scopeMatch[0]);
  if (!scope) {
    return null;
  }

  let head = line.slice(0, scopeMatch.index).trim();
  const current = head.startsWith('*');
  if (current) {
    head = head.slice(1).trim();
  }
  const id = head.split(/\s+/u)[0]?.trim() ?? '';
  if (!id) {
    return null;
  }
  const description = line.slice(scopeMatch.index + scopeMatch[0].length).trim();
  return {
    current,
    ...(description ? { description } : {}),
    id,
    scope,
  };
}

function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith('Error:')) {
    return true;
  }
  // `Workspace:` / `Global:` section headers end with a colon and carry no scope token.
  if (/^[A-Za-z][\w -]*:$/u.test(trimmed) && !SCOPE_TOKEN_PATTERN.test(trimmed)) {
    return true;
  }
  return false;
}

export class KiroAgentCatalogService implements KiroAgentCatalogServiceLike {
  private readonly runner: KiroCatalogCommandRunner;

  constructor(
    private readonly plugin: ProviderHost,
    private readonly options: KiroAgentCatalogServiceOptions = {},
  ) {
    this.runner = options.runner ?? new SpawnKiroCatalogCommandRunner();
  }

  async discoverCatalog(
    signal?: AbortSignal,
    ownerContext?: ProviderTransitionOwnerContext,
  ): Promise<KiroAgentCatalogDiscoveryResult> {
    if (!getKiroProviderSettings(this.plugin.settings).enabled) {
      return { kind: 'skipped', reason: 'provider-disabled' };
    }

    try {
      const context = await this.resolveCommandContext(ownerContext);
      const fingerprint = await this.resolveFingerprint(context, signal);
      const commandResult = await this.runner.run({
        args: ['agent', 'list'],
        command: context.command,
        cwd: context.cwd,
        env: context.env,
        signal,
        timeoutMs: this.options.agentCommandTimeoutMs ?? AGENT_COMMAND_TIMEOUT_MS,
      });
      const diagnostics = describeAgentCommandFailure(commandResult);
      if (diagnostics) {
        return {
          agents: [],
          currentAgentId: null,
          diagnostics,
          fingerprint,
          kind: 'completed',
        };
      }

      const parsed = parseKiroAgentListOutput(commandResult.stdout);
      if (parsed.agents.length === 0) {
        return {
          agents: [],
          currentAgentId: null,
          diagnostics: 'Kiro agent list returned no available agents',
          fingerprint,
          kind: 'completed',
        };
      }
      return {
        agents: parsed.agents,
        currentAgentId: parsed.currentAgentId,
        fingerprint,
        kind: 'completed',
      };
    } catch {
      return {
        agents: [],
        currentAgentId: null,
        diagnostics: 'Kiro agent list could not be started',
        fingerprint: buildKiroCatalogFingerprint({
          command: '',
          environmentKeys: [],
          version: 'unavailable',
        }),
        kind: 'completed',
      };
    }
  }

  private async resolveCommandContext(
    ownerContext?: ProviderTransitionOwnerContext,
  ): Promise<KiroResolvedAgentCommandContext> {
    const command = await this.plugin.getResolvedProviderCliPath(
      'kiro',
      ownerContext,
    ) ?? 'kiro-cli';
    const configuredEnvironment = getRuntimeEnvironmentVariables(this.plugin.settings, 'kiro');
    return {
      command,
      cwd: getVaultPath(this.plugin.app) ?? process.cwd(),
      env: buildKiroRuntimeEnv(this.plugin.settings, command),
      environmentKeys: Object.keys(configuredEnvironment),
    };
  }

  private async resolveFingerprint(
    context: KiroResolvedAgentCommandContext,
    signal?: AbortSignal,
  ): Promise<string> {
    let version = 'unavailable';
    try {
      const versionResult = await this.runner.run({
        args: ['--version'],
        command: context.command,
        cwd: context.cwd,
        env: context.env,
        signal,
        timeoutMs: this.options.versionCommandTimeoutMs ?? VERSION_COMMAND_TIMEOUT_MS,
      });
      if (versionResult.exitCode === 0 && !versionResult.termination) {
        version = versionResult.stdout.trim() || version;
      } else {
        version = `unavailable:${versionResult.termination ?? versionResult.exitCode ?? 'unknown'}`;
      }
    } catch {
      version = 'unavailable:error';
    }

    return buildKiroCatalogFingerprint({
      command: context.command,
      environmentKeys: context.environmentKeys,
      version,
    });
  }
}

function describeAgentCommandFailure(result: KiroCatalogCommandResult): string | null {
  switch (result.termination) {
    case 'abort':
      return 'Kiro agent list was cancelled';
    case 'error':
      return 'Kiro agent list could not be started';
    case 'output-limit':
      return 'Kiro agent list returned too much output';
    case 'timeout':
      return 'Kiro agent list timed out';
    default:
      return result.exitCode === 0
        ? null
        : `Kiro agent list exited with code ${result.exitCode ?? 'unknown'}`;
  }
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_SEQUENCE, '');
}
