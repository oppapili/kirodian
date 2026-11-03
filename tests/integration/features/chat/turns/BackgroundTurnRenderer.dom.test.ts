/** @jest-environment jsdom */
import '@/providers';

import { createSessionModelStub } from '@test/helpers/ConversationPorts';
import { enqueueTabSessionEvent } from '@test/helpers/features/chat/SessionEventsHarness';
import { FakeSideBackend } from '@test/helpers/features/chat/SideChatSessionHarness';
import { within } from '@testing-library/dom';
import { axe } from 'jest-axe';
import { Component, MarkdownRenderer } from 'obsidian';

import { ProviderExecutionLifecycleRegistry } from '@/core/execution';
import type { ChatMessage } from '@/core/types';
import { ChatExecutionCoordinator } from '@/features/chat/execution/ChatExecutionCoordinator';
import { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';
import { ChatSessionRuntime } from '@/features/chat/sessions/ChatSessionRuntime';
import { ChatState } from '@/features/chat/state/ChatState';
import { SubagentManager } from '@/features/chat/subagents/SubagentManager';
import { TabSession } from '@/features/chat/tabs/TabSession';
import { StreamController } from '@/features/chat/turns/StreamController';

HTMLElement.prototype.empty = function () { this.replaceChildren(); };
HTMLElement.prototype.addClass = function (...classes) { this.classList.add(...classes); };
HTMLElement.prototype.removeClass = function (...classes) { this.classList.remove(...classes); };
HTMLElement.prototype.hasClass = function (cls) { return this.classList.contains(cls); };
beforeEach(() => {
  document.body.replaceChildren();
  jest.mocked(MarkdownRenderer.render).mockImplementation(async (_app, markdown, el) => {
    (el as HTMLElement).createEl('p', { text: markdown });
  });
});

it.each([false, true])('keeps main-chat automatic work and later output on either side of a notification (compaction: %s)', async (compaction) => {
  const messagesEl = document.body.createDiv();
  const plugin = { app: {}, settings: { mediaFolder: '', showMessageTimestamps: false } } as any;
  const renderer = new MessageRenderer(plugin,
    new Component(), messagesEl);
  const state = new ChatState();
  const subagents = new SubagentManager(() => undefined);
  const stream = new StreamController({ plugin, state, renderer, subagentManager: subagents,
    getMessagesEl: () => messagesEl, updateQueueIndicator: () => undefined });
  const lifecycleRegistry = new ProviderExecutionLifecycleRegistry();
  const backend = new FakeSideBackend();
  const coordinator = new ChatExecutionCoordinator({
    lifecycleRegistry, resolveBackend: () => backend,
    persistence: { persistExecutionSnapshot: async () => true, registerExecutionBinding: () => undefined, releaseExecutionBinding: () => undefined } as any,
    interactionPort: {} as any, workingDirectory: '/vault', createId: () => 'binding',
    resolveMissingProviderSession: async () => 'not_found',
    onSessionEvent: (event, context) => enqueueTabSessionEvent(tab, plugin, event, context),
  });
  const runtime = new ChatSessionRuntime(
    { conversationId: 'conversation', providerId: 'kiro', draftModel: null },
    coordinator,
    session => createSessionModelStub(session, { getState: () => state }),
  );
  const session = new TabSession({ id: 'tab', lifecycleState: 'open' }, runtime);
  const tab = { state, renderer, session, executionCoordinator: coordinator, lifecycleState: 'open',
    ui: { promptSuggestion: { receive() {}, discard() {} } },
    dom: { contentEl: messagesEl },
    services: { subagentManager: subagents },
    controllers: { streamController: stream, inputController: undefined,
      conversationController: { save: async () => undefined, scheduleProgressSave: () => undefined } } } as any;
  try {
    await coordinator.bindConversation({ conversationId: 'conversation', providerId: 'kiro' });
    await coordinator.prepare();
    const requested: ChatMessage = { id: 'requested', role: 'assistant', timestamp: 1, content: '', contentBlocks: [] };
    state.addMessage(requested);
    state.currentContentEl = renderer.addMessage(requested).querySelector('.claudian-message-content');
    await stream.handleStreamChunk({ type: 'text', content: 'Requested ' }, requested);
    const current = state.currentContentEl;
    const native = backend.latest;
    native.emitSessionEvent({ type: 'task_notification', content: 'First task finished.' });
    native.emitBackgroundEvent({ type: 'background_turn_started' });
    native.emitBackgroundEvent({ type: 'tool_started', toolCallId: 'read', toolScope: { kind: 'main' }, name: 'Read', input: { file_path: 'task.output' } });
    native.emitBackgroundEvent({ type: 'tool_completed', toolCallId: 'read', toolScope: { kind: 'main' }, content: 'First task result' });
    native.emitSessionEvent({ type: 'task_notification', content: 'Second task finished.' });
    if (compaction) native.emitBackgroundEvent({ type: 'context_compacted' });
    native.emitBackgroundEvent({ type: 'text_delta', text: 'After notification.' });
    native.emitBackgroundEvent({ type: 'background_turn_completed', reason: 'completed', nativeAssistantId: 'final-checkpoint' });
    await session.runtime.awaitBackgroundWork();
    const notifications = within(messagesEl).getAllByRole('button', { name: 'Task notification' });
    const automaticWork = within(messagesEl).getByText('Read');
    expect(notifications[0].compareDocumentPosition(automaticWork) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(automaticWork.compareDocumentPosition(notifications[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const notification = notifications[1];
    const answer = within(messagesEl).getByText('After notification.');
    expect(notification.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const output = [notification, ...(compaction ? [within(messagesEl).getByText('Conversation compacted')] : []), answer];
    for (const [index, element] of output.slice(1).entries()) {
      expect(output[index].compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(state.messages.at(-1)).toMatchObject({ content: 'After notification.', assistantMessageId: 'final-checkpoint', isAutomaticResponse: true });
    expect(state.messages.filter(message => message.assistantMessageId === 'final-checkpoint')).toHaveLength(1);
    expect(state.currentContentEl).toBe(current);
    await stream.handleStreamChunk({ type: 'text', content: 'answer' }, requested);
    await stream.finalizeCurrentTextBlock(requested);
    expect(requested.content).toBe('Requested answer');
    expect((await axe(messagesEl)).violations).toEqual([]);
  } finally {
    await coordinator.dispose();
    await lifecycleRegistry.dispose();
    stream.dispose(); subagents.clear(); renderer.dispose();
  }
});
