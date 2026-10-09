import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { isPathWithinRoot } from '@/core/storage/pathContainment';

describe('isPathWithinRoot', () => {
  it('uses path segments instead of string prefixes', () => {
    expect(isPathWithinRoot('/home/user/.kiro/sessions/a.jsonl', '/home/user/.kiro/sessions')).toBe(true);
    expect(isPathWithinRoot('/home/user/.kiro/sessions-evil/a.jsonl', '/home/user/.kiro/sessions')).toBe(false);
    expect(isPathWithinRoot('/home/user/.kiro/sessions/../secrets/a.jsonl', '/home/user/.kiro/sessions')).toBe(false);
  });

  it('supports Windows drive and UNC paths independently of the host platform', () => {
    expect(isPathWithinRoot('C:\\Users\\me\\.kiro\\sessions\\a.jsonl', 'C:\\Users\\me\\.kiro\\sessions')).toBe(true);
    expect(isPathWithinRoot('D:\\Users\\me\\.kiro\\sessions\\a.jsonl', 'C:\\Users\\me\\.kiro\\sessions')).toBe(false);
    expect(isPathWithinRoot('\\\\wsl$\\Ubuntu\\home\\me\\.kiro\\sessions\\a.jsonl', '\\\\wsl$\\Ubuntu\\home\\me\\.kiro\\sessions')).toBe(true);
    expect(isPathWithinRoot('\\\\wsl$\\Other\\home\\me\\.kiro\\sessions\\a.jsonl', '\\\\wsl$\\Ubuntu\\home\\me\\.kiro\\sessions')).toBe(false);
  });

  it('rejects an existing symlink that escapes the trusted root', () => {
    if (process.platform === 'win32') return;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-path-trust-'));
    const root = path.join(tempDir, 'root');
    const outside = path.join(tempDir, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'session.jsonl'), '{}');
    fs.symlinkSync(outside, path.join(root, 'escape'));

    expect(isPathWithinRoot(path.join(root, 'escape', 'session.jsonl'), root)).toBe(false);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
