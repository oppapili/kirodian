import { NativeSessionArchiveSync } from '@/app/conversations/NativeSessionArchiveSync';
import type { ProviderId, ProviderSessionArchive, ProviderSessionArchiveChange } from '@/core/providers/types';
import type { Conversation } from '@/core/types';

/**
 * NativeSessionArchiveSync is provider-neutral: it mirrors committed application
 * archive state onto whichever provider owns a native session archive. Kirodian's
 * shipping providers (kiro, claude) declare no native archive, so these contracts
 * are exercised here as a focused unit rather than through the plugin, which was
 * the home of the removed codex/claude integration mirror cases.
 */
describe('NativeSessionArchiveSync', () => {
  function conversation(id: string, providerId: ProviderId, isArchived: boolean): Conversation {
    return { id, providerId, isArchived } as unknown as Conversation;
  }

  it('mirrors committed archive and restore state for one session', async () => {
    const store = new Map<string, Conversation>();
    store.set('thread-1', conversation('thread-1', 'claude', true));
    const setSessionsArchived = jest.fn<Promise<void>, [readonly ProviderSessionArchiveChange[]]>()
      .mockResolvedValue(undefined);
    const archive: ProviderSessionArchive = { setSessionsArchived };
    const sync = new NativeSessionArchiveSync({
      getConversation: id => store.get(id) ?? null,
      getSessionArchive: async () => archive,
      onFailure: () => undefined,
    });

    await sync.sync(['thread-1']);
    store.set('thread-1', conversation('thread-1', 'claude', false));
    await sync.sync(['thread-1']);

    expect(setSessionsArchived.mock.calls).toEqual([
      [[{ conversation: expect.objectContaining({ id: 'thread-1' }), isArchived: true }]],
      [[{ conversation: expect.objectContaining({ id: 'thread-1' }), isArchived: false }]],
    ]);
  });

  it("groups a batch by provider and reads each session's latest committed state", async () => {
    const store = new Map<string, Conversation>([
      ['a', conversation('a', 'claude', true)],
      ['b', conversation('b', 'claude', false)],
    ]);
    const changesByCall: ProviderSessionArchiveChange[][] = [];
    const archive: ProviderSessionArchive = {
      setSessionsArchived: async changes => { changesByCall.push([...changes]); },
    };
    const sync = new NativeSessionArchiveSync({
      getConversation: id => store.get(id) ?? null,
      getSessionArchive: async () => archive,
      onFailure: () => undefined,
    });

    await sync.sync(['a', 'b']);

    expect(changesByCall).toHaveLength(1);
    expect(changesByCall[0].map(change => [(change.conversation as unknown as { id: string }).id, change.isArchived])).toEqual([
      ['a', true],
      ['b', false],
    ]);
  });

  it('drains one batch at a time so native results cannot finish out of commit order', async () => {
    const store = new Map<string, Conversation>([['t', conversation('t', 'claude', true)]]);
    const order: string[] = [];
    let releaseFirst!: () => void;
    const setSessionsArchived = jest.fn<Promise<void>, [readonly ProviderSessionArchiveChange[]]>()
      .mockImplementationOnce(() => new Promise<void>(resolve => {
        order.push('archive:start');
        releaseFirst = () => { order.push('archive:end'); resolve(); };
      }))
      .mockImplementation(async () => { order.push('restore'); });
    const archive: ProviderSessionArchive = { setSessionsArchived };
    const sync = new NativeSessionArchiveSync({
      getConversation: id => store.get(id) ?? null,
      getSessionArchive: async () => archive,
      onFailure: () => undefined,
    });

    const first = sync.sync(['t']);
    await Promise.resolve();
    store.set('t', conversation('t', 'claude', false));
    const second = sync.sync(['t']);

    // The restore batch must not run until the archive batch resolves.
    expect(order).toEqual(['archive:start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['archive:start', 'archive:end', 'restore']);
  });

  it('finishes admitted work after dispose stops further admission', async () => {
    const store = new Map<string, Conversation>([['t', conversation('t', 'claude', true)]]);
    let releaseArchive!: () => void;
    const setSessionsArchived = jest.fn<Promise<void>, [readonly ProviderSessionArchiveChange[]]>()
      .mockImplementation(() => new Promise<void>(resolve => { releaseArchive = resolve; }));
    const archive: ProviderSessionArchive = { setSessionsArchived };
    const sync = new NativeSessionArchiveSync({
      getConversation: id => store.get(id) ?? null,
      getSessionArchive: async () => archive,
      onFailure: () => undefined,
    });

    const admitted = sync.sync(['t']);
    await Promise.resolve();
    const disposal = sync.dispose();
    // Admission is closed: a later sync resolves immediately and never mirrors.
    await sync.sync(['t']);
    expect(setSessionsArchived).toHaveBeenCalledTimes(1);

    releaseArchive();
    await Promise.all([admitted, disposal]);
    expect(setSessionsArchived).toHaveBeenCalledTimes(1);
  });

  it('reports native failures without rolling back and keeps draining', async () => {
    const store = new Map<string, Conversation>([['t', conversation('t', 'claude', true)]]);
    const failure = new Error('claude unavailable');
    const archive: ProviderSessionArchive = {
      setSessionsArchived: async () => { throw failure; },
    };
    const onFailure = jest.fn<void, [ProviderId, unknown]>();
    const sync = new NativeSessionArchiveSync({
      getConversation: id => store.get(id) ?? null,
      getSessionArchive: async () => archive,
      onFailure,
    });

    await expect(sync.sync(['t'])).resolves.toBeUndefined();

    expect(onFailure).toHaveBeenCalledWith('claude', failure);
  });

  it('skips providers that own no native archive', async () => {
    const store = new Map<string, Conversation>([['t', conversation('t', 'kiro', true)]]);
    const getSessionArchive = jest.fn<Promise<ProviderSessionArchive | null>, [ProviderId]>()
      .mockResolvedValue(null);
    const onFailure = jest.fn();
    const sync = new NativeSessionArchiveSync({
      getConversation: id => store.get(id) ?? null,
      getSessionArchive,
      onFailure,
    });

    await expect(sync.sync(['t'])).resolves.toBeUndefined();

    expect(getSessionArchive).toHaveBeenCalledWith('kiro');
    expect(onFailure).not.toHaveBeenCalled();
  });
});
