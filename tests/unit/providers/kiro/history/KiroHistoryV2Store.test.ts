import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  isKiroV2HistoryContent,
  parseKiroV2HistoryContent,
  resolveKiroV2PromptIndexAfterAssistant,
} from '@/providers/kiro/history/KiroHistoryV2Store';

function readFixture(name: string): string {
  return fs.readFileSync(
    path.join(process.cwd(), 'tests/fixtures/providers/kiro/history', name),
    'utf8',
  );
}

describe('KiroHistoryV2Store', () => {
  describe('isKiroV2HistoryContent', () => {
    it('recognizes a v2 record on the first non-blank line', () => {
      expect(isKiroV2HistoryContent(readFixture('v2-multi-turn.jsonl'))).toBe(true);
    });

    it('rejects v1 content and empty content', () => {
      expect(isKiroV2HistoryContent(readFixture('v1-updates.jsonl'))).toBe(false);
      expect(isKiroV2HistoryContent('')).toBe(false);
      expect(isKiroV2HistoryContent('   \n\n')).toBe(false);
    });
  });

  describe('parseKiroV2HistoryContent', () => {
    const parsed = parseKiroV2HistoryContent(
      readFixture('v2-multi-turn.jsonl'),
      'session-v2',
    );

    it('produces one user + assistant message per completed turn', () => {
      expect(parsed.messages).toHaveLength(6);
      expect(parsed.messages.map(message => message.role)).toEqual([
        'user', 'assistant', 'user', 'assistant', 'user', 'assistant',
      ]);
    });

    it('maps a Prompt record to a user message with its timestamp', () => {
      expect(parsed.messages[0]).toMatchObject({
        content: 'Inspect the sample file.',
        id: 'prompt-1',
        role: 'user',
        timestamp: 1_700_000_000_000,
        userMessageId: 'prompt-1',
      });
    });

    it('preserves text, non-empty thinking, and tool_use block ordering', () => {
      expect(parsed.messages[1]).toMatchObject({
        assistantMessageId: 'assistant-1',
        content: 'Done.',
        role: 'assistant',
      });
      expect(parsed.messages[1].contentBlocks).toEqual([
        { content: 'I will read it.', type: 'thinking' },
        { toolId: 'tool-1', type: 'tool_use' },
        { content: 'Done.', type: 'text' },
      ]);
    });

    it('matches a ToolResults text payload back to its toolUse by id', () => {
      expect(parsed.messages[1].toolCalls).toEqual([
        expect.objectContaining({
          id: 'tool-1',
          name: 'Read',
          input: expect.objectContaining({ path: 'notes/sample.md' }),
          result: 'sample text',
          status: 'completed',
        }),
      ]);
    });

    it('serializes a ToolResults json payload into the tool result', () => {
      expect(parsed.messages[3].toolCalls?.[0]).toMatchObject({
        id: 'tool-2',
        name: 'Grep',
        result: '{"numMatches":2,"numFiles":1}',
        status: 'completed',
      });
    });

    it('emits an assistant message with no tool calls for a plain-text turn', () => {
      expect(parsed.messages[5]).toMatchObject({ content: 'Okay.', role: 'assistant' });
      expect(parsed.messages[5].toolCalls).toBeUndefined();
    });

    it('marks a tool with no matching ToolResults as still running', () => {
      const content = [
        JSON.stringify({ version: 'v1', kind: 'Prompt', data: { message_id: 'p', content: [{ kind: 'text', data: 'go' }], meta: { timestamp: 1 } } }),
        JSON.stringify({ version: 'v1', kind: 'AssistantMessage', data: { message_id: 'a', content: [{ kind: 'toolUse', data: { toolUseId: 't', name: 'grep', input: {} } }] } }),
      ].join('\n');
      const result = parseKiroV2HistoryContent(content, 'session-pending');
      expect(result.messages[1].toolCalls?.[0].status).toBe('running');
      expect(result.messages[1].toolCalls?.[0].result).toBeUndefined();
    });

    it('drops a turn with no user content', () => {
      const content = JSON.stringify({
        version: 'v1',
        kind: 'AssistantMessage',
        data: { message_id: 'a', content: [{ kind: 'text', data: 'orphan' }] },
      });
      expect(parseKiroV2HistoryContent(content, 'session-orphan').messages).toHaveLength(0);
    });
  });

  describe('resolveKiroV2PromptIndexAfterAssistant', () => {
    const content = readFixture('v2-multi-turn.jsonl');

    it('returns the prompt index following the matching assistant turn', () => {
      expect(resolveKiroV2PromptIndexAfterAssistant(content, 'session-v2', 'assistant-1')).toBe(1);
      expect(resolveKiroV2PromptIndexAfterAssistant(content, 'session-v2', 'assistant-2')).toBe(2);
      expect(resolveKiroV2PromptIndexAfterAssistant(content, 'session-v2', 'assistant-3')).toBe(3);
    });

    it('returns null when the assistant message id is not present', () => {
      expect(resolveKiroV2PromptIndexAfterAssistant(content, 'session-v2', 'absent')).toBeNull();
    });
  });
});
