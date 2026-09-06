import type { AcpAvailableCommand } from '../../acp';

// Kiro streams its session updates over standard ACP `session/update`, so unlike
// Grok there is no `x.ai/*` wrapped-notification envelope to unwrap here. The only
// Kiro-specific notification this provider consumes is the slash-command catalog,
// pushed as `_kiro.dev/commands/available` after a session is created.

export const KIRO_COMMANDS_AVAILABLE_NOTIFICATION_METHODS = [
  '_kiro.dev/commands/available',
  'kiro.dev/commands/available',
] as const;

/**
 * Extract the `commands` array from a `_kiro.dev/commands/available` notification.
 * Returns null when the payload is malformed so callers keep the previous catalog.
 */
export function parseKiroAvailableCommandsNotification(
  params: unknown,
): AcpAvailableCommand[] | null {
  if (!isRecord(params) || !Array.isArray(params.commands)) {
    return null;
  }
  return params.commands.filter(isAcpAvailableCommand);
}

function isAcpAvailableCommand(value: unknown): value is AcpAvailableCommand {
  return isRecord(value) && typeof value.name === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
