import { isWriteEditTool, TOOL_ASK_USER_QUESTION } from '../../../core/tools/toolNames';
import type {
  ChatMessage,
  ContentBlock,
  ToolCallInfo,
} from '../../../core/types';
import type { SDKToolUseResult } from '../../../core/types/diff';
import { extractDiffData } from '../../../utils/diff';
import {
  normalizeKiroToolCall,
  normalizeKiroToolUseResult,
} from '../normalization/kiroToolNormalization';
import type { KiroHistoryUsage, ParsedKiroHistory } from './KiroHistoryStore';

/**
 * Kiro CLI v2 session record kinds, as written to
 * `~/.kiro/sessions/cli/<sessionId>.jsonl` by kiro-cli >= 2.27.
 */
const V2_RECORD_KINDS = new Set(['Prompt', 'AssistantMessage', 'ToolResults']);

interface KiroV2Record {
  kind: string;
  data: Record<string, unknown>;
}

interface KiroV2ToolUse {
  id: string;
  input: Record<string, unknown>;
  name: string;
  rawInput: unknown;
  rawName: string;
}

interface KiroV2PendingTurn {
  assistantContent: string;
  assistantId?: string;
  blocks: ContentBlock[];
  startedAt: number;
  toolOrder: string[];
  tools: Map<string, KiroV2ToolUse>;
  turnIndex: number;
  userContent: string;
  userId?: string;
}

/**
 * Detect whether raw file content is in the Kiro CLI v2 session layout.
 *
 * v2 lines are `{"version":"v1","kind":"Prompt"|"AssistantMessage"|"ToolResults",...}`,
 * whereas v1 lines are `{"method":"session/update",...}`. Only the first
 * well-formed JSON line is inspected, so an empty or malformed file is treated
 * as non-v2 and left to the v1 parser.
 */
export function isKiroV2HistoryContent(content: string): boolean {
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const record = parseV2Line(line);
    if (record) return true;
    // A first non-blank line that does not parse as a v2 record (e.g. a v1
    // `session/update` record) means this is not a v2 file.
    try {
      const parsed = JSON.parse(line) as unknown;
      return isV2Shape(parsed);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Parse Kiro CLI v2 session history into Claudian `ChatMessage[]`.
 *
 * A turn opens on a `Prompt` record and closes when the next `Prompt` arrives
 * (or at end of file). `AssistantMessage` text/thinking blocks and `toolUse`
 * blocks accumulate into the open turn; a separate `ToolResults` record carries
 * each tool's output, matched back to its `toolUse` by `toolUseId`.
 */
export function parseKiroV2HistoryContent(
  content: string,
  sessionId: string,
): ParsedKiroHistory {
  const turns: ChatMessage[][] = [];
  let pending: KiroV2PendingTurn | null = null;
  let turnIndex = 0;
  // Tool outputs can arrive in a ToolResults record emitted after the turn's
  // AssistantMessage; buffer them by toolUseId so finalizeTurn can attach them.
  const toolResults = new Map<string, unknown>();

  const commit = (turn: KiroV2PendingTurn): void => {
    const messages = finalizeV2Turn(turn, sessionId, toolResults);
    if (messages.length > 0) turns.push(messages);
  };

  for (const line of content.split(/\r?\n/)) {
    const record = parseV2Line(line);
    if (!record) continue;

    if (record.kind === 'Prompt') {
      if (pending) commit(pending);
      pending = createPendingTurn(turnIndex, readV2Timestamp(record.data));
      turnIndex += 1;
      pending.userContent = readV2TextContent(record.data.content);
      pending.userId = readString(record.data.message_id);
      continue;
    }

    if (record.kind === 'AssistantMessage') {
      if (!pending) {
        // Assistant output with no preceding prompt (e.g. a truncated head):
        // open an anonymous turn so the content is not silently dropped.
        pending = createPendingTurn(turnIndex, 0);
        turnIndex += 1;
      }
      pending.assistantId ??= readString(record.data.message_id);
      applyAssistantContent(pending, record.data.content);
      continue;
    }

    if (record.kind === 'ToolResults') {
      applyToolResults(record.data.content, toolResults);
      continue;
    }
  }

  if (pending) commit(pending);

  const messages = turns.flat();
  return { messages };
}

/**
 * Resolve the fork target prompt index for a v2 session: the number of prompts
 * that precede (and include) the turn whose assistant `message_id` equals
 * `resumeAt`. v2 prompts are ordered, so the index is the count of `Prompt`
 * records seen up to and including the matching assistant turn.
 */
export function resolveKiroV2PromptIndexAfterAssistant(
  content: string,
  _sessionId: string,
  resumeAt: string,
): number | null {
  let promptIndex = -1;
  for (const line of content.split(/\r?\n/)) {
    const record = parseV2Line(line);
    if (!record) continue;
    if (record.kind === 'Prompt') {
      promptIndex += 1;
      continue;
    }
    if (
      record.kind === 'AssistantMessage'
      && readString(record.data.message_id) === resumeAt
      && promptIndex >= 0
    ) {
      return promptIndex + 1;
    }
  }
  return null;
}

function createPendingTurn(turnIndex: number, timestamp: number): KiroV2PendingTurn {
  return {
    assistantContent: '',
    blocks: [],
    startedAt: normalizeTimestamp(timestamp),
    toolOrder: [],
    tools: new Map(),
    turnIndex,
    userContent: '',
  };
}

function applyAssistantContent(turn: KiroV2PendingTurn, content: unknown): void {
  if (!Array.isArray(content)) return;
  for (const entry of content) {
    const block = readRecord(entry);
    if (!block) continue;
    const kind = readString(block.kind);
    if (kind === 'text') {
      const text = typeof block.data === 'string' ? block.data : '';
      if (!text) continue;
      turn.assistantContent += text;
      appendContentBlock(turn.blocks, 'text', text);
      continue;
    }
    if (kind === 'thinking') {
      const thinking = readRecord(block.data);
      const text = thinking && typeof thinking.text === 'string' ? thinking.text : '';
      // Empty thinking blocks (redacted-only) carry no displayable text.
      if (!text) continue;
      appendContentBlock(turn.blocks, 'thinking', text);
      continue;
    }
    if (kind === 'toolUse') {
      const toolUse = readRecord(block.data);
      if (!toolUse) continue;
      const id = readString(toolUse.toolUseId);
      if (!id) continue;
      const rawName = readString(toolUse.name) ?? 'tool';
      const normalized = normalizeKiroToolCall({ rawInput: toolUse.input, title: rawName });
      turn.tools.set(id, {
        id,
        input: normalized.input,
        name: normalized.name,
        rawInput: toolUse.input,
        rawName,
      });
      turn.toolOrder.push(id);
      turn.blocks.push({ toolId: id, type: 'tool_use' });
      continue;
    }
  }
}

function applyToolResults(content: unknown, sink: Map<string, unknown>): void {
  if (!Array.isArray(content)) return;
  for (const entry of content) {
    const block = readRecord(entry);
    if (!block || readString(block.kind) !== 'toolResult') continue;
    const data = readRecord(block.data);
    if (!data) continue;
    const id = readString(data.toolUseId);
    if (!id) continue;
    sink.set(id, data.content);
  }
}

function finalizeV2Turn(
  turn: KiroV2PendingTurn,
  sessionId: string,
  toolResults: Map<string, unknown>,
): ChatMessage[] {
  if (!turn.userContent) {
    return [];
  }
  const scope = sanitizeId(sessionId);
  const userId = turn.userId ?? `kiro-${scope}-turn-${turn.turnIndex}-user`;
  const assistantId = turn.assistantId ?? `kiro-${scope}-turn-${turn.turnIndex}-assistant`;
  const user: ChatMessage = {
    content: turn.userContent,
    id: userId,
    role: 'user',
    timestamp: turn.startedAt,
    userMessageId: userId,
  };

  if (!turn.assistantContent && turn.blocks.length === 0 && turn.tools.size === 0) {
    return [user];
  }

  const toolCalls = turn.toolOrder.flatMap((id) => {
    const tool = turn.tools.get(id);
    if (!tool) return [];
    const rawOutput = toolResults.get(id);
    const output = renderToolResultContent(rawOutput);
    const providerToolUseResult = normalizeKiroToolUseResult(
      tool.rawName,
      tool.input,
      rawOutput,
      tool.rawInput,
    );
    const toolUseResult: SDKToolUseResult = { ...providerToolUseResult };
    const toolCall: ToolCallInfo = {
      id: tool.id,
      input: tool.input,
      name: tool.name,
      providerPayload: providerToolUseResult.providerPayload,
      ...(output ? { result: output } : {}),
      status: rawOutput === undefined ? 'running' : 'completed',
    };
    if (toolCall.name === TOOL_ASK_USER_QUESTION && providerToolUseResult.answers) {
      toolCall.resolvedAnswers = providerToolUseResult.answers;
    }
    if (toolCall.status === 'completed' && isWriteEditTool(toolCall.name)) {
      const diffData = extractDiffData(toolUseResult, toolCall);
      if (diffData) toolCall.diffData = diffData;
    }
    return [toolCall];
  });

  const assistant: ChatMessage = {
    assistantMessageId: assistantId,
    content: turn.assistantContent,
    ...(turn.blocks.length > 0 ? { contentBlocks: turn.blocks } : {}),
    id: assistantId,
    role: 'assistant',
    timestamp: turn.startedAt,
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
  return [user, assistant];
}

function renderToolResultContent(value: unknown): string {
  if (!Array.isArray(value)) {
    return '';
  }
  return value.flatMap((entry) => {
    const record = readRecord(entry);
    if (!record) return [];
    const kind = readString(record.kind);
    if (kind === 'text') {
      return typeof record.data === 'string' && record.data ? [record.data] : [];
    }
    if (kind === 'json') {
      if (record.data === undefined) return [];
      try {
        return [JSON.stringify(record.data)];
      } catch {
        return [];
      }
    }
    return [];
  }).join('\n\n');
}

function appendContentBlock(
  blocks: ContentBlock[],
  type: 'text' | 'thinking',
  content: string,
): void {
  if (!content) return;
  const previous = blocks[blocks.length - 1];
  if (previous?.type === type) {
    previous.content += content;
    return;
  }
  blocks.push({ content, type });
}

function readV2TextContent(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.flatMap((entry) => {
    const record = readRecord(entry);
    if (!record || readString(record.kind) !== 'text') return [];
    return typeof record.data === 'string' ? [record.data] : [];
  }).join('');
}

function readV2Timestamp(data: Record<string, unknown>): number {
  const meta = readRecord(data.meta);
  const timestamp = meta?.timestamp;
  return typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : 0;
}

function parseV2Line(line: string): KiroV2Record | null {
  if (!line.trim()) return null;
  try {
    const parsed = JSON.parse(line) as unknown;
    const record = readRecord(parsed);
    const kind = readString(record?.kind);
    const data = readRecord(record?.data);
    if (!record || !kind || !data || !V2_RECORD_KINDS.has(kind)) {
      return null;
    }
    return { data, kind };
  } catch {
    return null;
  }
}

function isV2Shape(parsed: unknown): boolean {
  const record = readRecord(parsed);
  const kind = readString(record?.kind);
  return Boolean(record && kind && V2_RECORD_KINDS.has(kind));
}

function normalizeTimestamp(value: number): number {
  return value > 0 && value < 1_000_000_000_000 ? value * 1_000 : value;
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'session';
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// Re-export the usage type so callers importing only the v2 module get it too.
export type { KiroHistoryUsage, ParsedKiroHistory };
