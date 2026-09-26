import type { ProviderHost } from '@/core/providers/ProviderHost';
import {
  KiroAgentCatalogService,
  parseKiroAgentListDirectories,
  parseKiroAgentListOutput,
  toKiroAgentModes,
} from '@/providers/kiro/runtime/KiroAgentCatalogService';
import type {
  KiroCatalogCommandResult,
  KiroCatalogCommandRunner,
} from '@/providers/kiro/runtime/KiroModelCatalogService';

const ESC = String.fromCharCode(27);
const DIM = `${ESC}[38;5;244m`;
const RESET = `${ESC}[0m`;

// Expected values are derived from captured `kiro-cli agent list` output (kiro-cli
// 2.18.0), not from the parser implementation. The scope word and header labels are
// wrapped in ANSI colour codes; descriptions wrap onto blank-id continuation lines.
const REAL_OUTPUT = [
  `${DIM}Workspace: ${RESET}~/projects/kirodian/.kiro/agents`,
  `${DIM}Global:    ${RESET}~/.kiro/agents`,
  '',
  `* kiro_default                   ${DIM}(Built-in)${RESET}    Default agent`,
  `  kiro_help                      ${DIM}(Built-in)${RESET}    Help agent that answers questions about Kiro CLI features using`,
  '                                                documentation',
  '  kirocrew                       Global        Autonomous personal AI agent that schedules recurring tasks, spawns',
  '                                                parallel workers, and operates independently',
  '  kirocrew-lite                  Global        ',
  '  project_helper                 Local         Repo-specific helper',
].join('\n');

describe('parseKiroAgentListOutput', () => {
  it('skips the Workspace / Global header lines', () => {
    const ids = parseKiroAgentListOutput(REAL_OUTPUT).map((agent) => agent.id);

    expect(ids).toEqual([
      'kiro_default',
      'kiro_help',
      'kirocrew',
      'kirocrew-lite',
      'project_helper',
    ]);
  });

  it('marks the leading-* agent as current and the others as not', () => {
    const agents = parseKiroAgentListOutput(REAL_OUTPUT);

    expect(agents[0]).toMatchObject({ id: 'kiro_default', isCurrent: true });
    expect(agents.slice(1).every((agent) => !agent.isCurrent)).toBe(true);
  });

  it('resolves all three scopes', () => {
    const byId = new Map(
      parseKiroAgentListOutput(REAL_OUTPUT).map((agent) => [agent.id, agent.scope]),
    );

    expect(byId.get('kiro_default')).toBe('built-in');
    expect(byId.get('kirocrew')).toBe('global');
    expect(byId.get('project_helper')).toBe('local');
  });

  it('joins a wrapped multi-line description onto its agent', () => {
    const agent = parseKiroAgentListOutput(REAL_OUTPUT).find(
      (entry) => entry.id === 'kiro_help',
    );

    expect(agent?.description).toBe(
      'Help agent that answers questions about Kiro CLI features using documentation',
    );
  });

  it('preserves an empty description', () => {
    const agent = parseKiroAgentListOutput(REAL_OUTPUT).find(
      (entry) => entry.id === 'kirocrew-lite',
    );

    expect(agent?.description).toBe('');
  });

  it('preserves a unicode (Japanese) description untouched', () => {
    const output = [
      `  taskmaster                     Global        タスクを分解して実行する自律エージェント`,
    ].join('\n');

    expect(parseKiroAgentListOutput(output)[0]).toMatchObject({
      id: 'taskmaster',
      description: 'タスクを分解して実行する自律エージェント',
      scope: 'global',
      isCurrent: false,
    });
  });

  it('skips the WSL "Error: File URI not found" line', () => {
    const output = [
      'Error: File URI not found: file:///mnt/c/Users/dev',
      `${DIM}Global:    ${RESET}~/.kiro/agents`,
      `* kiro_default                   ${DIM}(Built-in)${RESET}    Default agent`,
    ].join('\n');

    const agents = parseKiroAgentListOutput(output);

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ id: 'kiro_default', isCurrent: true });
  });

  it('collapses a duplicate id to its first occurrence', () => {
    const output = [
      `  kiro_default                   ${DIM}(Built-in)${RESET}    Default agent`,
      `  kiro_default                   ${DIM}(Built-in)${RESET}    Duplicate line`,
    ].join('\n');

    const agents = parseKiroAgentListOutput(output);

    expect(agents).toHaveLength(1);
    expect(agents[0].description).toBe('Default agent');
  });

  it('returns an empty list for output with no agent rows', () => {
    expect(parseKiroAgentListOutput('Error: something went wrong')).toEqual([]);
  });

  it('excludes a count-suffixed section header (Global: 3 agents) explicitly', () => {
    const output = [
      'Global: 3 agents',
      `  kiro_default                   ${DIM}(Built-in)${RESET}    Default agent`,
    ].join('\n');

    const agents = parseKiroAgentListOutput(output);

    expect(agents.map((agent) => agent.id)).toEqual(['kiro_default']);
  });

  it('excludes a parenthesized section header (Global (2):) explicitly', () => {
    const output = [
      'Global (2):',
      'Workspace (1):',
      `  kirocrew                       Global        Autonomous agent`,
    ].join('\n');

    const agents = parseKiroAgentListOutput(output);

    expect(agents.map((agent) => agent.id)).toEqual(['kirocrew']);
  });

  it('keeps a real agent row whose id starts like a scope word (Globaltron)', () => {
    // Regression guard: a header word that is also a scope token (Global) must be
    // excluded, but a genuine agent whose id merely begins with those letters must
    // survive — the header exclusion keys on the header SHAPE, not the word.
    const output = [
      'Global: 2 agents',
      `  globaltron                     Global        Custom agent`,
    ].join('\n');

    const agents = parseKiroAgentListOutput(output);

    expect(agents.map((agent) => agent.id)).toEqual(['globaltron']);
  });

  it('does not exclude a row whose description merely contains a colon', () => {
    const output = [
      `  kiro_help                      ${DIM}(Built-in)${RESET}    Answers: questions about Kiro`,
    ].join('\n');

    const agents = parseKiroAgentListOutput(output);

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      id: 'kiro_help',
      description: 'Answers: questions about Kiro',
    });
  });
});

describe('toKiroAgentModes', () => {
  it('projects agents onto {id, name, description} using the raw id as name', () => {
    const modes = toKiroAgentModes(parseKiroAgentListOutput(REAL_OUTPUT));

    expect(modes[0]).toEqual({ id: 'kiro_default', name: 'kiro_default', description: 'Default agent' });
  });

  it('omits the description key when the agent description is empty', () => {
    const modes = toKiroAgentModes(parseKiroAgentListOutput(REAL_OUTPUT));
    const lite = modes.find((mode) => mode.id === 'kirocrew-lite');

    expect(lite).toEqual({ id: 'kirocrew-lite', name: 'kirocrew-lite' });
    expect(lite && 'description' in lite).toBe(false);
  });
});

describe('parseKiroAgentListDirectories', () => {
  it('extracts the local and global agent directories from the header lines', () => {
    const directories = parseKiroAgentListDirectories(REAL_OUTPUT);

    expect(directories).toEqual({
      localDir: '~/projects/kirodian/.kiro/agents',
      globalDir: '~/.kiro/agents',
    });
  });

  it('returns null for the local directory when the Workspace header is absent', () => {
    const output = [
      `${DIM}Global:    ${RESET}~/.kiro/agents`,
      `* kiro_default                   ${DIM}(Built-in)${RESET}    Default agent`,
    ].join('\n');

    expect(parseKiroAgentListDirectories(output)).toEqual({
      localDir: null,
      globalDir: '~/.kiro/agents',
    });
  });

  it('returns null for both directories when no header lines are present', () => {
    const output = [
      `* kiro_default                   ${DIM}(Built-in)${RESET}    Default agent`,
    ].join('\n');

    expect(parseKiroAgentListDirectories(output)).toEqual({
      localDir: null,
      globalDir: null,
    });
  });

  it('captures a count-suffixed header value verbatim (a non-path, harmless downstream)', () => {
    const output = ['Global: 3 agents'].join('\n');

    expect(parseKiroAgentListDirectories(output)).toEqual({
      localDir: null,
      globalDir: '3 agents',
    });
  });
});

describe('KiroAgentCatalogService.discoverCatalog', () => {
  function makeService(result: KiroCatalogCommandResult): KiroAgentCatalogService {
    const runner: KiroCatalogCommandRunner = {
      run: async () => result,
    };
    const plugin = {
      settings: { providerConfigs: { kiro: { enabled: true } } },
      app: { vault: { adapter: { basePath: '/vault' } } },
      getResolvedProviderCliPath: async () => 'kiro-cli',
    } as unknown as ProviderHost;
    return new KiroAgentCatalogService(plugin, { runner });
  }

  it('parses the listing even when the CLI exits non-zero with stdout present', async () => {
    // `kiro-cli agent list` can exit non-zero on a partial error (e.g. an
    // `Error: File URI not found` for an unrelated agent's prompt) while still
    // printing the full listing. The catalog must NOT be discarded in that case.
    const stdout = [
      'Error: File URI not found: file:///missing/prompt.md',
      'Workspace: ~/projects/kirodian/.kiro/agents',
      'Global:    ~/.kiro/agents',
      '',
      '* kiro_default                (Built-in)    Default agent',
      '  kirocrew                    Global        Autonomous personal AI agent',
    ].join('\n');
    const result = await makeService({
      exitCode: 1,
      stdout,
      stderr: '',
      termination: undefined,
    }).discoverCatalog();

    expect(result.kind).toBe('completed');
    if (result.kind !== 'completed') return;
    expect(result.agents.map((agent) => agent.id)).toEqual(['kiro_default', 'kirocrew']);
    expect(result.currentAgentId).toBe('kiro_default');
    expect(result.directories).toEqual({
      localDir: '~/projects/kirodian/.kiro/agents',
      globalDir: '~/.kiro/agents',
    });
  });

  it('parses the listing from stderr when stdout is empty', async () => {
    // Verified on kiro-cli 2.18: `agent list` prints the whole listing on STDERR
    // and leaves stdout empty. The catalog must read stderr in that case.
    const stderr = [
      'Workspace: ~/projects/kirodian/.kiro/agents',
      'Global:    ~/.kiro/agents',
      '',
      '* kiro_default                (Built-in)    Default agent',
      '  kirocrew                    Global        Autonomous personal AI agent',
    ].join('\n');
    const result = await makeService({
      exitCode: 0,
      stdout: '',
      stderr,
      termination: undefined,
    }).discoverCatalog();

    expect(result.kind).toBe('completed');
    if (result.kind !== 'completed') return;
    expect(result.agents.map((agent) => agent.id)).toEqual(['kiro_default', 'kirocrew']);
    expect(result.currentAgentId).toBe('kiro_default');
    expect(result.directories).toEqual({
      localDir: '~/projects/kirodian/.kiro/agents',
      globalDir: '~/.kiro/agents',
    });
  });

  it('returns an empty completed result on a hard termination', async () => {
    const result = await makeService({
      exitCode: null,
      stdout: '',
      stderr: '',
      termination: 'timeout',
    }).discoverCatalog();

    expect(result.kind).toBe('completed');
    if (result.kind !== 'completed') return;
    expect(result.agents).toEqual([]);
    expect(result.directories).toEqual({ localDir: null, globalDir: null });
  });
});
