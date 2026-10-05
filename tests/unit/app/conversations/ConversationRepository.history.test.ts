import '@/providers';

import { ConversationRepository } from '@/app/conversations/ConversationRepository';
import type { ConversationPersistence } from '@/core/bootstrap/ConversationPersistenceStore';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { Conversation } from '@/core/types';
import { ClaudeConversationHistoryService } from '@/providers/claude/history/ClaudeConversationHistoryService';
import * as claudeHistory from '@/providers/claude/history/ClaudeHistoryStore';

function createConversation(id = 'conversation-1'): Conversation {
  return {
    id,
    providerId: 'claude',
    title: 'Conversation',
    createdAt: 1,
    lastActivityAt: 1,
    sessionId: 'session-1',
    messages: [],
  };
}

function createRepository(conversation = createConversation()) {
  const persistence: jest.Mocked<ConversationPersistence> = {
    metadataReader: {
      load: jest.fn().mockResolvedValue(null),
      scan: jest.fn().mockResolvedValue({
        records: [],
        complete: true,
        invalidMetadataCount: 0,
      }),
      loadMetadata: jest.fn().mockResolvedValue(null),
      scanMetadata: jest.fn().mockResolvedValue({
        metadata: [],
        complete: true,
        invalidMetadataCount: 0,
      }),
      listMetadata: jest.fn().mockResolvedValue([]),
    },
    saveMetadata: jest.fn().mockResolvedValue(undefined),
    deleteCurrentMetadata: jest.fn().mockResolvedValue(undefined),
    deleteLegacyMetadata: jest.fn().mockResolvedValue(undefined),
    assignMetadataToDevice: jest.fn().mockResolvedValue(undefined),
  };
  const repository = new ConversationRepository({
    getSettings: () => ({}),
    getVaultPath: () => '/vault',
    persistence,
    onConversationDeleted: jest.fn().mockResolvedValue(undefined),
  });
  repository.replaceAll([conversation]);
  return { repository, persistence };
}

afterEach(() => jest.restoreAllMocks());

test('does not publish recovered identity after concurrent deletion', async () => {
  const conversation = createConversation();
  const { repository, persistence } = createRepository(conversation);
  jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
    hydrateConversationHistory: async () => undefined,
    resolveSessionIdForConversation: value => value?.sessionId ?? null,
    isPendingForkConversation: () => false,
    buildForkProviderState: () => ({}),
    recoverConversationSessionReference: async draft => {
      draft.sessionId = 'recovered-session';
      await repository.delete(conversation.id);
      return true;
    },
  });
  expect(await repository.ensureHydrated(conversation.id)).toBeNull();
  expect(repository.getCachedConversation(conversation.id)).toBeNull();
  expect(persistence.saveMetadata).not.toHaveBeenCalled();
});

test('keeps relocated Claude history readable after its metadata save fails', async () => {
  const conversation = createConversation();
  conversation.selectedModel = 'sonnet';
  const messages: Conversation['messages'] = [
    { id: 'native-response', role: 'assistant', content: 'Native history', timestamp: 2 },
  ];
  const location = { availability: 'relocated' as const, sessionPath: '/old-vault/session-1.jsonl' };
  jest.spyOn(claudeHistory, 'locateSDKSession').mockResolvedValue(location);
  jest.spyOn(claudeHistory, 'locateSDKSessions').mockResolvedValue(new Map([['session-1', location]]));
  jest.spyOn(claudeHistory, 'loadSDKSessionMessages').mockResolvedValue({ messages, skippedLines: 0 });
  jest.spyOn(ProviderRegistry, 'getConversationHistoryService')
    .mockReturnValue(new ClaudeConversationHistoryService());
  const { repository, persistence } = createRepository(conversation);
  persistence.saveMetadata.mockRejectedValue(new Error('Metadata unavailable'));

  expect((await repository.ensureHydrated(conversation.id))?.messages).toEqual(messages);
  expect(repository.getCachedConversation(conversation.id)?.sessionId).toBe('session-1');
});

test('restores the conversation when missing-session metadata removal fails', async () => {
  const conversation = createConversation();
  const { repository, persistence } = createRepository(conversation);
  jest.spyOn(claudeHistory, 'locateSDKSessions').mockResolvedValue(new Map([
    ['session-1', { availability: 'missing' as const }],
  ]));
  jest.spyOn(ProviderRegistry, 'getConversationHistoryService')
    .mockReturnValue(new ClaudeConversationHistoryService());
  persistence.deleteCurrentMetadata.mockRejectedValue(new Error('Metadata cleanup failed'));

  await expect(repository.handleMissingProviderSession(conversation.id, 'session-1'))
    .rejects.toThrow('Metadata cleanup failed');
  expect(repository.getCachedConversation(conversation.id)).toBe(conversation);
});

test('late accepted binding survives a missing-session decision', async () => {
  const conversation = createConversation();
  const { repository } = createRepository(conversation);
  let updating: Promise<void> | undefined;
  jest.spyOn(ProviderRegistry, 'getConversationHistoryService').mockReturnValue({
    hydrateConversationHistory: async () => undefined,
    resolveSessionIdForConversation: value => value?.sessionId ?? null,
    isPendingForkConversation: () => false,
    buildForkProviderState: () => ({}),
    resolveMissingConversationSession: async () => {
      queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => {
        updating = repository.update(conversation.id, { sessionId: 'new-session' });
      })));
      return 'delete';
    },
  });
  const outcome = await repository.handleMissingProviderSession(conversation.id, 'session-1');
  await updating;
  expect(outcome).toBe('preserved');
  expect(repository.getCachedConversation(conversation.id)?.sessionId).toBe('new-session');
});
