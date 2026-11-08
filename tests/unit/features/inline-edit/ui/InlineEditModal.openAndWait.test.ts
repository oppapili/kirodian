import '@/providers';

import { createMockEl } from '@test/helpers/MockElement';
import { MarkdownRenderer, Notice } from 'obsidian';
import type { Mock } from 'vitest';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { InlineEditSessionOwner } from '@/features/inline-edit/InlineEditSessionOwner';
import { type InlineEditContext, InlineEditModal } from '@/features/inline-edit/ui/InlineEditModal';
import { VaultFolderCache } from '@/shared/mention/VaultMentionCache';
import * as obsidianCompat from '@/utils/obsidianCompat';

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function createInertInlineEditService() {
  return {
    send: vi.fn(),
    end: vi.fn(),
  };
}

describe('InlineEditModal - openAndWait', () => {
  let owner: InlineEditSessionOwner;
  beforeEach(() => {
    owner = new InlineEditSessionOwner();
    vi.clearAllMocks();
    vi.spyOn(ProviderWorkspaceRegistry, 'ensureInitialized').mockResolvedValue(undefined);
    vi
      .spyOn(ProviderRegistry, 'createInlineEditService')
      .mockReturnValue(createInertInlineEditService() as any);
  });

  afterEach(() => {
    owner.dispose();
    vi.restoreAllMocks();
  });

  it('uses editorCallback references first and falls back to view.editor before rejecting', async () => {
    const callbackEditor = {} as any;
    const fallbackEditor = {} as any;

    const app = {
      workspace: {
        getActiveViewOfType: vi.fn(),
      },
    } as any;
    const plugin = {} as any;
    const view = { editor: fallbackEditor } as any;

    const editContext: InlineEditContext = {
      mode: 'cursor',
      cursorContext: {
        beforeCursor: '',
        afterCursor: '',
        isInbetween: true,
        line: 0,
        column: 0,
      },
    };

    const getEditorViewSpy = vi
      .spyOn(obsidianCompat, 'getEditorView')
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined);

    const modal = new InlineEditModal(app, plugin, plugin, callbackEditor, view, editContext, 'note.md', owner);
    const result = await modal.openAndWait();

    expect(result).toEqual({ decision: 'reject' });
    expect(getEditorViewSpy).toHaveBeenNthCalledWith(1, callbackEditor);
    expect(getEditorViewSpy).toHaveBeenNthCalledWith(2, fallbackEditor);
    expect(app.workspace.getActiveViewOfType).not.toHaveBeenCalled();

    const noticeMock = Notice as unknown as Mock;
    expect(noticeMock).toHaveBeenCalledWith(
      'Inline edit unavailable: could not access the active editor. Try reopening the note.'
    );
  });

  it('uses an enabled settings provider when no chat tab is open', async () => {
    const editor = {} as any;
    const app = {} as any;
    const plugin = {
      settings: {
        settingsProvider: 'claude',
        providerConfigs: {
          claude: { enabled: false },
          kiro: { enabled: true },
        },
      },
      getView: vi.fn().mockReturnValue(null),
    } as any;
    plugin.providerHost = plugin;
    const view = { editor } as any;
    const editContext: InlineEditContext = {
      mode: 'cursor',
      cursorContext: {
        beforeCursor: '',
        afterCursor: '',
        isInbetween: true,
        line: 0,
        column: 0,
      },
    };

    vi.spyOn(obsidianCompat, 'getEditorView').mockReturnValue({ dispatch: vi.fn() } as any);
    vi.spyOn(ProviderWorkspaceRegistry, 'ensureInitialized')
      .mockRejectedValue(new Error('stop after provider resolution'));

    const modal = new InlineEditModal(app, plugin, plugin, editor, view, editContext, 'note.md', owner);

    await expect(modal.openAndWait()).resolves.toEqual({ decision: 'reject' });
    expect(ProviderWorkspaceRegistry.ensureInitialized).toHaveBeenCalledWith(
      plugin,
      'kiro',
      'inline-edit',
    );
  });

  it('uses an enabled settings provider when the active conversation provider is disabled', async () => {
    const editor = {} as any;
    const app = {} as any;
    const plugin = {
      settings: {
        settingsProvider: 'kiro',
        providerConfigs: {
          claude: { enabled: false },
          kiro: { enabled: true },
        },
      },
      getConversationSync: vi.fn().mockReturnValue({
        id: 'claude-conversation',
        providerId: 'claude',
        selectedModel: 'sonnet',
      }),
      getView: vi.fn().mockReturnValue({
        getActiveTab: vi.fn().mockReturnValue({
          conversationId: 'claude-conversation',
          providerId: 'claude',
          selectedModel: 'sonnet',
        }),
      }),
    } as any;
    plugin.providerHost = plugin;
    const view = { editor } as any;
    const editContext: InlineEditContext = {
      mode: 'cursor',
      cursorContext: {
        beforeCursor: '',
        afterCursor: '',
        isInbetween: true,
        line: 0,
        column: 0,
      },
    };

    vi.spyOn(obsidianCompat, 'getEditorView').mockReturnValue({ dispatch: vi.fn() } as any);
    vi.spyOn(ProviderWorkspaceRegistry, 'ensureInitialized')
      .mockRejectedValue(new Error('stop after provider resolution'));

    const modal = new InlineEditModal(app, plugin, plugin, editor, view, editContext, 'note.md', owner);

    await expect(modal.openAndWait()).resolves.toEqual({ decision: 'reject' });
    expect(ProviderWorkspaceRegistry.ensureInitialized).toHaveBeenCalledWith(
      plugin,
      'kiro',
      'inline-edit',
    );
  });

  it('debounces Inline Edit Vault mention loading through the shared dropdown', async () => {
    vi.useFakeTimers();
    const originalDocument = (global as any).document;
    (global as any).document = {
      body: createMockEl('body'),
      createElement: (tagName: string) => createMockEl(tagName),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      // The merged composer installs its accept/reject key handler on the document's
      // defaultView, so the fake document exposes one with the window listener API.
      defaultView: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    };

    try {
      const app = {
        vault: {
          getFiles: vi.fn().mockReturnValue([]),
          getAllLoadedFiles: vi.fn().mockReturnValue([]),
        },
        workspace: {
          getActiveViewOfType: vi.fn(),
        },
      } as any;
      const plugin = {
        settings: {
          hiddenCommands: [],
        },
        getActiveEnvironmentVariables: () => ({}),
      } as any;
      plugin.providerHost = plugin;
      const editor = {} as any;
      const view = { editor } as any;

      let widgetRef: any = null;
      const dispatch = vi.fn((transaction: any) => {
        const effects = Array.isArray(transaction?.effects)
          ? transaction.effects
          : transaction?.effects
            ? [transaction.effects]
            : [];
        for (const effect of effects) {
          const widget = effect?.value?.widget;
          if (widget && typeof widget.createInputDOM === 'function') {
            widgetRef = widget;
            widget.createInputDOM();
          }
        }
      });
      const editorView = {
        state: {
          field: vi.fn(() => undefined),
          doc: {
            line: vi.fn(() => ({ from: 0 })),
            lineAt: vi.fn(() => ({ from: 0 })),
          },
        },
        dispatch,
        focus: vi.fn(),
        dom: {
          ownerDocument: (global as any).document,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      } as any;

      const getEditorViewSpy = vi
        .spyOn(obsidianCompat, 'getEditorView')
        .mockReturnValue(editorView);
      const getFoldersSpy = vi
        .spyOn(VaultFolderCache.prototype, 'getFolders')
        .mockReturnValue([{ name: 'src', path: 'src' } as any]);

      const editContext: InlineEditContext = {
        mode: 'cursor',
        cursorContext: {
          beforeCursor: '',
          afterCursor: '',
          isInbetween: true,
          line: 0,
          column: 0,
        },
      };

      const modal = new InlineEditModal(app, plugin, plugin, editor, view, editContext, 'note.md', owner);
      const resultPromise = modal.openAndWait();
      await Promise.resolve();

      const inputEl = widgetRef?.inputEl;
      inputEl.value = '@s';
      inputEl.selectionStart = inputEl.selectionEnd = 2;
      // Upstream #1815 removed the mention-load debounce (reduce lookup latency),
      // so the shared dropdown resolves folders promptly on input.
      inputEl.dispatchEvent({ type: 'input' });
      vi.advanceTimersByTime(1);
      await Promise.resolve();

      expect(getFoldersSpy).toHaveBeenCalled();
      const labels = (global as any).document.body
        .querySelectorAll('.claudian-composer-dropdown-label')
        .map((element: { textContent: string }) => element.textContent);
      expect(labels).toEqual(['@src/']);

      widgetRef?.reject();
      await expect(resultPromise).resolves.toEqual({ decision: 'reject' });

      getEditorViewSpy.mockRestore();
      getFoldersSpy.mockRestore();
    } finally {
      (global as any).document = originalDocument;
      vi.useRealTimers();
    }
  });


  it('passes the active blank tab draft model into inline edit services', async () => {
    const originalDocument = (global as any).document;
    (global as any).document = {
      body: createMockEl('body'),
      createElement: (tagName: string) => createMockEl(tagName),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      // The merged composer installs its accept/reject key handler on the document's
      // defaultView, so the fake document exposes one with the window listener API.
      defaultView: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    };

    try {
      const app = {
        vault: {
          getFiles: vi.fn().mockReturnValue([]),
          getAllLoadedFiles: vi.fn().mockReturnValue([]),
        },
        workspace: {
          getActiveViewOfType: vi.fn(),
        },
      } as any;
      const inlineEditService = {
        send: vi.fn().mockResolvedValue({ success: true, editedText: 'done' }),
        end: vi.fn(),
      };
      const providerSpy = vi
        .spyOn(ProviderRegistry, 'createInlineEditService')
        .mockReturnValue(inlineEditService as any);
      const plugin = {
        settings: {
          hiddenCommands: [],
          providerConfigs: {
            kiro: {
              enabled: true,
              visibleModels: ['claude-sonnet-4'],
            },
          },
        },
        getActiveModelSelection: () => ({ providerId: 'kiro', model: 'kiro:claude-sonnet-4' }),
        getActiveEnvironmentVariables: () => ({}),
        getConversationSync: vi.fn().mockReturnValue(null),
        getView: vi.fn().mockReturnValue({
          getActiveTab: vi.fn().mockReturnValue({
            conversationId: null,
            draftModel: 'kiro:claude-sonnet-4',
            providerId: 'kiro',
          }),
        }),
      } as any;
      plugin.providerHost = plugin;
      const editor = {} as any;
      const view = { editor } as any;

      let widgetRef: any = null;
      const dispatch = vi.fn((transaction: any) => {
        const effects = Array.isArray(transaction?.effects)
          ? transaction.effects
          : transaction?.effects
            ? [transaction.effects]
            : [];
        for (const effect of effects) {
          const widget = effect?.value?.widget;
          if (widget && typeof widget.createInputDOM === 'function') {
            widgetRef = widget;
            widget.createInputDOM();
          }
        }
      });
      const editorView = {
        state: {
          field: vi.fn(() => undefined),
          doc: {
            line: vi.fn(() => ({ from: 0 })),
            lineAt: vi.fn(() => ({ from: 0 })),
          },
        },
        dispatch,
        focus: vi.fn(),
        dom: {
          ownerDocument: (global as any).document,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      } as any;

      const getEditorViewSpy = vi
        .spyOn(obsidianCompat, 'getEditorView')
        .mockReturnValue(editorView);

      const editContext: InlineEditContext = {
        mode: 'cursor',
        cursorContext: {
          beforeCursor: '',
          afterCursor: '',
          isInbetween: true,
          line: 0,
          column: 0,
        },
      };

      const modal = new InlineEditModal(app, plugin, plugin, editor, view, editContext, 'note.md', owner);
      const resultPromise = modal.openAndWait();
      await Promise.resolve();

      expect(providerSpy).toHaveBeenCalledWith(plugin, 'kiro');

      // The merged service applies the model per request via send(request, { model }),
      // so the active blank-tab draft model reaches it when the edit runs.
      widgetRef.inputEl.value = 'Improve the statement';
      await widgetRef.generate();
      expect(inlineEditService.send).toHaveBeenCalledTimes(1);
      expect(inlineEditService.send.mock.calls[0][1].model).toBe('kiro:claude-sonnet-4');

      widgetRef.reject();
      await expect(resultPromise).resolves.toEqual({ decision: 'reject' });
      getEditorViewSpy.mockRestore();
      providerSpy.mockRestore();
    } finally {
      (global as any).document = originalDocument;
    }
  });

  it('passes the bound conversation model into inline edit services before runtime initialization', async () => {
    const originalDocument = (global as any).document;
    (global as any).document = {
      body: createMockEl('body'),
      createElement: (tagName: string) => createMockEl(tagName),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      // The merged composer installs its accept/reject key handler on the document's
      // defaultView, so the fake document exposes one with the window listener API.
      defaultView: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    };

    try {
      const app = {
        vault: {
          getFiles: vi.fn().mockReturnValue([]),
          getAllLoadedFiles: vi.fn().mockReturnValue([]),
        },
        workspace: {
          getActiveViewOfType: vi.fn(),
        },
      } as any;
      const inlineEditService = {
        send: vi.fn().mockResolvedValue({ success: true, editedText: 'done' }),
        end: vi.fn(),
      };
      const providerSpy = vi
        .spyOn(ProviderRegistry, 'createInlineEditService')
        .mockReturnValue(inlineEditService as any);
      const conversation = {
        id: 'conv-1',
        providerId: 'kiro',
        selectedModel: 'kiro:claude-sonnet-4',
      };
      const plugin = {
        settings: {
          hiddenCommands: [],
          providerConfigs: {
            kiro: { enabled: true },
          },
        },
        getActiveModelSelection: () => ({ providerId: 'kiro', model: conversation.selectedModel }),
        getActiveEnvironmentVariables: () => ({}),
        getConversationSync: vi.fn().mockReturnValue(conversation),
        getView: vi.fn().mockReturnValue({
          getActiveTab: vi.fn().mockReturnValue({
            conversationId: 'conv-1',
            draftModel: null,
            providerId: 'kiro',
          }),
        }),
      } as any;
      plugin.providerHost = plugin;
      const editor = {} as any;
      const view = { editor } as any;

      let widgetRef: any = null;
      const dispatch = vi.fn((transaction: any) => {
        const effects = Array.isArray(transaction?.effects)
          ? transaction.effects
          : transaction?.effects
            ? [transaction.effects]
            : [];
        for (const effect of effects) {
          const widget = effect?.value?.widget;
          if (widget && typeof widget.createInputDOM === 'function') {
            widgetRef = widget;
            widget.createInputDOM();
          }
        }
      });
      const editorView = {
        state: {
          field: vi.fn(() => undefined),
          doc: {
            line: vi.fn(() => ({ from: 0 })),
            lineAt: vi.fn(() => ({ from: 0 })),
          },
        },
        dispatch,
        focus: vi.fn(),
        dom: {
          ownerDocument: (global as any).document,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      } as any;

      const getEditorViewSpy = vi
        .spyOn(obsidianCompat, 'getEditorView')
        .mockReturnValue(editorView);

      const editContext: InlineEditContext = {
        mode: 'cursor',
        cursorContext: {
          beforeCursor: '',
          afterCursor: '',
          isInbetween: true,
          line: 0,
          column: 0,
        },
      };

      const modal = new InlineEditModal(app, plugin, plugin, editor, view, editContext, 'note.md', owner);
      const resultPromise = modal.openAndWait();
      await Promise.resolve();

      expect(providerSpy).toHaveBeenCalledWith(plugin, 'kiro');

      // The merged service applies the model per request via send(request, { model }),
      // so the bound conversation model reaches it when the edit runs.
      widgetRef.inputEl.value = 'Improve the statement';
      await widgetRef.generate();
      expect(inlineEditService.send).toHaveBeenCalledTimes(1);
      expect(inlineEditService.send.mock.calls[0][1].model).toBe('kiro:claude-sonnet-4');

      widgetRef.reject();
      await expect(resultPromise).resolves.toEqual({ decision: 'reject' });
      getEditorViewSpy.mockRestore();
      providerSpy.mockRestore();
    } finally {
      (global as any).document = originalDocument;
    }
  });


  it('parses @mentions into contextFiles at send time without dropdown attachment state', async () => {
    const originalDocument = (global as any).document;
    (global as any).document = {
      body: createMockEl('body'),
      createElement: (tagName: string) => createMockEl(tagName),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      // The merged composer installs its accept/reject key handler on the document's
      // defaultView, so the fake document exposes one with the window listener API.
      defaultView: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    };

    try {
      const app = {
        vault: {
          adapter: { basePath: '/vault' },
          getFiles: vi.fn().mockReturnValue([
            { path: 'notes/a.md' },
            { path: 'notes/b.md' },
          ]),
          getAllLoadedFiles: vi.fn().mockReturnValue([]),
        },
        workspace: {
          getActiveViewOfType: vi.fn(),
        },
      } as any;
      const plugin = {
        settings: {
          hiddenCommands: [],
        },
        getActiveEnvironmentVariables: () => ({}),
      } as any;
      plugin.providerHost = plugin;
      const editor = {} as any;
      const view = { editor } as any;

      let widgetRef: any = null;
      const dispatch = vi.fn((transaction: any) => {
        const effects = Array.isArray(transaction?.effects)
          ? transaction.effects
          : transaction?.effects
            ? [transaction.effects]
            : [];
        for (const effect of effects) {
          const widget = effect?.value?.widget;
          if (widget && typeof widget.createInputDOM === 'function') {
            widgetRef = widget;
            widget.createInputDOM();
          }
        }
      });
      const editorView = {
        state: {
          field: vi.fn(() => undefined),
          doc: {
            line: vi.fn(() => ({ from: 0 })),
            lineAt: vi.fn(() => ({ from: 0, number: 1 })),
          },
        },
        dispatch,
        focus: vi.fn(),
        dom: {
          ownerDocument: (global as any).document,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      } as any;

      const getEditorViewSpy = vi
        .spyOn(obsidianCompat, 'getEditorView')
        .mockReturnValue(editorView);

      const editContext: InlineEditContext = {
        mode: 'cursor',
        cursorContext: {
          beforeCursor: '',
          afterCursor: '',
          isInbetween: true,
          line: 0,
          column: 0,
        },
      };

      const modal = new InlineEditModal(app, plugin, plugin, editor, view, editContext, 'note.md', owner);
      const resultPromise = modal.openAndWait();
      await Promise.resolve();

      const sendMock = vi.fn().mockResolvedValue({
        success: true,
        clarification: 'Need more detail',
      });
      widgetRef.inlineEditService = {
        send: sendMock,
        end: vi.fn(),
      };

      widgetRef.inputEl.value = 'Please check @notes/a.md and @notes/a.md.';
      await widgetRef.generate();

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sendMock.mock.calls[0][0].contextFiles).toEqual(['notes/a.md']);

      widgetRef.reject();
      await expect(resultPromise).resolves.toEqual({ decision: 'reject' });
      getEditorViewSpy.mockRestore();
    } finally {
      (global as any).document = originalDocument;
    }
  });

  it('parses vault @mentions with spaces into contextFiles at send time', async () => {
    const originalDocument = (global as any).document;
    (global as any).document = {
      body: createMockEl('body'),
      createElement: (tagName: string) => createMockEl(tagName),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      // The merged composer installs its accept/reject key handler on the document's
      // defaultView, so the fake document exposes one with the window listener API.
      defaultView: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    };

    try {
      const app = {
        vault: {
          adapter: { basePath: '/vault' },
          getFiles: vi.fn().mockReturnValue([
            { path: 'notes/my note.md' },
          ]),
          getAllLoadedFiles: vi.fn().mockReturnValue([]),
        },
        workspace: {
          getActiveViewOfType: vi.fn(),
        },
      } as any;
      const plugin = {
        settings: {
          hiddenCommands: [],
        },
        getActiveEnvironmentVariables: () => ({}),
      } as any;
      plugin.providerHost = plugin;
      const editor = {} as any;
      const view = { editor } as any;

      let widgetRef: any = null;
      const dispatch = vi.fn((transaction: any) => {
        const effects = Array.isArray(transaction?.effects)
          ? transaction.effects
          : transaction?.effects
            ? [transaction.effects]
            : [];
        for (const effect of effects) {
          const widget = effect?.value?.widget;
          if (widget && typeof widget.createInputDOM === 'function') {
            widgetRef = widget;
            widget.createInputDOM();
          }
        }
      });
      const editorView = {
        state: {
          field: vi.fn(() => undefined),
          doc: {
            line: vi.fn(() => ({ from: 0 })),
            lineAt: vi.fn(() => ({ from: 0, number: 1 })),
          },
        },
        dispatch,
        focus: vi.fn(),
        dom: {
          ownerDocument: (global as any).document,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      } as any;

      const getEditorViewSpy = vi
        .spyOn(obsidianCompat, 'getEditorView')
        .mockReturnValue(editorView);

      const editContext: InlineEditContext = {
        mode: 'cursor',
        cursorContext: {
          beforeCursor: '',
          afterCursor: '',
          isInbetween: true,
          line: 0,
          column: 0,
        },
      };

      const modal = new InlineEditModal(app, plugin, plugin, editor, view, editContext, 'note.md', owner);
      const resultPromise = modal.openAndWait();
      await Promise.resolve();

      const sendMock = vi.fn().mockResolvedValue({
        success: true,
        clarification: 'Need more detail',
      });
      widgetRef.inlineEditService = {
        send: sendMock,
        end: vi.fn(),
      };

      widgetRef.inputEl.value = 'Please check @notes/my note.md.';
      await widgetRef.generate();

      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sendMock.mock.calls[0][0].contextFiles).toEqual(['notes/my note.md']);

      widgetRef.reject();
      await expect(resultPromise).resolves.toEqual({ decision: 'reject' });
      getEditorViewSpy.mockRestore();
    } finally {
      (global as any).document = originalDocument;
    }
  });

  it('does not let stale clarification markdown renders overwrite newer replies', async () => {
    const originalDocument = (global as any).document;
    (global as any).document = {
      body: createMockEl('body'),
      createElement: (tagName: string) => createMockEl(tagName),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      // The merged composer installs its accept/reject key handler on the document's
      // defaultView, so the fake document exposes one with the window listener API.
      defaultView: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    };

    try {
      const app = {
        vault: {
          getFiles: vi.fn().mockReturnValue([]),
          getAllLoadedFiles: vi.fn().mockReturnValue([]),
        },
        workspace: {
          getActiveViewOfType: vi.fn(),
        },
      } as any;
      const plugin = {
        settings: {
          hiddenCommands: [],
          mediaFolder: '',
        },
        getActiveEnvironmentVariables: () => ({}),
      } as any;
      plugin.providerHost = plugin;
      const editor = {} as any;
      const view = { editor } as any;

      let widgetRef: any = null;
      const dispatch = vi.fn((transaction: any) => {
        const effects = Array.isArray(transaction?.effects)
          ? transaction.effects
          : transaction?.effects
            ? [transaction.effects]
            : [];
        for (const effect of effects) {
          const widget = effect?.value?.widget;
          if (widget && typeof widget.createInputDOM === 'function') {
            widgetRef = widget;
            widget.createInputDOM();
          }
        }
      });
      const editorView = {
        state: {
          field: vi.fn(() => undefined),
          doc: {
            line: vi.fn(() => ({ from: 0 })),
            lineAt: vi.fn(() => ({ from: 0, number: 1 })),
          },
        },
        dispatch,
        focus: vi.fn(),
        dom: {
          ownerDocument: (global as any).document,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      } as any;

      const getEditorViewSpy = vi
        .spyOn(obsidianCompat, 'getEditorView')
        .mockReturnValue(editorView);

      const firstRender = createDeferred();
      const secondRender = createDeferred();
      (MarkdownRenderer.renderMarkdown as Mock)
        .mockImplementationOnce((markdown: string, container: any) => {
          container.createDiv({ text: markdown });
          return firstRender.promise;
        })
        .mockImplementationOnce((markdown: string, container: any) => {
          container.createDiv({ text: markdown });
          return secondRender.promise;
        });

      const editContext: InlineEditContext = {
        mode: 'cursor',
        cursorContext: {
          beforeCursor: '',
          afterCursor: '',
          isInbetween: true,
          line: 0,
          column: 0,
        },
      };

      const modal = new InlineEditModal(app, plugin, plugin, editor, view, editContext, 'math/note.md', owner);
      const resultPromise = modal.openAndWait();
      await Promise.resolve();

      (MarkdownRenderer.renderMarkdown as Mock).mockClear();
      widgetRef.showAgentReply('Should this use $Z(f)$?');
      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledWith(
        'Should this use $Z(f)$?',
        expect.anything(),
        'math/note.md',
        plugin,
      );
      widgetRef.showAgentReply('Second clarification');

      secondRender.resolve();
      await secondRender.promise;
      await Promise.resolve();
      await Promise.resolve();

      expect(widgetRef.agentReplyEl.children).toHaveLength(1);
      expect(widgetRef.agentReplyEl.children[0].textContent).toBe('Second clarification');

      firstRender.resolve();
      await firstRender.promise;
      await Promise.resolve();
      await Promise.resolve();

      expect(widgetRef.agentReplyEl.children).toHaveLength(1);
      expect(widgetRef.agentReplyEl.children[0].textContent).toBe('Second clarification');

      widgetRef.reject();
      await expect(resultPromise).resolves.toEqual({ decision: 'reject' });
      getEditorViewSpy.mockRestore();
    } finally {
      (global as any).document = originalDocument;
    }
  });

  it('renders accept and reject controls in the block preview', async () => {
    const originalDocument = (global as any).document;
    (global as any).document = {
      body: createMockEl('body'),
      createElement: (tagName: string) => createMockEl(tagName),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      // The merged composer installs its accept/reject key handler on the document's
      // defaultView, so the fake document exposes one with the window listener API.
      defaultView: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    };

    try {
      const app = {
        vault: {
          getFiles: vi.fn().mockReturnValue([]),
          getAllLoadedFiles: vi.fn().mockReturnValue([]),
        },
        workspace: {
          getActiveViewOfType: vi.fn(),
        },
      } as any;
      const plugin = {
        settings: {
          hiddenCommands: [],
          mediaFolder: '',
        },
        getActiveEnvironmentVariables: () => ({}),
      } as any;
      plugin.providerHost = plugin;
      const editor = {} as any;
      const view = { editor } as any;

      let widgetRef: any = null;
      const dispatch = vi.fn((transaction: any) => {
        const effects = Array.isArray(transaction?.effects)
          ? transaction.effects
          : transaction?.effects
            ? [transaction.effects]
            : [];
        for (const effect of effects) {
          const widget = effect?.value?.widget;
          if (widget && typeof widget.createInputDOM === 'function') {
            widgetRef = widget;
            widget.createInputDOM();
          }
        }
      });
      const editorView = {
        state: {
          field: vi.fn(() => undefined),
          doc: {
            line: vi.fn(() => ({ from: 0 })),
            lineAt: vi.fn(() => ({ from: 0, number: 1 })),
          },
        },
        dispatch,
        focus: vi.fn(),
        dom: {
          ownerDocument: (global as any).document,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      } as any;

      const getEditorViewSpy = vi
        .spyOn(obsidianCompat, 'getEditorView')
        .mockReturnValue(editorView);

      const editContext: InlineEditContext = {
        mode: 'cursor',
        cursorContext: {
          beforeCursor: '',
          afterCursor: '',
          isInbetween: true,
          line: 0,
          column: 0,
        },
      };

      const modal = new InlineEditModal(app, plugin, plugin, editor, view, editContext, 'math/note.md', owner);
      const resultPromise = modal.openAndWait();
      await Promise.resolve();

      const rejectSpy = vi.spyOn(widgetRef, 'reject').mockImplementation(() => {});
      const acceptSpy = vi.spyOn(widgetRef, 'accept').mockImplementation(() => {});

      const previewEl = widgetRef.createDiffPreviewDOM([
        { type: 'insert', text: 'Updated text' },
      ]);
      const actionBar = previewEl.querySelector('.claudian-inline-preview-actions');
      const actionButtons = previewEl.querySelectorAll('.claudian-inline-preview-action');

      expect(actionBar).not.toBeNull();
      expect(actionButtons).toHaveLength(2);
      expect(actionButtons[0].textContent).toBe('Reject');
      expect(actionButtons[1].textContent).toBe('Accept');

      actionButtons[0].click();
      actionButtons[1].click();

      expect(rejectSpy).toHaveBeenCalledTimes(1);
      expect(acceptSpy).toHaveBeenCalledTimes(1);

      rejectSpy.mockRestore();
      acceptSpy.mockRestore();
      widgetRef.reject();
      await expect(resultPromise).resolves.toEqual({ decision: 'reject' });
      getEditorViewSpy.mockRestore();
    } finally {
      (global as any).document = originalDocument;
    }
  });

  it.each([
    {
      name: 'fenced code with block context',
      expectedDiffOps: [
        { type: 'equal', text: '```ts\n' },
        { type: 'delete', text: 'const value = 1;\n' },
        { type: 'insert', text: 'const value = 2;\n' },
        { type: 'equal', text: '```' },
      ],
      oldMarkdown: '```ts\nconst value = 1;\n```',
      newMarkdown: '```ts\nconst value = 2;\n```',
      expectedKinds: ['del', 'ins'],
    },
    {
      name: 'unchanged text',
      expectedDiffOps: [
        { type: 'equal', text: 'Hello world' },
      ],
      oldMarkdown: 'Hello world',
      newMarkdown: 'Hello world',
      expectedKinds: ['equal'],
    },
    {
      name: 'insertion into empty text',
      expectedDiffOps: [
        { type: 'insert', text: 'New text' },
      ],
      oldMarkdown: '',
      newMarkdown: 'New text',
      expectedKinds: ['ins'],
    },
    {
      name: 'complete deletion',
      expectedDiffOps: [
        { type: 'delete', text: 'Removed text' },
      ],
      oldMarkdown: 'Removed text',
      newMarkdown: '',
      expectedKinds: ['del'],
    },
    {
      name: 'empty documents',
      expectedDiffOps: [
      ],
      oldMarkdown: '',
      newMarkdown: '',
      expectedKinds: [],
    },
    {
      name: 'word insertion',
      expectedDiffOps: [
        { type: 'delete', text: 'Hello world' },
        { type: 'insert', text: 'Hello beautiful world' },
      ],
      oldMarkdown: 'Hello world',
      newMarkdown: 'Hello beautiful world',
      expectedKinds: ['del', 'ins'],
    },
    {
      name: 'word deletion',
      expectedDiffOps: [
        { type: 'delete', text: 'Hello beautiful world' },
        { type: 'insert', text: 'Hello world' },
      ],
      oldMarkdown: 'Hello beautiful world',
      newMarkdown: 'Hello world',
      expectedKinds: ['del', 'ins'],
    },
    {
      name: 'whitespace and multiline markdown',
      expectedDiffOps: [
        { type: 'equal', text: '# Heading\n\n' },
        { type: 'delete', text: '  First paragraph.  \n' },
        { type: 'insert', text: '  Updated paragraph!  \n' },
        { type: 'equal', text: '\tSecond line.\n' },
      ],
      oldMarkdown: '# Heading\n\n  First paragraph.  \n\tSecond line.\n',
      newMarkdown: '# Heading\n\n  Updated paragraph!  \n\tSecond line.\n',
      expectedKinds: ['del', 'ins'],
    },
    {
      name: 'literal HTML and punctuation in code',
      expectedDiffOps: [
        { type: 'equal', text: '```html\n' },
        { type: 'delete', text: '<div title="old">Hello & goodbye.</div>\n' },
        { type: 'insert', text: '<div title="new">Hello, world!</div>\n' },
        { type: 'equal', text: '```' },
      ],
      oldMarkdown: '```html\n<div title="old">Hello & goodbye.</div>\n```',
      newMarkdown: '```html\n<div title="new">Hello, world!</div>\n```',
      expectedKinds: ['del', 'ins'],
    },
  ])('renders markdown diff documents for $name', async ({ oldMarkdown, newMarkdown, expectedKinds, expectedDiffOps }) => {
    const originalDocument = (global as any).document;
    (global as any).document = {
      body: createMockEl('body'),
      createElement: (tagName: string) => createMockEl(tagName),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      // The merged composer installs its accept/reject key handler on the document's
      // defaultView, so the fake document exposes one with the window listener API.
      defaultView: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    };

    try {
      const app = {
        vault: {
          getFiles: vi.fn().mockReturnValue([]),
          getAllLoadedFiles: vi.fn().mockReturnValue([]),
        },
        workspace: {
          getActiveViewOfType: vi.fn(),
        },
      } as any;
      const plugin = {
        settings: {
          hiddenCommands: [],
          mediaFolder: '',
        },
        getActiveEnvironmentVariables: () => ({}),
      } as any;
      plugin.providerHost = plugin;
      const editor = {
        getCursor: vi.fn((which: string) => which === 'from'
          ? { line: 0, ch: 0 }
          : { line: 0, ch: 3 }),
        getSelection: vi.fn().mockReturnValue(oldMarkdown),
      } as any;
      const view = { editor } as any;

      let widgetRef: any = null;
      let diffOps: Array<{ type: string; text: string }> | undefined;
      let hasPreviewText = false;
      const dispatch = vi.fn((transaction: any) => {
        const effects = Array.isArray(transaction?.effects)
          ? transaction.effects
          : transaction?.effects
            ? [transaction.effects]
            : [];
        for (const effect of effects) {
          if (effect?.value?.diffOps) {
            diffOps = effect.value.diffOps;
          }
          if (effect?.value?.previewText) {
            hasPreviewText = true;
          }

          const widget = effect?.value?.widget;
          if (widget && typeof widget.createInputDOM === 'function' && !widgetRef) {
            widgetRef = widget;
            widget.createInputDOM();
          }
        }
      });
      const editorView = {
        state: {
          field: vi.fn(() => undefined),
          doc: {
            line: vi.fn(() => ({ from: 0 })),
            lineAt: vi.fn(() => ({ from: 0, number: 1 })),
          },
        },
        dispatch,
        focus: vi.fn(),
        dom: {
          ownerDocument: (global as any).document,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      } as any;

      const getEditorViewSpy = vi
        .spyOn(obsidianCompat, 'getEditorView')
        .mockReturnValue(editorView);

      const editContext: InlineEditContext = {
        mode: 'selection',
        selectedText: oldMarkdown,
      };

      const modal = new InlineEditModal(app, plugin, plugin, editor, view, editContext, 'math/note.md', owner);
      const resultPromise = modal.openAndWait();
      await Promise.resolve();
      widgetRef.inlineEditService = {
        send: vi.fn().mockResolvedValue({
          success: true,
          editedText: newMarkdown,
        }),
        end: vi.fn(),
      };

      widgetRef.inputEl.value = 'Improve the statement';
      await widgetRef.generate();

      expect(diffOps).toEqual(expectedDiffOps);
      expect(hasPreviewText).toBe(false);

      (MarkdownRenderer.renderMarkdown as Mock).mockClear();
      const previewEl = widgetRef.createDiffPreviewDOM(diffOps);
      for (let i = 0; i < 5 && (MarkdownRenderer.renderMarkdown as Mock).mock.calls.length < expectedKinds.length; i++) {
        await Promise.resolve();
      }

      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledTimes(expectedKinds.length);
      const diffBlocks = previewEl.querySelectorAll('.claudian-diff-block');
      expect(diffBlocks).toHaveLength(expectedKinds.length);
      expectedKinds.forEach((kind, index) => {
        expect(MarkdownRenderer.renderMarkdown).toHaveBeenNthCalledWith(
          index + 1,
          kind === 'del' ? oldMarkdown : newMarkdown,
          expect.anything(),
          'math/note.md',
          plugin
        );
        expect(diffBlocks[index].hasClass(`claudian-diff-${kind}`)).toBe(true);
      });

      widgetRef.reject();
      await expect(resultPromise).resolves.toEqual({ decision: 'reject' });
      getEditorViewSpy.mockRestore();
    } finally {
      (global as any).document = originalDocument;
    }
  });
});
