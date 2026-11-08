import '@/providers';

import { createMockEl, type MockEl } from '@test/helpers/MockElement';
import { partialMock } from '@test/helpers/partialMock';
import type { Mock } from 'vitest';

import {
  TOOL_APPLY_PATCH,
  TOOL_SUBAGENT,
  TOOL_TODO_WRITE,
} from '@/core/tools/toolNames';
import type { ChatMessage, SubagentInfo, ToolCallInfo, UsageInfo } from '@/core/types';
import * as displayOnlyCodeFences from '@/features/chat/rendering/markdown/DisplayOnlyCodeFences';
import { providerOutputEventToStreamChunk } from '@/features/chat/rendering/providerOutputChunks';
import type { ThinkingBlockState } from '@/features/chat/rendering/ThinkingBlockRenderer';
import type { WriteEditState } from '@/features/chat/rendering/tools/WriteEditRenderer';
import { ChatState } from '@/features/chat/state/ChatState';
import {
  AsyncSubagentHistoryRecovery,
  type AsyncSubagentHistoryRecoveryDeps,
} from '@/features/chat/subagents/AsyncSubagentHistoryRecovery';
import { SubagentManager } from '@/features/chat/subagents/SubagentManager';
import { StreamController, type StreamControllerDeps } from '@/features/chat/turns/StreamController';
import { TurnCoordinator } from '@/features/chat/turns/TurnCoordinator';
import * as markdownMath from '@/utils/markdownMath';

vi.mock('@/core/tools/toolInput', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/tools/toolInput')>()),
  extractResolvedAnswersFromResultText: vi.fn().mockReturnValue(undefined),
}));

vi.mock('@/features/chat/subagents/SubagentRenderer', () => ({
  createAsyncSubagentBlock: vi.fn((_parent: HTMLElement, info: SubagentInfo) => ({ info, statusTextEl: {} })),
  createSubagentBlock: vi.fn((_parent: HTMLElement, info: SubagentInfo) => ({ info })),
  updateSubagentBlock: vi.fn((state: { info: SubagentInfo }, info: SubagentInfo) => { state.info = info; }),
  updateAsyncSubagentBlock: vi.fn((state: { info: SubagentInfo }, info: SubagentInfo) => { state.info = info; }),
}));

vi.mock('@/features/chat/rendering/ThinkingBlockRenderer', () => ({
  createThinkingBlock: vi.fn().mockImplementation((_parentEl, options) => ({
    wrapperEl: {},
    contentEl: {},
    labelEl: {},
    content: '',
    startTime: Date.now(),
    isExpanded: false,
    onToggle: options?.onToggle,
  })),
  finalizeThinkingBlock: vi.fn().mockReturnValue(0),
  cleanupThinkingBlock: vi.fn(),
}));

vi.mock('@/features/chat/rendering/tools/toolPresentation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/chat/rendering/tools/toolPresentation')>()),
  getToolName: vi.fn().mockReturnValue('Read'),
  getToolSummary: vi.fn().mockReturnValue('file.md'),
}));

vi.mock('@/features/chat/rendering/tools/ToolCallRenderer', () => ({
  renderToolCall: vi.fn(),
  updateToolCallResult: vi.fn(),
  refreshToolCallHeader: vi.fn(),
}));

vi.mock('@/features/chat/rendering/tools/WriteEditRenderer', () => ({
  createWriteEditBlock: vi.fn().mockReturnValue({}),
  finalizeWriteEditBlock: vi.fn(),
  updateWriteEditWithDiff: vi.fn(),
}));

vi.mock('@/utils/path', () => ({
  getVaultPath: vi.fn().mockReturnValue('/test/vault'),
  normalizePathForVault: vi.fn((path: string | undefined) => path),
}));

const originalWindow = (globalThis as { window?: Window }).window;

// Opaque non-default model id used to exercise provider-neutral usage stamping.
const TEST_USAGE_MODEL = 'kiro/claude-sonnet-4-5';

function createMemoryLocalStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  } satisfies Storage;
}

function installTestWindow(): void {
  const testWindow = {
    requestAnimationFrame: (callback: FrameRequestCallback): number =>
      globalThis.setTimeout(() => callback(performance.now()), 16) as unknown as number,
    cancelAnimationFrame: (handle: number): void => {
      globalThis.clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    },
    setTimeout: (callback: () => void, timeout: number): number =>
      globalThis.setTimeout(callback, timeout) as unknown as number,
    clearTimeout: (handle: number): void => {
      globalThis.clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    },
    setInterval: (callback: () => void, timeout: number): number =>
      globalThis.setInterval(callback, timeout) as unknown as number,
    clearInterval: (handle: number): void => {
      globalThis.clearInterval(handle as unknown as ReturnType<typeof setInterval>);
    },
    // The default chat provider is now kiro, whose isEnabled reads a persisted
    // device-settings seed from window.localStorage during provider resolution.
    // The bare test window must expose one or resolution throws.
    localStorage: createMemoryLocalStorage(),
  } as Window;

  Object.defineProperty(globalThis, 'window', {
    value: testWindow,
    configurable: true,
  });
}

function restoreTestWindow(): void {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: Window }).window;
    return;
  }

  Object.defineProperty(globalThis, 'window', {
    value: originalWindow,
    configurable: true,
  });
}

type MockStreamControllerDeps = Omit<StreamControllerDeps, 'renderer' | 'getMessagesEl' | 'subagentManager'> & {
  subagentManager: ReturnType<typeof createMockSubagentManager>;
  getProviderSessionId: () => string | null;
  /** The recovery shares the stream's provider, session, manager, and window ports. */
  historyRecovery: AsyncSubagentHistoryRecoveryDeps;
  /** The turn owner the presentation state derives its stream generation from. */
  turns: TurnCoordinator;
  /**
   * The mock always supplies a concrete renderer and messages element, so these
   * ports are non-null here even though the production deps made them nullable.
   */
  renderer: NonNullable<StreamControllerDeps['renderer']>;
  getMessagesEl: () => HTMLElement;
};

function createMockSubagentManager() {
  return Object.assign(new SubagentManager(() => undefined), {
    isPendingAsyncTask: vi.fn().mockReturnValue(false),
    isLinkedAgentOutputTool: vi.fn().mockReturnValue(false),
    handleAgentOutputToolResult: vi.fn().mockReturnValue(undefined),
    handleAgentOutputToolUse: vi.fn(),
    handleAsyncSubagentCompletion: vi.fn().mockReturnValue(undefined),
    handleTaskToolUse: vi.fn().mockReturnValue({ action: 'buffered' }),
    handleTaskToolResult: vi.fn(),
    getByTaskId: vi.fn().mockReturnValue(undefined),
    refreshAsyncSubagent: vi.fn(),
    hasPendingTask: vi.fn().mockReturnValue(false),
    resolvePendingTask: vi.fn().mockReturnValue(null),
    resolvePendingTaskFromTaskResult: vi.fn().mockReturnValue(null),
    getSyncSubagent: vi.fn().mockReturnValue(undefined),
    addSyncToolCall: vi.fn(),
    updateSyncToolResult: vi.fn(),
    finalizeSyncSubagent: vi.fn().mockReturnValue(null),
    resetStreamingState: vi.fn(),
    resetLifecycleState: vi.fn(),
  });
}

function createMockDeps(): MockStreamControllerDeps {
  const turns = new TurnCoordinator();
  const state = new ChatState({}, undefined, turns);
  const messagesEl = createMockEl();
  const subagentManager = createMockSubagentManager();

  const deps: MockStreamControllerDeps = {
    plugin: partialMock<StreamControllerDeps['plugin']>({
      settings: {
        permissionMode: 'yolo',
      },
      app: {
        vault: {
          adapter: {
            basePath: '/test/vault',
          },
        },
      },
    }),
    state,
    renderer: partialMock<MockStreamControllerDeps['renderer']>({
      renderContent: vi.fn(),
      addTextCopyButton: vi.fn(),
    }),
    subagentManager,
    getMessagesEl: () => messagesEl,
    updateQueueIndicator: vi.fn(),
    getProviderId: () => 'kiro',
    getProviderSessionId: () => 'session-1',
    turns,
    historyRecovery: {
      subagentManager,
      getProviderId: () => deps.getProviderId?.() ?? 'kiro',
      getProviderSessionId: () => deps.getProviderSessionId?.() ?? null,
      loadSubagentFinalResult: vi.fn().mockResolvedValue(null),
      loadSubagentToolCalls: vi.fn().mockResolvedValue([]),
      enqueueBackgroundWork: work => work(),
      persistConversation: vi.fn().mockResolvedValue(undefined),
    },
  };
  deps.asyncSubagentHistoryRecovery = new AsyncSubagentHistoryRecovery(deps.historyRecovery);
  return deps;
}

function createTestMessage(): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    toolCalls: [],
    contentBlocks: [],
  };
}

function createMockUsage(overrides: Partial<UsageInfo> = {}): UsageInfo {
  return {
    model: 'model-a',
    inputTokens: 10,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    contextWindow: 100,
    contextTokens: 10,
    percentage: 10,
    ...overrides,
  };
}

function installOrderedMockParent(parent: MockEl): void {
  Object.assign(parent, {
    insertBefore: vi.fn((element: MockEl, reference: MockEl | null) => {
      const existingIndex = parent.children.indexOf(element);
      if (existingIndex >= 0) parent.children.splice(existingIndex, 1);
      const referenceIndex = reference ? parent.children.indexOf(reference) : -1;
      parent.children.splice(referenceIndex >= 0 ? referenceIndex : parent.children.length, 0, element);
    }),
  });
}

function mountMockChild(parent: HTMLElement, child: MockEl): MockEl {
  const mockParent = parent as MockEl;
  mockParent.children.push(child);
  Object.defineProperty(child, 'parentElement', {
    configurable: true,
    value: parent,
  });
  child.remove = vi.fn(() => {
    const index = mockParent.children.indexOf(child);
    if (index >= 0) mockParent.children.splice(index, 1);
  });
  return child;
}

describe('StreamController - Text Content', () => {
  let controller: StreamController;
  let deps: MockStreamControllerDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    installTestWindow();
    deps = createMockDeps();
    controller = new StreamController(deps);
    deps.state.currentContentEl = createMockEl();
  });

  afterEach(() => {
    deps.state.clearThinkingIndicatorTimeout();
    deps.state.clearFlavorTimerInterval();
    restoreTestWindow();
    vi.useRealTimers();
  });

  describe('Text streaming', () => {
    it('should accumulate text across multiple chunks', async () => {
      const msg = createTestMessage();
      deps.state.currentTextEl = createMockEl();

      const chunks = ['This ', 'is ', 'a ', 'test.'];
      for (const chunk of chunks) {
        await controller.handleStreamChunk({ type: 'text', content: chunk }, msg);
      }

      expect(msg.content).toBe('This is a test.');
    });

    it('should coalesce text renders until the next animation frame', async () => {
      deps.state.currentTextEl = createMockEl();

      await controller.appendText('Hello ');
      await controller.appendText('World');

      expect(deps.renderer.renderContent).not.toHaveBeenCalled();

      vi.advanceTimersByTime(16);
      await Promise.resolve();

      expect(deps.renderer.renderContent).toHaveBeenCalledTimes(1);
      expect(deps.renderer.renderContent).toHaveBeenCalledWith(
        deps.state.currentTextEl,
        'Hello World', { deferMath: true, deferDiagrams: true }
      );
    });

    it('should throttle successive streaming text renders', async () => {
      deps.state.currentTextEl = createMockEl();

      await controller.appendText('First');
      vi.advanceTimersByTime(16);
      await Promise.resolve();
      expect(deps.renderer.renderContent).toHaveBeenCalledTimes(1);

      await controller.appendText(' second');
      vi.advanceTimersByTime(16);
      await Promise.resolve();
      expect(deps.renderer.renderContent).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(150);
      await Promise.resolve();
      expect(deps.renderer.renderContent).toHaveBeenCalledTimes(2);
      expect(deps.renderer.renderContent).toHaveBeenLastCalledWith(
        deps.state.currentTextEl,
        'First second', { deferMath: true, deferDiagrams: true }
      );
    });

    it('scans for deferred math and diagrams only when a text render runs', async () => {
      const mathSpy = vi.spyOn(markdownMath, 'hasStreamingMathDelimiters');
      const mermaidSpy = vi.spyOn(displayOnlyCodeFences, 'hasDeferredDiagramFence');
      try {
        deps.state.currentTextEl = createMockEl();
        controller.setTabActive(false);
        for (let i = 0; i < 20; i += 1) {
          await controller.appendText('$x$ ');
        }
        vi.advanceTimersByTime(500);
        await Promise.resolve();

        expect(deps.renderer.renderContent).not.toHaveBeenCalled();
        expect(mathSpy).not.toHaveBeenCalled();
        expect(mermaidSpy).not.toHaveBeenCalled();

        controller.setTabActive(true);
        vi.advanceTimersByTime(16);
        await Promise.resolve();
        expect(deps.renderer.renderContent).toHaveBeenCalledTimes(1);
        expect(deps.renderer.renderContent).toHaveBeenLastCalledWith(
          deps.state.currentTextEl, '$x$ '.repeat(20), { deferMath: true, deferDiagrams: true }
        );
        const scansAfterFirstRender = mathSpy.mock.calls.length;
        expect(mermaidSpy).toHaveBeenCalledTimes(scansAfterFirstRender);

        for (let i = 0; i < 20; i += 1) {
          await controller.appendText('$y$ ');
        }
        vi.advanceTimersByTime(16);
        await Promise.resolve();
        expect(deps.renderer.renderContent).toHaveBeenCalledTimes(1);
        expect(mathSpy).toHaveBeenCalledTimes(scansAfterFirstRender);
        expect(mermaidSpy).toHaveBeenCalledTimes(scansAfterFirstRender);

        vi.advanceTimersByTime(150);
        await Promise.resolve();
        expect(deps.renderer.renderContent).toHaveBeenCalledTimes(2);
        expect(deps.renderer.renderContent).toHaveBeenLastCalledWith(
          deps.state.currentTextEl, '$x$ '.repeat(20) + '$y$ '.repeat(20), { deferMath: true, deferDiagrams: true }
        );
        expect(mathSpy).toHaveBeenCalledTimes(2 * scansAfterFirstRender);
      } finally {
        mathSpy.mockRestore();
        mermaidSpy.mockRestore();
      }
    });

    it('should catch up with the latest text when a hidden tab becomes active', async () => {
      deps.state.currentTextEl = createMockEl();
      controller.setTabActive(false);

      await controller.appendText('Hidden ');
      await controller.appendText('content');
      vi.advanceTimersByTime(500);
      await Promise.resolve();

      expect(deps.renderer.renderContent).not.toHaveBeenCalled();

      controller.setTabActive(true);
      vi.advanceTimersByTime(16);
      await Promise.resolve();

      expect(deps.renderer.renderContent).toHaveBeenCalledTimes(1);
      expect(deps.renderer.renderContent).toHaveBeenCalledWith(
        deps.state.currentTextEl,
        'Hidden content', { deferMath: true, deferDiagrams: true }
      );
    });

    it('should force the final text render while its viewport is hidden', async () => {
      const msg = createTestMessage();
      deps.state.currentTextEl = createMockEl();
      controller.setViewportVisible(false);

      await controller.appendText('Final hidden content');
      await controller.finalizeCurrentTextBlock(msg);

      expect(deps.renderer.renderContent).toHaveBeenCalledTimes(1);
      expect(deps.renderer.renderContent).toHaveBeenCalledWith(
        expect.anything(),
        'Final hidden content', { deferMath: true, deferDiagrams: true }
      );
    });

    it.each(['```mermaid', '> ```Mermaid title="example"', '- ~~~MERMAID'])('defers %s until text finalization', async opener => {
      deps.state.currentTextEl = createMockEl();
      const content = `${opener}\ngraph TD\nA --> B`;
      await controller.appendText(content);
      vi.advanceTimersByTime(16);
      await Promise.resolve();
      expect(deps.renderer.renderContent).toHaveBeenLastCalledWith(
        deps.state.currentTextEl, content, { deferMath: true, deferDiagrams: true }
      );
      const target = deps.state.currentTextEl;
      await controller.finalizeCurrentTextBlock(createTestMessage());
      expect(deps.renderer.renderContent).toHaveBeenLastCalledWith(target, content);
    });

    it('should defer math rendering during live text renders', async () => {
      deps.state.currentTextEl = createMockEl();

      await controller.appendText('Euler: $e^{i\\pi} + 1 = 0$');

      vi.advanceTimersByTime(16);
      await Promise.resolve();

      expect(deps.renderer.renderContent).toHaveBeenCalledWith(
        deps.state.currentTextEl,
        'Euler: $e^{i\\pi} + 1 = 0$',
        { deferMath: true, deferDiagrams: true }
      );
    });

    it('should defer LaTeX-delimited math during live text renders', async () => {
      deps.state.currentTextEl = createMockEl();

      await controller.appendText('Euler: \\(e^{i\\pi} + 1 = 0\\)');

      vi.advanceTimersByTime(16);
      await Promise.resolve();

      expect(deps.renderer.renderContent).toHaveBeenCalledWith(
        deps.state.currentTextEl,
        'Euler: \\(e^{i\\pi} + 1 = 0\\)',
        { deferMath: true, deferDiagrams: true }
      );
    });

    it('should honor disabled deferred math rendering setting during live text renders', async () => {
      Object.assign(deps.plugin.settings, { deferMathRenderingDuringStreaming: false });
      deps.state.currentTextEl = createMockEl();

      await controller.appendText('Euler: $e^{i\\pi} + 1 = 0$');

      vi.advanceTimersByTime(16);
      await Promise.resolve();

      expect(deps.renderer.renderContent).toHaveBeenCalledWith(
        deps.state.currentTextEl,
        'Euler: $e^{i\\pi} + 1 = 0$', { deferMath: false, deferDiagrams: true }
      );
    });

    it('should flush a pending text render before finalizing text', async () => {
      const msg = createTestMessage();

      await controller.appendText('Hello');
      await controller.finalizeCurrentTextBlock(msg);

      expect(deps.state.currentTextEl).toBeNull();
      expect(deps.state.currentTextContent).toBe('');

      expect(deps.renderer.renderContent).toHaveBeenCalledWith(
        expect.anything(),
        'Hello', { deferMath: true, deferDiagrams: true }
      );
      expect(deps.renderer.addTextCopyButton).toHaveBeenCalledWith(
        expect.anything(),
        'Hello'
      );
      expect(msg.contentBlocks).toContainEqual({
        type: 'text',
        content: 'Hello',
      });
    });

    it('should coalesce a pending deferred render into the final math render', async () => {
      const msg = createTestMessage();

      await controller.appendText('Final $x^2$');
      await controller.finalizeCurrentTextBlock(msg);

      expect(deps.renderer.renderContent).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        'Final $x^2$'
      );
      expect(deps.renderer.renderContent).toHaveBeenCalledTimes(1);
      expect(deps.renderer.addTextCopyButton).toHaveBeenCalledWith(
        expect.anything(),
        'Final $x^2$'
      );
    });
  });

  describe('Text block finalization', () => {
    it('should not add copy button when no text element exists', async () => {
      const msg = createTestMessage();
      deps.state.currentTextEl = null;
      deps.state.currentTextContent = 'Hello World';

      await controller.finalizeCurrentTextBlock(msg);

      expect(deps.renderer.addTextCopyButton).not.toHaveBeenCalled();
      // Content block should still be added
      expect(msg.contentBlocks).toContainEqual({
        type: 'text',
        content: 'Hello World',
      });
    });

    it('should not add copy button when no text content exists', async () => {
      const msg = createTestMessage();
      deps.state.currentTextEl = createMockEl();
      deps.state.currentTextContent = '';

      await controller.finalizeCurrentTextBlock(msg);

      expect(deps.renderer.addTextCopyButton).not.toHaveBeenCalled();
      expect(msg.contentBlocks).toEqual([]);
    });
  });

  describe('context_compacted handling', () => {
    it('should record a context_compacted block on the message', async () => {
      const msg = createTestMessage();

      await controller.handleStreamChunk({ type: 'context_compacted' }, msg);

      expect(msg.contentBlocks).toContainEqual({ type: 'context_compacted' });
    });
  });

  describe('citation handling', () => {
    it('finalizes text and records a rendered citation block', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk({ type: 'text', content: 'Answer' }, msg);
      await controller.handleStreamChunk({
        type: 'citations',
        citations: {
          kind: 'memory',
          entries: [{
            path: 'MEMORY.md',
            lineStart: 10,
            lineEnd: 12,
            note: 'Used project conventions',
          }],
        },
      }, msg);

      expect(msg.contentBlocks).toEqual([
        { type: 'text', content: 'Answer' },
        {
          type: 'citations',
          citations: {
            kind: 'memory',
            entries: [{
              path: 'MEMORY.md',
              lineStart: 10,
              lineEnd: 12,
              note: 'Used project conventions',
            }],
          },
        },
      ]);
      const group = deps.state.currentContentEl!.querySelector('.claudian-citations');
      expect(group).not.toBeNull();
      expect(group!.querySelector('.claudian-citation-location')?.textContent).toBe('MEMORY.md:10\u201312');
      expect(group!.querySelector('.claudian-citation-note')?.textContent).toBe('Used project conventions');
    });
  });

  describe('Usage handling', () => {
    it('should update usage', async () => {
      const msg = createTestMessage();
      const usage = createMockUsage();

      await controller.handleStreamChunk({ type: 'usage', usage, sessionId: 'session-1' }, msg);

      expect(deps.state.usage).toEqual(usage);
    });

    it('preserves unknown usage identity instead of deriving it from global settings', async () => {
      const msg = createTestMessage();
      const usage = createMockUsage({ model: undefined });
      await controller.handleStreamChunk({ type: 'usage', usage, sessionId: 'session-1' }, msg);
      expect(deps.state.usage).toEqual(usage);
    });

  });

  describe('Tool handling', () => {
    it('should record tool_use and add to content blocks', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'notes/test.md' } },
        msg
      );

      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.toolCalls![0].id).toBe('tool-1');
      expect(msg.toolCalls![0].status).toBe('running');
      expect(msg.contentBlocks).toHaveLength(1);
      expect(msg.contentBlocks![0]).toEqual({ type: 'tool_use', toolId: 'tool-1' });
    });

    it('should update tool_result status', async () => {
      const msg = createTestMessage();
      msg.toolCalls = [
        {
          id: 'tool-1',
          name: 'Read',
          input: { file_path: 'notes/test.md' },
          status: 'running',
        },
      ];
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'tool-1', content: 'ok' },
        msg
      );

      expect(msg.toolCalls![0].status).toBe('completed');
      expect(msg.toolCalls![0].result).toBe('ok');
    });

    // Removed: claude managed-agent subagent routing (Task/Agent tool ->
    // contentBlocks subagent entry, managed protocol dispatch). Kiro has no
    // managed-agent protocol; lifecycle spawn routing is owned by
    // SubagentStreamRouter and handleTaskToolUse is covered by
    // SubagentManager.test.ts.

    it('should render TodoWrite inline', async () => {
      const { renderToolCall } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      const mockTodos = [{ content: 'Task 1', status: 'pending', activeForm: 'Working on task 1' }];

      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        {
          type: 'tool_use',
          id: 'todo-1',
          name: TOOL_TODO_WRITE,
          input: { todos: mockTodos },
        },
        msg
      );

      // Tool is buffered, should be in pendingTools
      expect(msg.contentBlocks).toHaveLength(1);
      expect(msg.contentBlocks![0]).toEqual({ type: 'tool_use', toolId: 'todo-1' });
      expect(deps.state.pendingTools.size).toBe(1);

      // Flush pending tools by sending a different chunk type (text or done)
      await controller.handleStreamChunk({ type: 'done' }, msg);

      // Now renderToolCall should have been called
      expect(renderToolCall).toHaveBeenCalled();
      expect(deps.state.pendingTools.size).toBe(0);
    });

    it('should flush pending tools before rendering text content', async () => {
      const { renderToolCall } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'test.md' } },
        msg
      );
      expect(deps.state.pendingTools.size).toBe(1);
      expect(renderToolCall).not.toHaveBeenCalled();

      deps.state.currentTextEl = createMockEl();
      await controller.handleStreamChunk({ type: 'text', content: 'Hello' }, msg);

      expect(deps.state.pendingTools.size).toBe(0);
      expect(renderToolCall).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 'read-1', name: 'Read' }),
        expect.objectContaining({ initiallyExpanded: false }),
      );
    });

    it.each([
      { changes: [{ path: 'notes/new.md', kind: 'add' }] },
      { patch: '*** Begin Patch\n*** Add File: notes/new.md\n+hello\n*** End Patch' },
    ])('refreshes the vault after successful current apply_patch input: %j', async (input) => {
      const vault = deps.plugin.app.vault;
      vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);
      vault.adapter.list = vi.fn().mockResolvedValue({ files: [], folders: [] });
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'patch-refresh', name: TOOL_APPLY_PATCH, input }, msg,
      );
      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'patch-refresh', content: 'Success' }, msg,
      );
      await vi.advanceTimersByTimeAsync(200);

      expect(vault.getAbstractFileByPath).toHaveBeenCalledWith('notes/new.md');
      expect(vault.adapter.list).toHaveBeenCalledWith('notes');
    });

    it('refreshes the vault for files a script changed through nested calls, even when the script failed', async () => {
      const vault = deps.plugin.app.vault;
      vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);
      vault.adapter.list = vi.fn().mockResolvedValue({ files: [], folders: [] });
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'script-refresh', name: 'exec', input: { code: 'await tools.write({})' } }, msg,
      );
      await controller.handleStreamChunk({
        type: 'tool_result', id: 'script-refresh', content: 'Script error', isError: true,
        resultDetails: { scriptToolCalls: [
          { name: 'Write', input: { file_path: 'notes/new.md', content: 'hi' }, status: 'completed' },
          { name: TOOL_APPLY_PATCH, input: { patch: '*** Begin Patch\n*** Add File: drafts/plan.md\n+x\n*** End Patch' }, status: 'completed' },
          { name: 'Edit', input: { file_path: 'failed/edit.md' }, status: 'error' },
          { name: 'Read', input: { file_path: 'read/only.md' }, status: 'completed' },
        ] },
      }, msg);
      await vi.advanceTimersByTimeAsync(200);

      expect((vault.adapter.list as Mock).mock.calls.map(([dir]) => dir).sort()).toEqual(['drafts', 'notes']);
    });

    it('refreshes each nested file change once as script progress and completion arrive', async () => {
      const vault = deps.plugin.app.vault;
      vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);
      vault.adapter.list = vi.fn().mockResolvedValue({ files: [], folders: [] });
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();
      const write = { name: 'Write', input: { file_path: 'notes/new.md', content: 'hi' } };
      const edit = { name: 'Edit', input: { file_path: 'drafts/plan.md' } };
      const refreshedDirs = () => (vault.adapter.list as Mock).mock.calls.map(([dir]) => dir);

      await controller.handleStreamChunk({ type: 'tool_use', id: 'script-progress', name: 'exec', input: { code: '' } }, msg);
      await controller.handleStreamChunk({ type: 'tool_output', id: 'script-progress', content: '',
        resultDetails: { scriptToolCalls: [{ ...write, status: 'running' }] } }, msg);
      await controller.handleStreamChunk({ type: 'tool_output', id: 'script-progress', content: '',
        resultDetails: { scriptToolCalls: [{ ...write, status: 'completed' }, { ...edit, status: 'running' }] } }, msg);
      await vi.advanceTimersByTimeAsync(200);
      expect(refreshedDirs()).toEqual(['notes']);
      expect(msg.toolCalls?.[0].scriptToolCalls?.map(call => call.status)).toEqual(['completed', 'running']);

      await controller.handleStreamChunk({ type: 'tool_result', id: 'script-progress', content: 'done',
        resultDetails: { scriptToolCalls: [{ ...write, status: 'completed' }, { ...edit, status: 'completed' }] } }, msg);
      await vi.advanceTimersByTimeAsync(200);
      expect(refreshedDirs()).toEqual(['notes', 'drafts']);
    });

    it('should pass expanded default to apply_patch tool blocks when enabled', async () => {
      const { renderToolCall } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      Object.assign(deps.plugin.settings, { expandFileEditsByDefault: true });

      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        {
          type: 'tool_use',
          id: 'patch-1',
          name: TOOL_APPLY_PATCH,
          input: { changes: [{ path: 'src/main.ts', kind: 'update' }] },
        },
        msg
      );
      await controller.handleStreamChunk({ type: 'done' }, msg);

      expect(renderToolCall).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 'patch-1', name: TOOL_APPLY_PATCH }),
        expect.objectContaining({ initiallyExpanded: true }),
      );
    });

    it('should flush pending tools before rendering thinking content', async () => {
      const { renderToolCall } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'grep-1', name: 'Grep', input: { pattern: 'test' } },
        msg
      );
      expect(deps.state.pendingTools.size).toBe(1);
      expect(renderToolCall).not.toHaveBeenCalled();

      await controller.handleStreamChunk({ type: 'thinking', content: 'Let me think...' }, msg);

      expect(deps.state.pendingTools.size).toBe(0);
      expect(renderToolCall).toHaveBeenCalled();
    });

    it('should render pending tool when tool_result arrives before flush', async () => {
      const { renderToolCall } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'test.md' } },
        msg
      );
      expect(deps.state.pendingTools.size).toBe(1);
      expect(renderToolCall).not.toHaveBeenCalled();

      // Result arrives while tool still pending - should render tool first
      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'read-1', content: 'file contents here' },
        msg
      );

      expect(deps.state.pendingTools.size).toBe(0);
      expect(renderToolCall).toHaveBeenCalled();
      expect(msg.toolCalls![0].status).toBe('completed');
      expect(msg.toolCalls![0].result).toBe('file contents here');
    });

    it('should render a pending tool on tool_output and append incremental output', async () => {
      const { renderToolCall, updateToolCallResult } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'npm test' } },
        msg
      );

      expect(deps.state.pendingTools.size).toBe(1);

      await controller.handleStreamChunk(
        { type: 'tool_output', id: 'bash-1', content: 'line 1\n' },
        msg
      );

      expect(deps.state.pendingTools.size).toBe(0);
      expect(renderToolCall).toHaveBeenCalled();
      expect(updateToolCallResult).not.toHaveBeenCalled();

      vi.advanceTimersByTime(16);
      await Promise.resolve();

      expect(updateToolCallResult).toHaveBeenCalledWith(
        deps.state.toolCallElements.get('bash-1'),
        expect.objectContaining({
          id: 'bash-1',
          status: 'running',
          result: 'line 1\n',
        })
      );

      await controller.handleStreamChunk(
        { type: 'tool_output', id: 'bash-1', content: 'line 2\n' },
        msg
      );

      expect(msg.toolCalls![0].status).toBe('running');
      expect(msg.toolCalls![0].result).toBe('line 1\nline 2\n');
      expect(updateToolCallResult).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(16);
      await Promise.resolve();

      expect(updateToolCallResult).toHaveBeenLastCalledWith(
        deps.state.toolCallElements.get('bash-1'),
        expect.objectContaining({
          id: 'bash-1',
          status: 'running',
          result: 'line 1\nline 2\n',
        })
      );
    });

    it('should coalesce tool_output renders until the next animation frame', async () => {
      const { updateToolCallResult } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'npm test' } },
        msg
      );
      await controller.handleStreamChunk(
        { type: 'tool_output', id: 'bash-1', content: 'line 1\n' },
        msg
      );
      await controller.handleStreamChunk(
        { type: 'tool_output', id: 'bash-1', content: 'line 2\n' },
        msg
      );

      expect(updateToolCallResult).not.toHaveBeenCalled();

      vi.advanceTimersByTime(16);
      await Promise.resolve();

      expect(updateToolCallResult).toHaveBeenCalledTimes(1);
      expect(updateToolCallResult).toHaveBeenCalledWith(
        deps.state.toolCallElements.get('bash-1'),
        expect.objectContaining({
          result: 'line 1\nline 2\n',
          status: 'running',
        })
      );
    });

    it('should buffer Write tool and use createWriteEditBlock on flush', async () => {
      const { renderToolCall } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      const { createWriteEditBlock } = vi.mocked(await import('@/features/chat/rendering/tools/WriteEditRenderer'));
      createWriteEditBlock.mockReturnValue({ wrapperEl: createMockEl() } as unknown as WriteEditState);

      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'write-1', name: 'Write', input: { file_path: 'test.md', content: 'hello' } },
        msg
      );

      expect(deps.state.pendingTools.size).toBe(1);
      expect(createWriteEditBlock).not.toHaveBeenCalled();
      expect(renderToolCall).not.toHaveBeenCalled();

      await controller.handleStreamChunk({ type: 'done' }, msg);

      expect(deps.state.pendingTools.size).toBe(0);
      expect(createWriteEditBlock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 'write-1', name: 'Write' }),
        expect.objectContaining({ initiallyExpanded: false }),
      );
      // renderToolCall should NOT be called for Write/Edit tools
      expect(renderToolCall).not.toHaveBeenCalled();
    });

    it('should pass expanded default to Write tool blocks when enabled', async () => {
      const { createWriteEditBlock } = vi.mocked(await import('@/features/chat/rendering/tools/WriteEditRenderer'));
      createWriteEditBlock.mockReturnValue({ wrapperEl: createMockEl() } as unknown as WriteEditState);

      Object.assign(deps.plugin.settings, { expandFileEditsByDefault: true });

      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'write-1', name: 'Write', input: { file_path: 'test.md', content: 'hello' } },
        msg
      );
      await controller.handleStreamChunk({ type: 'done' }, msg);

      expect(createWriteEditBlock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 'write-1', name: 'Write' }),
        expect.objectContaining({ initiallyExpanded: true }),
      );
    });

    it('should buffer Edit tool and use createWriteEditBlock on flush', async () => {
      const { createWriteEditBlock } = vi.mocked(await import('@/features/chat/rendering/tools/WriteEditRenderer'));
      createWriteEditBlock.mockReturnValue({ wrapperEl: createMockEl() } as unknown as WriteEditState);

      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'edit-1', name: 'Edit', input: { file_path: 'test.md', old_string: 'a', new_string: 'b' } },
        msg
      );

      expect(deps.state.pendingTools.size).toBe(1);
      expect(createWriteEditBlock).not.toHaveBeenCalled();

      deps.state.currentTextEl = createMockEl();
      await controller.handleStreamChunk({ type: 'text', content: 'Done editing' }, msg);

      expect(deps.state.pendingTools.size).toBe(0);
      expect(createWriteEditBlock).toHaveBeenCalled();
    });

    it('should flush pending tools before rendering blocked message', async () => {
      const { renderToolCall } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'ls' } },
        msg
      );
      expect(deps.state.pendingTools.size).toBe(1);

      await controller.handleStreamChunk({ type: 'notice', content: 'Command blocked', level: 'warning' }, msg);

      expect(deps.state.currentTextContent).toContain('Warning');

      expect(deps.state.pendingTools.size).toBe(0);
      expect(renderToolCall).toHaveBeenCalled();
    });

    it('should flush pending tools before rendering error message', async () => {
      const { renderToolCall } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'missing.md' } },
        msg
      );
      expect(deps.state.pendingTools.size).toBe(1);

      await controller.handleStreamChunk({ type: 'error', content: 'Something went wrong' }, msg);

      expect(deps.state.currentTextContent).toContain('Error');

      expect(deps.state.pendingTools.size).toBe(0);
      expect(renderToolCall).toHaveBeenCalled();
    });

    // Removed: claude managed-agent Task-tool flush variant. The pending-tool
    // flush contract is covered by the flush-before-text and flush-before-
    // thinking cases; the Task-tool specifics were managed-agent only.

    it('should clear pendingTools on resetStreamingState', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'a.md' } },
        msg
      );
      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'read-2', name: 'Read', input: { file_path: 'b.md' } },
        msg
      );
      expect(deps.state.pendingTools.size).toBe(2);

      controller.resetStreamingState();

      expect(deps.state.pendingTools.size).toBe(0);
    });

    it('should clear responseStartTime on resetStreamingState', () => {
      deps.state.responseStartTime = 12345;
      expect(deps.state.responseStartTime).toBe(12345);

      controller.resetStreamingState();

      expect(deps.state.responseStartTime).toBeNull();
    });
  });

  describe('Timer lifecycle', () => {
    it('should scroll to a newly shown thinking indicator when auto-scroll is enabled', () => {
      const messagesEl = deps.getMessagesEl();
      Object.defineProperty(messagesEl, 'scrollHeight', { value: 1_000, configurable: true });
      messagesEl.scrollTop = 0;

      controller.thinkingIndicator.show();
      vi.advanceTimersByTime(416);

      expect(deps.state.thinkingEl).not.toBeNull();
      expect(messagesEl.scrollTop).toBe(1_000);
    });

    it('should not scroll to a newly shown thinking indicator when auto-scroll is paused', () => {
      const messagesEl = deps.getMessagesEl();
      Object.defineProperty(messagesEl, 'scrollHeight', { value: 1_000, configurable: true });
      messagesEl.scrollTop = 0;
      deps.state.autoScrollEnabled = false;

      controller.thinkingIndicator.show();
      vi.advanceTimersByTime(416);

      expect(deps.state.thinkingEl).not.toBeNull();
      expect(messagesEl.scrollTop).toBe(0);
    });

    it('should clear timer interval in resetStreamingState', () => {
      deps.state.responseStartTime = performance.now();

      controller.thinkingIndicator.show();
      vi.advanceTimersByTime(500);
      expect(deps.state.flavorTimerInterval).not.toBeNull();

      controller.resetStreamingState();

      expect(deps.state.flavorTimerInterval).toBeNull();
    });
  });

  describe('Tool handling - continued', () => {
    it('should handle multiple pending tools and flush in order', async () => {
      const { renderToolCall } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'a.md' } },
        msg
      );
      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'grep-1', name: 'Grep', input: { pattern: 'test' } },
        msg
      );
      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'glob-1', name: 'Glob', input: { pattern: '*.md' } },
        msg
      );

      expect(deps.state.pendingTools.size).toBe(3);
      expect(renderToolCall).not.toHaveBeenCalled();

      await controller.handleStreamChunk({ type: 'done' }, msg);

      expect(deps.state.pendingTools.size).toBe(0);
      expect(renderToolCall).toHaveBeenCalledTimes(3);

      // Verify tools were rendered in order (Map preserves insertion order)
      const calls = renderToolCall.mock.calls;
      expect(calls[0][1].id).toBe('read-1');
      expect(calls[1][1].id).toBe('grep-1');
      expect(calls[2][1].id).toBe('glob-1');

      await controller.handleStreamChunk({ type: 'done' }, msg);
      expect(renderToolCall).toHaveBeenCalledTimes(3);
    });
  });

  describe('Usage handling - edge cases', () => {
    it('should skip usage when subagentsSpawnedThisStream > 0', async () => {
      const msg = createTestMessage();
      vi.spyOn(deps.subagentManager, 'subagentsSpawnedThisStream', 'get').mockReturnValue(1);

      const usage = createMockUsage({ inputTokens: 100, contextWindow: 200, contextTokens: 100, percentage: 50 });

      await controller.handleStreamChunk({ type: 'usage', usage, sessionId: 'session-1' }, msg);

      expect(deps.state.usage).toBeNull();
    });

    it('should update usage when no sessionId on chunk', async () => {
      const msg = createTestMessage();
      const usage = createMockUsage();

      await controller.handleStreamChunk({ type: 'usage', usage }, msg);

      expect(deps.state.usage).toEqual(usage);
    });

    it('uses reported usage chunks directly', async () => {
      const msg = createTestMessage();
      const usage = createMockUsage({
        model: TEST_USAGE_MODEL,
        contextWindow: 258400,
        contextTokens: 129200,
        percentage: 50,
      });

      await controller.handleStreamChunk({ type: 'usage', usage, sessionId: 'session-1' }, msg);

      expect(deps.state.usage).toEqual(usage);
    });

    it('retains the same-model reported window when a partial update omits it', async () => {
      const msg = createTestMessage();
      await controller.handleStreamChunk({ type: 'usage', usage: createMockUsage({
        model: TEST_USAGE_MODEL, contextWindow: 200_000, contextTokens: 50_000, percentage: 25,
      }), sessionId: 'session-1' }, msg);

      await controller.handleStreamChunk({ type: 'usage', usage: createMockUsage({
        model: TEST_USAGE_MODEL, contextWindow: 0, contextTokens: 100_000, percentage: 0,
      }), sessionId: 'session-1' }, msg);

      expect(deps.state.usage).toMatchObject({ contextWindow: 200_000, contextTokens: 100_000, percentage: 50 });
    });


  });

  describe('Thinking indicator - edge cases', () => {
    it('drops explicit compaction status once the compaction boundary renders', async () => {
      const msg = createTestMessage();
      controller.thinkingIndicator.show('Compacting...', 'claudian-thinking--compact');
      vi.advanceTimersByTime(500);
      expect(deps.state.waitingStatus).toBe('Compacting...');

      await controller.handleStreamChunk({ type: 'context_compacted' }, msg);
      controller.thinkingIndicator.show();
      vi.advanceTimersByTime(500);

      expect(deps.state.waitingStatus).not.toBeNull();
      expect(deps.state.waitingStatus).not.toBe('Compacting...');
    });

    it('cancels a pending or visible indicator on dispose', () => {
      controller.thinkingIndicator.show();
      controller.dispose();
      vi.advanceTimersByTime(500);
      expect(deps.state.thinkingEl).toBeNull();
      expect(deps.state.waitingStatus).toBeNull();

      const visible = new StreamController(deps);
      visible.thinkingIndicator.show();
      vi.advanceTimersByTime(500);
      expect(deps.state.waitingStatus).not.toBeNull();
      visible.dispose();
      expect(deps.state.thinkingEl).toBeNull();
      expect(deps.state.waitingStatus).toBeNull();
      expect(deps.state.flavorTimerInterval).toBeNull();
    });

  });

  describe('scrollToBottom - settings', () => {
    it('should not scroll when enableAutoScroll setting is false', async () => {
      Object.assign(deps.plugin.settings, { enableAutoScroll: false });
      const messagesEl = deps.getMessagesEl();
      Object.defineProperty(messagesEl, 'scrollHeight', { value: 1000, configurable: true });
      messagesEl.scrollTop = 0;

      const msg = createTestMessage();
      deps.state.currentTextEl = createMockEl();
      await controller.handleStreamChunk({ type: 'text', content: 'Hello' }, msg);

      vi.advanceTimersByTime(16);
      await Promise.resolve();
      expect(messagesEl.scrollTop).toBe(0);

      Object.assign(deps.plugin.settings, { enableAutoScroll: true });
      await controller.handleStreamChunk({ type: 'text', content: ' again' }, msg);
      vi.advanceTimersByTime(16);
      await Promise.resolve();
      expect(messagesEl.scrollTop).toBe(1000);
    });

    it('should not scroll when autoScrollEnabled state is false', async () => {
      deps.state.autoScrollEnabled = false;
      const messagesEl = deps.getMessagesEl();
      Object.defineProperty(messagesEl, 'scrollHeight', { value: 1000, configurable: true });
      messagesEl.scrollTop = 0;

      const msg = createTestMessage();
      deps.state.currentTextEl = createMockEl();
      await controller.handleStreamChunk({ type: 'text', content: 'Hello' }, msg);

      vi.advanceTimersByTime(16);
      await Promise.resolve();
      expect(messagesEl.scrollTop).toBe(0);

      deps.state.autoScrollEnabled = true;
      await controller.handleStreamChunk({ type: 'text', content: ' again' }, msg);
      vi.advanceTimersByTime(16);
      await Promise.resolve();
      expect(messagesEl.scrollTop).toBe(1000);
    });
  });

  describe('Subagent chunk handling', () => {
    it('routes provider child output and native completion payloads to the child tool', async () => {
      const msg = createTestMessage();
      const toolCall = { id: 'read', name: 'Read', input: {}, status: 'running', result: '' };
      const child = { id: 'parent', description: 'test', status: 'running', toolCalls: [toolCall] };
      (deps.subagentManager.getSyncSubagent as Mock).mockReturnValue(child);
      const scope = { kind: 'requested' as const, sessionInstanceId: 's', executionId: 'e', turnId: 't', sequence: 1 };
      const toolScope = { kind: 'subagent' as const, subagentId: 'parent' };
      const output = providerOutputEventToStreamChunk({ type: 'tool_output', toolCallId: 'read', toolScope, scope, content: 'partial' })!;
      await controller.handleStreamChunk(output, msg);
      expect(deps.subagentManager.updateSyncToolResult).toHaveBeenLastCalledWith(
        'parent', 'read', expect.objectContaining({ status: 'running', result: 'partial' }),
      );
      const completion = providerOutputEventToStreamChunk({ type: 'tool_completed', toolCallId: 'read', toolScope, scope, content: 'complete', providerPayload: { rawOutput: { native: true } } })!;
      await controller.handleStreamChunk(completion, msg);
      expect(deps.subagentManager.updateSyncToolResult).toHaveBeenLastCalledWith(
        'parent', 'read', expect.objectContaining({ status: 'completed', result: 'complete', providerPayload: { rawOutput: { native: true } } }),
      );
      expect(msg.toolCalls ?? []).toEqual([]);
    });

    it('should handle subagent tool_result chunk', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      const toolCall = { id: 'read-1', name: 'Read', input: {}, status: 'running' };
      (deps.subagentManager.getSyncSubagent as Mock).mockReturnValueOnce({
        id: 'task-1', description: 'test', status: 'running', toolCalls: [toolCall],
      });

      await controller.handleStreamChunk(
        { type: 'subagent_tool_result', id: 'read-1', subagentId: 'task-1', content: 'file content' },
        msg
      );

      expect(deps.subagentManager.updateSyncToolResult).toHaveBeenCalledWith(
        'task-1',
        'read-1',
        expect.objectContaining({ status: 'completed', result: 'file content' })
      );
    });

    it('should handle subagent tool_use chunk', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      (deps.subagentManager.getSyncSubagent as Mock).mockReturnValueOnce({
        info: { id: 'task-1', description: 'test', status: 'running', toolCalls: [] },
      });

      await controller.handleStreamChunk(
        { type: 'subagent_tool_use', id: 'grep-1', name: 'Grep', input: { pattern: 'test' }, subagentId: 'task-1' },
        msg
      );

      expect(deps.subagentManager.addSyncToolCall).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ id: 'grep-1', name: 'Grep', status: 'running' })
      );
    });

    it('should skip subagent chunk when no sync subagent found', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      (deps.subagentManager.getSyncSubagent as Mock).mockReturnValueOnce(undefined);

      await controller.handleStreamChunk(
        { type: 'subagent_tool_use', id: 'orphan-read', name: 'Read', input: { file_path: 'test.md' }, subagentId: 'unknown-task' },
        msg
      );

      // Should not throw
      expect(msg.content).toBe('');
    });
  });

  // Removed: claude managed-agent async subagent actions (created_async,
  // label_updated) from Task tool use. Kiro has no managed-agent protocol;
  // lifecycle async spawn routing is owned by SubagentStreamRouter.

  describe('Thinking block finalization', () => {
    it('should finalize thinking block and add to contentBlocks', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      deps.state.currentThinkingBlock = { content: 'Let me think...', startTime: Date.now() };
      deps.state.currentThinkingState = partialMock<ThinkingBlockState>({
        container: createMockEl(),
        contentEl: createMockEl(),
      });

      await controller.finalizeCurrentThinkingBlock(msg);

      expect(msg.contentBlocks).toContainEqual(
        expect.objectContaining({ type: 'thinking', content: 'Let me think...' })
      );
      expect(deps.state.currentThinkingState).toBeNull();
    });

    it('should not add to contentBlocks when no thinking content', async () => {
      const msg = createTestMessage();
      deps.state.currentThinkingBlock = { content: '', startTime: Date.now() };
      deps.state.currentThinkingState = partialMock<ThinkingBlockState>({
        container: createMockEl(),
        contentEl: createMockEl(),
      });

      await controller.finalizeCurrentThinkingBlock(msg);

      expect(msg.contentBlocks).toEqual([]);
    });

    it('should be a no-op when no thinking state', async () => {
      const msg = createTestMessage();
      deps.state.currentThinkingState = null;

      await controller.finalizeCurrentThinkingBlock(msg);

      expect(msg.contentBlocks).toEqual([]);
    });

    it('should coalesce thinking renders until the next animation frame', async () => {
      const { createThinkingBlock } = vi.mocked(await import('@/features/chat/rendering/ThinkingBlockRenderer'));
      const msg = createTestMessage();
      const contentEl = createMockEl();
      createThinkingBlock.mockReturnValueOnce({
        wrapperEl: createMockEl(),
        contentEl,
        labelEl: createMockEl(),
        content: '',
        startTime: Date.now(),
        isExpanded: true,
      } as unknown as ThinkingBlockState);

      await controller.handleStreamChunk({ type: 'thinking', content: 'Let ' }, msg);
      await controller.handleStreamChunk({ type: 'thinking', content: 'me think' }, msg);

      expect(deps.renderer.renderContent).not.toHaveBeenCalled();

      vi.advanceTimersByTime(16);
      await Promise.resolve();

      expect(deps.renderer.renderContent).toHaveBeenCalledTimes(1);
      expect(deps.renderer.renderContent).toHaveBeenCalledWith(contentEl, 'Let me think', { deferMath: true, deferDiagrams: true });
    });

    it('defers Mermaid in thinking and renders it at finalization', async () => {
      const { createThinkingBlock } = vi.mocked(await import('@/features/chat/rendering/ThinkingBlockRenderer'));
      const contentEl = createMockEl();
      createThinkingBlock.mockReturnValueOnce({
        wrapperEl: createMockEl(), contentEl, labelEl: createMockEl(),
        content: '', startTime: Date.now(), isExpanded: true,
      } as unknown as ThinkingBlockState);
      const content = '> ```mermaid\n> graph TD\n> A --> B';
      await controller.appendThinking(content);
      vi.advanceTimersByTime(16);
      await Promise.resolve();
      expect(deps.renderer.renderContent).toHaveBeenLastCalledWith(contentEl, content, { deferMath: true, deferDiagrams: true });
      await controller.finalizeCurrentThinkingBlock(createTestMessage());
      expect(deps.renderer.renderContent).toHaveBeenLastCalledWith(contentEl, content);
    });

    it('should render original math once when finalizing a collapsed thinking block', async () => {
      const { createThinkingBlock } = vi.mocked(await import('@/features/chat/rendering/ThinkingBlockRenderer'));
      const msg = createTestMessage();
      const contentEl = createMockEl();
      createThinkingBlock.mockReturnValueOnce({
        wrapperEl: createMockEl(),
        contentEl,
        labelEl: createMockEl(),
        content: '',
        startTime: Date.now(),
        isExpanded: false,
      } as unknown as ThinkingBlockState);

      await controller.handleStreamChunk({ type: 'thinking', content: 'Reasoning $x^2$' }, msg);
      await controller.finalizeCurrentThinkingBlock(msg);

      expect(deps.renderer.renderContent).not.toHaveBeenCalled();
      expect(msg.contentBlocks).toContainEqual(
        expect.objectContaining({ type: 'thinking', content: 'Reasoning $x^2$' })
      );
    });

    it('should replace deferred math when finalizing an expanded thinking block', async () => {
      const { createThinkingBlock } = vi.mocked(await import('@/features/chat/rendering/ThinkingBlockRenderer'));
      const msg = createTestMessage();
      const contentEl = createMockEl();
      createThinkingBlock.mockReturnValueOnce({
        wrapperEl: createMockEl(),
        contentEl,
        labelEl: createMockEl(),
        content: '',
        startTime: Date.now(),
        isExpanded: true,
      } as unknown as ThinkingBlockState);

      await controller.handleStreamChunk({ type: 'thinking', content: 'Reasoning $x^2$' }, msg);
      vi.advanceTimersByTime(16);
      await Promise.resolve();
      expect(deps.renderer.renderContent).toHaveBeenCalledTimes(1);
      expect(deps.renderer.renderContent).toHaveBeenCalledWith(
        contentEl,
        'Reasoning $x^2$',
        { deferMath: true, deferDiagrams: true }
      );

      await controller.finalizeCurrentThinkingBlock(msg);

      expect(deps.renderer.renderContent).toHaveBeenNthCalledWith(
        1,
        contentEl,
        'Reasoning $x^2$',
        { deferMath: true, deferDiagrams: true }
      );
      expect(deps.renderer.renderContent).toHaveBeenNthCalledWith(
        2,
        contentEl,
        'Reasoning $x^2$'
      );
    });

    it('should skip live renders while thinking is collapsed', async () => {
      const { createThinkingBlock } = vi.mocked(await import('@/features/chat/rendering/ThinkingBlockRenderer'));
      const msg = createTestMessage();
      const contentEl = createMockEl();
      createThinkingBlock.mockReturnValueOnce({
        wrapperEl: createMockEl(),
        contentEl,
        labelEl: createMockEl(),
        content: '',
        startTime: Date.now(),
        isExpanded: false,
      } as unknown as ThinkingBlockState);

      await controller.handleStreamChunk({ type: 'thinking', content: 'Hidden ' }, msg);
      await controller.handleStreamChunk({ type: 'thinking', content: 'reasoning' }, msg);
      vi.advanceTimersByTime(500);
      await Promise.resolve();

      expect(deps.renderer.renderContent).not.toHaveBeenCalled();

      await controller.finalizeCurrentThinkingBlock(msg);

      expect(deps.renderer.renderContent).not.toHaveBeenCalled();
    });

    it('does not scan collapsed thinking deltas for deferred math or diagrams', async () => {
      const mathSpy = vi.spyOn(markdownMath, 'hasStreamingMathDelimiters');
      const mermaidSpy = vi.spyOn(displayOnlyCodeFences, 'hasDeferredDiagramFence');
      try {
        const msg = createTestMessage();
        for (let i = 0; i < 20; i += 1) {
          await controller.handleStreamChunk({ type: 'thinking', content: '$x$ ' }, msg);
        }
        vi.advanceTimersByTime(500);
        await Promise.resolve();

        expect(deps.renderer.renderContent).not.toHaveBeenCalled();
        expect(mathSpy).not.toHaveBeenCalled();
        expect(mermaidSpy).not.toHaveBeenCalled();
      } finally {
        mathSpy.mockRestore();
        mermaidSpy.mockRestore();
      }
    });

    it('should render accumulated thinking through the coordinator when expanded', async () => {
      const { createThinkingBlock } = vi.mocked(await import('@/features/chat/rendering/ThinkingBlockRenderer'));
      const msg = createTestMessage();
      const contentEl = createMockEl();
      const thinkingState = {
        wrapperEl: createMockEl(),
        contentEl,
        labelEl: createMockEl(),
        content: '',
        startTime: Date.now(),
        isExpanded: false,
      };
      let onToggle: ((isExpanded: boolean) => void) | undefined;
      createThinkingBlock.mockImplementationOnce((_parentEl: HTMLElement, options: Parameters<typeof createThinkingBlock>[1]) => {
        onToggle = options?.onToggle;
        return partialMock<ThinkingBlockState>(thinkingState);
      });

      await controller.handleStreamChunk({ type: 'thinking', content: 'Deferred reasoning' }, msg);
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      expect(deps.renderer.renderContent).not.toHaveBeenCalled();

      thinkingState.isExpanded = true;
      onToggle?.(true);
      vi.advanceTimersByTime(16);
      await Promise.resolve();

      expect(deps.renderer.renderContent).toHaveBeenCalledTimes(1);
      expect(deps.renderer.renderContent).toHaveBeenCalledWith(
        contentEl,
        'Deferred reasoning', { deferMath: true, deferDiagrams: true }
      );
    });

    it('should flush a pending thinking render before finalizing', async () => {
      const msg = createTestMessage();

      await controller.handleStreamChunk({ type: 'thinking', content: 'Reasoning' }, msg);
      await controller.finalizeCurrentThinkingBlock(msg);

      expect(deps.renderer.renderContent).not.toHaveBeenCalled();
      expect(msg.contentBlocks).toContainEqual(
        expect.objectContaining({ type: 'thinking', content: 'Reasoning' })
      );
    });
  });

  describe('Pending Task tool handling', () => {
    // Removed: asserted handleTaskToolUse is called for a managed-agent 'Agent'
    // spawn chunk, which is claude-specific; kiro's adapter does not own that
    // tool name. The pending-task child-chunk render path is covered by the
    // sibling cases below.

    it('should not crash stream when pending Task rendering returns null via child chunk', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      // Task without run_in_background - manager returns buffered
      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'task-1', name: TOOL_SUBAGENT, input: { prompt: 'Do something', subagent_type: 'general-purpose' } },
        msg
      );

      // Configure manager: pending task exists but render returns null (error case)
      (deps.subagentManager.hasPendingTask as Mock).mockReturnValueOnce(true);
      (deps.subagentManager.resolvePendingTask as Mock).mockReturnValueOnce(null);

      // Child chunk arrives - resolvePendingTask returns null but shouldn't crash
      await controller.handleStreamChunk(
        { type: 'subagent_tool_use', id: 'read-1', name: 'Read', input: { file_path: 'test.md' }, subagentId: 'task-1' },
        msg
      );

      // Should not throw - manager handled errors internally
      expect(deps.subagentManager.resolvePendingTask).toHaveBeenCalledWith('task-1', deps.state.currentContentEl);
    });

    it('should not crash stream when pending Task rendering returns null via tool_result', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      // Task without run_in_background - manager returns buffered
      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'task-1', name: TOOL_SUBAGENT, input: { prompt: 'Do something', subagent_type: 'general-purpose' } },
        msg
      );

      // Configure manager: pending task exists but render returns null
      (deps.subagentManager.hasPendingTask as Mock).mockReturnValueOnce(true);
      (deps.subagentManager.resolvePendingTaskFromTaskResult as Mock).mockReturnValueOnce(null);

      // Tool result arrives - pending resolver returns null but stream should continue
      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'task-1', content: 'Task completed' },
        msg
      );

      // Should not throw - manager handled errors internally
      expect(deps.subagentManager.resolvePendingTaskFromTaskResult).toHaveBeenCalledWith(
        'task-1',
        'Task completed',
        false,
        deps.state.currentContentEl,
        undefined
      );
    });

    it('should resolve pending Task as async via tool_result and continue async lifecycle', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'task-1', name: TOOL_SUBAGENT, input: { prompt: 'Do something' } },
        msg
      );

      (deps.subagentManager.hasPendingTask as Mock).mockReturnValueOnce(true);
      (deps.subagentManager.resolvePendingTaskFromTaskResult as Mock).mockReturnValueOnce({
        mode: 'async',
        info: {
          id: 'task-1',
          description: 'Do something',
          prompt: 'Do something',
          mode: 'async',
          isExpanded: false,
          status: 'running',
          toolCalls: [],
          asyncStatus: 'pending',
        },
      });
      (deps.subagentManager.isPendingAsyncTask as Mock).mockReturnValueOnce(true);

      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'task-1', content: '{"agent_id":"agent-1"}' },
        msg
      );

      expect(deps.subagentManager.resolvePendingTaskFromTaskResult).toHaveBeenCalledWith(
        'task-1',
        '{"agent_id":"agent-1"}',
        false,
        deps.state.currentContentEl,
        undefined
      );
      expect(deps.subagentManager.handleTaskToolResult).toHaveBeenCalledWith(
        'task-1',
        '{"agent_id":"agent-1"}',
        undefined,
        undefined
      );
      expect(msg.contentBlocks).toContainEqual({
        type: 'subagent',
        subagentId: 'task-1',
        mode: 'async',
      });
      expect(msg.toolCalls).toContainEqual(
        expect.objectContaining({
          id: 'task-1',
          name: TOOL_SUBAGENT,
          subagent: expect.objectContaining({ mode: 'async' }),
        })
      );
    });

    it('should pass the task provider payload into pending Task resolver', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'task-1', name: TOOL_SUBAGENT, input: { prompt: 'Do something' } },
        msg
      );

      const providerPayload = { rawOutput: { isAsync: true, status: 'async_launched', agentId: 'agent-1' } };
      (deps.subagentManager.hasPendingTask as Mock).mockReturnValueOnce(true);
      (deps.subagentManager.resolvePendingTaskFromTaskResult as Mock).mockReturnValueOnce(null);

      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'task-1', content: 'Launching...', providerPayload },
        msg
      );

      expect(deps.subagentManager.resolvePendingTaskFromTaskResult).toHaveBeenCalledWith(
        'task-1',
        'Launching...',
        false,
        deps.state.currentContentEl,
        providerPayload
      );
    });
  });

  describe('Text ↔ Thinking transitions', () => {
    it('text arrives while thinking state is active → finalizeCurrentThinkingBlock is called', async () => {
      const { finalizeThinkingBlock } = vi.mocked(await import('@/features/chat/rendering/ThinkingBlockRenderer'));
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      deps.state.currentThinkingBlock = { content: 'Let me think...', startTime: Date.now() };
      deps.state.currentThinkingState = partialMock<ThinkingBlockState>({
        container: createMockEl(),
        contentEl: createMockEl(),
      });

      await controller.handleStreamChunk({ type: 'text', content: 'Hello' }, msg);

      expect(finalizeThinkingBlock).toHaveBeenCalled();
      expect(deps.state.currentThinkingState).toBeNull();
      expect(msg.contentBlocks).toContainEqual(
        expect.objectContaining({ type: 'thinking', content: 'Let me think...' })
      );
    });

    it('thinking arrives while textEl exists → finalizeCurrentTextBlock is called', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      deps.state.currentTextEl = createMockEl();
      deps.state.currentTextContent = 'Some text';

      await controller.handleStreamChunk({ type: 'thinking', content: 'Hmm...' }, msg);

      expect(deps.state.currentTextEl).toBeNull();
      expect(msg.contentBlocks).toContainEqual(
        expect.objectContaining({ type: 'text', content: 'Some text' })
      );
      expect(deps.renderer.addTextCopyButton).toHaveBeenCalledWith(
        expect.anything(),
        'Some text'
      );
    });

    it('tool_use arrives while thinking state → finalizeCurrentThinkingBlock is called', async () => {
      const { finalizeThinkingBlock } = vi.mocked(await import('@/features/chat/rendering/ThinkingBlockRenderer'));
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      deps.state.currentThinkingBlock = { content: 'Reasoning...', startTime: Date.now() };
      deps.state.currentThinkingState = partialMock<ThinkingBlockState>({
        container: createMockEl(),
        contentEl: createMockEl(),
      });

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'test.md' } },
        msg
      );

      expect(finalizeThinkingBlock).toHaveBeenCalled();
      expect(deps.state.currentThinkingState).toBeNull();
      expect(msg.contentBlocks).toContainEqual(
        expect.objectContaining({ type: 'thinking', content: 'Reasoning...' })
      );
    });
  });

  describe('Agent output tool use/result', () => {
    // Removed: delegation of a managed-agent TOOL_AGENT_OUTPUT spawn chunk to
    // handleAgentOutputToolUse, which is claude-specific; kiro's output tool is
    // a lifecycle hidden tool (task_output) owned by SubagentStreamRouter.

    it('Agent output tool result handled via handleAgentOutputToolResult returning true', async () => {
      const { updateToolCallResult } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      (deps.subagentManager.isLinkedAgentOutputTool as Mock).mockReturnValueOnce(true);
      (deps.subagentManager.handleAgentOutputToolResult as Mock).mockReturnValueOnce({});

      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'agent-out-1', content: 'agent result', providerPayload: { rawOutput: { foo: 'bar' } } },
        msg
      );

      expect(deps.subagentManager.handleAgentOutputToolResult).toHaveBeenCalledWith(
        'agent-out-1',
        'agent result',
        false,
        { rawOutput: { foo: 'bar' } }
      );
      expect(updateToolCallResult).not.toHaveBeenCalled();
    });

  });

  describe('Tool header update on input re-dispatch', () => {
    it.each([
      ['Bash', { command: 'npm test' }],
      ['Read', { file_path: 'notes/test.md' }],
    ])('refines a pending generic tool to %s without duplicating it', async (name, input) => {
      const { renderToolCall } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk({
        id: 'refined-tool',
        input: {},
        name: 'tool',
        providerPayload: { rawName: 'tool' },
        type: 'tool_use',
      }, msg);
      await controller.handleStreamChunk({
        id: 'refined-tool',
        input,
        name,
        providerPayload: { rawName: name.toLowerCase() },
        type: 'tool_use',
      }, msg);
      await controller.handleStreamChunk({ type: 'done' }, msg);

      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.contentBlocks).toEqual([{ type: 'tool_use', toolId: 'refined-tool' }]);
      expect(msg.toolCalls![0]).toMatchObject({
        id: 'refined-tool',
        input,
        name,
        providerPayload: { rawName: name.toLowerCase() },
        status: 'running',
      });
      expect(renderToolCall).toHaveBeenCalledTimes(1);
      expect(renderToolCall).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 'refined-tool', name }),
        expect.objectContaining({ initiallyExpanded: false }),
      );
    });

    it('selects the Edit renderer after a pending generic tool is refined', async () => {
      const { renderToolCall } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      const { createWriteEditBlock } = vi.mocked(await import('@/features/chat/rendering/tools/WriteEditRenderer'));
      createWriteEditBlock.mockReturnValueOnce({ wrapperEl: createMockEl() } as unknown as WriteEditState);
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'edit-refined', name: 'tool', input: {} },
        msg,
      );
      await controller.handleStreamChunk({
        type: 'tool_use',
        id: 'edit-refined',
        name: 'Edit',
        input: { file_path: 'notes/test.md', old_string: 'old', new_string: 'new' },
      }, msg);
      await controller.handleStreamChunk({ type: 'done' }, msg);

      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.contentBlocks).toEqual([{ type: 'tool_use', toolId: 'edit-refined' }]);
      expect(createWriteEditBlock).toHaveBeenCalledTimes(1);
      expect(createWriteEditBlock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 'edit-refined', name: 'Edit' }),
        expect.objectContaining({ initiallyExpanded: false }),
      );
      expect(renderToolCall).not.toHaveBeenCalled();
    });

    it.each(['Edit', 'Write'])('migrates a rendered generic tool in place to %s and finalizes its diff', async (name) => {
      const { renderToolCall, updateToolCallResult } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      const {
        createWriteEditBlock,
        finalizeWriteEditBlock,
        updateWriteEditWithDiff,
      } = vi.mocked(await import('@/features/chat/rendering/tools/WriteEditRenderer'));
      const parentEl = createMockEl();
      installOrderedMockParent(parentEl);
      deps.state.currentContentEl = parentEl;
      const genericEl = createMockEl();
      const writeEditEl = createMockEl();
      let writeEditState: WriteEditState | undefined;
      renderToolCall.mockImplementationOnce((parent: HTMLElement, toolCall: ToolCallInfo) => {
        mountMockChild(parent, genericEl);

        return genericEl;
      });
      createWriteEditBlock.mockImplementationOnce((parent: HTMLElement, toolCall: ToolCallInfo) => {
        mountMockChild(parent, writeEditEl);
        const state = partialMock<WriteEditState>({ wrapperEl: writeEditEl, toolCall, isExpanded: toolCall.isExpanded });
        writeEditState = state;
        return state;
      });
      const msg = createTestMessage();

      await controller.handleStreamChunk({
        id: 'migrated-edit',
        input: {},
        name: 'tool',
        providerPayload: { rawName: 'tool' },
        type: 'tool_use',
      }, msg);
      await controller.handleStreamChunk({ type: 'text', content: 'Intervening content' }, msg);
      const interveningTextEl = parentEl.children[1];
      await controller.handleStreamChunk(
        { type: 'tool_output', id: 'migrated-edit', content: 'partial output' },
        msg,
      );

      await controller.handleStreamChunk({
        id: 'migrated-edit',
        input: name === 'Edit'
          ? { file_path: 'notes/test.md', old_string: 'old', new_string: 'new' }
          : { file_path: 'notes/test.md', content: 'new' },
        name,
        providerPayload: { rawInput: { path: 'notes/test.md' }, rawName: name.toLowerCase() },
        type: 'tool_use',
      }, msg);

      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.contentBlocks?.filter(block => block.type === 'tool_use')).toEqual([
        { type: 'tool_use', toolId: 'migrated-edit' },
      ]);
      expect(genericEl.remove).toHaveBeenCalledTimes(1);
      expect(parentEl.children[0]).toBe(writeEditEl);
      expect(parentEl.children[1]).toBe(interveningTextEl);
      expect(deps.state.toolCallElements.get('migrated-edit')).toBe(writeEditEl);
      expect(deps.state.writeEditStates.get('migrated-edit')).toBe(writeEditState);
      expect(updateToolCallResult).not.toHaveBeenCalled();

      vi.advanceTimersByTime(16);
      await Promise.resolve();
      expect(updateToolCallResult).not.toHaveBeenCalled();

      await controller.handleStreamChunk({
        content: 'updated file',
        id: 'migrated-edit',
        resultDetails: {
          diff: {
            filePath: 'notes/test.md',
            diffLines: [
              { type: 'delete', text: 'old', oldLineNum: 1 },
              { type: 'insert', text: 'new', newLineNum: 1 },
            ],
            stats: { added: 1, removed: 1 },
          },
        },
        type: 'tool_result',
      }, msg);

      expect(msg.toolCalls![0]).toMatchObject({
        id: 'migrated-edit',
        name,
        result: 'updated file',
        status: 'completed',
        providerPayload: { rawInput: { path: 'notes/test.md' }, rawName: name.toLowerCase() },
        diffData: {
          filePath: 'notes/test.md',
          stats: { added: 1, removed: 1 },
        },
      });
      expect(updateWriteEditWithDiff).toHaveBeenCalledWith(
        writeEditState,
        msg.toolCalls![0].diffData,
      );
      expect(finalizeWriteEditBlock).toHaveBeenCalledWith(writeEditState, false);
    });

    it('migrates a rendered Write tool back to generic without losing tool state', async () => {
      const { renderToolCall, updateToolCallResult } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      const { createWriteEditBlock } = vi.mocked(await import('@/features/chat/rendering/tools/WriteEditRenderer'));
      const parentEl = createMockEl();
      installOrderedMockParent(parentEl);
      deps.state.currentContentEl = parentEl;
      const writeEditEl = createMockEl();
      const genericEl = createMockEl();
      const writeEditState = { wrapperEl: writeEditEl, isExpanded: true };
      createWriteEditBlock.mockImplementationOnce((parent: HTMLElement) => {
        mountMockChild(parent, writeEditEl);
        return partialMock<WriteEditState>(writeEditState);
      });
      renderToolCall.mockImplementationOnce((parent: HTMLElement, toolCall: ToolCallInfo) => {
        mountMockChild(parent, genericEl);

        return genericEl;
      });
      const msg = createTestMessage();

      await controller.handleStreamChunk({
        id: 'reverse-migration',
        input: { content: 'draft', file_path: 'notes/test.md' },
        name: 'Write',
        providerPayload: { rawName: 'write_file', rawOutput: { partial: true } },
        type: 'tool_use',
      }, msg);
      await controller.handleStreamChunk({ type: 'text', content: 'Intervening content' }, msg);
      const interveningTextEl = parentEl.children[1];
      const toolCall = msg.toolCalls![0];
      const diffData = {
        filePath: 'notes/test.md',
        diffLines: [{ type: 'insert' as const, text: 'draft', newLineNum: 1 }],
        stats: { added: 1, removed: 0 },
      };
      const subagent = {
        id: 'agent-1',
        description: 'Existing agent',
        status: 'completed' as const,
        toolCalls: [],
        isExpanded: true,
      };
      Object.assign(toolCall, {
        diffData,
        isExpanded: true,
        result: 'existing result',
        status: 'completed',
        subagent,
      });
      await controller.handleStreamChunk(
        { type: 'tool_output', id: 'reverse-migration', content: ' queued output' },
        msg,
      );

      await controller.handleStreamChunk({
        id: 'reverse-migration',
        input: { file_path: 'notes/refined.md' },
        name: 'Read',
        providerPayload: { rawInput: { path: 'notes/refined.md' }, rawName: 'read_file' },
        type: 'tool_use',
      }, msg);

      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.contentBlocks?.filter(block => block.type === 'tool_use')).toEqual([
        { type: 'tool_use', toolId: 'reverse-migration' },
      ]);
      expect(msg.toolCalls![0]).toBe(toolCall);
      expect(toolCall).toMatchObject({
        diffData,
        input: { content: 'draft', file_path: 'notes/refined.md' },
        isExpanded: true,
        name: 'Read',
        providerPayload: {
          rawInput: { path: 'notes/refined.md' },
          rawName: 'read_file',
          rawOutput: { partial: true },
        },
        result: 'existing result queued output',
        status: 'completed',
        subagent,
      });
      expect(renderToolCall).toHaveBeenCalledWith(
        parentEl,
        toolCall,
        expect.objectContaining({ initiallyExpanded: true }),
      );
      expect(updateToolCallResult).toHaveBeenCalledTimes(1);
      expect(updateToolCallResult).toHaveBeenCalledWith(
        deps.state.toolCallElements.get('reverse-migration'),
        toolCall,
      );
      expect(writeEditEl.remove).toHaveBeenCalledTimes(1);
      expect(parentEl.children[0]).toBe(genericEl);
      expect(parentEl.children[1]).toBe(interveningTextEl);
      expect(deps.state.toolCallElements.get('reverse-migration')).toBe(genericEl);
      expect(deps.state.writeEditStates.has('reverse-migration')).toBe(false);

      vi.advanceTimersByTime(16);
      await Promise.resolve();
      expect(updateToolCallResult).toHaveBeenCalledTimes(1);
    });

    it('rebuilds rendered generic tools for forward and reverse normalized-name changes', async () => {
      const { renderToolCall, updateToolCallResult } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      renderToolCall.mockReset();
      const parentEl = createMockEl();
      installOrderedMockParent(parentEl);
      deps.state.currentContentEl = parentEl;
      const initialEl = createMockEl();
      const bashEl = createMockEl();
      const unknownEl = createMockEl();
      for (const element of [initialEl, bashEl, unknownEl]) {
        renderToolCall.mockImplementationOnce((parent: HTMLElement, toolCall: ToolCallInfo) => {
          mountMockChild(parent, element);

          return element;
        });
      }
      const msg = createTestMessage();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'generic-migration', name: 'tool', input: {} },
        msg,
      );
      await controller.handleStreamChunk({ type: 'text', content: 'Intervening content' }, msg);
      const interveningTextEl = parentEl.children[1];
      const toolCall = msg.toolCalls![0];
      const diffData = {
        filePath: 'notes/test.md',
        diffLines: [],
        stats: { added: 0, removed: 0 },
      };
      const subagent = {
        id: 'agent-1',
        description: 'Existing agent',
        status: 'completed' as const,
        toolCalls: [],
        isExpanded: true,
      };
      Object.assign(toolCall, {
        diffData,
        isExpanded: true,
        result: 'existing result',
        status: 'completed',
        subagent,
      });

      await controller.handleStreamChunk({
        id: 'generic-migration',
        input: { command: 'npm test' },
        name: 'Bash',
        providerPayload: { rawName: 'run_terminal_command' },
        type: 'tool_use',
      }, msg);
      await controller.handleStreamChunk({
        id: 'generic-migration',
        input: { future: true },
        name: 'future_tool',
        providerPayload: { rawOutput: { complete: true } },
        type: 'tool_use',
      }, msg);

      expect(msg.toolCalls).toEqual([toolCall]);
      expect(msg.contentBlocks?.filter(block => block.type === 'tool_use')).toEqual([
        { type: 'tool_use', toolId: 'generic-migration' },
      ]);
      expect(toolCall).toMatchObject({
        diffData,
        input: { command: 'npm test', future: true },
        isExpanded: true,
        name: 'future_tool',
        providerPayload: {
          rawName: 'run_terminal_command',
          rawOutput: { complete: true },
        },
        result: 'existing result',
        status: 'completed',
        subagent,
      });
      expect(renderToolCall).toHaveBeenCalledTimes(3);
      expect(renderToolCall).toHaveBeenNthCalledWith(
        2,
        parentEl,
        toolCall,
        expect.objectContaining({ initiallyExpanded: true }),
      );
      expect(renderToolCall).toHaveBeenNthCalledWith(
        3,
        parentEl,
        toolCall,
        expect.objectContaining({ initiallyExpanded: true }),
      );
      expect(updateToolCallResult).toHaveBeenCalledTimes(2);
      expect(initialEl.remove).toHaveBeenCalledTimes(1);
      expect(bashEl.remove).toHaveBeenCalledTimes(1);
      expect(parentEl.children[0]).toBe(unknownEl);
      expect(parentEl.children[1]).toBe(interveningTextEl);
      expect(deps.state.toolCallElements.get('generic-migration')).toBe(unknownEl);
      expect(deps.state.writeEditStates.has('generic-migration')).toBe(false);
    });

    it('rebuilds a rendered generic tool as TodoWrite', async () => {
      const { renderToolCall } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      renderToolCall.mockReset();
      const todos = [{ content: 'Task', status: 'in_progress', activeForm: 'Working' }];
      const parentEl = createMockEl();
      installOrderedMockParent(parentEl);
      deps.state.currentContentEl = parentEl;
      const initialEl = createMockEl();
      const todoEl = createMockEl();
      for (const element of [initialEl, todoEl]) {
        renderToolCall.mockImplementationOnce((parent: HTMLElement, toolCall: ToolCallInfo) => {
          mountMockChild(parent, element);

          return element;
        });
      }
      const msg = createTestMessage();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'todo-migration', name: 'tool', input: {} },
        msg,
      );
      await controller.handleStreamChunk({ type: 'text', content: 'Intervening content' }, msg);
      await controller.handleStreamChunk({
        id: 'todo-migration',
        input: { todos },
        name: TOOL_TODO_WRITE,
        type: 'tool_use',
      }, msg);

      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.toolCalls![0]).toMatchObject({ name: TOOL_TODO_WRITE, input: { todos } });
      expect(msg.contentBlocks?.filter(block => block.type === 'tool_use')).toHaveLength(1);
      expect(initialEl.remove).toHaveBeenCalledTimes(1);
      expect(deps.state.toolCallElements.get('todo-migration')).toBe(todoEl);
    });

    it('rebuilds a rendered generic tool as AskUserQuestion without duplicating result handling', async () => {
      const { renderToolCall, updateToolCallResult } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      renderToolCall.mockReset();
      const parentEl = createMockEl();
      installOrderedMockParent(parentEl);
      deps.state.currentContentEl = parentEl;
      const initialEl = createMockEl();
      const askEl = createMockEl();
      for (const element of [initialEl, askEl]) {
        renderToolCall.mockImplementationOnce((parent: HTMLElement, toolCall: ToolCallInfo) => {
          mountMockChild(parent, element);

          return element;
        });
      }
      const msg = createTestMessage();

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'ask-migration', name: 'tool', input: {} },
        msg,
      );
      await controller.handleStreamChunk({ type: 'text', content: 'Intervening content' }, msg);
      await controller.handleStreamChunk({
        id: 'ask-migration',
        input: { questions: [{ id: 'color', question: 'Color?' }] },
        name: 'AskUserQuestion',
        type: 'tool_use',
      }, msg);
      await controller.handleStreamChunk({
        content: 'answered',
        id: 'ask-migration',
        resultDetails: { resolvedAnswers: { color: 'Blue' } },
        type: 'tool_result',
      }, msg);

      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.contentBlocks?.filter(block => block.type === 'tool_use')).toHaveLength(1);
      expect(msg.toolCalls![0]).toMatchObject({
        name: 'AskUserQuestion',
        resolvedAnswers: { color: 'Blue' },
        result: 'answered',
        status: 'completed',
      });
      expect(initialEl.remove).toHaveBeenCalledTimes(1);
      expect(deps.state.toolCallElements.get('ask-migration')).toBe(askEl);
      expect(updateToolCallResult).toHaveBeenCalledTimes(1);
      expect(updateToolCallResult).toHaveBeenCalledWith(
        deps.state.toolCallElements.get('ask-migration'),
        msg.toolCalls![0],
      );
    });

    it('preserves result and lifecycle state while refining the normalized name', async () => {
      const msg = createTestMessage();
      const diffData = {
        filePath: 'notes/test.md',
        diffLines: [],
        stats: { added: 1, removed: 0 },
      };
      const subagent = {
        id: 'agent-1',
        description: 'Existing agent',
        status: 'completed',
        toolCalls: [],
        isExpanded: true,
      };
      msg.toolCalls = [{
        id: 'preserved-tool',
        name: 'tool',
        input: { existing: true },
        providerPayload: { rawName: 'tool', rawOutput: { partial: true } },
        status: 'completed',
        result: 'existing result',
        diffData,
        subagent,
        isExpanded: true,
      } as ToolCallInfo];

      await controller.handleStreamChunk({
        id: 'preserved-tool',
        input: { command: 'npm test' },
        name: 'Bash',
        providerPayload: { rawInput: { command: 'npm test' }, rawName: 'run_terminal_command' },
        type: 'tool_use',
      }, msg);

      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.toolCalls![0]).toMatchObject({
        input: { command: 'npm test', existing: true },
        name: 'Bash',
        providerPayload: {
          rawInput: { command: 'npm test' },
          rawName: 'run_terminal_command',
          rawOutput: { partial: true },
        },
        result: 'existing result',
        status: 'completed',
      });
      expect(msg.toolCalls![0].diffData).toBe(diffData);
      expect(msg.toolCalls![0].subagent).toBe(subagent);
      expect(msg.toolCalls![0].isExpanded).toBe(true);
    });

    it('accepts an unknown refined name but ignores a later blank name', async () => {
      const msg = createTestMessage();
      const rawInput = { opaque: true };
      const rawOutput = { future: ['lossless'] };

      await controller.handleStreamChunk({
        type: 'tool_use',
        id: 'unknown-tool',
        name: 'execute',
        input: rawInput,
        providerPayload: { rawInput, rawName: 'execute' },
      }, msg);
      await controller.handleStreamChunk({
        type: 'tool_use',
        id: 'unknown-tool',
        name: 'future_tool',
        input: rawInput,
        providerPayload: { rawInput, rawName: 'future_tool', rawOutput },
      }, msg);
      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'unknown-tool', name: '   ', input: { later: true } },
        msg,
      );

      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.toolCalls![0]).toMatchObject({
        input: { later: true, opaque: true },
        name: 'future_tool',
        providerPayload: { rawInput, rawName: 'future_tool', rawOutput },
      });
    });

    it('dispatches a merged same-id input refinement to the rendered header owner', async () => {
      const { renderToolCall, refreshToolCallHeader } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();
      const toolEl = createMockEl();
      renderToolCall.mockReturnValueOnce(toolEl);

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'test.md', offset: 4 } },
        msg
      );

      await controller.handleStreamChunk({ type: 'done' }, msg);
      const tool = msg.toolCalls![0];

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'updated.md' } },
        msg
      );

      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.toolCalls![0]).toBe(tool);
      expect(tool.input).toEqual({ file_path: 'updated.md', offset: 4 });
      expect(tool.status).toBe('running');
      expect(refreshToolCallHeader).toHaveBeenCalledWith(toolEl);
      expect(renderToolCall).toHaveBeenCalledTimes(1);
    });

    it('dispatches a title-only name refinement without losing the logical tool input', async () => {
      const { renderToolCall, refreshToolCallHeader } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();
      const toolEl = createMockEl();
      renderToolCall.mockReturnValueOnce(toolEl);

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'title-only', name: 'tool', input: { file_path: 'retained.md' } },
        msg,
      );
      await controller.handleStreamChunk({ type: 'done' }, msg);

      const tool = msg.toolCalls![0];

      await controller.handleStreamChunk(
        { type: 'tool_use', id: 'title-only', name: 'Read', input: {} },
        msg,
      );

      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.toolCalls![0]).toBe(tool);
      expect(tool).toMatchObject({ id: 'title-only', name: 'Read', input: { file_path: 'retained.md' }, status: 'running' });
      expect(refreshToolCallHeader).toHaveBeenCalledWith(toolEl);
    });
  });

  describe('Sync subagent finalization', () => {
    it('tool_result for a sync subagent calls finalizeSyncSubagent and updates Task toolCall', async () => {
      (deps.subagentManager.finalizeSyncSubagent as Mock).mockImplementationOnce(
        SubagentManager.prototype.finalizeSyncSubagent.bind(deps.subagentManager),
      );
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      msg.toolCalls = [
        {
          id: 'task-1',
          name: TOOL_SUBAGENT,
          input: { description: 'Do something' },
          status: 'running',
          subagent: { id: 'task-1', description: 'Do something', status: 'running', toolCalls: [], isExpanded: false },
        },
      ];

      // getSyncSubagent returns a subagent state (indicating this is a sync subagent)
      (deps.subagentManager.getSyncSubagent as Mock).mockReturnValueOnce({
        info: { id: 'task-1', description: 'Do something', status: 'running', toolCalls: [], isExpanded: false },
      });

      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'task-1', content: 'Task completed successfully' },
        msg
      );

      expect(deps.subagentManager.finalizeSyncSubagent).toHaveBeenCalledWith(
        'task-1',
        'Task completed successfully',
        false,
        undefined,
        expect.objectContaining({ id: 'task-1' }),
      );

      expect(msg.toolCalls![0].status).toBe('completed');
      expect(msg.toolCalls![0].result).toBe('Task completed successfully');
      expect(msg.toolCalls![0].subagent?.status).toBe('completed');
      expect(msg.toolCalls![0].subagent?.result).toBe('Task completed successfully');
    });
  });

  describe('Async task tool result', () => {
    it('tool_result for a pending async task returns true from handleAsyncTaskToolResult', async () => {
      const { updateToolCallResult } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();

      (deps.subagentManager.isPendingAsyncTask as Mock).mockReturnValueOnce(true);

      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'task-1', content: 'Task started in background' },
        msg
      );

      expect(deps.subagentManager.handleTaskToolResult).toHaveBeenCalledWith(
        'task-1',
        'Task started in background',
        undefined,
        undefined
      );

      expect(updateToolCallResult).not.toHaveBeenCalled();
      expect(msg.toolCalls).toEqual([]);
    });

    it('passes the provider payload through to async Task result handler', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = createMockEl();
      (deps.subagentManager.isPendingAsyncTask as Mock).mockReturnValueOnce(true);

      const structured = { rawOutput: { data: { agent_id: 'agent-from-structured' } } };
      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'task-1', content: 'Task started', providerPayload: structured },
        msg
      );

      expect(deps.subagentManager.handleTaskToolResult).toHaveBeenCalledWith(
        'task-1',
        'Task started',
        undefined,
        structured
      );
    });

    it('normalizes structured tool_result content before storing it on tool calls', async () => {
      const { updateToolCallResult } = vi.mocked(await import('@/features/chat/rendering/tools/ToolCallRenderer'));
      const msg = createTestMessage();
      msg.toolCalls = [
        {
          id: 'mcp-1',
          name: 'mcp__stitch__create_project',
          input: {},
          status: 'running',
          isExpanded: false,
        },
      ];

      await controller.handleStreamChunk(
        // Provider payloads arrive as content-block arrays rather than the declared string.
        partialMock<Parameters<StreamController['handleStreamChunk']>[0]>({
          type: 'tool_result',
          id: 'mcp-1',
          content: [{ type: 'text', text: 'Created project successfully' }],
        }),
        msg,
      );

      expect(msg.toolCalls[0].status).toBe('completed');
      expect(msg.toolCalls[0].result).toBe('Created project successfully');
      expect(updateToolCallResult).toHaveBeenCalled();
    });
  });

  describe('appendThinking - no currentContentEl', () => {
    it('should not create thinking state when currentContentEl is null', async () => {
      const msg = createTestMessage();
      deps.state.currentContentEl = null;

      await controller.handleStreamChunk({ type: 'thinking', content: 'test thinking' }, msg);

      // No thinking state should be created
      expect(deps.state.currentThinkingState).toBeNull();
    });
  });

});

describe('StreamController - Tool completion', () => {
  let controller: StreamController;
  let deps: MockStreamControllerDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    installTestWindow();
    deps = createMockDeps();
    controller = new StreamController(deps);
    deps.state.currentContentEl = createMockEl();
  });

  afterEach(() => {
    deps.state.clearThinkingIndicatorTimeout();
    deps.state.clearFlavorTimerInterval();
    restoreTestWindow();
    vi.useRealTimers();
  });

  describe('tool completion outcomes', () => {
    it('persists provider payload from an incomplete tool stream without changing presentation', async () => {
      const rawInput = ['opaque', { nested: true }];
      const rawOutput = { partial: { bytes: [1, 2, 3] } };
      const msg = createTestMessage();

      await controller.handleStreamChunk({
        id: 'future-incomplete',
        input: {},
        name: 'Read',
        providerPayload: { rawInput, rawName: 'future_tool' },
        type: 'tool_use',
      }, msg);
      await controller.handleStreamChunk({
        id: 'future-incomplete',
        input: {},
        name: 'Read',
        providerPayload: { rawInput, rawName: 'future_tool', rawOutput },
        type: 'tool_use',
      }, msg);

      expect(JSON.parse(JSON.stringify(msg)).toolCalls[0]).toMatchObject({
        input: {},
        name: 'Read',
        providerPayload: { rawInput, rawName: 'future_tool', rawOutput },
        status: 'running',
      });
    });

    it('persists provider tool payload without replacing concise presentation', async () => {
      const rawInput = ['opaque', { nested: true }];
      const rawOutput = { future: { bytes: [1, 2, 3] } };
      const msg = createTestMessage();

      await controller.handleStreamChunk({
        id: 'future-1',
        input: {},
        name: 'future_tool',
        type: 'tool_use',
      }, msg);
      await controller.handleStreamChunk({
        content: 'Concise result',
        id: 'future-1',
        providerPayload: {
          rawInput,
          rawName: 'future_tool',
          rawOutput,
        },
        type: 'tool_result',
      }, msg);

      const persisted = JSON.parse(JSON.stringify(msg));
      expect(persisted.toolCalls[0]).toMatchObject({
        input: {},
        name: 'future_tool',
        providerPayload: {
          rawInput,
          rawName: 'future_tool',
          rawOutput,
        },
        result: 'Concise result',
        status: 'completed',
      });
      expect(persisted.toolCalls[0].result).not.toContain('bytes');
    });

    it('should hydrate AskUserQuestion resolvedAnswers from result text fallback', async () => {
      const coreTools = vi.mocked(await import('@/core/tools/toolInput'));
      (coreTools.extractResolvedAnswersFromResultText as Mock).mockReturnValueOnce({
        'Color?': 'Blue',
      });

      const msg = createTestMessage();
      msg.toolCalls = [{
        id: 'ask-1',
        name: 'AskUserQuestion',
        input: { questions: [{ question: 'Color?' }] },
        status: 'running',
      }];

      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'ask-1', content: '"Color?"="Blue"' },
        msg
      );

      expect(msg.toolCalls![0].resolvedAnswers).toEqual({ 'Color?': 'Blue' });
    });

    it('should not infer AskUserQuestion status from result text', async () => {
      const msg = createTestMessage();
      msg.toolCalls = [{
        id: 'ask-1',
        name: 'AskUserQuestion',
        input: {},
        status: 'running',
      }];

      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'ask-1', content: 'User denied this action.' },
        msg
      );

      expect(msg.toolCalls![0].status).toBe('completed');
    });

    it('should not infer ExitPlanMode status from result text', async () => {
      const msg = createTestMessage();
      msg.toolCalls = [{
        id: 'exit-1',
        name: 'ExitPlanMode',
        input: {},
        status: 'running',
      }];

      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'exit-1', content: 'User denied.' },
        msg
      );

      expect(msg.toolCalls![0].status).toBe('completed');
    });

    it('should complete a successful Read whose file content discusses approval', async () => {
      const msg = createTestMessage();
      msg.toolCalls = [{
        id: 'read-1',
        name: 'Read',
        input: { file_path: 'repro-a.md' },
        status: 'running',
      }];

      await controller.handleStreamChunk(
        { type: 'tool_result', id: 'read-1', content: 'wait for explicit approval' },
        msg
      );

      expect(msg.toolCalls![0].status).toBe('completed');
    });

    it('should mark a tool as blocked only when the provider reports that outcome', async () => {
      const msg = createTestMessage();
      msg.toolCalls = [{
        id: 'bash-1',
        name: 'Bash',
        input: { command: 'rm -rf /' },
        status: 'running',
      }];

      await controller.handleStreamChunk(
        {
          type: 'tool_result',
          id: 'bash-1',
          content: 'The tool was not run.',
          isBlocked: true,
        },
        msg
      );

      expect(msg.toolCalls![0].status).toBe('blocked');
    });
  });
});
