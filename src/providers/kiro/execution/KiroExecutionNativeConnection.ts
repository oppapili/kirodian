import type { SlashCommand } from '../../../core/types';
import { toAbortError } from '../../../utils/abort';
import {
  ACPClientConnection,
  ACPJSONRPCTransport,
  ACPSubprocess,
} from '../../acp';
import {
  KIRO_COMMANDS_AVAILABLE_NOTIFICATION_METHODS,
  parseKiroAvailableCommandsNotification,
} from '../runtime/KiroSessionNotifications';
import type {
  KiroExecutionNativeConnection,
  KiroExecutionNativeCreateOptions,
} from './KiroExecutionBackend';

const LIST_COMMANDS_ABORT_MESSAGE = 'Kiro command metadata listing aborted';

// How long `listCommands` waits for the first `_kiro.dev/commands/available`
// push after a session is created before falling back to whatever catalog has
// arrived so far. Kiro emits the notification promptly on `session/new`, so this
// is a safety net for the "notification never arrives" case, not the happy path.
const COMMANDS_AVAILABLE_TIMEOUT_MS = 5000;

// Kiro exposes its slash-command catalog by pushing `_kiro.dev/commands/available`
// notifications after a session is created, rather than answering a synchronous
// list request. That push arrives ONLY
// after `session/new` — an `initialize()`-only connection never receives it — so
// `listCommands` must establish a session and wait for the first catalog push
// before resolving. We capture the most recent catalog per connection so the wait
// resolves against real data instead of the empty seed.
export class KiroExecutionNativeConnectionImpl
implements KiroExecutionNativeConnection {
  private readonly commandsAvailableTimeoutMs: number;
  private readonly connection: ACPClientConnection;
  private commandsAvailableReceived = false;
  private readonly commandsAvailableWaiters = new Set<() => void>();
  private latestCommands: SlashCommand[] = [];
  private readonly listeners = new Set<Parameters<KiroExecutionNativeConnection['onNotification']>[0]>();
  private readonly process: ACPSubprocess;
  private readonly transport: ACPJSONRPCTransport;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    options: KiroExecutionNativeCreateOptions,
    commandsAvailableTimeoutMs: number = COMMANDS_AVAILABLE_TIMEOUT_MS,
  ) {
    this.commandsAvailableTimeoutMs = commandsAvailableTimeoutMs;
    this.process = new ACPSubprocess({
      args: ['acp'],
      command: options.command,
      cwd: options.cwd,
      env: options.env,
    });
    this.process.start();
    this.transport = new ACPJSONRPCTransport({
      input: this.process.stdout,
      onClose: listener => this.process.onClose(listener),
      output: this.process.stdin,
    });
    this.connection = new ACPClientConnection({
      clientInfo: { name: 'claudian', version: options.version },
      delegate: {
        onSessionNotification: notification => this.notify(notification, 'standard'),
        requestPermission: request => options.requestPermission(request),
      },
      transport: this.transport,
    });
    for (const method of KIRO_COMMANDS_AVAILABLE_NOTIFICATION_METHODS) {
      this.unsubscribers.push(this.transport.onNotification(method, params => {
        const commands = parseKiroAvailableCommandsNotification(params);
        if (commands) this.latestCommands = commands;
        this.commandsAvailableReceived = true;
        for (const resolve of [...this.commandsAvailableWaiters]) resolve();
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

  // Kiro pushes its command catalog via `_kiro.dev/commands/available`, but only
  // after a session exists. Establish one, wait for the first catalog push (or a
  // short timeout / caller abort), then return whatever catalog has arrived. The
  // probe owns this connection and shuts it down afterwards, so the session is
  // cheap and short-lived; there is no synchronous list RPC to fall back on.
  async listCommands(cwd: string, signal?: AbortSignal): Promise<SlashCommand[]> {
    if (signal?.aborted) throw toAbortError(signal, LIST_COMMANDS_ABORT_MESSAGE);
    if (this.commandsAvailableReceived) return this.latestCommands;

    await this.newSession({ cwd, mcpServers: [] });
    if (signal?.aborted) throw toAbortError(signal, LIST_COMMANDS_ABORT_MESSAGE);

    await this.waitForCommandsAvailable(signal);
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
    for (const resolve of [...this.commandsAvailableWaiters]) resolve();
    this.commandsAvailableWaiters.clear();
    this.listeners.clear();
    this.connection.dispose();
    this.transport.dispose();
    await this.process.shutdown();
  }

  // Resolve once the first `_kiro.dev/commands/available` push arrives. Races the
  // push against a short timeout and the caller's abort signal so a session that
  // never emits the catalog cannot hang the probe. A timeout resolves (returning
  // the current catalog); only an abort rejects, mirroring the OwnedProbeRegistry
  // contract that a cancelled probe surfaces an abort error.
  private waitForCommandsAvailable(signal?: AbortSignal): Promise<void> {
    if (this.commandsAvailableReceived) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        this.commandsAvailableWaiters.delete(onReceived);
        window.clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const onReceived = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(toAbortError(signal!, LIST_COMMANDS_ABORT_MESSAGE));
      };
      const timer = window.setTimeout(onReceived, this.commandsAvailableTimeoutMs);
      this.commandsAvailableWaiters.add(onReceived);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private notify(
    notification: Parameters<Parameters<KiroExecutionNativeConnection['onNotification']>[0]>[0],
    source: 'extension' | 'standard',
  ): void {
    for (const listener of this.listeners) listener(notification, source);
  }
}
