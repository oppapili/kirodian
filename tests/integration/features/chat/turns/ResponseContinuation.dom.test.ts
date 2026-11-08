/** @vitest-environment jsdom */
import '@/providers';

import { testDate } from '@test/helpers/testClock';
import { fireEvent, within } from '@testing-library/dom';
import { Component, MarkdownRenderer } from 'obsidian';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { ChatMessage } from '@/core/types';
import { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';
import { ChatState } from '@/features/chat/state/ChatState';
import { SubagentManager } from '@/features/chat/subagents/SubagentManager';
import { continueResponseAfterNotification } from '@/features/chat/turns/ResponseContinuation';
import { StreamController } from '@/features/chat/turns/StreamController';

// Claude-SDK JSONL replay/hydration coverage (loadSDKSessionMessages,
// ClaudeConversationHistoryService) and managed-Agent-subagent coverage were
// removed with the claude provider (#83): kiro's native history store does not
// parse SDK task-notification attachments and kiro has no managed-task
// interpreter. The neutral live-rendering contracts (compaction collapse,
// notification grouping, continuation lifecycle) are retained below through the
// provider-neutral StreamController path.
HTMLElement.prototype.empty = function () { this.replaceChildren(); };
HTMLElement.prototype.addClass = function (...classes) { this.classList.add(...classes); };
HTMLElement.prototype.removeClass = function (...classes) { this.classList.remove(...classes); };

beforeEach(() => {
  document.body.replaceChildren();
  vi.mocked(MarkdownRenderer.render).mockImplementation(async (_app, markdown, el) => {
    (el as HTMLElement).createEl('p', { text: markdown });
  });
});

it.each([false, true])('collapses work across compaction on completion and reload (notification split: %s)', async notification => {
  const { renderSessionTaskNotification } = await import('@/features/chat/turns/BackgroundTurnRenderer');
  const messagesEl = document.body.createDiv();
  const plugin = { app: {}, settings: { mediaFolder: '', showMessageTimestamps: false } } as any;
  const renderer = new MessageRenderer(plugin, new Component(), messagesEl);
  const state = new ChatState();
  const subagents = new SubagentManager(() => undefined, ProviderRegistry.getTaskResultInterpreter('kiro'));
  const stream = new StreamController({ plugin, state, renderer, subagentManager: subagents,
    getMessagesEl: () => messagesEl, updateQueueIndicator: () => undefined, getProviderId: () => 'kiro' });
  let response: ChatMessage = { id: 'response', role: 'assistant', timestamp: testDate().getTime(), content: '', contentBlocks: [] };
  const assertDisclosure = async () => {
    const header = within(messagesEl).getByRole('button', { name: 'Worked for 05:07' });
    const history = document.getElementById(header.getAttribute('aria-controls')!)!;
    const before = within(messagesEl).getByRole('button', { name: /Read.*before\.md/, hidden: true });
    const after = within(messagesEl).getByRole('button', { name: /Read.*after\.md/, hidden: true });
    const compact = within(messagesEl).getByText('Conversation compacted');
    const answer = within(messagesEl).getByText('Final answer.');
    for (const element of [before, compact, after]) {
      expect(history.contains(element)).toBe(true);
      expect(element.closest('[hidden]')).toBe(history);
      expect(header.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(before.compareDocumentPosition(compact) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(compact.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(answer.closest('[hidden]')).toBeNull();
    expect(header.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(before.closest('[hidden]')).toBeNull();
    expect(after.closest('[hidden]')).toBeNull();
    expect((await axe(messagesEl)).violations).toEqual([]);
    fireEvent.click(header);
    expect(history.hidden).toBe(true);
    expect(answer.closest('[hidden]')).toBeNull();
  };
  try {
    state.addMessage(response);
    state.currentContentEl = renderer.addMessage(response).querySelector('.claudian-message-content');
    await stream.handleStreamChunk({ type: 'tool_use', id: 'before', name: 'Read', input: { file_path: 'before.md' } }, response);
    await stream.handleStreamChunk({ type: 'tool_result', id: 'before', content: 'Before compaction' }, response);
    await stream.handleStreamChunk({ type: 'context_compacted' }, response);
    if (notification) renderSessionTaskNotification({ state, renderer,
      createMessageId: () => 'notification' }, 'Task finished.');
    const tool = { type: 'tool_use' as const, id: 'after', name: 'Read', input: { file_path: 'after.md' } };
    response = await continueResponseAfterNotification({ state, renderer, stream, createMessageId: () => 'continuation' }, response, tool);
    await stream.handleStreamChunk(tool, response);
    await stream.handleStreamChunk({ type: 'tool_result', id: 'after', content: 'After compaction' }, response);
    await stream.handleStreamChunk({ type: 'text', content: 'Final answer.' }, response);
    await stream.finalizeCurrentTextBlock(response);
    response.durationSeconds = 307;
    renderer.finalizeResponse(response, state.messages);
    await assertDisclosure();
    renderer.renderMessages(state.messages, () => 'Welcome');
    await Promise.resolve();
    await assertDisclosure();
  } finally {
    stream.dispose(); subagents.clear(); renderer.dispose();
  }
});

it('does not recreate a response after its conversation is cleared during finalization', async () => {
  const { renderSessionTaskNotification } = await import('@/features/chat/turns/BackgroundTurnRenderer');
  const messagesEl = document.body.createDiv();
  const plugin = { app: {}, settings: { mediaFolder: '', showMessageTimestamps: false } } as any;
  const renderer = new MessageRenderer(plugin,
    new Component(), messagesEl, undefined, undefined, () => ProviderRegistry.getCapabilities('kiro'));
  const state = new ChatState();
  const subagents = new SubagentManager(() => undefined, ProviderRegistry.getTaskResultInterpreter('kiro'));
  const stream = new StreamController({ plugin, state, renderer, subagentManager: subagents,
    getMessagesEl: () => messagesEl, updateQueueIndicator: () => undefined, getProviderId: () => 'kiro' });
  const original: ChatMessage = { id: 'original', role: 'assistant', timestamp: 1, content: '', contentBlocks: [] };
  try {
    state.addMessage(original);
    state.currentContentEl = renderer.addMessage(original).querySelector('.claudian-message-content');
    await stream.handleStreamChunk({ type: 'text', content: 'Earlier text.' }, original);
    renderSessionTaskNotification({ state, renderer, createMessageId: () => 'notification' }, 'Task finished.');
    const pending = continueResponseAfterNotification({ state, renderer, stream, createMessageId: () => 'continuation' }, original, { type: 'text', content: 'Later text.' });
    state.clearMessages();
    messagesEl.replaceChildren();
    await pending;
    expect(state.messages).toEqual([]);
    expect(messagesEl.childElementCount).toBe(0);
  } finally {
    stream.dispose(); subagents.clear(); renderer.dispose();
  }
});

it.each(['background', 'user'] as const)('groups only the requested response across notifications with intervening %s output', async intervening => {
  const { renderSessionTaskNotification } = await import('@/features/chat/turns/BackgroundTurnRenderer');
  const messagesEl = document.body.createDiv();
  const plugin = { app: {}, settings: { mediaFolder: '', showMessageTimestamps: false } } as any;
  const renderer = new MessageRenderer(plugin,
    new Component(), messagesEl, undefined, undefined, () => ProviderRegistry.getCapabilities('kiro'));
  const state = new ChatState();
  const subagents = new SubagentManager(() => undefined, ProviderRegistry.getTaskResultInterpreter('kiro'));
  const stream = new StreamController({ plugin, state, renderer, subagentManager: subagents,
    getMessagesEl: () => messagesEl, updateQueueIndicator: () => undefined, getProviderId: () => 'kiro' });
  let nextId = 0;
  const host = { state, renderer, stream, isConnected: () => true, createMessageId: () => `part-${++nextId}` };
  let response: ChatMessage = { id: 'response', role: 'assistant', timestamp: testDate().getTime(), content: '', contentBlocks: [] };
  try {
    state.addMessage(response);
    state.currentContentEl = renderer.addMessage(response).querySelector('.claudian-message-content');
    await stream.handleStreamChunk({ type: 'tool_use', id: 'read', name: 'Read', input: { file_path: 'note.md' } }, response);
    renderSessionTaskNotification(host, 'First notification.');
    response = await continueResponseAfterNotification(host, response, { type: 'text', content: 'Still working.' });
    await stream.handleStreamChunk({ type: 'text', content: 'Still working.' }, response);
    await stream.handleStreamChunk({ type: 'tool_use', id: 'second-read', name: 'Read', input: { file_path: 'second.md' } }, response);
    const other: ChatMessage = { id: 'other', role: intervening === 'user' ? 'user' : 'assistant',
      isAutomaticResponse: intervening === 'background', timestamp: testDate().getTime(), content: 'Independent output.' };
    state.addMessage(other);
    renderer.renderStoredMessage(other);
    renderSessionTaskNotification(host, 'Second notification.');
    response = await continueResponseAfterNotification(host, response, { type: 'text', content: 'Final answer.' });
    await stream.handleStreamChunk({ type: 'text', content: 'Final answer.' }, response);
    await stream.finalizeCurrentTextBlock(response);
    response.durationSeconds = 18;
    renderer.finalizeResponse(response, state.messages);
    const header = within(messagesEl).getByRole('button', { name: 'Worked for 00:18' });
    const history = document.getElementById(header.getAttribute('aria-controls')!)!;
    const cards = within(messagesEl).getAllByRole('button', { name: /Read.*(?:note|second)\.md/, hidden: true });
    expect(cards).toHaveLength(2);
    for (const card of cards) expect(history.contains(card)).toBe(intervening === 'background');
    const commentary = within(messagesEl).getByText('Still working.');
    const notifications = within(messagesEl).getAllByRole('button', { name: 'Task notification', hidden: true });
    expect(history.contains(commentary)).toBe(intervening === 'background');
    for (const notification of notifications) expect(history.contains(notification)).toBe(intervening === 'background');
    expect(notifications[0].compareDocumentPosition(commentary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(commentary.compareDocumentPosition(notifications[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(history.contains(messagesEl.querySelector('[data-message-id="other"]'))).toBe(false);
    expect(notifications).toHaveLength(2);
    expect(within(messagesEl).getByText('Final answer.').closest('[hidden]')).toBeNull();
    expect((await axe(messagesEl)).violations).toEqual([]);
  } finally {
    stream.dispose(); subagents.clear(); renderer.dispose();
  }
});
