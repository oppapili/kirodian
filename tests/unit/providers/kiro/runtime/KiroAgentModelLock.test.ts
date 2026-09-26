import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { readKiroAgentModelLock } from '@/providers/kiro/runtime/KiroAgentModelLock';

describe('readKiroAgentModelLock', () => {
  let tmpRoot: string;
  let localDir: string;
  let globalDir: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-agent-lock-'));
    localDir = path.join(tmpRoot, 'local', '.kiro', 'agents');
    globalDir = path.join(tmpRoot, 'global', '.kiro', 'agents');
    fs.mkdirSync(localDir, { recursive: true });
    fs.mkdirSync(globalDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeAgentJson(dir: string, id: string, contents: unknown): void {
    fs.writeFileSync(
      path.join(dir, `${id}.json`),
      typeof contents === 'string' ? contents : JSON.stringify(contents),
      'utf8',
    );
  }

  it('reads a pinned model from a global custom agent json', () => {
    writeAgentJson(globalDir, 'kirocrew', { model: 'auto' });

    const lock = readKiroAgentModelLock('kirocrew', { globalDir, localDir: null });

    expect(lock).toBe('auto');
  });

  it('reads a pinned model from a local custom agent json', () => {
    writeAgentJson(localDir, 'project_helper', { model: 'claude-opus-5' });

    const lock = readKiroAgentModelLock('project_helper', { globalDir: null, localDir });

    expect(lock).toBe('claude-opus-5');
  });

  it('prefers the local json over the global json for a doubly-defined id', () => {
    writeAgentJson(globalDir, 'kirocrew', { model: 'auto' });
    writeAgentJson(localDir, 'kirocrew', { model: 'claude-opus-5' });

    const lock = readKiroAgentModelLock('kirocrew', { globalDir, localDir });

    expect(lock).toBe('claude-opus-5');
  });

  it('returns null for a built-in agent with no json in either directory', () => {
    const lock = readKiroAgentModelLock('kiro_default', { globalDir, localDir });

    expect(lock).toBeNull();
  });

  it('returns null when the json exists but has no model field', () => {
    writeAgentJson(globalDir, 'kirocrew', { description: 'no model here' });

    const lock = readKiroAgentModelLock('kirocrew', { globalDir, localDir: null });

    expect(lock).toBeNull();
  });

  it('returns null when the model field is a blank string', () => {
    writeAgentJson(globalDir, 'kirocrew', { model: '   ' });

    const lock = readKiroAgentModelLock('kirocrew', { globalDir, localDir: null });

    expect(lock).toBeNull();
  });

  it('returns null when the model field is not a string', () => {
    writeAgentJson(globalDir, 'kirocrew', { model: 123 });

    const lock = readKiroAgentModelLock('kirocrew', { globalDir, localDir: null });

    expect(lock).toBeNull();
  });

  it('returns null (never throws) on malformed json', () => {
    writeAgentJson(globalDir, 'kirocrew', '{ not valid json');

    expect(() =>
      readKiroAgentModelLock('kirocrew', { globalDir, localDir: null }),
    ).not.toThrow();
    expect(readKiroAgentModelLock('kirocrew', { globalDir, localDir: null })).toBeNull();
  });

  it('returns null when no directories are provided', () => {
    expect(readKiroAgentModelLock('kirocrew', {})).toBeNull();
    expect(readKiroAgentModelLock('kirocrew', { globalDir: null, localDir: null })).toBeNull();
  });

  it('returns null for a blank agent id', () => {
    writeAgentJson(globalDir, 'kirocrew', { model: 'auto' });

    expect(readKiroAgentModelLock('   ', { globalDir, localDir: null })).toBeNull();
  });

  it('falls through to global when the local directory lacks the json', () => {
    writeAgentJson(globalDir, 'kirocrew', { model: 'auto' });

    const lock = readKiroAgentModelLock('kirocrew', { globalDir, localDir });

    expect(lock).toBe('auto');
  });
});
