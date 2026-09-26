import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type { ProviderTransitionOwnerContext } from '../../../core/providers/types';
import { getVaultPath } from '../../../utils/path';
import type { KiroAgentMode } from '../execution/KiroSessionModeMetadata';
import { getKiroProviderSettings } from '../settings';
import type { KiroAgentDirectories } from './KiroAgentModelLock';
import {
  type KiroCatalogCommandRunner,
  SpawnKiroCatalogCommandRunner,
} from './KiroModelCatalogService';
import { buildKiroRuntimeEnv } from './KiroRuntimeEnvironment';

const AGENT_COMMAND_TIMEOUT_MS = 20_000;
const ANSI_ESCAPE_SEQUENCE = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  'g',
);
// Section headers printed by `kiro-cli agent list` (`Workspace:`, `Global:`), which
// point at agent directories rather than naming an agent. The heading word is followed
// directly by a colon, optionally trailed by a count or parenthetical (`Global: 3 agents`,
// `Global (2):`) but never by the two-column `<scope>  <description>` layout of a real row.
// Matching the header shape explicitly makes the exclusion intentional rather than relying
// on `parseAgentLine` failing to find a scope token — a header whose word is itself a scope
// token (`Global`) must never be mistaken for an agent id.
const SECTION_HEADER_PATTERN = /^[A-Za-z][\w -]*(?:\s*\([^)]*\))?\s*:(?:\s+\d.*)?$/u;

/** The three scopes `kiro-cli agent list` labels each agent with. */
export type KiroAgentScope = 'built-in' | 'global' | 'local';

/**
 * A single agent as parsed from `kiro-cli agent list` output. Carries the raw sendable
 * mode id, its scope, whether the CLI marked it as the current agent, and its (possibly
 * empty) description.
 */
export interface KiroDiscoveredAgent {
  description: string;
  id: string;
  isCurrent: boolean;
  scope: KiroAgentScope;
}

export type KiroAgentCatalogDiscoveryResult =
  | {
    agents: KiroDiscoveredAgent[];
    currentAgentId: string | null;
    /**
     * Agent-definition directories mined from the `agent list` headers. Optional so existing
     * callers/fixtures that predate the model-lock feature still satisfy the type; the live
     * `discoverCatalog` always populates it (with nulls when a header is absent).
     */
    directories?: KiroAgentDirectories;
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
}

const SCOPE_TOKENS: ReadonlyMap<string, KiroAgentScope> = new Map([
  ['(built-in)', 'built-in'],
  ['global', 'global'],
  ['local', 'local'],
]);

/**
 * Parses the plain-text output of `kiro-cli agent list` into a flat agent list.
 *
 * The CLI emits (after ANSI colour codes, which are stripped first):
 *   - an optional `Error: File URI not found ...` line (WSL URI-resolution failure)
 *   - `Workspace:` / `Global:` header lines pointing at agent directories
 *   - one line per agent: `[* ]<id>  <scope>  <description>` where scope is one of
 *     `(Built-in)` / `Global` / `Local` and a leading `*` marks the current agent
 *   - continuation lines for a wrapped description: the id column is blank and only
 *     the description text is present
 *
 * Header and error lines are skipped, wrapped descriptions are re-joined onto their
 * owning agent, empty descriptions are preserved, and unicode (e.g. Japanese) survives
 * untouched. Duplicate ids collapse to the first occurrence. The raw `id` is the
 * sendable `session/set_mode` id, so only real agent ids are emitted.
 *
 * @param output - Raw stdout from `kiro-cli agent list`.
 * @returns The parsed agents in listing order.
 */
export function parseKiroAgentListOutput(output: string): KiroDiscoveredAgent[] {
  const agents: KiroDiscoveredAgent[] = [];
  const seen = new Set<string>();
  let current: KiroDiscoveredAgent | null = null;

  for (const rawLine of stripAnsi(output).split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/u, '');
    if (line.trim().length === 0) {
      continue;
    }
    if (isSkippableLine(line)) {
      current = null;
      continue;
    }

    const marker = line.startsWith('*');
    // Both data rows and continuation lines are indented, so leading whitespace alone
    // cannot tell them apart. A data row parses as `<id>  <scope>  <description>`; a
    // wrapped continuation line does not (it carries only description text). Parse first,
    // and only fall back to appending as a continuation when the row has no id+scope.
    const parsed = parseAgentLine(line, marker);
    if (!parsed) {
      if (current) {
        const text = line.trim();
        current.description = current.description
          ? `${current.description} ${text}`
          : text;
      }
      continue;
    }

    if (seen.has(parsed.id)) {
      current = null;
      continue;
    }
    current = parsed;
    seen.add(parsed.id);
    agents.push(parsed);
  }

  return agents;
}

// A `Workspace:` / `Global:` header line, capturing the scope label and the directory path
// that follows the colon. These lines are excluded from the agent list by
// SECTION_HEADER_PATTERN; here we additionally mine them for the agent-definition dirs so a
// selected agent's `<dir>/<id>.json` (which carries its pinned `"model"`) can be resolved
// later. The path is whatever trails the colon after ANSI codes are stripped; a count-suffixed
// header (`Global: 3 agents`) yields a non-path value and is simply ignored downstream.
const AGENT_DIR_HEADER_PATTERN = /^(Workspace|Global)\s*(?:\([^)]*\))?\s*:\s*(.+?)\s*$/u;

/**
 * Extracts the local and global agent-definition directories from the `Workspace:` and
 * `Global:` header lines of `kiro-cli agent list` output.
 *
 * `Workspace:` points at the local `<project>/.kiro/agents` directory and `Global:` at
 * `~/.kiro/agents`. Either may be absent (no local `.kiro/agents`, or a headless invocation
 * that omits the workspace header). A header whose value is not a path (e.g. a count suffix
 * such as `Global: 3 agents`) is captured verbatim; the reader treats a non-existent
 * directory as "no json", so a spurious value cannot lock the selector.
 *
 * @param output - Raw stdout from `kiro-cli agent list`.
 * @returns The captured directories, each `null` when its header is absent.
 */
export function parseKiroAgentListDirectories(output: string): KiroAgentDirectories {
  let localDir: string | null = null;
  let globalDir: string | null = null;

  for (const rawLine of stripAnsi(output).split(/\r?\n/)) {
    const match = AGENT_DIR_HEADER_PATTERN.exec(rawLine.trim());
    if (!match) {
      continue;
    }
    const value = match[2].trim();
    if (!value) {
      continue;
    }
    if (match[1] === 'Workspace' && localDir === null) {
      localDir = value;
    } else if (match[1] === 'Global' && globalDir === null) {
      globalDir = value;
    }
  }

  return { globalDir, localDir };
}

/**
 * Reads the live agent catalog by running `kiro-cli agent list` through the same
 * spawn seam as the model catalog. Best-effort: a non-zero exit, a timeout, or a
 * parse yielding no agents returns an empty completed result so the selector hides
 * gracefully rather than throwing into the session.
 */
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
      const command = await this.plugin.getResolvedProviderCliPath(
        'kiro',
        ownerContext,
      ) ?? 'kiro-cli';
      const commandResult = await this.runner.run({
        args: ['agent', 'list'],
        command,
        cwd: getVaultPath(this.plugin.app) ?? process.cwd(),
        env: buildKiroRuntimeEnv(this.plugin.settings, command),
        signal,
        timeoutMs: this.options.agentCommandTimeoutMs ?? AGENT_COMMAND_TIMEOUT_MS,
      });
      if (commandResult.termination || commandResult.exitCode !== 0) {
        return {
          agents: [],
          currentAgentId: null,
          directories: { globalDir: null, localDir: null },
          kind: 'completed',
        };
      }

      const agents = parseKiroAgentListOutput(commandResult.stdout);
      const currentAgentId = agents.find(agent => agent.isCurrent)?.id ?? null;
      const directories = parseKiroAgentListDirectories(commandResult.stdout);
      return { agents, currentAgentId, directories, kind: 'completed' };
    } catch {
      return {
        agents: [],
        currentAgentId: null,
        directories: { globalDir: null, localDir: null },
        kind: 'completed',
      };
    }
  }
}

/** Projects discovered agents onto the `{id, name, description}` shape the selector renders. */
export function toKiroAgentModes(agents: readonly KiroDiscoveredAgent[]): KiroAgentMode[] {
  return agents.map(agent => ({
    id: agent.id,
    name: agent.id,
    ...(agent.description ? { description: agent.description } : {}),
  }));
}

function parseAgentLine(line: string, marker: boolean): KiroDiscoveredAgent | null {
  const body = (marker ? line.slice(1) : line).trim();
  const tokens = body.split(/\s{2,}/u).map(token => token.trim()).filter(Boolean);
  const id = tokens[0];
  if (!id || /\s/u.test(id)) {
    return null;
  }
  const scope = SCOPE_TOKENS.get((tokens[1] ?? '').toLowerCase());
  if (!scope) {
    return null;
  }
  return {
    description: tokens.slice(2).join(' ').trim(),
    id,
    isCurrent: marker,
    scope,
  };
}

function isSkippableLine(line: string): boolean {
  const trimmed = line.trim();
  // The WSL URI-resolution failure line, then section headers matched by their explicit
  // shape (see SECTION_HEADER_PATTERN). A header such as `Global: 3 agents` or `Global (2):`
  // is excluded intentionally here rather than by `parseAgentLine` happening to reject it.
  return trimmed.startsWith('Error:')
    || SECTION_HEADER_PATTERN.test(trimmed);
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_SEQUENCE, '');
}
