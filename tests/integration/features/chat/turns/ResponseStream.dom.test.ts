/** @jest-environment jsdom */
import '@/providers';

import { testDate } from '@test/helpers/testClock';
import { fireEvent, within } from '@testing-library/dom';
import { axe } from 'jest-axe';
import { Component, MarkdownRenderer } from 'obsidian';

import type { ChatMessage } from '@/core/types';
import { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';
import { ChatState } from '@/features/chat/state/ChatState';
import { SubagentManager } from '@/features/chat/subagents/SubagentManager';
import { renderSessionTaskNotification } from '@/features/chat/turns/BackgroundTurnRenderer';
import { continueResponseAfterNotification } from '@/features/chat/turns/ResponseContinuation';
import { ResponseStream } from '@/features/chat/turns/ResponseStream';
import { StreamController } from '@/features/chat/turns/StreamController';
import { TurnCoordinator } from '@/features/chat/turns/TurnCoordinator';

HTMLElement.prototype.appendText = function (text) { this.append(document.createTextNode(text)); };
HTMLElement.prototype.empty = function () { this.replaceChildren(); };
HTMLElement.prototype.addClass = function (...classes) { this.classList.add(...classes); };
HTMLElement.prototype.removeClass = function (...classes) { this.classList.remove(...classes); };

const cleanups: Array<() => void> = [];
beforeEach(() => {
  jest.mocked(MarkdownRenderer.render).mockImplementation(async (_app, markdown, el) => {
    (el as HTMLElement).createEl('p', { text: markdown });
  });
});
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  document.body.replaceChildren();
});

function createSession() {
  const messagesEl = document.body.createDiv();
  const plugin = { app: {}, settings: { mediaFolder: '', showMessageTimestamps: false } } as any;
  const renderer = new MessageRenderer(plugin, new Component(), messagesEl);
  const turns = new TurnCoordinator();
  const state = new ChatState({}, undefined, turns);
  const subagents = new SubagentManager(() => undefined);
  const stream = new StreamController({ plugin, state, renderer, subagentManager: subagents,
    getMessagesEl: () => messagesEl, updateQueueIndicator: () => undefined });
  let nextId = 0;
  const host = { state, renderer, stream, turns, createMessageId: () => `message-${++nextId}` };
  const response = new ResponseStream(host);
  const prompt: ChatMessage = { id: 'prompt', role: 'user', content: 'Read the note', timestamp: testDate().getTime() };
  state.addMessage(prompt);
  renderer.addMessage(prompt);
  cleanups.push(() => { stream.dispose(); subagents.clear(); renderer.dispose(); });
  return { messagesEl, renderer, state, stream, host, response };
}

/** Text a reader sees in an element, skipping collapsed disclosure content. */
function visibleText(element: HTMLElement): string {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest('[hidden]') && node.textContent?.trim()) parts.push(node.textContent.trim());
  }
  return parts.join(' ');
}

const INTERRUPTED = 'Interrupted · What should Kirodian do instead?';

/** The interrupted turn as a reader sees it, collapsed and then expanded. */
function inspectInterruptedTurn(root: HTMLElement, folded: RegExp[]) {
  const header = within(root).getByRole('button', { name: INTERRUPTED });
  const history = document.getElementById(header.getAttribute('aria-controls')!)!;
  const turn = Array.from(root.querySelectorAll<HTMLElement>('.claudian-message-assistant'))
    .filter(message => visibleText(message.querySelector<HTMLElement>('.claudian-message-content')!));
  const collapsed = { expanded: header.getAttribute('aria-expanded'), visible: turn.map(message =>
    visibleText(message.querySelector<HTMLElement>('.claudian-message-content')!)),
  actions: turn.flatMap(message => within(message).queryAllByRole('button', { name: /^(Copy message|Fork conversation)$/ })).length,
  header: [header.querySelector('.claudian-interrupted')?.textContent, header.querySelector('.claudian-interrupted-hint')?.textContent] };
  fireEvent.click(header);
  const items = folded.map(pattern => within(history).getByText(pattern));
  const ordered = items.every((item, index) => index === 0
    || (items[index - 1].compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
  const expanded = { expanded: header.getAttribute('aria-expanded'), ordered, hidden: history.hidden,
    // The header carries the indicator; the body never repeats it.
    indicatorInBody: history.querySelector('.claudian-interrupted, .claudian-interrupted-hint') !== null,
    worked: within(root).queryAllByRole('button', { name: /^Worked/ }).length };
  fireEvent.click(header);
  return { collapsed, expanded };
}

const expectedTurn = {
  collapsed: { expanded: 'false', visible: [INTERRUPTED], actions: 0, header: ['Interrupted', '· What should Kirodian do instead?'] },
  expanded: { expanded: 'true', ordered: true, hidden: false, indicatorInBody: false, worked: 0 },
};

// Kiro's native history records no interruption marker, so the cross-provider on-disk reload
// columns are dropped with the deleted providers that recorded a stop in their transcript.
// The stop-fold contract stays proven by the live render and the structural rerender from
// the in-memory message list, which is what every reload ultimately produces.
it('collapses a stopped turn under Interrupted and renders it identically on rerender', async () => {
  const session = createSession();
  const { response, stream, messagesEl, renderer, state } = session;
  const live = response.start();
  await stream.handleStreamChunk({ type: 'tool_use', id: 'read', name: 'Read', input: { file_path: 'note.md' } }, live);
  await stream.handleStreamChunk({ type: 'tool_result', id: 'read', content: 'The note.' }, live);
  await stream.handleStreamChunk({ type: 'text', content: 'Partial answer' }, live);
  await response.finish(live, { interrupted: true, failed: false });
  await Promise.resolve();

  const folded = [/^Partial answer$/];
  const tool = () => within(messagesEl).getByRole('button', { name: /Read.*note\.md/, hidden: true });
  const liveResult = inspectInterruptedTurn(messagesEl, folded);
  expect(liveResult).toEqual(expectedTurn);
  expect(live.durationSeconds).toBeUndefined();
  expect(tool().closest('[hidden]')).not.toBeNull();
  expect((await axe(messagesEl)).violations).toEqual([]);

  renderer.renderMessages(state.messages, () => 'Welcome');
  await Promise.resolve();
  expect(inspectInterruptedTurn(messagesEl, folded)).toEqual(liveResult);
  expect(tool().closest('[hidden]')).not.toBeNull();
});

// The deleted providers recorded a compaction boundary and a stop in their on-disk transcript,
// so their reload columns are dropped; kiro has no such marker. The compaction-fold contract
// stays proven live and on the structural rerender from the in-memory message list.
it.each([true, false])('folds a turn stopped across compaction live and on rerender (output after compaction: %s)', async after => {
  const { response, stream, messagesEl, renderer, state } = createSession();
  const live = response.start();
  await stream.handleStreamChunk({ type: 'text', content: 'Before compaction.' }, live);
  await stream.handleStreamChunk({ type: 'tool_use', id: 'read', name: 'Read', input: { file_path: 'note.md' } }, live);
  await stream.handleStreamChunk({ type: 'tool_result', id: 'read', content: 'The note.' }, live);
  await stream.handleStreamChunk({ type: 'context_compacted' }, live);
  if (after) await stream.handleStreamChunk({ type: 'text', content: 'After compaction.' }, live);
  await response.finish(live, { interrupted: true, failed: false });
  await Promise.resolve();
  const folded = [/^Before compaction\.$/, /^Conversation compacted$/, ...(after ? [/^After compaction\.$/] : [])];
  const liveResult = inspectInterruptedTurn(messagesEl, folded);
  expect(liveResult).toEqual(expectedTurn);

  renderer.renderMessages(state.messages, () => 'Welcome');
  await Promise.resolve();
  expect(inspectInterruptedTurn(messagesEl, folded)).toEqual(liveResult);
});

it('folds every segment of a stopped turn continued after a notification, live and on rerender', async () => {
  const session = createSession();
  const { response, stream, messagesEl, renderer, state, host } = session;
  const first = response.start();
  await stream.handleStreamChunk({ type: 'tool_use', id: 'read', name: 'Read', input: { file_path: 'note.md' } }, first);
  await stream.handleStreamChunk({ type: 'tool_result', id: 'read', content: 'The note.' }, first);
  renderSessionTaskNotification(host, 'Task finished.');
  const chunk = { type: 'text' as const, content: 'Partial answer' };
  const continuation = await continueResponseAfterNotification(host, first, chunk);
  expect(continuation).not.toBe(first);
  await stream.handleStreamChunk(chunk, continuation);
  await response.finish(continuation, { interrupted: true, failed: false });
  await Promise.resolve();

  const folded = [/^Task notification$/, /^Partial answer$/];
  const liveResult = inspectInterruptedTurn(messagesEl, folded);
  expect(liveResult).toEqual(expectedTurn);
  const header = within(messagesEl).getByRole('button', { name: INTERRUPTED });
  const history = document.getElementById(header.getAttribute('aria-controls')!)!;
  expect(history.contains(within(messagesEl).getByRole('button', { name: /Read.*note\.md/, hidden: true }))).toBe(true);
  expect((await axe(messagesEl)).violations).toEqual([]);

  renderer.renderMessages(state.messages, () => 'Welcome');
  await Promise.resolve();
  expect(inspectInterruptedTurn(messagesEl, folded)).toEqual(liveResult);
});

it('keeps a notification that followed the stopped run\'s terminal event out of its fold', async () => {
  const { response, messagesEl, host, state } = createSession();
  response.start();
  const scope = (sequence: number) => ({ kind: 'requested' as const, sessionInstanceId: 'native', executionId: 'execution', turnId: 'turn', sequence });
  await response.handleEvent({ type: 'text_delta', text: 'Partial answer', scope: scope(1) });
  renderSessionTaskNotification(host, 'During the run.', scope(1));
  // The run's terminal event (sequence 2) never reaches the response; this notification followed it.
  renderSessionTaskNotification(host, 'After the run.', scope(2));
  await response.finish(response.active!, { interrupted: true, failed: false });
  await Promise.resolve();
  const after = state.messages.find(message => message.contentBlocks?.some(block => block.type === 'task_notification' && block.content === 'After the run.'))!;
  expect(after.isInterrupt).toBeUndefined();
  const header = within(messagesEl).getByRole('button', { name: INTERRUPTED });
  const history = document.getElementById(header.getAttribute('aria-controls')!)!;
  expect(within(messagesEl).getAllByRole('button', { name: 'Task notification', hidden: true })
    .map(button => history.contains(button))).toEqual([true, false]);
});

it('keeps a failed turn expanded', async () => {
  const { response, stream, messagesEl } = createSession();
  const live = response.start();
  await stream.handleStreamChunk({ type: 'tool_use', id: 'read', name: 'Read', input: { file_path: 'note.md' } }, live);
  await stream.handleStreamChunk({ type: 'text', content: 'Partial answer' }, live);
  await response.finish(live, { interrupted: false, failed: true });
  expect(within(messagesEl).getByRole('button', { name: /Read.*note\.md/ })).toBeDefined();
  expect(within(messagesEl).getByText('Partial answer').closest('[hidden]')).toBeNull();
  expect(within(messagesEl).queryByRole('button', { name: /^(Interrupted|Worked)/ })).toBeNull();
  const reply = messagesEl.querySelector<HTMLElement>(`[data-message-id="${live.id}"]`)!;
  expect(within(reply).getByRole('button', { name: 'Copy message' })).toBeDefined();
});
