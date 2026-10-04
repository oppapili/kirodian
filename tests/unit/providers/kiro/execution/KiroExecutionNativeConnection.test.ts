import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

jest.mock('cross-spawn', () => jest.fn());

import spawn from 'cross-spawn';

import { ACPJSONRPCTransport } from '@/providers/acp';
import { KiroExecutionNativeConnectionImpl } from '@/providers/kiro/execution/KiroExecutionNativeConnection';

function createNativeProcess() {
  const proc = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    killed: false,
    pid: 4321,
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    kill: () => {
      proc.exitCode = 0;
      proc.killed = true;
      proc.emit('exit', 0, null);
      return true;
    },
  });
  jest.mocked(spawn).mockReturnValue(proc as unknown as ChildProcessWithoutNullStreams);
  return proc;
}

// The `_kiro.dev/commands/available` payload Kiro actually pushes after
// `session/new`: a `commands` array of built-in slash commands and a `prompts`
// array of agent skills tagged `serverName: "skill:config"`.
const COMMANDS_AVAILABLE_PAYLOAD = {
  sessionId: 'session-kiro',
  commands: [
    { name: '/agent', description: 'Select or list available agents' },
    { name: '/model' },
  ],
  prompts: [
    {
      name: 'hello-skill',
      description: 'A test skill that greets you',
      arguments: [],
      serverName: 'skill:config',
    },
  ],
};

function tick(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

describe('KiroExecutionNativeConnection listCommands', () => {
  let transport: ACPJSONRPCTransport;
  let connection: KiroExecutionNativeConnectionImpl;

  function connect(commandsAvailableTimeoutMs?: number): KiroExecutionNativeConnectionImpl {
    return new KiroExecutionNativeConnectionImpl({
      command: '/opt/kiro-cli',
      cwd: '/vault',
      env: {},
      requestExtension: async () => null,
      requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
      version: 'test',
    }, commandsAvailableTimeoutMs);
  }

  beforeEach(() => {
    const proc = createNativeProcess();
    transport = new ACPJSONRPCTransport({ input: proc.stdin, output: proc.stdout });
    transport.onRequest('initialize', () => ({ protocolVersion: 1 }));
    transport.start();
    connection = connect();
  });

  afterEach(async () => {
    await connection.shutdown();
    transport.dispose();
  });

  it('establishes a session and returns commands + skills after the commands/available push', async () => {
    let newSessionParams: unknown;
    transport.onRequest('session/new', params => {
      newSessionParams = params;
      // Emulate Kiro: the catalog is pushed only after the session is created.
      queueMicrotask(() => {
        transport.notify('_kiro.dev/commands/available', COMMANDS_AVAILABLE_PAYLOAD);
      });
      return { sessionId: 'session-kiro' };
    });

    await connection.initialize();
    const commands = await connection.listCommands('/vault');

    // The probe query must open a session — this is the fix: the previous
    // implementation returned the empty seed without ever calling session/new,
    // so the catalog push never fired and the dropdown stayed empty.
    expect(newSessionParams).toEqual({ cwd: '/vault', mcpServers: [] });

    expect(commands.map(command => command.name)).toEqual(['agent', 'model', 'hello-skill']);
    const skill = commands.find(command => command.name === 'hello-skill');
    expect(skill).toMatchObject({ kind: 'skill', id: 'acp-skill:hello-skill' });
    // Built-in commands come through `normalizeACPAvailableCommands`, which does
    // not tag a `kind`; the catalog treats any non-`skill` entry as a command.
    const builtIn = commands.find(command => command.name === 'agent');
    expect(builtIn?.kind).not.toBe('skill');
    expect(builtIn).toMatchObject({ id: 'acp:agent' });
  });

  it('resolves with the current catalog when no push arrives before the timeout', async () => {
    await connection.shutdown();
    connection = connect(20);
    transport.onRequest('session/new', () => ({ sessionId: 'session-kiro' }));
    await connection.initialize();

    // No `_kiro.dev/commands/available` push is ever emitted, so the wait falls
    // back to the (empty) seed catalog once the short timeout elapses instead of
    // hanging the probe forever.
    await expect(connection.listCommands('/vault')).resolves.toEqual([]);
  });

  it('rejects with an abort error when the caller signal aborts during the wait', async () => {
    const controller = new AbortController();
    transport.onRequest('session/new', () => {
      // Session opens, but the catalog push never arrives; the caller aborts.
      queueMicrotask(() => controller.abort());
      return { sessionId: 'session-kiro' };
    });

    await connection.initialize();

    // toAbortError preserves the signal's own AbortError, so the message is the
    // runtime's standard abort text rather than the fallback — what matters is
    // the wait rejects (an aborted probe surfaces an abort) rather than resolving.
    await expect(connection.listCommands('/vault', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('rejects immediately when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let newSessionCalled = false;
    transport.onRequest('session/new', () => {
      newSessionCalled = true;
      return { sessionId: 'session-kiro' };
    });

    await connection.initialize();

    await expect(connection.listCommands('/vault', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    await tick();
    // A pre-aborted caller must not even open a session.
    expect(newSessionCalled).toBe(false);
  });
});
