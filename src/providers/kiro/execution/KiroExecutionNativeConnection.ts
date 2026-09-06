import {
  AcpClientConnection,
  AcpJsonRpcTransport,
  AcpSubprocess,
  normalizeAcpAvailableCommands,
} from '../../acp';
import {
  requestKiroInterjection,
  requestKiroRewind,
  requestKiroSessionFork,
} from '../runtime/KiroExtensionRequests';
import {
  KIRO_SESSION_UPDATE_NOTIFICATION_METHODS,
  KIRO_WRAPPED_SESSION_NOTIFICATION_METHOD,
  parseKiroSessionNotification,
} from '../runtime/KiroSessionNotifications';
import type {
  KiroExecutionNativeConnection,
  KiroExecutionNativeCreateOptions,
} from './KiroExecutionBackend';
import { parseKiroModelUpdateState } from './KiroSessionModelMetadata';

const KIRO_EXTENSION_REQUEST_METHODS = [
  'x.ai/ask_user_question',
  '_x.ai/ask_user_question',
  'x.ai/exit_plan_mode',
  '_x.ai/exit_plan_mode',
] as const;

const KIRO_EXTENSION_NOTIFICATION_METHODS = [
  'x.ai/yolo_mode_changed',
  '_x.ai/yolo_mode_changed',
] as const;

const KIRO_MODEL_UPDATE_NOTIFICATION_METHODS = [
  'x.ai/models/update',
  '_x.ai/models/update',
] as const;

export class KiroExecutionNativeConnectionImpl
implements KiroExecutionNativeConnection {
  private readonly connection: AcpClientConnection;
  private readonly listeners = new Set<Parameters<KiroExecutionNativeConnection['onNotification']>[0]>();
  private readonly modeListeners = new Set<(mode: 'normal' | 'yolo') => void>();
  private readonly modelListeners = new Set<
    Parameters<NonNullable<KiroExecutionNativeConnection['onModelsChanged']>>[0]
  >();
  private readonly process: AcpSubprocess;
  private readonly transport: AcpJsonRpcTransport;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(options: KiroExecutionNativeCreateOptions) {
    this.process = new AcpSubprocess({
      args: ['agent', '--no-leader', 'stdio'],
      command: options.command,
      cwd: options.cwd,
      env: options.env,
    });
    this.process.start();
    this.transport = new AcpJsonRpcTransport({
      input: this.process.stdout,
      onClose: listener => this.process.onClose(listener),
      output: this.process.stdin,
    });
    this.connection = new AcpClientConnection({
      clientInfo: { name: 'claudian', version: options.version },
      delegate: {
        onSessionNotification: notification => this.notify(notification, 'standard'),
        requestPermission: request => options.requestPermission(request),
      },
      methodOverrides: { cancel: 'session/cancel' },
      transport: this.transport,
    });
    for (const method of [
      ...KIRO_SESSION_UPDATE_NOTIFICATION_METHODS,
      KIRO_WRAPPED_SESSION_NOTIFICATION_METHOD,
    ]) {
      this.unsubscribers.push(this.transport.onNotification(method, params => {
        const notification = parseKiroSessionNotification(method, params);
        if (notification) this.notify(notification, 'extension');
      }));
    }
    for (const method of KIRO_EXTENSION_REQUEST_METHODS) {
      this.unsubscribers.push(this.transport.onRequest(
        method,
        params => options.requestExtension(method, params),
      ));
    }
    for (const method of KIRO_EXTENSION_NOTIFICATION_METHODS) {
      this.unsubscribers.push(this.transport.onNotification(method, params => {
        if (!isRecord(params) || typeof params.yolo_mode !== 'boolean') return;
        const mode = params.yolo_mode ? 'yolo' : 'normal';
        for (const listener of this.modeListeners) listener(mode);
      }));
    }
    for (const method of KIRO_MODEL_UPDATE_NOTIFICATION_METHODS) {
      this.unsubscribers.push(this.transport.onNotification(method, params => {
        const models = parseKiroModelUpdateState(params);
        if (!models) return;
        for (const listener of this.modelListeners) listener(models);
      }));
    }
  }

  cancel(sessionId: string): void {
    this.connection.cancel({ sessionId });
  }

  flush(): Promise<void> {
    return this.transport.flush();
  }

  fork: NonNullable<KiroExecutionNativeConnection['fork']> = request => (
    requestKiroSessionFork(this.transport, request)
  );

  async initialize(): Promise<void> {
    await this.connection.initialize();
  }

  isAlive(): boolean {
    return this.process.isAlive();
  }

  interject(
    request: Parameters<typeof requestKiroInterjection>[1],
    signal?: AbortSignal,
  ): Promise<void> {
    return requestKiroInterjection(this.transport, request, signal);
  }

  loadSession: KiroExecutionNativeConnection['loadSession'] = request => (
    this.connection.loadSession(request)
  );

  async listCommands(
    cwd: string,
    signal?: AbortSignal,
  ): Promise<Awaited<ReturnType<KiroExecutionNativeConnection['listCommands']>>> {
    const response = await this.transport.request<{ commands?: unknown }>(
      '_x.ai/commands/list',
      { cwd },
      { signal, timeoutMs: 5_000 },
    );
    if (!Array.isArray(response.commands)) {
      throw new Error('Kiro returned malformed command metadata.');
    }
    return normalizeAcpAvailableCommands(response.commands);
  }

  newSession: KiroExecutionNativeConnection['newSession'] = request => (
    this.connection.newSession(request)
  );

  onNotification(
    listener: Parameters<KiroExecutionNativeConnection['onNotification']>[0],
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onModeChanged(listener: (mode: 'normal' | 'yolo') => void): () => void {
    this.modeListeners.add(listener);
    return () => this.modeListeners.delete(listener);
  }

  onModelsChanged(
    listener: Parameters<NonNullable<KiroExecutionNativeConnection['onModelsChanged']>>[0],
  ): () => void {
    this.modelListeners.add(listener);
    return () => this.modelListeners.delete(listener);
  }

  prompt: KiroExecutionNativeConnection['prompt'] = request => (
    this.connection.prompt(request)
  );

  rewind: NonNullable<KiroExecutionNativeConnection['rewind']> = request => (
    requestKiroRewind(this.transport, request)
  );

  setMode: KiroExecutionNativeConnection['setMode'] = request => (
    this.connection.setMode(request)
  );

  setModel: KiroExecutionNativeConnection['setModel'] = request => (
    this.connection.setModel(request)
  );

  async shutdown(): Promise<void> {
    while (this.unsubscribers.length > 0) this.unsubscribers.pop()?.();
    this.listeners.clear();
    this.modeListeners.clear();
    this.modelListeners.clear();
    this.connection.dispose();
    this.transport.dispose();
    await this.process.shutdown();
  }

  private notify(
    notification: Parameters<Parameters<KiroExecutionNativeConnection['onNotification']>[0]>[0],
    source: 'extension' | 'standard',
  ): void {
    for (const listener of this.listeners) listener(notification, source);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
