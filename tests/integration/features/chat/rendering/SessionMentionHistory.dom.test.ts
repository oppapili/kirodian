/** @vitest-environment jsdom */
import '@/providers';

import { testDate } from '@test/helpers/testClock';
import { within } from '@testing-library/dom';
import { Component, MarkdownRenderer } from 'obsidian';

import type { ChatMessage } from '@/core/types';
import { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';

const prompt = 'ref @"Review"\n\n<context_sessions>\n<context_session title="Review" id="conv-1-ref" provider="kiro" updated="updated" path="/tmp/kiro-sessions/private.md" />\n</context_sessions>';

beforeEach(() => {
  HTMLElement.prototype.empty = function () { this.replaceChildren(); };
  HTMLElement.prototype.addClass = function (...names) { this.classList.add(...names); };
  HTMLElement.prototype.removeClass = function (...names) { this.classList.remove(...names); };
  vi.mocked(MarkdownRenderer.render).mockImplementation(async (_app, markdown, el) => {
    el.createEl('p', { text: markdown });
  });
});

it('hides snapshot XML when rendering a stored user message with a context-session snapshot', async () => {
  // Neutral renderer contract: a stored user message carrying a <context_sessions>
  // snapshot shows the author's prompt but not the snapshot XML or its paths.
  const messages: ChatMessage[] = [
    { id: 'u', role: 'user', content: prompt, timestamp: testDate().getTime() },
  ];
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
