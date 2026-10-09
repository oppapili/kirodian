import { copyProviderHistoryState } from '../../../core/providers/providerHistory';
import { mergePersistedProviderState } from '../../../core/providers/providerState';
import type {
  ProviderConversationHistoryService,
  ProviderHistoryInput,
  ProviderHistoryPathContext,
  ProviderHistoryResult,
  ProviderHistoryState,
  ProviderHistoryUpdate,
} from '../../../core/providers/types';
import {
  buildPersistedKiroProviderState,
  parseKiroProviderState,
} from '../types';
import { resolveKiroSessionDirectory } from './KiroHistoryPathResolver';
import { loadKiroHistory } from './KiroHistoryStore';

const KIRO_PROVIDER_STATE_KEYS = [
  'forkSource',
  'forkSourceSessionDirectory',
  'nativeConversationContextEstablished',
  'sessionDirectory',
] as const;

export class KiroConversationHistoryService implements ProviderConversationHistoryService {
  // Keyed by the resolved session id (application `id` is no longer part of the native
  // history input under upstream's immutable propose-changes contract). The value is the
  // `sessionId::sessionDirectory` hydration key, so a repeat hydrate of the same resolved
  // session with messages already present can skip re-parsing, as before.
  private readonly hydratedKeys = new Map<string, string>();

  async hydrateConversationHistory(
    input: ProviderHistoryInput,
    vaultPath: string | null,
    pathContext?: ProviderHistoryPathContext,
  ): Promise<ProviderHistoryUpdate> {
    const conversation = copyProviderHistoryState(input);
    const state = parseKiroProviderState(conversation.providerState);
    if (this.isPendingForkConversation(conversation)) {
      const cacheKey = conversation.providerState && state.forkSource
        ? state.forkSource.sessionId
        : null;
      if (!pathContext) {
        if (cacheKey) this.hydratedKeys.delete(cacheKey);
        return conversation;
      }
      const forkSource = state.forkSource!;
      const sourceSessionDirectory = resolveKiroSessionDirectory(
        state.forkSourceSessionDirectory,
        forkSource.sessionId,
        vaultPath,
        pathContext,
      );
      if (sourceSessionDirectory !== state.forkSourceSessionDirectory) {
        conversation.providerState = mergePersistedProviderState(
          conversation.providerState,
          KIRO_PROVIDER_STATE_KEYS,
          buildPersistedKiroProviderState({
            ...state,
            forkSourceSessionDirectory: sourceSessionDirectory ?? undefined,
          }) as Record<string, unknown> | undefined,
        );
      }
      if (conversation.messages.length > 0) return conversation;
      if (!sourceSessionDirectory) {
        this.hydratedKeys.delete(forkSource.sessionId);
        return conversation;
      }
      const hydrationKey = `fork::${sourceSessionDirectory}::${forkSource.resumeAt}`;
      const parsed = await loadKiroHistory(sourceSessionDirectory, forkSource.sessionId);
      const checkpointIndex = parsed.messages.findIndex(message => (
        message.role === 'assistant' && message.assistantMessageId === forkSource.resumeAt
      ));
      if (checkpointIndex < 0) {
        this.hydratedKeys.delete(forkSource.sessionId);
        return conversation;
      }
      conversation.messages = parsed.messages.slice(0, checkpointIndex + 1);
      this.hydratedKeys.set(forkSource.sessionId, hydrationKey);
      return conversation;
    }

    const sessionId = conversation.sessionId;
    if (!sessionId || !pathContext) {
      if (sessionId) this.hydratedKeys.delete(sessionId);
      return conversation;
    }
    const sessionDirectory = resolveKiroSessionDirectory(
      state.sessionDirectory,
      sessionId,
      vaultPath,
      pathContext,
    );
    if (sessionDirectory !== state.sessionDirectory) {
      conversation.providerState = mergePersistedProviderState(
        conversation.providerState,
        KIRO_PROVIDER_STATE_KEYS,
        buildPersistedKiroProviderState({
          ...state,
          sessionDirectory: sessionDirectory ?? undefined,
        }) as Record<string, unknown> | undefined,
      );
    }
    if (!sessionDirectory) {
      this.hydratedKeys.delete(sessionId);
      return conversation;
    }

    const hydrationKey = `${sessionId}::${sessionDirectory}`;
    if (
      conversation.messages.length > 0
      && this.hydratedKeys.get(sessionId) === hydrationKey
    ) {
      return conversation;
    }
    const parsed = await loadKiroHistory(sessionDirectory, sessionId);
    if (parsed.messages.length === 0) {
      this.hydratedKeys.delete(sessionId);
      return conversation;
    }
    conversation.messages = parsed.messages;
    const hydratedState = parseKiroProviderState(conversation.providerState);
    if (hydratedState.nativeConversationContextEstablished === false) {
      conversation.providerState = mergePersistedProviderState(
        conversation.providerState,
        KIRO_PROVIDER_STATE_KEYS,
        buildPersistedKiroProviderState({
          ...hydratedState,
          nativeConversationContextEstablished: true,
        }) as Record<string, unknown> | undefined,
      );
    }
    this.hydratedKeys.set(sessionId, hydrationKey);
    return conversation;
  }

  resolveSessionIdForConversation(conversation: ProviderHistoryInput | null): string | null {
    const state = parseKiroProviderState(conversation?.providerState);
    return conversation?.sessionId ?? state.forkSource?.sessionId ?? null;
  }

  async resolveMissingConversationSession(
    input: ProviderHistoryInput,
    _vaultPath: string | null,
    missingProviderSessionId?: string,
  ): Promise<ProviderHistoryResult<'delete' | 'reset' | 'preserve'>> {
    if (
      !input.sessionId
      || !missingProviderSessionId
      || input.sessionId !== missingProviderSessionId
    ) {
      return { outcome: 'preserve' };
    }

    const conversation = copyProviderHistoryState(input);
    const providerState = { ...conversation.providerState };
    for (const key of KIRO_PROVIDER_STATE_KEYS) delete providerState[key];
    conversation.sessionId = null;
    conversation.providerState = Object.keys(providerState).length > 0
      ? providerState
      : undefined;
    this.hydratedKeys.delete(input.sessionId);
    return { outcome: 'reset', changes: conversation };
  }

  isPendingForkConversation(conversation: ProviderHistoryInput): boolean {
    const state = parseKiroProviderState(conversation.providerState);
    return Boolean(state.forkSource && !conversation.sessionId);
  }

  buildForkProviderState(
    sourceSessionId: string,
    resumeAt: string,
    sourceProviderState?: Record<string, unknown>,
  ): Record<string, unknown> {
    const sourceState = parseKiroProviderState(sourceProviderState);
    return (buildPersistedKiroProviderState({
      forkSource: { resumeAt, sessionId: sourceSessionId },
      ...(sourceState.sessionDirectory || sourceState.forkSourceSessionDirectory
        ? {
          forkSourceSessionDirectory: sourceState.sessionDirectory
            ?? sourceState.forkSourceSessionDirectory,
        }
        : {}),
    }) as Record<string, unknown> | undefined) ?? {};
  }

  buildPersistedProviderState(
    conversation: ProviderHistoryInput,
  ): Record<string, unknown> | undefined {
    return mergePersistedProviderState(
      conversation.providerState,
      KIRO_PROVIDER_STATE_KEYS,
      buildPersistedKiroProviderState(
        parseKiroProviderState(conversation.providerState),
      ) as Record<string, unknown> | undefined,
    );
  }
}
