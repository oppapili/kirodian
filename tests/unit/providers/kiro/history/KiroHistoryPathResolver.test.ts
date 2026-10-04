import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  encodeKiroSessionCwd,
  readKiroV2SessionCwd,
  resolveKiroSessionCwd,
  resolveKiroSessionDirectory,
} from '@/providers/kiro/history/KiroHistoryPathResolver';

describe('KiroHistoryPathResolver v2 layout', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-history-path-v2-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  });

  function writeV2Session(sessionId: string, cwd?: string): string {
    const cliDirectory = path.join(tempRoot, '.kiro', 'sessions', 'cli');
    fs.mkdirSync(cliDirectory, { recursive: true });
    fs.writeFileSync(path.join(cliDirectory, `${sessionId}.jsonl`), '{"kind":"Prompt"}\n');
    if (cwd !== undefined) {
      fs.writeFileSync(
        path.join(cliDirectory, `${sessionId}.json`),
        JSON.stringify({ session_id: sessionId, cwd }),
      );
    }
    return cliDirectory;
  }

  it('resolves the cli directory when a v2 history file exists', () => {
    const vaultPath = path.join(tempRoot, 'vault');
    const cliDirectory = writeV2Session('session-v2', vaultPath);

    expect(resolveKiroSessionDirectory('', 'session-v2', vaultPath, {
      environment: { HOME: tempRoot },
    })).toBe(path.resolve(cliDirectory));
  });

  it('tolerates a missing metadata file (jsonl existence is sufficient)', () => {
    const vaultPath = path.join(tempRoot, 'vault');
    const cliDirectory = writeV2Session('session-no-meta');

    expect(resolveKiroSessionDirectory('', 'session-no-meta', vaultPath, {
      environment: { HOME: tempRoot },
    })).toBe(path.resolve(cliDirectory));
  });

  it('skips a v2 session whose recorded cwd does not match the vault', () => {
    const vaultPath = path.join(tempRoot, 'vault');
    writeV2Session('session-other-cwd', path.join(tempRoot, 'different-vault'));

    expect(resolveKiroSessionDirectory('', 'session-other-cwd', vaultPath, {
      environment: { HOME: tempRoot },
    })).toBeNull();
  });

  it('falls back to the v1 directory layout when no v2 file exists', () => {
    const vaultPath = path.join(tempRoot, 'vault');
    const sessionId = 'session-v1';
    const v1Directory = path.join(
      tempRoot,
      '.kiro',
      'sessions',
      encodeKiroSessionCwd(vaultPath),
      sessionId,
    );
    fs.mkdirSync(v1Directory, { recursive: true });

    expect(resolveKiroSessionDirectory('', sessionId, vaultPath, {
      environment: { HOME: tempRoot },
    })).toBe(v1Directory);
  });

  it('prefers v2 over an existing v1 directory for the same session id', () => {
    const vaultPath = path.join(tempRoot, 'vault');
    const sessionId = 'session-both';
    const v1Directory = path.join(
      tempRoot,
      '.kiro',
      'sessions',
      encodeKiroSessionCwd(vaultPath),
      sessionId,
    );
    fs.mkdirSync(v1Directory, { recursive: true });
    const cliDirectory = writeV2Session(sessionId, vaultPath);

    expect(resolveKiroSessionDirectory('', sessionId, vaultPath, {
      environment: { HOME: tempRoot },
    })).toBe(path.resolve(cliDirectory));
  });

  describe('resolveKiroSessionCwd', () => {
    it('reads the v2 cwd from <sessionId>.json when a sessionId is supplied', () => {
      const cwd = path.join(tempRoot, 'vault');
      const cliDirectory = writeV2Session('session-cwd', cwd);

      expect(resolveKiroSessionCwd(cliDirectory, 'session-cwd')).toBe(path.resolve(cwd));
    });

    it('ignores the v2 path when no sessionId is supplied (v1 behaviour)', () => {
      const encoded = encodeKiroSessionCwd(path.join(tempRoot, 'vault'));
      const v1SessionDirectory = path.join(tempRoot, '.kiro', 'sessions', encoded, 'session-x');
      fs.mkdirSync(v1SessionDirectory, { recursive: true });

      expect(resolveKiroSessionCwd(v1SessionDirectory)).toBe(path.resolve(path.join(tempRoot, 'vault')));
    });
  });

  describe('readKiroV2SessionCwd', () => {
    it('returns the absolute cwd from the metadata file', () => {
      const cwd = path.join(tempRoot, 'vault');
      const cliDirectory = writeV2Session('session-meta', cwd);

      expect(readKiroV2SessionCwd(cliDirectory, 'session-meta')).toBe(path.resolve(cwd));
    });

    it('returns null for a missing or malformed metadata file', () => {
      const cliDirectory = writeV2Session('session-bad');
      fs.writeFileSync(path.join(cliDirectory, 'session-bad.json'), 'not json');

      expect(readKiroV2SessionCwd(cliDirectory, 'session-bad')).toBeNull();
      expect(readKiroV2SessionCwd(cliDirectory, 'absent')).toBeNull();
    });
  });
});
