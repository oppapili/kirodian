import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ProviderHistoryPathContext } from '../../../core/providers/types';
import { isPathWithinRoot } from '../../../core/storage/pathContainment';

const MAX_CWD_DIRECTORIES_TO_SCAN = 1_024;

export function encodeKiroSessionCwd(cwd: string): string {
  return encodeURIComponent(path.resolve(cwd));
}

export function decodeKiroSessionCwd(encodedCwd: string): string | null {
  try {
    const decoded = decodeURIComponent(encodedCwd);
    if (!path.isAbsolute(decoded)) return null;
    return path.resolve(decoded);
  } catch {
    return null;
  }
}

export function resolveKiroSessionCwd(
  sessionDirectory: string,
  sessionId?: string | null,
): string | null {
  // v2 layout: `sessionDirectory` is the flat `.../cli` directory and the cwd
  // is recorded in `<sessionId>.json`. Only attempt this when a sessionId is
  // supplied and a matching v2 history file exists, so a v1 session directory
  // (whose basename is the sessionId) is never misread as v2.
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (
    normalizedSessionId
    && isFile(path.join(sessionDirectory, `${normalizedSessionId}.jsonl`))
  ) {
    const v2Cwd = readKiroV2SessionCwd(path.resolve(sessionDirectory), normalizedSessionId);
    if (v2Cwd) return v2Cwd;
  }

  const cwdDirectory = path.dirname(path.resolve(sessionDirectory));
  const decoded = decodeKiroSessionCwd(path.basename(cwdDirectory));
  if (decoded) return decoded;

  try {
    const storedCwd = fs.readFileSync(path.join(cwdDirectory, '.cwd'), 'utf8').trim();
    return path.isAbsolute(storedCwd) ? path.resolve(storedCwd) : null;
  } catch {
    return null;
  }
}

export function resolveKiroSessionDirectory(
  persistedHint: string | null | undefined,
  sessionId: string | null | undefined,
  vaultPath: string | null,
  context: ProviderHistoryPathContext,
): string | null {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return null;
  }

  const roots = getTrustedSessionRoots(context);

  // v2 layout (kiro-cli >= 2.27): a flat `<root>/cli/<sessionId>.jsonl` with a
  // sibling `<root>/cli/<sessionId>.json` metadata file carrying the cwd. This
  // is preferred over the legacy v1 directory layout so newly created sessions
  // hydrate after a restart. The returned path is the `cli` directory; the
  // store detects the v2 layout from the presence of `<sessionId>.jsonl`.
  const v2Directory = resolveKiroV2SessionDirectory(
    roots,
    normalizedSessionId,
    vaultPath,
  );
  if (v2Directory) {
    return v2Directory;
  }

  if (
    persistedHint
    && path.basename(path.normalize(persistedHint)) === normalizedSessionId
    && roots.some(root => isPathWithinRoot(persistedHint, root))
    && isDirectory(persistedHint)
  ) {
    return path.resolve(persistedHint);
  }

  if (vaultPath && path.isAbsolute(vaultPath)) {
    for (const root of roots) {
      const direct = path.join(root, encodeKiroSessionCwd(vaultPath), normalizedSessionId);
      if (isPathWithinRoot(direct, root) && isDirectory(direct)) {
        return direct;
      }
    }
  }

  for (const root of roots) {
    const found = findExactSessionDirectory(root, normalizedSessionId);
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * Resolve the Kiro CLI v2 `cli` directory for a session, or null when no v2
 * history file exists for it. When a `<sessionId>.json` metadata file is
 * present, its `cwd` must match `vaultPath` (if given) so a session created for
 * a different working directory is not hydrated into this vault. A missing or
 * unreadable metadata file is tolerated: the `.jsonl` existence alone is enough,
 * matching the CLI's own best-effort behaviour.
 */
function resolveKiroV2SessionDirectory(
  roots: readonly string[],
  sessionId: string,
  vaultPath: string | null,
): string | null {
  for (const root of roots) {
    const cliDirectory = path.join(root, 'cli');
    if (!isPathWithinRoot(cliDirectory, root)) {
      continue;
    }
    const historyFile = path.join(cliDirectory, `${sessionId}.jsonl`);
    if (!isPathWithinRoot(historyFile, cliDirectory) || !isFile(historyFile)) {
      continue;
    }
    if (!isKiroV2SessionCwdConsistent(cliDirectory, sessionId, vaultPath)) {
      continue;
    }
    return path.resolve(cliDirectory);
  }
  return null;
}

function isKiroV2SessionCwdConsistent(
  cliDirectory: string,
  sessionId: string,
  vaultPath: string | null,
): boolean {
  if (!vaultPath || !path.isAbsolute(vaultPath)) {
    return true;
  }
  const storedCwd = readKiroV2SessionCwd(cliDirectory, sessionId);
  if (!storedCwd) {
    return true;
  }
  return path.resolve(storedCwd) === path.resolve(vaultPath);
}

/**
 * Read the `cwd` recorded in a v2 session's `<sessionId>.json` metadata file.
 * Returns null when the file is absent, unreadable, malformed, or carries no
 * absolute cwd.
 */
export function readKiroV2SessionCwd(
  cliDirectory: string,
  sessionId: string,
): string | null {
  const metadataFile = path.join(cliDirectory, `${sessionId}.json`);
  if (!isPathWithinRoot(metadataFile, cliDirectory)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(metadataFile, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const cwd = (parsed as Record<string, unknown>).cwd;
    return typeof cwd === 'string' && path.isAbsolute(cwd) ? path.resolve(cwd) : null;
  } catch {
    return null;
  }
}

export function getTrustedKiroSessionRoots(
  context: ProviderHistoryPathContext,
): string[] {
  return getTrustedSessionRoots(context);
}

function getTrustedSessionRoots(context: ProviderHistoryPathContext): string[] {
  const configuredHome = context.environment.KIRO_HOME?.trim();
  if (configuredHome) {
    return path.isAbsolute(configuredHome)
      ? [path.resolve(configuredHome, 'sessions')]
      : [];
  }
  const home = resolveUserHome(context.environment, context.hostPlatform);
  return [path.resolve(home, '.kiro', 'sessions')];
}

function resolveUserHome(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform | undefined,
): string {
  const preferred = platform === 'win32'
    ? environment.USERPROFILE?.trim() || environment.HOME?.trim()
    : environment.HOME?.trim() || environment.USERPROFILE?.trim();
  return preferred && path.isAbsolute(preferred) ? preferred : os.homedir();
}

function normalizeSessionId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized
    && !path.isAbsolute(normalized)
    && !normalized.includes('/')
    && !normalized.includes('\\')
    && normalized !== '.'
    && normalized !== '..'
    ? normalized
    : null;
}

function findExactSessionDirectory(root: string, sessionId: string): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }

  let scanned = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    scanned += 1;
    if (scanned > MAX_CWD_DIRECTORIES_TO_SCAN) {
      break;
    }
    const candidate = path.join(root, entry.name, sessionId);
    if (isPathWithinRoot(candidate, root) && isDirectory(candidate)) {
      return candidate;
    }
  }
  return null;
}

function isDirectory(value: string): boolean {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function isFile(value: string): boolean {
  try {
    return fs.statSync(value).isFile();
  } catch {
    return false;
  }
}
