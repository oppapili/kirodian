/** @vitest-environment jsdom */
import '@/providers';

import { deferred } from '@test/helpers/ChatInputHarness';
import { createSessionRuntimePool } from '@test/helpers/features/chat/SessionRuntimePoolHarness';
import { FakeSideBackend } from '@test/helpers/features/chat/SideChatSessionHarness';
import { testDate } from '@test/helpers/testClock';
import { waitFor } from '@testing-library/dom';
import { App } from 'obsidian';

import { ConversationRepository } from '@/app/conversations/ConversationRepository';
import type { ConversationPersistence } from '@/app/storage/ConversationPersistenceStore';
import { ProviderExecutionLifecycleRegistry } from '@/core/execution';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import type { ClaudianSettings, Conversation, ConversationMutablePatch, SessionMetadata } from '@/core/types';
import type { ChatFeatureHost } from '@/features/chat/ChatFeatureHost';
import { SessionMessagingService } from '@/features/chat/session-messaging/SessionMessagingService';
import { getSessionSettingsSnapshot } from '@/features/chat/sessions/sessionSettings';
import { updateCurrentKiroCatalog, updateKiroProviderSettings } from '@/providers/kiro/settings';

// Selections carry the `kiro/` prefix; the backend receives the selection id (the kiro adapter decodes it on the wire).
// All models expose low/high effort.
const sonnet = 'kiro/sonnet';
const haiku = 'kiro/haiku';
const opus = 'kiro/opus';

function buildKiroCatalog(settings: Record<string, unknown>): void {
  updateCurrentKiroCatalog(settings, {
    defaultModelId: null, fingerprint: 'test-fingerprint', refreshedAt: 0,
    models: [
      { rawId: 'sonnet', displayName: 'Sonnet', description: 'SDK model', supportsReasoning: true,
        reasoningMetadataResolved: true, reasoningEfforts: [{ label: 'Low', value: 'low' }, { label: 'High', value: 'high' }] },
      { rawId: 'haiku', displayName: 'Haiku', description: 'SDK model', supportsReasoning: true,
        reasoningMetadataResolved: true, reasoningEfforts: [{ label: 'Low', value: 'low' }, { label: 'High', value: 'high' }] },
      { rawId: 'opus', displayName: 'Opus', description: 'SDK model', supportsReasoning: true,
        reasoningMetadataResolved: true, reasoningEfforts: [{ label: 'Low', value: 'low' }, { label: 'High', value: 'high' }] },
    ],
  });
  updateKiroProviderSettings(settings, { enabled: true, visibleModels: ['sonnet', 'haiku', 'opus'] });
}

function setup() {
  const app = new App();
  Object.assign(app.vault.adapter, { basePath: '/vault' });
  const backend = new FakeSideBackend();
  vi.spyOn(ProviderRegistry, 'createExecutionBackend').mockReturnValue(backend);
  ProviderWorkspaceRegistry.setServices('kiro', {});
  const settings = {
    model: sonnet, permissionMode: 'normal', effortLevel: 'high', excludedTags: [],
    lastSelectedChatModel: { providerId: 'kiro', model: sonnet },
  } as unknown as ClaudianSettings;
  buildKiroCatalog(settings as unknown as Record<string, unknown>);
  const records: Conversation[] = ['sender', 'recipient'].map(id => ({
    id, sessionId: null, providerId: 'kiro', selectedModel: sonnet, title: id, messages: [],
    createdAt: testDate().getTime(), lastActivityAt: testDate().getTime(),
  }));
  const stored = new Map<string, SessionMetadata>();
  const saveMetadata = vi.fn<(...args: [SessionMetadata]) => Promise<void>>(async metadata => { stored.set(metadata.id, structuredClone(metadata)); });
  const persistence = {
    metadataReader: { revalidate: vi.fn(), load: vi.fn(), scan: vi.fn(), loadMetadata: vi.fn(), scanMetadata: vi.fn(), listMetadata: vi.fn() },
    saveMetadata, deleteCurrentMetadata: vi.fn(), assignMetadataToDevice: vi.fn(),
  } as ConversationPersistence;
  const repository = new ConversationRepository({
    persistence, providers: ProviderRegistry, providerSettings: ProviderSettingsCoordinator,
    getSettings: () => settings, getVaultPath: () => '/vault', onConversationDeleted: async () => undefined,
  });
  repository.replaceAll(records);
  const host = {
    app, settings, providerHost: { app, settings, executionLifecycleRegistry: new ProviderExecutionLifecycleRegistry() },
    getCommittedSettings: () => settings, getActiveEnvironmentVariables: () => '',
    projects: { get: () => null },
    getConversationSummary: (id: string) => repository.getSummary(id),
    getConversationSync: (id: string) => repository.getSync(id),
    getCachedConversation: (id: string) => repository.getSync(id),
    getConversationById: async (id: string) => repository.getSync(id),
    getConversationList: () => repository.list(), ensureConversationMetadataLoaded: async () => undefined,
    renameConversation: (id: string, title: string) => repository.rename(id, title),
    updateConversation: vi.fn((id: string, patch: ConversationMutablePatch) => repository.update(id, patch)),
    executionPersistence: repository,
  } as unknown as ChatFeatureHost;
  // createSessionRuntimePool no longer assigns the pool onto the host, so wire it in here.
  const pool = createSessionRuntimePool(() => host);
  Object.assign(host, { sessionRuntimes: pool });
  const refreshModelControls = vi.fn();
  const service = new SessionMessagingService({ getHost: () => host, getActiveConversationId: () => null, refreshModelControls });
  Object.assign(host, { bindSessionTools: (id: string) => service.bindSessionTools(id) });
  const runtime = pool.ensure({ conversationId: 'recipient', providerId: 'kiro', draftModel: null });
  getSessionSettingsSnapshot(runtime, host);
  const reasoningBefore = [...runtime.reasoningSelections];
  const send = (
    choice: { model: string; reasoning?: string } = { model: haiku, reasoning: 'low' },
    signal: AbortSignal = new AbortController().signal,
  ) => service.bindSessionTools('sender').port.send(
    { sessionId: 'recipient', text: 'Incoming task', ...choice }, signal,
  );
  const pauseWrite = () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    saveMetadata.mockImplementationOnce(async metadata => {
      entered.resolve();
      await release.promise;
      stored.set(metadata.id, structuredClone(metadata));
    });
    return { entered: entered.promise, release: () => release.resolve() };
  };
  const waitForSend = () => waitFor(() => expect(runtime.mailbox!.hasPending || vi.mocked(host.updateConversation).mock.calls.length > 0 || refreshModelControls.mock.calls.length > 0).toBe(true));
  return { host, repository, runtime, backend, refreshModelControls, saveMetadata, stored, send, pauseWrite, waitForSend, reasoningBefore };
}

afterEach(() => { ProviderWorkspaceRegistry.clear(); vi.restoreAllMocks(); });

// Upstream #1807 applies a session-tool model switch like the user's own choice: the
// switch commits and persists, and a send that fails after it keeps the switch rather
// than rolling back. Only a failed model WRITE leaves the prior selection intact.
it('rejects a send whose model write fails without switching reasoning or delivering', async () => {
  const h = setup();
  h.saveMetadata.mockRejectedValueOnce(new Error('Disk unavailable'));
  await expect(h.send()).rejects.toThrow('Disk unavailable');
  expect(h.repository.getSummary('recipient')?.selectedModel).toBe(sonnet);
  expect([...h.runtime.reasoningSelections]).toEqual(h.reasoningBefore);
  expect(h.runtime.mailbox!.hasPending).toBe(false);
  expect(h.backend.sessions).toHaveLength(0);
  expect(h.refreshModelControls).not.toHaveBeenCalled();
});

it('keeps a committed switch but delivers nothing when the send is cancelled during its model write', async () => {
  const h = setup();
  const write = h.pauseWrite();
  const cancellation = new AbortController();
  const sending = h.send({ model: haiku }, cancellation.signal);
  await write.entered;
  cancellation.abort();
  write.release();
  await expect(sending).rejects.toMatchObject({ name: 'AbortError' });
  expect(h.repository.getSummary('recipient')?.selectedModel).toBe(haiku);
  expect(h.runtime.mailbox!.hasPending).toBe(false);
  expect(h.backend.sessions).toHaveLength(0);
});

it('applies its switch after a pending user model choice instead of rejecting the message', async () => {
  const h = setup();
  const write = h.pauseWrite();
  const selecting = h.repository.update('recipient', { selectedModel: haiku });
  await write.entered;
  const sending = h.send({ model: opus });
  try { await h.waitForSend(); } finally { write.release(); }
  await selecting;
  await expect(sending).resolves.toMatchObject({ sessionId: 'recipient', status: 'started' });
  expect(h.repository.getSummary('recipient')?.selectedModel).toBe(opus);
  await waitFor(() => expect(h.backend.sessions[0]?.requests).toHaveLength(1));
  expect(h.backend.latest.requests[0].configuration).toMatchObject({ model: opus });
  h.backend.latest.complete();
  await h.runtime.turns.drain();
});

it('does not reject an admitted switch when its presentation refresh throws', async () => {
  const h = setup();
  h.refreshModelControls.mockImplementation(() => { throw new Error('View closed'); });
  await expect(h.send()).resolves.toEqual({ sessionId: 'recipient', title: 'recipient', provider: 'kiro', status: 'started' });
  await waitFor(() => expect(h.backend.sessions[0]?.requests).toHaveLength(1));
  expect(h.backend.latest.requests[0].configuration).toMatchObject({ model: haiku, reasoning: 'low' });
  h.backend.latest.complete();
  await h.runtime.turns.drain();
});

it('discards a failed metadata write without committing reasoning or message admission', async () => {
  const h = setup();
  h.saveMetadata.mockRejectedValueOnce(new Error('Disk unavailable'));
  await expect(h.send()).rejects.toThrow('Disk unavailable');
  expect(h.repository.getSummary('recipient')?.selectedModel).toBe(sonnet);
  expect([...h.runtime.reasoningSelections]).toEqual(h.reasoningBefore);
  expect(h.runtime.mailbox!.hasPending).toBe(false);
  expect(h.backend.sessions).toHaveLength(0);
  expect(h.refreshModelControls).not.toHaveBeenCalled();
});
