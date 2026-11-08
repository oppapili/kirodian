/** @vitest-environment jsdom */
import '@/providers';

import { axe } from '@test/helpers/accessibility';
import { createEvent, fireEvent, waitFor, within } from '@testing-library/dom';
import { Notice } from 'obsidian';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { ProviderQuestionReply } from '@/core/providers/types';
import type { AskUserAnswers, ToolCallInfo } from '@/core/types';
import { deliverAsyncQuestion } from '@/features/chat/interactions/asyncQuestionDelivery';
import { SessionInteractions } from '@/features/chat/interactions/SessionInteractions';
import { setLocale } from '@/i18n/i18n';


afterEach(() => { document.body.replaceChildren(); setLocale('en'); });

it('makes long approval details a named keyboard-scrollable region', async () => {
  const parent = document.body.createDiv();
  const suppressed = parent.createDiv();
  const prompts = new SessionInteractions({ getPromptParentEl: () => parent, getSuppressedEl: () => suppressed });
  const pending = prompts.requestApproval('approval-id', 'Bash', {}, 'A long command description');
  const details = within(parent).getByRole('region', { name: 'Bash approval details' });
  details.focus();
  expect(document.activeElement).toBe(details);
  const parentKeyDown = vi.fn();
  parent.addEventListener('keydown', parentKeyDown);
  for (const key of ['ArrowDown', 'Enter']) {
    const event = createEvent.keyDown(details, { key });
    fireEvent(details, event);
    expect(event.defaultPrevented).toBe(false);
  }
  expect(parentKeyDown).not.toHaveBeenCalled();
  expect(await axe(parent)).toHaveNoViolations();
  prompts.dismiss('approval-id');
  await pending;
});

it('resumes the newest response when an older generation prompt settles last', async () => {
  const parent = document.body.createDiv();
  let generation = 1;
  const resumed: number[] = [];
  const prompts = new SessionInteractions({
    getPromptParentEl: () => parent,
    onBeforeShow: () => {
      const shownGeneration = generation;
      return () => resumed.push(shownGeneration);
    },
  });
  const question = { questions: [{ id: '0', question: 'Which check?', options: [{ label: 'History' }] }] };
  const first = prompts.askUserQuestion('first', question);
  generation = 2;
  const second = prompts.askUserQuestion('second', question);
  prompts.dismiss('second');
  await second;
  expect(resumed).toEqual([]);
  prompts.dismiss('first');
  await first;
  expect(resumed).toEqual([2]);
});

it('keeps an approval requested without a view pending until the user answers after attachment', async () => {
  let parent: HTMLElement | null = null;
  const prompts = new SessionInteractions({ getPromptParentEl: () => parent });
  let settled = false;
  const pending = prompts.requestApproval('approval', 'Bash', {}, 'Run the check').finally(() => { settled = true; });
  void pending.catch(() => undefined);
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toBe(false);
  parent = document.body.createDiv();
  prompts.setActive(true);
  fireEvent.click(within(parent).getByRole('button', { name: 'Allow once' }));
  await expect(pending).resolves.toBe('allow');
});

it('keeps answer drafts and an in-flight submission across presentation disposal', async () => {
  let parent = document.body.createDiv();
  const prompts = new SessionInteractions({ getPromptParentEl: () => parent });
  let fail!: (error: Error) => void;
  const delivery = new Promise<void>((_resolve, reject) => { fail = reject; });
  const answer = vi.fn().mockReturnValueOnce(delivery).mockResolvedValue(undefined);
  let settled = false;
  const pending = prompts.askUserQuestion('question', { questions: [
    { id: 'scope', question: 'Which scope?', isOther: true, options: [{ label: 'All' }] },
  ] }, undefined, { onSubmit: answer }).finally(() => { settled = true; });
  const draft = within(parent).getByRole('textbox', { name: 'Which scope?' });
  fireEvent.input(draft, { target: { value: 'Only this file' } });
  prompts.detachPresentation();
  parent.remove();
  parent = document.body.createDiv();
  prompts.setActive(true);
  expect((within(parent).getByRole('textbox', { name: 'Which scope?' }) as HTMLInputElement).value).toBe('Only this file');
  fireEvent.click(within(parent).getByRole('button', { name: 'Submit' }));
  fireEvent.click(within(parent).getByRole('button', { name: 'Submit answers' }));
  expect(answer).toHaveBeenCalledTimes(1);
  prompts.detachPresentation();
  parent.remove();
  parent = document.body.createDiv();
  prompts.setActive(true);
  expect((within(parent).getByRole('button', { name: 'Sending...' }) as HTMLButtonElement).disabled).toBe(true);
  expect(settled).toBe(false);
  fail(new Error('Definitely not sent'));
  await Promise.resolve();
  await Promise.resolve();
  expect(within(parent).getByRole('alert').textContent).toBe('Definitely not sent');
  fireEvent.click(within(parent).getByRole('button', { name: 'Submit answers' }));
  await expect(pending).resolves.toEqual({ scope: 'Only this file' });
  expect(answer).toHaveBeenCalledTimes(2);
});


// Kiro answers questions inline over the native protocol and registers no `formatQuestionReply`, so an
// async user-message reply is always unsupported. To exercise the generic delivery pipeline's steer/submit
// localization (the behavior under test), stub the narrow provider reply port with a stand-in formatter.
function stubKiroQuestionReply(): void {
  vi.spyOn(ProviderRegistry, 'formatQuestionReply').mockImplementation(
    (_providerId, _tool, answers: AskUserAnswers): ProviderQuestionReply | null => ({
      content: Object.values(answers).map(answer => Array.isArray(answer) ? answer.join(', ') : answer).join('\n'),
      displayContent: '',
    }),
  );
}

it.each([
  ['rejected', '回答未发送，请重试。'],
  ['unsupported', '此问题无法接受该回答。'],
] as const)('shows a localized %s delivery failure in the real question panel', async (failure, expected) => {
  setLocale('zh-CN');
  // Kiro has no `formatQuestionReply`, so delivery is unsupported out of the box; a reply stub drives the rejected path.
  if (failure === 'rejected') stubKiroQuestionReply();
  const parent = document.body.createDiv();
  const prompts = new SessionInteractions({ getPromptParentEl: () => parent });
  const tool: ToolCallInfo = { id: 'question', name: 'AskUserQuestion', status: 'completed', questionStatus: 'pending', input: {
    replyMode: 'user-message', questions: [{ id: '0', question: 'Which check?', options: [{ label: 'History' }] }],
  } };
  const steer = vi.fn(async (onDelivery: (accepted: boolean) => void) => { onDelivery(false); return 'accepted' as const; });
  const submit = vi.fn();
  const pending = prompts.askUserQuestion('question', tool.input, undefined, {
    onSubmit: answers => deliverAsyncQuestion(tool, answers, {
      providerId: 'kiro', assertCurrent: () => undefined,
      prepare: () => ({ steer, submit }),
    }),
  });
  try {
    const region = within(parent).getByRole('region', { name: '问题' });
    fireEvent.click(within(region).getByRole('button', { name: 'History' }));
    fireEvent.click(within(region).getByRole('button', { name: '提交回答' }));
    await waitFor(() => expect(within(region).getByRole('alert').textContent).toBe(expected));
    expect(within(region).getByText('History')).toBeDefined();
    expect(submit).not.toHaveBeenCalled();
    expect(await axe(region)).toHaveNoViolations();
  } finally {
    prompts.dismiss('question');
    await pending;
    vi.restoreAllMocks();
  }
});

it('localizes uncertain answer-delivery feedback without requeueing the native reply', async () => {
  setLocale('zh-CN');
  stubKiroQuestionReply();
  const tool: ToolCallInfo = { id: 'question', name: 'AskUserQuestion', status: 'completed', questionStatus: 'pending', input: {
    replyMode: 'user-message', questions: [{ id: '0', question: 'Which check?', options: [{ label: 'History' }] }],
  } };
  const submit = vi.fn();
  const prepare = vi.fn((_reply: { content: string }) => ({ steer: async () => 'uncertain' as const, submit }));
  try {
    await deliverAsyncQuestion(tool, { '0': 'History' }, { providerId: 'kiro', assertCurrent: () => undefined, prepare });
    expect(Notice).toHaveBeenCalledWith('无法确认回答是否送达。为避免重复发送，未将其重新加入队列。');
    expect(submit).not.toHaveBeenCalled();
    expect(prepare.mock.calls[0][0].content).toContain('History');
  } finally {
    vi.restoreAllMocks();
  }
});
