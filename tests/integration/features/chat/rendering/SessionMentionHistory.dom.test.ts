/** @jest-environment jsdom */
import '@/providers';

import * as fs from 'node:fs/promises';

import { testTime } from '@test/helpers/testClock';
import { within } from '@testing-library/dom';
import { Component, MarkdownRenderer } from 'obsidian';

import type { ChatMessage } from '@/core/types';
import { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';
import { loadSDKSessionMessages } from '@/providers/claude/history/ClaudeHistoryStore';

jest.mock('node:fs/promises');

const prompt = 'ref @"Review"\n\n<context_sessions>\n<context_session title="Review" id="conv-1-ref" provider="claude" updated="updated" path="/tmp/claudian-sessions/private.md" />\n</context_sessions>';

beforeEach(() => {
  HTMLElement.prototype.empty = function () { this.replaceChildren(); };
  HTMLElement.prototype.addClass = function (...names) { this.classList.add(...names); };
  HTMLElement.prototype.removeClass = function (...names) { this.classList.remove(...names); };
  jest.mocked(MarkdownRenderer.render).mockImplementation(async (_app, markdown, el) => {
    el.createEl('p', { text: markdown });
  });
});

it('hides snapshot XML after claude native history reload', async () => {
  jest.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ type: 'user', uuid: 'u', timestamp: testTime(), message: { content: prompt } }));
  const messages: ChatMessage[] = (await loadSDKSessionMessages('/vault', 'session', undefined, '/session.jsonl')).messages;
  expect(messages).toHaveLength(1);
  const parent = document.body.createDiv();
  const renderer = new MessageRenderer({ app: {}, settings: { mediaFolder: '', showMessageTimestamps: false } } as never, new Component(), parent);
  try {
    renderer.renderStoredMessage(messages[0], messages, 0);
    await Promise.resolve();
    expect(within(parent).getByText('ref @"Review"')).toBeTruthy();
    expect(parent.textContent).not.toContain('context_sessions');
    expect(parent.textContent).not.toContain('private.md');
  } finally { renderer.dispose(); parent.remove(); }
});
