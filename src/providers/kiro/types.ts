import * as path from 'path';

export interface KiroProviderState {
  forkSource?: KiroForkSource;
  forkSourceSessionDirectory?: string;
  nativeConversationContextEstablished?: boolean;
  sessionDirectory?: string;
}

export interface KiroForkSource {
  resumeAt: string;
  sessionId: string;
}

export function parseKiroProviderState(value: unknown): KiroProviderState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;
  const forkSource = parseForkSource(record.forkSource);
  const forkSourceSessionDirectory = parseAbsolutePath(record.forkSourceSessionDirectory);
  const nativeConversationContextEstablished = typeof record.nativeConversationContextEstablished
    === 'boolean'
    ? record.nativeConversationContextEstablished
    : undefined;
  const sessionDirectory = parseAbsolutePath(record.sessionDirectory);
  return {
    ...(forkSource ? { forkSource } : {}),
    ...(forkSourceSessionDirectory ? { forkSourceSessionDirectory } : {}),
    ...(nativeConversationContextEstablished !== undefined
      ? { nativeConversationContextEstablished }
      : {}),
    ...(sessionDirectory ? { sessionDirectory } : {}),
  };
}

export function buildKiroProviderState(
  sessionDirectory?: string | null,
): KiroProviderState | undefined {
  return buildPersistedKiroProviderState({ sessionDirectory: sessionDirectory ?? undefined });
}

export function buildPersistedKiroProviderState(
  state: KiroProviderState,
): KiroProviderState | undefined {
  const persisted = parseKiroProviderState(state);
  return Object.keys(persisted).length > 0 ? persisted : undefined;
}

function parseForkSource(value: unknown): KiroForkSource | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const sessionId = normalizeOpaqueString(record.sessionId);
  const resumeAt = normalizeOpaqueString(record.resumeAt);
  return sessionId && resumeAt ? { resumeAt, sessionId } : undefined;
}

function parseAbsolutePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return isAbsolutePath(normalized) ? normalized : undefined;
}

function normalizeOpaqueString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isAbsolutePath(value: string): boolean {
  return Boolean(value) && (path.posix.isAbsolute(value) || path.win32.isAbsolute(value));
}
