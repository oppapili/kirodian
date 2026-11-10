// kiro-cli 3.1.0 measurements (#103): the V2 engine names the spawn tool `subagent`
// (`_meta.kiro.toolName`); the V3 engine reports `invoke_sub_agent`.
export const KIRO_SUBAGENT_SPAWN_TOOL_NAMES = [
  'subagent',
  'invoke_sub_agent',
] as const;

export const KIRO_SUBAGENT_WAIT_TOOL_NAMES = [
  'get_command_or_subagent_output',
  'task_output',
  'wait_commands_or_subagents',
  'wait_for_task',
] as const;

export const KIRO_SUBAGENT_CLOSE_TOOL_NAMES = [
  'kill_command_or_subagent',
  'kill_task',
] as const;

export const KIRO_SUBAGENT_LIFECYCLE_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...KIRO_SUBAGENT_SPAWN_TOOL_NAMES,
  ...KIRO_SUBAGENT_WAIT_TOOL_NAMES,
  ...KIRO_SUBAGENT_CLOSE_TOOL_NAMES,
]);
