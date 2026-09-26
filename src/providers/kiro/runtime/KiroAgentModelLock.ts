import * as fs from 'fs';
import * as path from 'path';

import { expandHomePath } from '../../../utils/path';

/**
 * The agent-definition directories `kiro-cli agent list` prints in its `Workspace:`
 * (local) and `Global:` header lines. Either may be absent: the local `.kiro/agents`
 * directory does not exist in every project, and a headless invocation may omit the
 * workspace header entirely.
 */
export interface KiroAgentDirectories {
  /** Local `<project>/.kiro/agents` directory from the `Workspace:` header, if present. */
  localDir?: string | null;
  /** Global `~/.kiro/agents` directory from the `Global:` header, if present. */
  globalDir?: string | null;
}

/**
 * Reads the `"model"` a custom Kiro agent pins in its definition json.
 *
 * A custom agent's definition lives at `<agents-dir>/<id>.json`; its optional `"model"`
 * field (including the literal `"auto"`) overrides any `session/set_model` the UI would
 * otherwise send, so the model selector must reflect that the choice is fixed. Built-in
 * agents (`kiro_default`, `kiro_planner`, `kiro_guide`, ...) have no json and therefore
 * no lock.
 *
 * Local (`<project>/.kiro/agents`) is preferred over global (`~/.kiro/agents`) to mirror
 * kiro-cli's own precedence when the same id is defined in both scopes.
 *
 * Best-effort by contract: a missing json (built-in), an unreadable file, malformed JSON,
 * a non-string `"model"`, or an empty/blank `"model"` all resolve to `null` ("no lock").
 * This never throws — a filesystem or parse failure must not disable the selector or break
 * the session.
 *
 * @param agentId - The selected agent id (the sendable `session/set_mode` id).
 * @param directories - The local/global agent directories captured during discovery.
 * @returns The pinned model string, or `null` when there is no lock.
 */
export function readKiroAgentModelLock(
  agentId: string,
  directories: KiroAgentDirectories,
): string | null {
  const normalizedId = agentId.trim();
  if (!normalizedId) {
    return null;
  }

  // Local wins over global, matching kiro-cli precedence for a doubly-defined id.
  const orderedDirs = [directories.localDir, directories.globalDir];
  for (const dir of orderedDirs) {
    const model = readModelFromAgentJson(dir, normalizedId);
    if (model !== null) {
      return model;
    }
  }
  return null;
}

/**
 * Reads the `"model"` field from `<dir>/<id>.json`. Returns `null` on any failure or when
 * the field is absent, non-string, or blank. Never throws.
 */
function readModelFromAgentJson(
  dir: string | null | undefined,
  agentId: string,
): string | null {
  const normalizedDir = typeof dir === 'string' ? dir.trim() : '';
  if (!normalizedDir) {
    return null;
  }

  try {
    const jsonPath = path.join(expandHomePath(normalizedDir), `${agentId}.json`);
    const raw = fs.readFileSync(jsonPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }
    const model = parsed.model;
    if (typeof model !== 'string') {
      return null;
    }
    const trimmed = model.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
