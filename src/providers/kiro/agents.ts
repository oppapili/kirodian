/** Scope of an agent advertised by `kiro-cli agent list`. */
export type KiroAgentScope = 'built-in' | 'global' | 'local';

/**
 * A Kiro agent discovered from the pre-fetched `kiro-cli agent list` output
 * (kiro_default, kiro_planner, kiro_guide, kirocrew-*, taskmaster, and custom
 * Global/Local agents). The `id` is the real Kiro mode/agent id sent to
 * `session/set_mode`, so it must survive normalization verbatim.
 */
export interface KiroDiscoveredAgent {
  description?: string;
  id: string;
  name?: string;
  scope: KiroAgentScope;
}

const KIRO_AGENT_SCOPE_VALUES: ReadonlySet<KiroAgentScope> = new Set([
  'built-in',
  'global',
  'local',
]);

/** Maps the CLI scope token ((Built-in)/Global/Local) onto the typed scope. */
export function normalizeKiroAgentScopeToken(token: string): KiroAgentScope | null {
  const normalized = token.trim().replace(/^\(/u, '').replace(/\)$/u, '').toLowerCase();
  if (normalized === 'built-in' || normalized === 'builtin') {
    return 'built-in';
  }
  if (normalized === 'global') {
    return 'global';
  }
  if (normalized === 'local') {
    return 'local';
  }
  return null;
}

export function normalizeKiroDiscoveredAgents(value: unknown): KiroDiscoveredAgent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalizedById = new Map<string, KiroDiscoveredAgent>();
  for (const entry of value) {
    const agent = normalizeKiroDiscoveredAgent(entry);
    if (!agent || normalizedById.has(agent.id)) {
      continue;
    }
    normalizedById.set(agent.id, agent);
  }
  return Array.from(normalizedById.values());
}

function normalizeKiroDiscoveredAgent(value: unknown): KiroDiscoveredAgent | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readTrimmedString(value.id);
  if (!id) {
    return null;
  }
  const scope = isKiroAgentScope(value.scope) ? value.scope : 'built-in';
  const name = readTrimmedString(value.name);
  const description = readTrimmedString(value.description);
  return {
    ...(description ? { description } : {}),
    id,
    ...(name ? { name } : {}),
    scope,
  };
}

function isKiroAgentScope(value: unknown): value is KiroAgentScope {
  return typeof value === 'string' && KIRO_AGENT_SCOPE_VALUES.has(value as KiroAgentScope);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
