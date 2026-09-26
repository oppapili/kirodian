import type {
  ProviderExecutionBackend,
  ProviderExecutionSession,
  ProviderSessionConfig,
} from '../../../core/execution';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type { SlashCommand } from '../../../core/types';
import type {
  ACPLoadSessionRequest,
  ACPLoadSessionResponse,
  ACPNewSessionRequest,
  ACPNewSessionResponse,
  ACPPromptRequest,
  ACPPromptResponse,
  ACPRequestPermissionRequest,
  ACPRequestPermissionResponse,
  ACPSessionModelState,
  ACPSessionNotification,
  ACPSetSessionModelRequest,
  ACPSetSessionModelResponse,
  ACPSetSessionModeRequest,
} from '../../acp';
import type { KiroCommandCatalog } from '../commands/KiroCommandCatalog';
import { loadKiroPromptIndexAfterAssistant } from '../history/KiroHistoryStore';
import type { KiroModelCatalogCoordinator } from '../runtime/KiroModelCatalogCoordinator';
import { KiroExecutionNativeConnectionImpl } from './KiroExecutionNativeConnection';
import { KiroExecutionSession } from './KiroExecutionSession';

export interface KiroExecutionNativeConnection {
  cancel(sessionId: string): void;
  flush?(): Promise<void>;
  fork?(request: {
    newCwd: string;
    newModelId?: string;
    sourceCwd: string;
    sourceSessionId: string;
    targetPromptIndex: number;
  }): Promise<{
    newCwd: string;
    newSessionId: string;
    parentSessionId: string;
  }>;
  initialize(): Promise<void>;
  isAlive?(): boolean;
  interject?(request: {
    content: ACPPromptRequest['prompt'];
    interjectionId: string;
    sessionId: string;
    text: string;
  }, signal?: AbortSignal): Promise<void>;
  loadSession(request: ACPLoadSessionRequest): Promise<ACPLoadSessionResponse>;
  listCommands(cwd: string, signal?: AbortSignal): Promise<SlashCommand[]>;
  newSession(request: ACPNewSessionRequest): Promise<ACPNewSessionResponse>;
  onNotification(
    listener: (
      notification: ACPSessionNotification,
      source: 'extension' | 'standard',
    ) => void,
  ): () => void;
  onModeChanged?(listener: (mode: 'normal' | 'yolo') => void): () => void;
  onModelsChanged?(listener: (models: ACPSessionModelState) => void): () => void;
  prompt(request: ACPPromptRequest): Promise<ACPPromptResponse>;
  rewind?(request: {
    force: boolean;
    mode: 'all' | 'conversation_only' | 'files_only';
    sessionId: string;
    targetPromptIndex: number;
  }): Promise<{
    cleanFiles: string[];
    conflicts: Array<{ conflictType: string; path: string }>;
    error: string | null;
    revertedFiles: string[];
    success: boolean;
  }>;
  setMode(request: ACPSetSessionModeRequest): Promise<unknown>;
  setModel(request: ACPSetSessionModelRequest): Promise<ACPSetSessionModelResponse>;
  shutdown(): Promise<void>;
}

export interface KiroExecutionNativeCreateOptions {
  readonly command: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly requestPermission: (
    request: ACPRequestPermissionRequest,
    signal?: AbortSignal,
  ) => Promise<ACPRequestPermissionResponse>;
  readonly requestExtension: (
    method: string,
    params: unknown,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  readonly version: string;
}

export interface KiroExecutionNativeFactory {
  create(options: KiroExecutionNativeCreateOptions): KiroExecutionNativeConnection;
}

export interface KiroExecutionBackendOptions {
  readonly commandCatalog?: Pick<KiroCommandCatalog, 'setCommandSnapshot'>;
  readonly modelCatalogCoordinator?: Pick<KiroModelCatalogCoordinator, 'mergeLiveModels'>;
  readonly nativeFactory?: KiroExecutionNativeFactory;
  readonly resolvePromptIndex?: (
    sessionDirectory: string,
    providerSessionId: string,
    assistantMessageId: string,
  ) => Promise<number | null>;
}

export class KiroExecutionBackend implements ProviderExecutionBackend {
  readonly providerId = 'kiro' as const;
  private readonly nativeFactory: KiroExecutionNativeFactory;

  constructor(
    private readonly plugin: ProviderHost,
    private readonly options: KiroExecutionBackendOptions = {},
  ) {
    this.nativeFactory = options.nativeFactory ?? {
      create: nativeOptions => new KiroExecutionNativeConnectionImpl(nativeOptions),
    };
  }

  createSession(config: ProviderSessionConfig): ProviderExecutionSession {
    return new KiroExecutionSession(this.plugin, config, {
      commandCatalog: this.options.commandCatalog,
      modelCatalogCoordinator: this.options.modelCatalogCoordinator,
      nativeFactory: this.nativeFactory,
      resolvePromptIndex: this.options.resolvePromptIndex
        ?? ((directory, providerSessionId, assistantId) => loadKiroPromptIndexAfterAssistant(
          directory,
          providerSessionId,
          assistantId,
        )),
    });
  }
}
