/** @vitest-environment jsdom */
// @test-ci {"inputs":["tests/fixtures/providers/kiro/acp/*.jsonl"]}
import '@/providers';

import * as fs from 'node:fs';
import * as path from 'node:path';

import { partialMock } from '@test/helpers/partialMock';
import { testDate } from '@test/helpers/testClock';

import { TOOL_SUBAGENT } from '@/core/tools/toolNames';
import type { ChatMessage, StreamChunk, SubagentInfo } from '@/core/types';
import type { ChatFeatureHost } from '@/features/chat/ChatFeatureHost';
import { ChatState } from '@/features/chat/state/ChatState';
import {
  AsyncSubagentHistoryRecovery,
  type AsyncSubagentHistoryRecoveryDeps,
} from '@/features/chat/subagents/AsyncSubagentHistoryRecovery';
import { SubagentManager } from '@/features/chat/subagents/SubagentManager';
import { renderStoredSubagent } from '@/features/chat/subagents/SubagentRenderer';
import { SubagentStreamRouter } from '@/features/chat/subagents/SubagentStreamRouter';
import { ToolCallStream } from '@/features/chat/turns/ToolCallStream';
import { ACPSessionUpdateNormalizer } from '@/providers/acp';
import { createKiroToolStreamAdapter } from '@/providers/kiro/execution/KiroExecutionSession';



function createHarness() {
  const state = new ChatState({});
  const messagesEl = document.createElement('div');
  const subagentManager = Object.assign(new SubagentManager(() => undefined), {
    handleAsyncSubagentCompletion: vi.fn<SubagentManager['handleAsyncSubagentCompletion']>().mockReturnValue(undefined),
    getByTaskId: vi.fn<SubagentManager['getByTaskId']>().mockReturnValue(undefined),
    refreshAsyncSubagent: vi.fn<SubagentManager['refreshAsyncSubagent']>(),
  });
  const harness = {
    providerSessionId: 'session-1' as string | null,
    historyRecovery: undefined as unknown as AsyncSubagentHistoryRecoveryDeps,
    indicator: { show: vi.fn() },
    scrollToBottom: vi.fn(),
    state,
    subagentManager,
    router: undefined as unknown as SubagentStreamRouter,
  };
  harness.historyRecovery = {
    subagentManager,
    getProviderId: () => 'claude',
    getProviderSessionId: () => harness.providerSessionId,
    loadSubagentFinalResult: vi.fn().mockResolvedValue(null),
    loadSubagentToolCalls: vi.fn().mockResolvedValue([]),
    enqueueBackgroundWork: work => work(),
    persistConversation: vi.fn().mockResolvedValue(undefined),
  };
  harness.router = new SubagentStreamRouter({
    state,
    subagentManager,
    getMessagesEl: () => messagesEl,
    getProviderId: () => 'claude',
    asyncSubagentHistoryRecovery: new AsyncSubagentHistoryRecovery(harness.historyRecovery),
    tools: { flush: vi.fn(), flushBefore: vi.fn(), detach: vi.fn(), remove: vi.fn() },
    indicator: harness.indicator,
    scrollToBottom: harness.scrollToBottom,
  });
  return harness;
}

describe('SubagentStreamRouter', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('onAsyncSubagentStateChange', () => {
    it('should update subagent in messages', () => {
      const subagent: SubagentInfo = { id: 'task-1', description: 'test', status: 'completed', result: 'done', isExpanded: false, toolCalls: [] };
      harness.state.messages = [{
        id: 'a1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [{
          id: 'task-1',
          name: TOOL_SUBAGENT,
          input: { description: 'test' },
          status: 'running',
          subagent: { id: 'task-1', description: 'test', status: 'running', isExpanded: false, toolCalls: [] },
        }],
      }];

      harness.router.onAsyncSubagentStateChange(subagent);

      const taskTool = harness.state.messages[0].toolCalls![0];
      expect(taskTool.status).toBe('completed');
      expect(taskTool.subagent?.status).toBe('completed');
      expect(taskTool.subagent?.result).toBe('done');
      expect(harness.scrollToBottom).toHaveBeenCalled();
    });

    it('should not crash when subagent not found in messages', () => {
      const subagent: SubagentInfo = { id: 'unknown', description: 'test', status: 'completed', isExpanded: false, toolCalls: [] };
      harness.state.messages = [{
        id: 'a1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [{
          id: 'task-1',
          name: TOOL_SUBAGENT,
          input: { description: 'test' },
          status: 'running',
        }],
      }];

      expect(() => harness.router.onAsyncSubagentStateChange(subagent)).not.toThrow();
      expect(harness.state.messages[0].toolCalls![0].status).toBe('running');
    });
  });

  describe('handleAsyncSubagentCompletion', () => {
    it('recovers transcript-backed async subagent tools and final result', async () => {
      const completedSubagent: SubagentInfo = {
        agentId: 'agent-1',
        asyncStatus: 'completed',
        id: 'task-1',
        description: 'Background task',
        mode: 'async',
        status: 'completed',
        isExpanded: false, toolCalls: [],
      };
      const completion = {
        type: 'async_subagent_completion' as const,
        providerSessionId: 'session-1',
        taskId: 'agent-1',
        toolUseId: 'task-1',
        status: 'completed' as const,
        result: 'Final result',
      };
      harness.subagentManager.handleAsyncSubagentCompletion.mockReturnValueOnce(completedSubagent);
      harness.subagentManager.getByTaskId.mockReturnValue(completedSubagent);
      vi.mocked(harness.historyRecovery.loadSubagentToolCalls).mockResolvedValueOnce([{
        id: 'nested-tool',
        input: { path: 'README.md' },
        isExpanded: false,
        name: 'Read',
        status: 'completed',
      }]);
      vi.mocked(harness.historyRecovery.loadSubagentFinalResult)
        .mockResolvedValueOnce('Recovered final result');

      await expect(harness.router.handleAsyncSubagentCompletion(completion)).resolves.toBe(true);

      expect(harness.subagentManager.handleAsyncSubagentCompletion).toHaveBeenCalledWith(completion);
      expect(harness.historyRecovery.loadSubagentToolCalls).toHaveBeenCalledWith({
        providerId: 'claude',
        providerSessionId: 'session-1',
        subagentId: 'agent-1',
      });
      expect(harness.historyRecovery.loadSubagentFinalResult).toHaveBeenCalledWith({
        providerId: 'claude',
        providerSessionId: 'session-1',
        subagentId: 'agent-1',
      });
      expect(completedSubagent.toolCalls).toEqual([
        expect.objectContaining({
          id: 'nested-tool',
          input: { path: 'README.md' },
        }),
      ]);
      expect(completedSubagent).toMatchObject({
        result: 'Recovered final result',
      });
      expect(harness.subagentManager.refreshAsyncSubagent).toHaveBeenCalledWith(completedSubagent);
      expect(harness.indicator.show).toHaveBeenCalled();
    });

    it('bounds final-result retries and fences a replaced provider session', async () => {
      const completedSubagent: SubagentInfo = {
        agentId: 'agent-1',
        asyncStatus: 'completed',
        description: 'Background task',
        id: 'task-1',
        mode: 'async',
        result: 'Notification fallback',
        status: 'completed',
        isExpanded: false, toolCalls: [],
      };
      harness.subagentManager.handleAsyncSubagentCompletion.mockReturnValueOnce(completedSubagent);
      harness.subagentManager.getByTaskId.mockReturnValue(completedSubagent);
      vi.mocked(harness.historyRecovery.loadSubagentFinalResult).mockResolvedValue(null);

      await harness.router.handleAsyncSubagentCompletion({
        providerSessionId: 'session-1',
        status: 'completed',
        taskId: 'agent-1',
        toolUseId: 'task-1',
        type: 'async_subagent_completion',
      });
      harness.providerSessionId = 'session-2';
      await vi.advanceTimersByTimeAsync(10_000);

      expect(harness.historyRecovery.loadSubagentFinalResult).toHaveBeenCalledTimes(1);
      expect(completedSubagent.result).toBe('Notification fallback');
      expect(harness.subagentManager.refreshAsyncSubagent).not.toHaveBeenCalled();
    });

    it('does not schedule transcript retries when the provider has no recovery service', async () => {
      const completedSubagent: SubagentInfo = {
        agentId: 'agent-1',
        asyncStatus: 'completed',
        description: 'Background task',
        id: 'task-1',
        mode: 'async',
        result: 'Notification result',
        status: 'completed',
        isExpanded: false, toolCalls: [],
      };
      harness.subagentManager.handleAsyncSubagentCompletion.mockReturnValueOnce(completedSubagent);
      harness.subagentManager.getByTaskId.mockReturnValue(completedSubagent);
      vi.mocked(harness.historyRecovery.loadSubagentToolCalls).mockResolvedValue(undefined);
      vi.mocked(harness.historyRecovery.loadSubagentFinalResult).mockResolvedValue(undefined);

      await harness.router.handleAsyncSubagentCompletion({
        providerSessionId: 'session-1',
        status: 'completed',
        taskId: 'agent-1',
        toolUseId: 'task-1',
        type: 'async_subagent_completion',
      });
      await vi.advanceTimersByTimeAsync(10_000);

      expect(harness.historyRecovery.loadSubagentToolCalls).toHaveBeenCalledTimes(1);
      expect(harness.historyRecovery.loadSubagentFinalResult).not.toHaveBeenCalled();
      expect(completedSubagent.result).toBe('Notification result');
      expect(harness.subagentManager.refreshAsyncSubagent).not.toHaveBeenCalled();
    });

    it('reports an unmatched normalized async completion without provider-native recovery', async () => {
      await expect(harness.router.handleAsyncSubagentCompletion({
        type: 'async_subagent_completion',
        providerSessionId: 'session-1',
        taskId: 'agent-missing',
        toolUseId: 'task-missing',
        status: 'completed',
      })).resolves.toBe(false);

      expect(harness.subagentManager.handleAsyncSubagentCompletion).toHaveBeenCalledTimes(1);
      expect(harness.historyRecovery.loadSubagentToolCalls).not.toHaveBeenCalled();
      expect(harness.indicator.show).not.toHaveBeenCalled();
    });
  });
});

// Kiro drives subagents through the lifecycle protocol: spawn, then wait/close tools that name the agent.
const SPAWN = 'spawn-1';
const WAIT = 'wait-1';
const AGENT = 'agent-1';

type ToolUseChunk = Extract<StreamChunk, { type: 'tool_use' }>;
type ToolResultChunk = Extract<StreamChunk, { type: 'tool_result' }>;

const toolUse = (id: string, name: string, input: Record<string, unknown> = {}): ToolUseChunk => (
  { type: 'tool_use', id, name, input }
);
const spawnUse = (input: Record<string, unknown> = {}): ToolUseChunk => toolUse(SPAWN, 'subagent', input);
const waitUse = (agentId = AGENT): ToolUseChunk => toolUse(WAIT, 'task_output', { task_id: agentId });
const toolResult = (id: string, content: string): ToolResultChunk => ({ type: 'tool_result', id, content });
const spawnResult = (): ToolResultChunk => toolResult(SPAWN, JSON.stringify({ task_id: AGENT }));
const waitResult = (): ToolResultChunk => toolResult(WAIT, JSON.stringify({ task_id: AGENT, status: 'completed', output: 'found it' }));

function createLifecycleHarness() {
  document.body.replaceChildren();
  const state = new ChatState({});
  const messagesEl = document.createElement('div');
  const msg: ChatMessage = { id: 'a1', role: 'assistant', content: '', timestamp: testDate().getTime() };
  const messageEl = document.createElement('div');
  messageEl.dataset.messageId = msg.id;
  const contentEl = document.createElement('div');
  contentEl.className = 'claudian-message-content';
  messageEl.append(contentEl);
  messagesEl.append(messageEl);
  document.body.append(messagesEl);
  state.messages = [msg];
  state.currentContentEl = contentEl;

  const indicator = { show: vi.fn() };
  const scrollToBottom = vi.fn();
  const tools = new ToolCallStream({
    plugin: partialMock<Pick<ChatFeatureHost, 'app' | 'settings'>>({ app: {}, settings: { expandFileEditsByDefault: false } }),
    state,
    indicator,
    getMessagesEl: () => messagesEl,
    scrollToBottom,
  });
  const router = new SubagentStreamRouter({
    state,
    subagentManager: new SubagentManager(() => undefined),
    getMessagesEl: () => messagesEl,
    getProviderId: () => 'kiro',
    tools,
    indicator,
    scrollToBottom,
  });

  return {
    state, msg, contentEl, indicator, router, tools,
    /** Dispatches a tool_use the way StreamController does: subagent protocol first, then the tool stream. */
    use(chunk: ToolUseChunk): void {
      if (!router.routeToolUse(chunk, msg)) tools.use(chunk, msg);
    },
    /** Dispatches a tool_result the way StreamController does and reports whether a subagent consumed it. */
    async result(chunk: ToolResultChunk): Promise<boolean> {
      const consumed = await router.routeToolResult(chunk, msg);
      if (!consumed) tools.complete(chunk, msg);
      return consumed;
    },
    /** The rendered cards in document order, as `tool:<id>` or `subagent:<id>`. */
    cards(): string[] {
      return [...contentEl.children].map((el) => {
        const { toolId, subagentId, asyncSubagentId } = (el as HTMLElement).dataset;
        return toolId ? `tool:${toolId}` : `subagent:${subagentId ?? asyncSubagentId}`;
      });
    },
    toolCall: (id: string) => msg.toolCalls?.find(toolCall => toolCall.id === id),
    /** Spawns a background agent and binds its id from the spawn result. */
    async startBackgroundAgent(): Promise<void> {
      this.use(spawnUse({ description: 'Investigate', run_in_background: true }));
      await this.result(spawnResult());
    },
  };
}

describe('SubagentStreamRouter kiro lifecycle', () => {
  let h: ReturnType<typeof createLifecycleHarness>;

  beforeEach(() => {
    h = createLifecycleHarness();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  describe('spawn', () => {
    it('should claim a spawn tool_use for the lifecycle protocol', () => {
      expect(h.router.routeToolUse(spawnUse(), h.msg)).toBe(true);
    });

    it('should render the spawn as a subagent card instead of a tool card', () => {
      h.use(spawnUse({ description: 'Investigate' }));

      expect(h.cards()).toEqual([`subagent:${SPAWN}`]);
    });

    it('should record the spawn tool call once in the message', () => {
      h.use(spawnUse({ description: 'Investigate' }));

      expect(h.msg.toolCalls?.map(toolCall => toolCall.id)).toEqual([SPAWN]);
    });

    it('should record the spawn as a tool_use content block', () => {
      h.use(spawnUse({ description: 'Investigate' }));

      expect(h.msg.contentBlocks).toEqual([{ type: 'tool_use', toolId: SPAWN }]);
    });

    it('should describe the subagent from the spawn input', () => {
      h.use(spawnUse({ description: 'Investigate', prompt: 'Look around' }));

      expect(h.toolCall(SPAWN)?.subagent).toMatchObject({ id: SPAWN, description: 'Investigate', prompt: 'Look around', mode: 'sync' });
    });

    it('should render a background spawn as an async card', () => {
      h.use(spawnUse({ description: 'Investigate', run_in_background: true }));

      expect(h.contentEl.querySelector(`[data-async-subagent-id="${SPAWN}"]`)).not.toBeNull();
    });
  });

  describe('spawn continuation', () => {
    beforeEach(() => {
      h.use(spawnUse());
      h.use(spawnUse({ description: 'Investigate' }));
    });

    it('should merge a repeated snapshot into the existing tool call', () => {
      expect(h.msg.toolCalls).toEqual([expect.objectContaining({ id: SPAWN, input: { description: 'Investigate' } })]);
    });

    it('should keep a single card', () => {
      expect(h.cards()).toEqual([`subagent:${SPAWN}`]);
    });

    it('should keep a single content block', () => {
      expect(h.msg.contentBlocks).toEqual([{ type: 'tool_use', toolId: SPAWN }]);
    });

    it('should refresh the card label from the merged input', () => {
      expect(h.contentEl.textContent).toContain('Investigate');
    });

    it('should refresh the subagent info from the merged input', () => {
      expect(h.toolCall(SPAWN)?.subagent?.description).toBe('Investigate');
    });
  });

  describe('card placement', () => {
    const read = (id: string) => toolUse(id, 'Read', { file_path: `${id}.md` });

    it('should render earlier buffered tools before a first-time card', () => {
      h.use(read('read-0'));

      h.use(spawnUse());

      expect(h.cards()).toEqual(['tool:read-0', `subagent:${SPAWN}`]);
    });

    it('should replace the spawn’s own buffered tool card and keep earlier tools first', () => {
      h.use(read('read-0'));
      h.use(toolUse(SPAWN, 'unknown_tool'));

      h.use(spawnUse());

      expect(h.cards()).toEqual(['tool:read-0', `subagent:${SPAWN}`]);
    });

    it('should leave tools buffered after the spawn buffered', () => {
      h.use(toolUse(SPAWN, 'unknown_tool'));
      h.use(read('read-2'));

      h.use(spawnUse());

      expect([...h.state.pendingTools.keys()]).toEqual(['read-2']);
    });

    it('should take the position of an already rendered tool card', () => {
      h.use(read('before'));
      h.use(toolUse(SPAWN, 'unknown_tool'));
      h.use(read('after'));
      h.tools.flush();

      h.use(spawnUse());

      expect(h.cards()).toEqual(['tool:before', `subagent:${SPAWN}`, 'tool:after']);
    });

    it('should release the replaced tool card from the tool stream', () => {
      h.use(toolUse(SPAWN, 'unknown_tool'));
      h.tools.flush();

      h.use(spawnUse());

      expect(h.state.toolCallElements.has(SPAWN)).toBe(false);
    });

    it('should take the position of a restored card', () => {
      h.use(read('before'));
      h.tools.flush();
      renderStoredSubagent(h.contentEl, {
        id: SPAWN, description: 'Restored', status: 'completed', toolCalls: [], isExpanded: false,
      });
      h.use(read('after'));
      h.tools.flush();

      h.use(spawnUse({ description: 'Investigate' }));

      expect(h.cards()).toEqual(['tool:before', `subagent:${SPAWN}`, 'tool:after']);
    });

    it('should remove a wait tool card once a session update binds its agent', () => {
      h.use(spawnUse({ run_in_background: true }));
      h.use(waitUse());
      h.tools.flush();
      expect(h.cards()).toEqual([`subagent:${SPAWN}`, `tool:${WAIT}`]);

      h.router.handleSubagentUpdate({
        id: SPAWN, agentId: AGENT, description: 'Investigate', mode: 'async', status: 'running', asyncStatus: 'running', toolCalls: [], isExpanded: false,
      });

      expect(h.cards()).toEqual([`subagent:${SPAWN}`]);
    });

    it('should route a wait-named chunk carrying a session-reported subagent id to the lifecycle spawn', () => {
      h.router.handleSubagentUpdate({
        id: SPAWN, agentId: AGENT, description: 'Investigate', status: 'running', toolCalls: [], isExpanded: false,
      });

      expect(h.router.routeToolUse(toolUse(SPAWN, 'task_output'), h.msg)).toBe(true);
    });
  });

  describe('hidden tools', () => {
    it('should claim a wait tool that targets a known agent', async () => {
      await h.startBackgroundAgent();

      expect(h.router.routeToolUse(waitUse(), h.msg)).toBe(true);
    });

    it('should not render a wait tool that targets a known agent', async () => {
      await h.startBackgroundAgent();

      h.use(waitUse());

      expect(h.cards()).toEqual([`subagent:${SPAWN}`]);
    });

    it('should track the hidden tool call in the message', async () => {
      await h.startBackgroundAgent();

      h.use(waitUse());

      expect(h.msg.toolCalls?.map(toolCall => toolCall.id)).toEqual([SPAWN, WAIT]);
    });

    it('should record the hidden tool as a tool_use content block', async () => {
      await h.startBackgroundAgent();

      h.use(waitUse());

      expect(h.msg.contentBlocks).toContainEqual({ type: 'tool_use', toolId: WAIT });
    });

    it('should leave a wait tool for an unknown agent to the tool stream', async () => {
      await h.startBackgroundAgent();

      expect(h.router.routeToolUse(waitUse('other-agent'), h.msg)).toBe(false);
    });

    it('should forward the result of an already completed hidden tool to the subagent', async () => {
      await h.startBackgroundAgent();
      h.use(waitUse());
      // The completion was recorded outside the router, so only a repeated snapshot can carry it to the card.
      h.tools.complete(waitResult(), h.msg);
      expect(h.toolCall(SPAWN)?.subagent?.status).toBe('running');

      h.use(waitUse());

      expect(h.toolCall(SPAWN)?.subagent).toMatchObject({ status: 'completed', result: 'found it' });
    });

    it('should keep a repeated snapshot of a running hidden tool running', async () => {
      await h.startBackgroundAgent();
      h.use(waitUse());

      h.use(waitUse());

      expect(h.toolCall(WAIT)?.status).toBe('running');
    });

    it('should merge a repeated snapshot into the tracked hidden tool call', async () => {
      await h.startBackgroundAgent();
      h.use(waitUse());

      h.use(toolUse(WAIT, 'task_output', { task_id: AGENT, timeout: 5 }));

      expect(h.toolCall(WAIT)?.input).toEqual({ task_id: AGENT, timeout: 5 });
    });

    it('should remove the card a tool rendered before its name was refined to a wait tool', async () => {
      await h.startBackgroundAgent();
      h.use(toolUse(WAIT, 'unknown_tool', { task_id: AGENT }));
      h.tools.flush();
      expect(h.cards()).toEqual([`subagent:${SPAWN}`, `tool:${WAIT}`]);

      h.use(waitUse());

      expect(h.cards()).toEqual([`subagent:${SPAWN}`]);
    });
  });

  describe('results', () => {
    it('should consume the result of a lifecycle spawn', async () => {
      h.use(spawnUse({ description: 'Investigate' }));

      await expect(h.result(toolResult(SPAWN, 'all done'))).resolves.toBe(true);
    });

    it('should complete the subagent from the spawn result', async () => {
      h.use(spawnUse({ description: 'Investigate' }));

      await h.result(toolResult(SPAWN, 'all done'));

      expect(h.toolCall(SPAWN)?.subagent).toMatchObject({ status: 'completed', result: 'all done' });
    });

    it('should show the thinking indicator when a subagent consumes a result', async () => {
      h.use(spawnUse({ description: 'Investigate' }));
      h.indicator.show.mockClear();

      await h.result(toolResult(SPAWN, 'all done'));

      expect(h.indicator.show).toHaveBeenCalledTimes(1);
    });

    it('should consume the result of an owned wait tool', async () => {
      await h.startBackgroundAgent();
      h.use(waitUse());

      await expect(h.result(waitResult())).resolves.toBe(true);
    });

    it('should complete the subagent from an owned wait result', async () => {
      await h.startBackgroundAgent();
      h.use(waitUse());

      await h.result(waitResult());

      expect(h.toolCall(SPAWN)?.subagent).toMatchObject({ asyncStatus: 'completed', status: 'completed', result: 'found it' });
    });

    it('should remove the card of a wait tool that the spawn result binds to the subagent', async () => {
      h.use(spawnUse({ description: 'Investigate', run_in_background: true }));
      h.use(waitUse());
      h.tools.flush();

      await h.result(spawnResult());

      expect(h.cards()).toEqual([`subagent:${SPAWN}`]);
    });

    it('should not consume the result of a wait tool for an unknown agent', async () => {
      await h.startBackgroundAgent();
      h.use(waitUse('other-agent'));

      await expect(h.result(toolResult(WAIT, JSON.stringify({ task_id: 'other-agent', status: 'completed', output: 'x' })))).resolves.toBe(false);
    });

    it('should not consume the result of a tool outside the subagent protocol', async () => {
      h.use(toolUse('read-1', 'Read', { file_path: 'a.md' }));

      await expect(h.result(toolResult('read-1', 'contents'))).resolves.toBe(false);
    });

    it('should not consume a result for an unknown tool call', async () => {
      await expect(h.result(toolResult('missing', 'x'))).resolves.toBe(false);
    });
  });
});

// Frames captured from kiro-cli 3.1.0 (`kiro-cli acp --agent-engine v2|v3`), one `session/update`
// payload per line, sanitized: ids, paths and prompts replaced with neutral values.
type KiroEngine = 'v2' | 'v3';

function readFrames(engine: KiroEngine): unknown[] {
  const file = path.join(process.cwd(), 'tests/fixtures/providers/kiro/acp', `subagent-${engine}.jsonl`);
  return fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line) as unknown);
}

/** Runs frames through the Kiro ACP normalization the session uses, ending in router-ready chunks. */
function framesToChunks(frames: unknown[], rename: (id: string) => string = id => id): StreamChunk[] {
  const normalizer = new ACPSessionUpdateNormalizer();
  const toolStream = createKiroToolStreamAdapter();
  return frames.flatMap((frame) => {
    const renamed = { ...(frame as { toolCallId: string }), toolCallId: rename((frame as { toolCallId: string }).toolCallId) };
    const normalized = normalizer.normalizeUnknown(renamed);
    if (normalized.type === 'tool_call') {
      return toolStream.normalizeToolCall(normalized.toolCall, normalized.streamChunks);
    }
    if (normalized.type === 'tool_call_update') {
      return toolStream.normalizeToolCallUpdate(normalized.toolCallUpdate, normalized.streamChunks);
    }
    return [];
  });
}

async function dispatch(h: ReturnType<typeof createLifecycleHarness>, chunks: StreamChunk[]): Promise<void> {
  for (const chunk of chunks) {
    if (chunk.type === 'tool_use') h.use(chunk);
    else if (chunk.type === 'tool_result') await h.result(chunk);
  }
}

describe.each<{ engine: KiroEngine; spawnId: string; description: string; prompt: string; result: string }>([
  {
    engine: 'v2',
    spawnId: 'toolu_bdrk_spawn_agent',
    description: 'Kiro subagent',
    prompt: 'Reply with the single word PONG and nothing else.',
    result: 'Pipeline completed: 1 stages finished.\n\n## pong\n\nPONG',
  },
  {
    engine: 'v3',
    spawnId: 'invoke_subagent_toolu_bdrk_spawn_agent',
    description: 'general-task-execution',
    prompt: 'Reply with only the single word PONG. Do not use any tools. Do not add any other text.',
    result: 'PONG',
  },
])('SubagentStreamRouter kiro $engine wire frames', ({ engine, spawnId, description, prompt, result }) => {
  const writeId = 'toolu_bdrk_write_file';
  let h: ReturnType<typeof createLifecycleHarness>;

  beforeEach(() => {
    h = createLifecycleHarness();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('should render the spawn frame as a subagent card', async () => {
    await dispatch(h, framesToChunks(readFrames(engine).slice(0, 1)));

    expect(h.cards()).toEqual([`subagent:${spawnId}`]);
  });

  it('should describe the subagent from the spawn input', async () => {
    await dispatch(h, framesToChunks(readFrames(engine).slice(0, 1)));

    expect(h.toolCall(spawnId)?.subagent).toMatchObject({ description, prompt, mode: 'sync', status: 'running' });
  });

  it('should keep the subagent running through progress frames', async () => {
    await dispatch(h, framesToChunks(readFrames(engine).slice(0, 2)));

    expect(h.toolCall(spawnId)?.subagent?.status).toBe('running');
  });

  it('should complete the subagent with the reported output', async () => {
    await dispatch(h, framesToChunks(readFrames(engine)));

    expect(h.toolCall(spawnId)?.subagent).toMatchObject({ status: 'completed', result });
  });

  it('should keep a single subagent card across spawn, progress and completion', async () => {
    await dispatch(h, framesToChunks(readFrames(engine)));

    expect(h.cards()).toEqual([`subagent:${spawnId}`, `tool:${writeId}`]);
  });

  it('should not treat an ordinary file write as a subagent', async () => {
    await dispatch(h, framesToChunks(readFrames(engine)));

    expect(h.toolCall(writeId)?.subagent).toBeUndefined();
  });

  it('should track concurrent subagents independently', async () => {
    const frames = readFrames(engine);
    const second = framesToChunks(frames.slice(0, 1), id => `${id}-second`);
    const first = framesToChunks(frames.slice(0, 3));
    const secondDone = framesToChunks(frames.slice(0, 3), id => `${id}-second`).slice(second.length);

    await dispatch(h, [...first.slice(0, 1), ...second, ...first.slice(1), ...secondDone]);

    expect([h.toolCall(spawnId)?.subagent?.status, h.toolCall(`${spawnId}-second`)?.subagent?.status])
      .toEqual(['completed', 'completed']);
  });

  it('should leave a concurrent subagent running while another completes', async () => {
    const frames = readFrames(engine);

    await dispatch(h, [
      ...framesToChunks(frames.slice(0, 1), id => `${id}-second`),
      ...framesToChunks(frames.slice(0, 3)),
    ]);

    expect(h.toolCall(`${spawnId}-second`)?.subagent?.status).toBe('running');
  });
});
