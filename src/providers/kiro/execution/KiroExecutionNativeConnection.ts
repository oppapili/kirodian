import type { SlashCommand } from '../../../core/types';
import {
  AcpClientConnection,
  AcpJsonRpcTransport,
  AcpSubprocess,
  normalizeAcpAvailableCommands,
} from '../../acp';
import {
  KIRO_COMMANDS_AVAILABLE_NOTIFICATION_METHODS,
  parseKiroAvailableCommandsNotification,
} from '../runtime/KiroSessionNotifications';
import type {
  KiroExecutionNativeConnection,
  KiroExecutionNativeCreateOptions,
} from './KiroExecutionBackend';

// Kiro exposes its slash-command catalog by pushing `_kiro.dev/commands/available`
// notifications after a session is created, rather than answering a synchronous
// list request the way Grok's `_x.ai/commands/list` does. We capture the most
// recent catalog per cwd so `listCommands` can resolve against it without a
// round-trip the agent does not support.
export class KiroExecutionNativeConnectionImpl
implements KiroExecutionNativeConnection {
  private readonly connection: AcpClientConnection;
  private latestCommands: SlashCommand[] = [];
  private readonly listeners = new Set<Parameters<KiroExecutionNativeConnection['onNotification']>[0]>();
  private readonly process: AcpSubprocess;
  private readonly transport: AcpJsonRpcTransport;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(options: KiroExecutionNativeCreateOptions) {
    this.process = new AcpSubprocess({
      args: ['acp'],
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
    for (const method of KIRO_COMMANDS_AVAILABLE_NOTIFICATION_METHODS) {
      this.unsubscribers.push(this.transport.onNotification(method, params => {
        const commands = parseKiroAvailableCommandsNotification(params);
        if (commands) this.latestCommands = normalizeAcpAvailableCommands(commands);
      }));
    }
  }

  cancel(sessionId: string): void {
    this.connection.cancel({ sessionId });
  }

  flush(): Promise<void> {
    return this.transport.flush();
  }

  async initialize(): Promise<void> {
    await this.connection.initialize();
  }

  isAlive(): boolean {
    return this.process.isAlive();
  }

  loadSession: KiroExecutionNativeConnection['loadSession'] = request => (
    this.connection.loadSession(request)
  );

  // Kiro pushes its command catalog via `_kiro.dev/commands/available`; return the
  // latest catalog captured for this connection instead of issuing a list request.
  async listCommands(): Promise<SlashCommand[]> {
    return this.latestCommands;
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

  prompt: KiroExecutionNativeConnection['prompt'] = request => (
    this.connection.prompt(request)
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
