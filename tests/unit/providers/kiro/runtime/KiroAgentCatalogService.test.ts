import type { ProviderHost } from '@/core/providers/ProviderHost';
import {
  KiroAgentCatalogService,
  parseKiroAgentListOutput,
} from '@/providers/kiro/runtime/KiroAgentCatalogService';
import type {
  KiroCatalogCommandRequest,
  KiroCatalogCommandResult,
} from '@/providers/kiro/runtime/KiroModelCatalogService';
import { DEFAULT_KIRO_PROVIDER_SETTINGS } from '@/providers/kiro/settings';

function makeHost(options: { enabled?: boolean } = {}): ProviderHost {
  const { enabled = true } = options;
  return {
    app: { vault: { adapter: { basePath: '/tmp/vault' } } },
    getResolvedProviderCliPath: jest.fn(async () => 'kiro-cli'),
    settings: {
      providerConfigs: {
        kiro: { ...DEFAULT_KIRO_PROVIDER_SETTINGS, enabled },
      },
    },
  } as unknown as ProviderHost;
}

function makeRunner(
  handler: (request: KiroCatalogCommandRequest) => KiroCatalogCommandResult,
): { run: jest.Mock } {
  return {
    run: jest.fn(async (request: KiroCatalogCommandRequest) => handler(request)),
  };
}

// Expected values are derived from a captured `kiro-cli agent list` (kiro-cli
// 2.18.0) run under WSL, not from the parser implementation. The capture
// includes the leading `Error: File URI not found` WSL noise line, the
// `Global:` / `Workspace:` section headers, a `*`-marked current agent, a
// wrapped (indented continuation) description, and all three scopes.
const REAL_OUTPUT = [
  'Error: File URI not found for path /mnt/c/Users/dev/.aws/amazonq/agents',
  '',
  '* kiro_default    (Built-in)  Default general-purpose Kiro agent for everyday',
  '                              coding tasks and questions',
  '  kiro_planner    (Built-in)  Plans work before editing any files',
  '  kiro_guide      (Built-in)  Guided, explanation-first assistant',
  '',
  'Global:',
  '  kirocrew-lead   Global      Coordinates a crew of specialised subagents',
  '  taskmaster      Global      Breaks a goal into tracked tasks',
  '',
  'Workspace:',
  '  repo-reviewer   Local       Reviews changes against this repository',
  '',
].join('\n');

describe('parseKiroAgentListOutput', () => {
  it('excludes the Error and section-header noise lines', () => {
    const ids = parseKiroAgentListOutput(REAL_OUTPUT).agents.map((agent) => agent.id);
    expect(ids).not.toContain('Error:');
    expect(ids).not.toContain('Global');
    expect(ids).not.toContain('Workspace');
  });

  it('parses every agent id in order', () => {
    expect(parseKiroAgentListOutput(REAL_OUTPUT).agents.map((agent) => agent.id)).toEqual([
      'kiro_default',
      'kiro_planner',
      'kiro_guide',
      'kirocrew-lead',
      'taskmaster',
      'repo-reviewer',
    ]);
  });

  it('maps the (Built-in)/Global/Local scope tokens onto the typed scope', () => {
    const byId = new Map(
      parseKiroAgentListOutput(REAL_OUTPUT).agents.map((agent) => [agent.id, agent]),
    );
    expect(byId.get('kiro_default')?.scope).toBe('built-in');
    expect(byId.get('kirocrew-lead')?.scope).toBe('global');
    expect(byId.get('taskmaster')?.scope).toBe('global');
    expect(byId.get('repo-reviewer')?.scope).toBe('local');
  });

  it('joins wrapped continuation-line descriptions into the preceding agent', () => {
    const kiroDefault = parseKiroAgentListOutput(REAL_OUTPUT).agents.find(
      (agent) => agent.id === 'kiro_default',
    );
    expect(kiroDefault?.description).toBe(
      'Default general-purpose Kiro agent for everyday coding tasks and questions',
    );
  });

  it('reports the *-marked agent as the current agent', () => {
    expect(parseKiroAgentListOutput(REAL_OUTPUT).currentAgentId).toBe('kiro_default');
    // The marker must not survive as part of the id.
    expect(parseKiroAgentListOutput(REAL_OUTPUT).agents[0].id).toBe('kiro_default');
  });

  it('returns an empty result for output with no agent rows', () => {
    expect(parseKiroAgentListOutput('Error: something went wrong\n\nGlobal:\n')).toEqual({
      agents: [],
      currentAgentId: null,
    });
  });

  it('collapses duplicate ids to the first occurrence and drops the current flag on an unknown mark', () => {
    const output = [
      '  kiro_default  (Built-in)  First definition',
      '  kiro_default  (Built-in)  Duplicate to ignore',
    ].join('\n');
    const parsed = parseKiroAgentListOutput(output);
    expect(parsed.agents.map((agent) => agent.id)).toEqual(['kiro_default']);
    expect(parsed.agents[0].description).toBe('First definition');
    expect(parsed.currentAgentId).toBeNull();
  });
});

describe('KiroAgentCatalogService.discoverCatalog', () => {
  it('runs `agent list` and maps the parsed agents into the snapshot', async () => {
    const runner = makeRunner((request) =>
      request.args.includes('--version')
        ? { exitCode: 0, stdout: 'kiro-cli 2.18.0' }
        : { exitCode: 0, stdout: REAL_OUTPUT });
    const service = new KiroAgentCatalogService(makeHost(), { runner });

    const result = await service.discoverCatalog();

    expect(result.kind).toBe('completed');
    if (result.kind !== 'completed') {
      return;
    }
    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['agent', 'list'] }),
    );
    expect(result.agents.map((agent) => agent.id)).toEqual([
      'kiro_default',
      'kiro_planner',
      'kiro_guide',
      'kirocrew-lead',
      'taskmaster',
      'repo-reviewer',
    ]);
    expect(result.currentAgentId).toBe('kiro_default');
    expect(result.fingerprint).toBeTruthy();
  });

  it('returns skipped when the provider is disabled', async () => {
    const runner = makeRunner(() => ({ exitCode: 0, stdout: REAL_OUTPUT }));
    const service = new KiroAgentCatalogService(makeHost({ enabled: false }), { runner });

    const result = await service.discoverCatalog();

    expect(result.kind).toBe('skipped');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('returns a completed result with empty agents and diagnostics on command failure', async () => {
    const runner = makeRunner((request) =>
      request.args.includes('--version')
        ? { exitCode: 0, stdout: 'kiro-cli 2.18.0' }
        : { exitCode: null, stdout: '', termination: 'error' });
    const service = new KiroAgentCatalogService(makeHost(), { runner });

    const result = await service.discoverCatalog();

    expect(result.kind).toBe('completed');
    if (result.kind !== 'completed') {
      return;
    }
    expect(result.agents).toEqual([]);
    expect(result.diagnostics).toBeTruthy();
  });

  it('returns diagnostics when the CLI emits only noise (parse yields no agents)', async () => {
    const runner = makeRunner((request) =>
      request.args.includes('--version')
        ? { exitCode: 0, stdout: 'kiro-cli 2.18.0' }
        : { exitCode: 0, stdout: 'Error: File URI not found\n\nGlobal:\n' });
    const service = new KiroAgentCatalogService(makeHost(), { runner });

    const result = await service.discoverCatalog();

    expect(result.kind).toBe('completed');
    if (result.kind !== 'completed') {
      return;
    }
    expect(result.agents).toEqual([]);
    expect(result.diagnostics).toBe('Kiro agent list returned no available agents');
  });
});
