import type { SlashCommand } from '../../../core/types';
import { type ACPAvailableCommand, normalizeACPAvailableCommands } from '../../acp';

// Kiro streams its session updates over standard ACP `session/update`, so unlike
// Grok there is no `x.ai/*` wrapped-notification envelope to unwrap here. The only
// Kiro-specific notification this provider consumes is the slash-command catalog,
// pushed as `_kiro.dev/commands/available` after a session is created.
//
// That notification carries two distinct catalogs in one payload:
//   - `commands`: built-in slash commands (`/agent`, `/model`, …).
//   - `prompts`: the agent-skill catalog. Each entry names a `serverName`; user
//     skills (`.kiro/skills/*/SKILL.md` and `~/.kiro/skills/*/SKILL.md`) arrive
//     with `serverName: "skill:config"`. Prompts from MCP servers carry a
//     different `serverName` and are deliberately NOT surfaced as skills.
// Kiro excites a skill with `/<skillname>` (same wire form as a command), so the
// composer inserts skills with `/` even though the dropdown advertises them as `$`.

export const KIRO_COMMANDS_AVAILABLE_NOTIFICATION_METHODS = [
  '_kiro.dev/commands/available',
  'kiro.dev/commands/available',
] as const;

/** `serverName` that marks a prompt as a user-authored agent skill (vs. an MCP prompt). */
export const KIRO_SKILL_PROMPT_SERVER_NAME = 'skill:config';

interface KiroAvailablePrompt {
  name: string;
  description?: string | null;
  arguments?: unknown;
  serverName?: string | null;
}

/**
 * Extract both the `commands` and the skill `prompts` from a
 * `_kiro.dev/commands/available` notification, normalized to `SlashCommand[]`.
 *
 * Commands become `kind: 'command'` entries; skill prompts (those whose
 * `serverName` is `skill:config`) become `kind: 'skill'` entries so the Kiro
 * command catalog can advertise them with the `$` display / `/` insert affordance.
 * MCP-origin prompts are filtered out. Returns null when the payload is malformed
 * so callers keep the previous catalog.
 */
export function parseKiroAvailableCommandsNotification(
  params: unknown,
): SlashCommand[] | null {
  if (!isRecord(params) || !Array.isArray(params.commands)) {
    return null;
  }
  const commands = normalizeACPAvailableCommands(
    params.commands.filter(isAcpAvailableCommand),
  );
  const skills = Array.isArray(params.prompts)
    ? params.prompts
      .filter(isKiroSkillPrompt)
      .map(mapKiroSkillPromptToSlashCommand)
    : [];
  return [...commands, ...skills];
}

function isAcpAvailableCommand(value: unknown): value is ACPAvailableCommand {
  return isRecord(value) && typeof value.name === 'string';
}

function isKiroSkillPrompt(value: unknown): value is KiroAvailablePrompt {
  return (
    isRecord(value)
    && typeof value.name === 'string'
    && value.serverName === KIRO_SKILL_PROMPT_SERVER_NAME
  );
}

function mapKiroSkillPromptToSlashCommand(prompt: KiroAvailablePrompt): SlashCommand {
  const name = prompt.name.replace(/^\//, '');
  return {
    content: '',
    description: prompt.description ?? undefined,
    id: `acp-skill:${name}`,
    kind: 'skill',
    name,
    source: 'sdk',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
