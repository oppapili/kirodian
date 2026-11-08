import '@/providers';

import type { Mocked } from 'vitest';

import { ConversationRepository } from '@/app/conversations/ConversationRepository';
import type { ConversationPersistence } from '@/app/storage/ConversationPersistenceStore';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { Conversation } from '@/core/types';

function createConversation(id = 'conversation-1'): Conversation {
  return {
    id,
    providerId: 'kiro',
    title: 'Conversation',
    createdAt: 1,
    lastActivityAt: 1,
    sessionId: 'session-1',
    messages: [],
  };
}

function createRepository(conversation = createConversation()) {
  const persistence: Mocked<ConversationPersistence> = {
    metadataReader: {
      revalidate: vi.fn().mockResolvedValue([]),
      load: vi.fn().mockResolvedValue(null),
      scan: vi.fn().mockResolvedValue({
        records: [],
        complete: true,
        invalidMetadataCount: 0,
      }),
      loadMetadata: vi.fn().mockResolvedValue(null),
      scanMetadata: vi.fn().mockResolvedValue({
        metadata: [],
        complete: true,
        invalidMetadataCount: 0,
      }),
      listMetadata: vi.fn().mockResolvedValue([]),
    },
    saveMetadata: vi.fn().mockResolvedValue(undefined),
    deleteCurrentMetadata: vi.fn().mockResolvedValue(undefined),
    assignMetadataToDevice: vi.fn().mockResolvedValue(undefined),
  };
  const repository = new ConversationRepository({
    providers: ProviderRegistry,
    providerSettings: ProviderSettingsCoordinator,
    getSettings: () => ({}),
    getVaultPath: () => '/vault',
    persistence,
    onConversationDeleted: vi.fn().mockResolvedValue(undefined),
  });
  repository.replaceAll([conversation]);
  return { repository, persistence };
}

afterEach(() => vi.restoreAllMocks());

test('does not publish recovered identity after concurrent deletion', async () => {
  const conversation = createConversation();
  const { repository, persistence } = createRepository(conversation);
  vi.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
    hydrateConversationHistory: async () => ({}),
    readNativeHistoryRevision: async () => null,
    resolveSessionIdForConversation: value => value?.sessionId ?? null,
    isPendingForkConversation: () => false,
    buildForkProviderState: () => ({}),
    recoverConversationSessionReference: async () => {
      await repository.delete(conversation.id);
      return { sessionId: 'recovered-session' };
    },
  });
  expect(await repository.ensureHydrated(conversation.id)).toBeNull();
  expect(repository.getCachedConversation(conversation.id)).toBeNull();
  expect(persistence.saveMetadata).not.toHaveBeenCalled();
});

test('keeps relocated native history readable after its metadata save fails', async () => {
  const conversation = createConversation();
  conversation.selectedModel = 'sonnet';
  const messages: Conversation['messages'] = [
    { id: 'native-response', role: 'assistant', content: 'Native history', timestamp: 2 },
  ];
  // The repository must keep hydrated native history readable even when the
  // metadata write that follows hydration fails. Drive this through a minimal
  // history-service port (the provider-neutral contract) rather than a specific
  // provider's SDK relocation internals.
  vi.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
    hydrateConversationHistory: async conv => ({ ...conv, messages }),
    readNativeHistoryRevision: async () => null,
    resolveSessionIdForConversation: value => value?.sessionId ?? null,
    isPendingForkConversation: () => false,
    buildForkProviderState: () => ({}),
  });
  const { repository, persistence } = createRepository(conversation);
  persistence.saveMetadata.mockRejectedValue(new Error('Metadata unavailable'));

  expect((await repository.ensureHydrated(conversation.id))?.messages).toEqual(messages);
  expect(repository.getCachedConversation(conversation.id)?.sessionId).toBe('session-1');
});


test('restores the conversation when missing-session metadata removal fails', async () => {
  const conversation = createConversation();
  const { repository, persistence } = createRepository(conversation);
  vi.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
    hydrateConversationHistory: async conv => conv,
    readNativeHistoryRevision: async () => null,
    resolveSessionIdForConversation: value => value?.sessionId ?? null,
    isPendingForkConversation: () => false,
    buildForkProviderState: () => ({}),
    resolveMissingConversationSession: async () => ({ outcome: 'delete' }),
  });
  persistence.deleteCurrentMetadata.mockRejectedValue(new Error('Metadata cleanup failed'));

  await expect(repository.handleMissingProviderSession(conversation.id, 'session-1'))
    .rejects.toThrow('Metadata cleanup failed');
  expect(repository.getCachedConversation(conversation.id)).toMatchObject({ id: conversation.id });
});

test('late accepted binding survives a missing-session decision', async () => {
  const conversation = createConversation();
  const { repository } = createRepository(conversation);
  let updating: Promise<void> | undefined;
  vi.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
    hydrateConversationHistory: async () => ({}),
    readNativeHistoryRevision: async () => null,
    resolveSessionIdForConversation: value => value?.sessionId ?? null,
    isPendingForkConversation: () => false,
    buildForkProviderState: () => ({}),
    resolveMissingConversationSession: async () => {
      queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => {
        updating = repository.update(conversation.id, { sessionId: 'new-session' });
      })));
      return { outcome: 'delete' };
    },
  });
  const outcome = await repository.handleMissingProviderSession(conversation.id, 'session-1');
  await updating;
  expect(outcome).toBe('preserved');
  expect(repository.getCachedConversation(conversation.id)?.sessionId).toBe('new-session');
});
