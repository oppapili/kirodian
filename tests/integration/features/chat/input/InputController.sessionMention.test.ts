import '@/providers';

import { createHarness, FakeSession, requestedScope } from '@test/helpers/ChatExecutionHarness';
import { createFixture, deferred, waitForCall } from '@test/helpers/ChatInputHarness';
import { testDate } from '@test/helpers/testClock';
import { Notice } from 'obsidian';

import { cancelSelectedDestinationTurn } from '@/features/chat/tabs/TabInputEvents';

const id = 'conv-1-source';
const token = `@[Old title](claudian-session:${id})`;
const time = testDate().getTime();

function setup() {
  const native = createHarness();
  const fixture = createFixture({ getExecutionCoordinator: () => native.coordinator, getTabProviderId: () => 'kiro' });
  Object.assign(fixture.plugin, { findConversationAcrossViews: () => null });
  fixture.plugin.getConversationById.mockResolvedValue({
    id, title: 'Current title', providerId: 'kiro', createdAt: time, lastActivityAt: time,
    sessionId: 'native-source', messages: [
      { id: 'u', role: 'user', content: 'verbatim prompt', timestamp: time },
      { id: 'a', role: 'assistant', content: 'final answer', timestamp: time },
    ],
  } as never);
  return { ...fixture, native };
}

beforeEach(() => {
  const execute = FakeSession.prototype.execute;
  vi.spyOn(FakeSession.prototype, 'execute').mockImplementation(function (this: FakeSession, request) {
    const result = execute.call(this, request);
    const run = this.runs.at(-1)!;
    run.events.push({ type: 'turn_started', accepted: true, scope: requestedScope(this, run, 1) });
    run.events.push({ type: 'turn_completed', scope: requestedScope(this, run, 2), reason: 'completed' });
    run.events.end();
    return result;
  });
});
afterEach(() => vi.restoreAllMocks());

it.each([false, true])('resolves current titles once and carries snapshots through real handoff (queued: %s)', async queued => {
  const fixture = setup();
  await fixture.native.coordinator.bindConversation({ conversationId: 'conversation-1', providerId: 'kiro' });
  try {
    const releaseTurn = queued ? fixture.holdResponse() : async () => undefined;
    fixture.input.value = `Use ${token} and ${token}`;
    await fixture.controller.sendMessage();
    if (queued) {
      await releaseTurn();
      fixture.controller.queue.scheduleContinuation();
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const request = fixture.native.backends.get('kiro')!.sessions.flatMap(session => session.requests)[0];
    expect(request.input).toEqual([{ type: 'text', text: 'Use @"Current title" and @"Current title"' }]);
    expect(request.context?.sessionReferences).toEqual([{
      id, title: 'Current title', providerId: 'kiro', updatedAt: new Date(time).toISOString(),
    }]);
    // Mentions are id references the agent reads with the read-session tool; no snapshot file is written and no extra readable root is granted.
    expect(request.configuration).not.toHaveProperty('readableRoots');
    expect(fixture.plugin.getConversationById).toHaveBeenCalledTimes(1);
    const user = fixture.state.messages.find(message => message.role === 'user');
    expect(user?.displayContent).toBe('Use @"Current title" and @"Current title"');
    expect(user?.executionInput?.context?.sessionReferences).toEqual(request.context?.sessionReferences);
  } finally { await fixture.native.coordinator.dispose(); await fixture.native.registry.dispose(); }
});

it('preserves the original token draft when the session cannot be loaded', async () => {
  const fixture = setup();
  try {
    fixture.plugin.getConversationById.mockResolvedValue(null);
    fixture.input.value = token;
    await fixture.controller.sendMessage();
    expect(fixture.input.value).toBe(token);
    expect(fixture.state.messages).toEqual([]);
    expect(Notice).toHaveBeenCalledWith(expect.stringContaining('Old title'));
    expect(fixture.native.backends.get('kiro')!.sessions).toHaveLength(0);
  } finally { await fixture.native.coordinator.dispose(); await fixture.native.registry.dispose(); }
});

it('does not send to a replaced conversation while hydration is pending', async () => {
  const fixture = setup();
  const gate = deferred<never>();
  fixture.plugin.getConversationById.mockReturnValue(gate.promise);
  fixture.input.value = token;
  const sending = fixture.controller.sendMessage();
  await waitForCall(fixture.plugin.getConversationById);
  fixture.state.currentConversationId = 'replacement';
  gate.resolve(null as never);
  await sending;
  expect(fixture.input.value).toBe(token);
  expect(fixture.native.backends.get('kiro')!.sessions).toHaveLength(0);
  await fixture.native.coordinator.dispose(); await fixture.native.registry.dispose();
});

it('restores a plain follow-up queued during failed snapshot preparation', async () => {
  const fixture = setup();
  const gate = deferred<never>();
  fixture.plugin.getConversationById.mockReturnValue(gate.promise);
  try {
    fixture.input.value = token;
    const sending = fixture.controller.sendMessage();
    await waitForCall(fixture.plugin.getConversationById);
    fixture.input.value = 'plain follow-up';
    await fixture.controller.sendMessage();
    expect(fixture.state.queuedMessage?.content).toBe('plain follow-up');
    gate.reject(new Error('history missing'));
    await sending;
    expect(fixture.state.queuedMessage).toBeNull();
    expect(fixture.input.value).toContain(token);
    expect(fixture.input.value).toContain('plain follow-up');
  } finally { await fixture.native.coordinator.dispose(); await fixture.native.registry.dispose(); }
});


it('cancels and drains queued snapshot preparation before tab shutdown finishes', async () => {
  const fixture = setup();
  const session = fixture.session;
  const gate = deferred<any>();
  const source = await fixture.plugin.getConversationById(id);
  fixture.plugin.getConversationById.mockClear().mockReturnValue(gate.promise);
  fixture.holdResponse();
  fixture.input.value = token;
  const sending = fixture.controller.sendMessage();
  await waitForCall(fixture.plugin.getConversationById);
  let stopped = false;
  session.beginShutdown();
  const draining = fixture.controller.drainSessionMentionPreparations().then(() => { stopped = true; });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(stopped).toBe(false);
  gate.resolve(source);
  await Promise.all([sending, draining]);
  expect(fixture.state.queuedMessage).toBeNull();
  expect(fixture.input.value).toBe(token);
  expect(fixture.native.backends.get('kiro')!.sessions).toHaveLength(0);
  await fixture.native.coordinator.dispose(); await fixture.native.registry.dispose();
});

it.each([false, true])('restores prepared drafts when rewind begins during hydration (plain follow-up: %s)', async followUp => {
  const fixture = setup();
  const hydration = deferred<any>();
  const initialization = deferred<boolean>();
  const source = await fixture.plugin.getConversationById(id);
  fixture.plugin.getConversationById.mockClear().mockReturnValue(hydration.promise);
  const initialize = vi.fn().mockReturnValue(initialization.promise);
  fixture.deps.ensureExecutionInitialized = initialize;
  const conversation = fixture.deps.conversationController;
  fixture.state.messages = [
    { id: 'previous-user', role: 'user', content: 'previous prompt', userMessageId: 'native-user', timestamp: time },
    { id: 'previous-assistant', role: 'assistant', content: 'previous answer', assistantMessageId: 'native-assistant', timestamp: time },
  ];
  const releaseTurn = fixture.holdResponse();
  fixture.input.value = token;
  const sending = fixture.controller.sendMessage();
  await waitForCall(fixture.plugin.getConversationById);
  let following: Promise<void> | undefined;
  if (followUp) {
    fixture.input.value = 'later plain follow-up';
    following = fixture.controller.sendMessage();
  }
  expect(fixture.input.value).toBe('');
  await releaseTurn();
  const rewinding = conversation.rewind('previous-user', 'conversation');
  try {
    await waitForCall(initialize);
    expect(fixture.state.isRewinding).toBe(true);
    hydration.resolve(source);
    await Promise.all([sending, following]);
    expect(fixture.native.backends.get('kiro')!.sessions).toHaveLength(0);
    expect(fixture.state.queuedMessage).toBeNull();
    expect(fixture.input.value.split('\n\n').sort()).toEqual(
      (followUp ? [token, 'later plain follow-up'] : [token]).sort(),
    );
  } finally {
    initialization.resolve(false);
    await rewinding;
    await fixture.native.coordinator.dispose();
    await fixture.native.registry.dispose();
  }
});

function holdNativeTurns() {
  vi.restoreAllMocks();
  const execute = FakeSession.prototype.execute;
  return vi.spyOn(FakeSession.prototype, 'execute').mockImplementation(function (this: FakeSession, request) {
    const result = execute.call(this, request);
    const run = this.runs.at(-1)!;
    run.events.push({ type: 'turn_started', accepted: true, scope: requestedScope(this, run, 1) });
    return result;
  });
}

function finishNativeTurn(session: FakeSession, index: number) {
  const run = session.runs[index];
  run.events.push({ type: 'turn_completed', scope: requestedScope(session, run, 2), reason: 'completed' });
  run.events.end();
}

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 100 && !check(); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  expect(check()).toBe(true);
}



it.each(['withdraw', 'cancel', 'initialization'])('restores token text and refreshes references after %s', async recovery => {
  const fixture = setup();
  await fixture.native.coordinator.bindConversation({ conversationId: 'conversation-1', providerId: 'kiro' });
  try {
    const releaseTurn = recovery !== 'initialization' ? fixture.holdResponse() : async () => undefined;
    if (recovery === 'initialization') fixture.deps.ensureExecutionInitialized = async () => false;
    fixture.input.value = token;
    await fixture.controller.sendMessage();
    if (recovery !== 'initialization') {
      fixture.input.value = 'plain follow-up';
      await fixture.controller.sendMessage();
      if (recovery === 'withdraw') fixture.controller.queue.withdrawToComposer();
      else fixture.controller.cancelStreaming();
    }
    const suffix = recovery === 'initialization' ? '' : '\n\nplain follow-up';
    expect(fixture.input.value).toBe(token + suffix);
    await releaseTurn();
    fixture.deps.ensureExecutionInitialized = async () => true;
    await fixture.controller.sendMessage();
    expect(fixture.plugin.getConversationById).toHaveBeenCalledTimes(2);
    const request = fixture.native.backends.get('kiro')!.sessions.flatMap(session => session.requests)[0];
    expect(request.input).toEqual([{ type: 'text', text: '@"Current title"' + suffix }]);
    expect(request.context?.sessionReferences?.[0].id).toBe(id);
  } finally { await fixture.native.coordinator.dispose(); await fixture.native.registry.dispose(); }
});


it.each(['cancel', 'withdraw', 'discard', 'shutdown', 'replacement'] as const)(
  'retains scheduled queued input through %s without a stray handoff', async action => {
    vi.useFakeTimers();
    const fixture = setup();
    const session = fixture.session;
    fixture.deps.canStartTurn = () => session.acceptsIntents;
    await fixture.native.coordinator.bindConversation({ conversationId: 'conversation-1', providerId: 'kiro' });
    try {
      const releaseTurn = fixture.holdResponse();
      fixture.input.value = token;
      await fixture.controller.sendMessage();
      await releaseTurn();
      fixture.controller.queue.scheduleContinuation();
      switch (action) {
        case 'cancel': fixture.controller.cancelStreaming(); break;
        case 'withdraw': fixture.controller.queue.withdrawToComposer(); break;
        case 'discard': fixture.controller.queue.clear(); break;
        case 'replacement': fixture.state.currentConversationId = 'replacement'; break;
        case 'shutdown': session.beginShutdown(); break;
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(fixture.native.backends.get('kiro')!.sessions.flatMap(value => value.requests).length).toBe(0);
      expect(fixture.input.value).toBe(['cancel', 'withdraw', 'replacement'].includes(action) ? token : '');
      expect(fixture.native.backends.get('kiro')!.sessions.flatMap(value => value.requests)
        .map(request => request.context?.sessionReferences?.[0].id)).toEqual([]);
    } finally {
      fixture.controller.queue.clear();
      await fixture.native.coordinator.dispose(); await fixture.native.registry.dispose();
      vi.useRealTimers();
    }
  },
);

it('cancels a still-hydrating queued mention after the active turn completes', async () => {
  const execute = holdNativeTurns();
  const fixture = setup();
  const source = await fixture.plugin.getConversationById(id);
  const hydration = deferred<any>();
  fixture.plugin.getConversationById.mockClear().mockReturnValue(hydration.promise);
  await fixture.native.coordinator.bindConversation({ conversationId: 'conversation-1', providerId: 'kiro' });
  fixture.input.value = 'active turn';
  const active = fixture.controller.sendMessage();
  await until(() => execute.mock.calls.length > 0);
  const session = fixture.native.backends.get('kiro')!.sessions[0];
  fixture.input.value = token;
  const mention = fixture.controller.sendMessage();
  await waitForCall(fixture.plugin.getConversationById);
  finishNativeTurn(session, 0);
  await active;
  const cancelled = cancelSelectedDestinationTurn({
    state: fixture.state,
    controllers: { inputController: fixture.controller, sideChatController: { destination: 'main' } },
  } as never);
  hydration.resolve(source);
  for (let tick = 0; tick < 100; tick++) await new Promise(resolve => setTimeout(resolve, 1));
  session.runs.forEach(run => run.cancel());
  await mention;
  await fixture.native.coordinator.dispose(); await fixture.native.registry.dispose();
  expect({ cancelled, submittedTurns: session.requests.length, draft: fixture.input.value })
    .toEqual({ cancelled: true, submittedTurns: 1, draft: token });
});
