import {
  type ACPSessionConfigOption,
  type ACPSessionModeState,
  extractACPSessionModeState,
} from '../../acp';

/** A Kiro agent mode advertised by an ACP session (kiro_default, kiro_planner, custom agents, ...). */
export interface KiroAgentMode {
  description?: string;
  id: string;
  name: string;
}

export interface NormalizedKiroSessionModes {
  currentModeId: string | null;
  modes: KiroAgentMode[];
}

/**
 * Extracts the agent-mode catalog from a `session/new`, `session/load`, or config-option
 * response. Unlike the model metadata, modes carry no reasoning or alias state, so the
 * shape is a thin `{id, name, description}` projection. Duplicate ids are collapsed to the
 * first occurrence and blank ids are dropped, so only real Kiro mode ids survive — sending
 * an unknown id back to `session/set_mode` makes Kiro reply with a JSON-RPC Internal error.
 */
export function normalizeKiroSessionModeMetadata(response: {
  configOptions?: ACPSessionConfigOption[] | null;
  modes?: ACPSessionModeState | null;
}): NormalizedKiroSessionModes {
  const state = extractACPSessionModeState(response);
  const modes: KiroAgentMode[] = [];
  const seen = new Set<string>();
  for (const mode of state.availableModes) {
    const id = typeof mode.id === 'string' ? mode.id.trim() : '';
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const name = typeof mode.name === 'string' && mode.name.trim()
      ? mode.name.trim()
      : id;
    const description = typeof mode.description === 'string' && mode.description.trim()
      ? mode.description.trim()
      : undefined;
    modes.push({
      id,
      name,
      ...(description ? { description } : {}),
    });
  }

  const currentModeId = typeof state.currentModeId === 'string' && state.currentModeId.trim()
    ? state.currentModeId.trim()
    : null;

  return {
    currentModeId,
    modes,
  };
}
