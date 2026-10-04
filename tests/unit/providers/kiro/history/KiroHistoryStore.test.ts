import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  loadKiroHistory,
  loadKiroPromptIndexAfterAssistant,
} from '@/providers/kiro/history/KiroHistoryStore';

function readFixture(name: string): string {
  return fs.readFileSync(
    path.join(process.cwd(), 'tests/fixtures/providers/kiro/history', name),
    'utf8',
  );
}

describe('KiroHistoryStore layout detection', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-history-store-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  });

  it('loads a v2 flat <sessionId>.jsonl from the resolved directory', async () => {
    const sessionId = 'session-v2';
    fs.writeFileSync(
      path.join(tempRoot, `${sessionId}.jsonl`),
      readFixture('v2-multi-turn.jsonl'),
    );

    const parsed = await loadKiroHistory(tempRoot, sessionId);

    expect(parsed.messages).toHaveLength(6);
    expect(parsed.messages[0]).toMatchObject({ content: 'Inspect the sample file.', role: 'user' });
    expect(parsed.messages[1].toolCalls?.[0]).toMatchObject({ name: 'Read', result: 'sample text' });
  });

  it('falls back to the v1 updates.jsonl when no v2 file exists', async () => {
    fs.writeFileSync(path.join(tempRoot, 'updates.jsonl'), readFixture('v1-updates.jsonl'));

    const parsed = await loadKiroHistory(tempRoot, 'session-v1');

    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0]).toMatchObject({ content: 'Hello from v1.', role: 'user' });
    expect(parsed.messages[1]).toMatchObject({ content: 'Hi there.', role: 'assistant' });
  });

  it('returns no messages when neither layout is present', async () => {
    expect((await loadKiroHistory(tempRoot, 'absent')).messages).toHaveLength(0);
  });

  it('resolves the fork prompt index from a v2 file', async () => {
    const sessionId = 'session-v2';
    fs.writeFileSync(
      path.join(tempRoot, `${sessionId}.jsonl`),
      readFixture('v2-multi-turn.jsonl'),
    );

    expect(await loadKiroPromptIndexAfterAssistant(tempRoot, sessionId, 'assistant-2')).toBe(2);
  });

  it('resolves the fork prompt index from a v1 file', async () => {
    fs.writeFileSync(path.join(tempRoot, 'updates.jsonl'), readFixture('v1-updates.jsonl'));

    expect(await loadKiroPromptIndexAfterAssistant(tempRoot, 'session-v1', 'assistant-v1')).toBe(1);
  });
});
