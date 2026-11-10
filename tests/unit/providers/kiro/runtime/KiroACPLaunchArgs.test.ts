import {
  buildKiroACPArgs,
  resolveKiroACPArgs,
} from '@/providers/kiro/runtime/KiroACPLaunchArgs';
import type {
  KiroCatalogCommandRequest,
  KiroCatalogCommandResult,
  KiroCatalogCommandRunner,
} from '@/providers/kiro/runtime/KiroModelCatalogService';

const PINNED_ARGS = ['acp', '--agent-engine', 'v2'];

describe('buildKiroACPArgs', () => {
  it.each([
    ['kiro-cli 3.1.0\n'],
    ['kiro-cli 3.0.0\n'],
    ['kiro-cli 2.36.0\n'],
    ['kiro-cli 2.40.1\n'],
    ['kiro-cli 2.36.0-beta.1\n'],
  ])('should pin the V2 engine for %j, which accepts --agent-engine', (output) => {
    expect(buildKiroACPArgs(output)).toEqual(PINNED_ARGS);
  });

  it.each([
    ['kiro-cli 2.35.9\n'],
    ['kiro-cli 2.9.0\n'],
    ['kiro-cli 1.28.3\n'],
  ])('should not pass --agent-engine to %j, which predates the flag', (output) => {
    expect(buildKiroACPArgs(output)).toEqual(['acp']);
  });

  it.each([
    ['no output', null],
    ['an empty output', ''],
    ['an output without a version', 'kiro-cli dev build'],
  ])('should pin the V2 engine when the version is undetermined (%s)', (_label, output) => {
    expect(buildKiroACPArgs(output)).toEqual(PINNED_ARGS);
  });
});

describe('resolveKiroACPArgs', () => {
  const context = { command: '/opt/kiro-cli', cwd: '/vault', env: { PATH: '/bin' } };

  function runnerReturning(result: KiroCatalogCommandResult | Error): {
    requests: KiroCatalogCommandRequest[];
    runner: KiroCatalogCommandRunner;
  } {
    const requests: KiroCatalogCommandRequest[] = [];
    return {
      requests,
      runner: {
        run: async (request) => {
          requests.push(request);
          if (result instanceof Error) throw result;
          return result;
        },
      },
    };
  }

  it('should ask the resolved CLI for its version in the launch environment', async () => {
    const { requests, runner } = runnerReturning({ exitCode: 0, stderr: '', stdout: 'kiro-cli 3.1.0\n' });

    await resolveKiroACPArgs(context, undefined, runner);

    expect(requests).toMatchObject([{ args: ['--version'], command: '/opt/kiro-cli', cwd: '/vault', env: { PATH: '/bin' } }]);
  });

  it('should omit --agent-engine for a CLI older than the flag', async () => {
    const { runner } = runnerReturning({ exitCode: 0, stderr: '', stdout: 'kiro-cli 2.20.0\n' });

    await expect(resolveKiroACPArgs(context, undefined, runner)).resolves.toEqual(['acp']);
  });

  it('should pin the V2 engine for a CLI that has the flag', async () => {
    const { runner } = runnerReturning({ exitCode: 0, stderr: '', stdout: 'kiro-cli 3.1.0\n' });

    await expect(resolveKiroACPArgs(context, undefined, runner)).resolves.toEqual(PINNED_ARGS);
  });

  it('should treat a failing version command as an undetermined version', async () => {
    const { runner } = runnerReturning({ exitCode: 1, stderr: '', stdout: 'kiro-cli 2.20.0\n' });

    await expect(resolveKiroACPArgs(context, undefined, runner)).resolves.toEqual(PINNED_ARGS);
  });

  it('should treat a timed out version command as an undetermined version', async () => {
    const { runner } = runnerReturning({ exitCode: null, stderr: '', stdout: '', termination: 'timeout' });

    await expect(resolveKiroACPArgs(context, undefined, runner)).resolves.toEqual(PINNED_ARGS);
  });

  it('should treat a runner that throws as an undetermined version', async () => {
    const { runner } = runnerReturning(new Error('spawn failed'));

    await expect(resolveKiroACPArgs(context, undefined, runner)).resolves.toEqual(PINNED_ARGS);
  });
});
