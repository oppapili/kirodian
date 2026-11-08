import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { parse } from 'yaml';

import { ciTestLanes, documentationPaths, selectCiTests, selectRelatedCiTests } from './ciTestSelection.mjs';

const prompt = 'tests/unit/core/prompt/mainAgent.systemPrompt.test.ts';
const panel = 'tests/unit/features/chat/ClaudianView.test.ts';
const native = 'tests/integration/core/process/ManagedStdioProcess.test.ts';
const docs = 'tests/unit/docs/Documentation.test.ts';
const select = (paths, relatedTests = [], eventName = 'pull_request') => selectCiTests({
  changes: paths.map(path => typeof path === 'string' ? { status: 'M', path } : path),
  relatedTests, eventName,
});

test('ordinary PRs and pushes select affected consumers', () => {
  for (const event of ['pull_request', 'push']) {
    const result = select(['src/core/prompt/mainAgent.ts'], [prompt], event);
    assert.deepEqual(result.testFiles, [prompt]);
    assert.deepEqual(result.crossPlatformTests, []);
  }
});

test('presentation changes do not trigger native checks through main composition', () => {
  const result = select(['src/features/chat/ClaudianView.ts'], [panel, 'tests/integration/main.test.ts']);
  assert.deepEqual(result.testFiles, [panel, 'tests/integration/main.test.ts']);
  assert.deepEqual(result.crossPlatformTests, []);
});

test('shared dependencies retain affected native consumers', () => {
  const result = select(['src/core/process/env.ts'], [prompt, native]);
  assert.deepEqual(result.testFiles, [prompt, native]);
  assert.deepEqual(result.crossPlatformTests, [native]);
});

test('real subprocess consumers run on native platforms when affected', () => {
  for (const consumer of [
    'tests/integration/core/process/ProcessProbe.test.ts',
    'tests/integration/core/process/ManagedStdioProcess.test.ts',
    'tests/integration/core/process/cliBinaryLocator.test.ts',
  ]) {
    const result = select(['src/core/process/cliPath.ts'], [consumer]);
    assert.deepEqual(result.crossPlatformTests, [consumer]);
    assert.equal(result.crossPlatform, true);
    assert.deepEqual(select([consumer]).crossPlatformTests, [consumer]);
  }
});

test('mocked process policies remain in the ordinary suite without native jobs', () => {
  const unitTests = [
    'tests/unit/core/process/windowsCmdShim.test.ts',
    'tests/unit/core/process/ManagedStdioProcess.test.ts',
  ];
  const result = select(unitTests);
  assert.deepEqual(result.testFiles, unitTests);
  assert.deepEqual(result.crossPlatformTests, []);
  assert.equal(result.crossPlatform, false);
});

test('changed tests run directly, while removed tests are omitted', () => {
  const result = select([{ status: 'D', path: panel }, prompt], [panel]);
  assert.deepEqual(result.testFiles, [prompt]);
  assert.deepEqual(result.crossPlatformTests, []);
});

test('shared test helpers use their graph consumers', () => {
  assert.deepEqual(select(['tests/helpers/testClock.ts'], [native]).testFiles, [native]);
});

test('filesystem-read documentation, styles, and captured fixtures retain their consumers', () => {
  assert.deepEqual(select(['README.md']).testFiles, [docs]);
  assert.deepEqual(select(['src/features/chat/AGENTS.md']).testFiles, [docs]);
  assert.ok(select(['src/style/components/code.css']).testFiles.includes('tests/unit/style/components/code.test.ts'));
});

test('script edits select their script tests without unrelated Vitest work', () => {
  const result = select(['scripts/summarize-vitest-results.mjs']);
  assert.deepEqual(result.testFiles, []);
  assert.deepEqual(result.scriptTests, ['scripts/summarize-vitest-results.test.mjs']);
  assert.equal(result.crossPlatform, false);
});

test('native script regressions retain a Windows job without selecting unrelated Vitest suites', () => {
  for (const script of ['scripts/ciTestSelection.test.mjs', 'scripts/run-tests.test.mjs']) {
    const result = select([script]);
    assert.deepEqual(result.scriptTests, [script]);
    assert.deepEqual(result.testFiles, []);
    assert.deepEqual(result.crossPlatformTests, []);
    assert.equal(result.crossPlatform, true);
  }
});

test('unsafe deletions and global or unknown changes retain full verification', () => {
  for (const change of [
    { status: 'D', path: 'src/core/prompt/mainAgent.ts' },
    { status: 'D', path: 'tests/helpers/testClock.ts' },
    ...['package-lock.json', 'vitest.config.mts', 'scripts/vitest-open-handles.config.mts', 'tests/setupWindow.ts',
      'scripts/ciTestSelection.mjs', '.github/workflows/ci.yml', 'unknown-config'].map(path => ({ status: 'M', path })),
  ]) {
    const result = select([change]);
    assert.equal(result.testFiles, null);
    assert.equal(result.crossPlatformTests, null);
    assert.equal(result.scriptTests, null);
  }
});

test('scheduled and reusable verification retain full coverage', () => {
  for (const event of ['workflow_call', 'schedule', 'workflow_dispatch']) {
    assert.equal(select([], [], event).testFiles, null);
  }
  // Scheduled verification reuses CI so the full suite runs weekly.
  const nightly = parse(readFileSync(new URL('../.github/workflows/nightly.yml', import.meta.url), 'utf8'));
  assert.ok(Object.values(nightly.jobs).some(job => job.uses === './.github/workflows/ci.yml'));
});

test('real dependency graph preserves prompt and provider coverage without Collab suites', () => {
  const relatedTests = JSON.parse(execFileSync(process.execPath, [
    'scripts/list-related-tests.mjs', 'src/core/prompt/mainAgent.ts',
  ], { encoding: 'utf8' })).map(file => file.split(path.sep).join('/'));
  assert.ok(relatedTests.some(file => file.endsWith('/core/prompt/mainAgent.systemPrompt.test.ts')));
  assert.ok(relatedTests.some(file => file.includes('/providers/')));
  assert.equal(relatedTests.some(file => /collab/i.test(file)), false);
});

test('Vitest shards scale with the selection and script checks run in their own lane', () => {
  const files = count => Array.from({ length: count }, (_, index) => `tests/unit/${index}.test.ts`);
  assert.deepEqual(ciTestLanes({ testFiles: [], scriptTests: [] }), []);
  assert.deepEqual(ciTestLanes({ testFiles: [], scriptTests: ['scripts/run-tests.test.mjs'] }), ['scripts']);
  assert.deepEqual(ciTestLanes({ testFiles: files(200), scriptTests: [] }), ['1/1']);
  assert.deepEqual(ciTestLanes({ testFiles: files(201), scriptTests: [] }), ['1/2', '2/2']);
  assert.deepEqual(ciTestLanes({ testFiles: files(5000), scriptTests: [] }), ['1/4', '2/4', '3/4', '4/4']);
  assert.deepEqual(ciTestLanes({ testFiles: null, scriptTests: null }), ['1/4', '2/4', '3/4', '4/4', 'scripts']);
});

test('the CI entry point handles real Git ranges, renames, missing bases and release tags', async () => {
  const { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const root = mkdtempSync(path.join(tmpdir(), 'claudian-ci-scope-'));
  try {
    for (const directory of ['scripts', 'src', 'tests/unit']) mkdirSync(path.join(root, directory), { recursive: true });
    for (const file of ['ciTestSelection.mjs', 'testSuites.cjs', 'testDeclarations.cjs']) copyFileSync(`scripts/${file}`, path.join(root, 'scripts', file));
    writeFileSync(path.join(root, 'scripts/run-vitest.js'), `require(${JSON.stringify(path.resolve('scripts/run-vitest.js'))});`);
    writeFileSync(path.join(root, 'scripts/list-related-tests.mjs'), `import ${JSON.stringify(pathToFileURL(path.resolve('scripts/list-related-tests.mjs')).href)};`);
    writeFileSync(path.join(root, 'vitest.config.mjs'), `export default { test: { globals: true, maxWorkers: 1, include: ['tests/unit/**/*.test.ts'] } };`);
    writeFileSync(path.join(root, 'src/value.ts'), 'export const value = 1;');
    writeFileSync(path.join(root, 'tests/unit/types.test.ts'), "import type { value } from '../../src/value'; const example: typeof value = 1; test('type-only', () => expect(example).toBe(1));");
    writeFileSync(path.join(root, 'src/value.css'), 'body {}');
    writeFileSync(path.join(root, 'tests/unit/value.test.ts'), "// @test-ci {\"native\":true,\"inputs\":[\"src/value.css\"]}\nimport { value } from '../../src/value'; test('value', () => expect(value).toBe(1));");
    writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init');
    git('config', 'user.name', 'CI fixture');
    git('config', 'user.email', 'ci@example.test');
    git('config', 'commit.gpgsign', 'false');
    git('add', '.');
    git('commit', '-m', 'Initial fixture');
    const base = git('rev-parse', 'HEAD');
    const scope = (head, overrides = {}) => {
      const output = execFileSync(process.execPath, ['scripts/ciTestSelection.mjs'], {
        cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GITHUB_OUTPUT: '', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main',
          BASE_SHA: base, HEAD_SHA: head, ...overrides },
      });
      return Object.fromEntries(output.trim().split('\n').map(line => {
        const index = line.indexOf('=');
        return [line.slice(0, index), JSON.parse(line.slice(index + 1))];
      }));
    };
    writeFileSync(path.join(root, 'src/value.ts'), 'export const value = 2;');
    git('add', '.'); git('commit', '-m', 'Edit source');
    const edited = git('rev-parse', 'HEAD');
    assert.deepEqual(scope(edited)['test-files'], ['tests/unit/value.test.ts']);
    assert.deepEqual(scope(edited)['test-lanes'], ['1/1', 'scripts']);
    assert.deepEqual([scope(edited).build, scope(edited).dependencies, scope(edited).workflows], [true, false, false]);
    assert.deepEqual(scope(edited, { GITHUB_EVENT_NAME: 'pull_request' })['test-files'], ['tests/unit/value.test.ts']);
    renameSync(path.join(root, 'tests/unit/value.test.ts'), path.join(root, 'tests/unit/renamed.test.ts'));
    git('add', '.'); git('commit', '-m', 'Rename test');
    const renamed = git('rev-parse', 'HEAD');
    assert.deepEqual(scope(renamed, { BASE_SHA: edited })['test-files'], ['tests/unit/renamed.test.ts']);
    assert.deepEqual(scope(renamed, { BASE_SHA: edited })['cross-platform-tests'], ['tests/unit/renamed.test.ts']);
    writeFileSync(path.join(root, 'src/value.css'), 'body { color: red }');
    git('add', '.'); git('commit', '-m', 'Edit a non-import input');
    const styled = git('rev-parse', 'HEAD');
    assert.deepEqual(scope(styled, { BASE_SHA: renamed })['test-files'], ['tests/unit/renamed.test.ts']);
    assert.deepEqual(scope(styled, { BASE_SHA: renamed })['cross-platform-tests'], ['tests/unit/renamed.test.ts']);
    rmSync(path.join(root, 'tests/unit/renamed.test.ts'));
    git('add', '.'); git('commit', '-m', 'Delete test');
    const deleted = git('rev-parse', 'HEAD');
    assert.deepEqual(scope(deleted, { BASE_SHA: styled })['test-files'], []);
    assert.deepEqual(scope(deleted, { BASE_SHA: styled })['test-lanes'], ['scripts']);
    for (const overrides of [
      { BASE_SHA: 'f'.repeat(40) }, { BASE_SHA: '0'.repeat(40) }, { BASE_SHA: '' },
      { GITHUB_REF: 'refs/tags/2.3.0' },
    ]) {
      const full = scope(deleted, overrides);
      assert.equal(full['test-files'], null);
      assert.deepEqual(full['test-lanes'], ['1/4', '2/4', '3/4', '4/4', 'scripts']);
      assert.deepEqual([full.build, full.dependencies, full.workflows], [true, true, true]);
    }
    // Release scope must work before dependency installation, without invoking Vitest.
    writeFileSync(path.join(root, 'scripts/run-vitest.js'), "throw new Error('Vitest is unavailable');");
    const tag = scope(deleted, { GITHUB_REF: 'refs/tags/2.3.0' });
    assert.equal(tag['test-files'], null);
    assert.equal(tag['script-tests'], null);
    assert.equal(tag['cross-platform-tests'], null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('locale changes retain the dependency envelope and lazy CommonJS loader coverage', () => {
  const result = selectRelatedCiTests({ changes: [{ status: 'M', path: 'src/i18n/locales/de.json' }] });
  assert.ok(result.testFiles.includes('tests/integration/build/dependency-envelope.test.ts'));
  assert.ok(result.testFiles.includes('tests/unit/i18n/i18n.test.ts'));
});

test('local selection includes committed, staged, unstaged and untracked edits with safe fallbacks', async () => {
  const { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const root = mkdtempSync(path.join(tmpdir(), 'claudian-local-scope-'));
  try {
    for (const directory of ['scripts', 'src', 'tests/unit']) mkdirSync(path.join(root, directory), { recursive: true });
    for (const file of ['ciTestSelection.mjs', 'testSuites.cjs', 'testDeclarations.cjs', 'run-affected-tests.mjs']) copyFileSync(`scripts/${file}`, path.join(root, 'scripts', file));
    writeFileSync(path.join(root, 'scripts/run-vitest.js'), `require(${JSON.stringify(path.resolve('scripts/run-vitest.js'))});`);
    writeFileSync(path.join(root, 'scripts/list-related-tests.mjs'), `import ${JSON.stringify(pathToFileURL(path.resolve('scripts/list-related-tests.mjs')).href)};`);
    writeFileSync(path.join(root, 'vitest.config.mjs'), `export default { test: { globals: true, maxWorkers: 1, include: ['tests/unit/**/*.test.ts'] } };`);
    for (const name of ['committed', 'staged', 'unstaged', 'deleted']) {
      writeFileSync(path.join(root, `tests/unit/${name}.test.ts`), "test('example', () => {});");
    }
    writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.test');
    git('config', 'commit.gpgsign', 'false'); git('add', '.'); git('commit', '-m', 'Baseline');
    const base = git('rev-parse', 'HEAD');
    const scope = (...args) => JSON.parse(execFileSync(process.execPath, [
      'scripts/run-affected-tests.mjs', '--base', base, '--list', ...args,
    ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    assert.deepEqual(scope().testFiles, []);
    writeFileSync(path.join(root, 'tests/unit/committed.test.ts'), "test('committed edit', () => {});");
    git('add', '.'); git('commit', '-m', 'Committed edit');
    renameSync(path.join(root, 'tests/unit/staged.test.ts'), path.join(root, 'tests/unit/renamed.test.ts'));
    git('add', '.');
    writeFileSync(path.join(root, 'tests/unit/unstaged.test.ts'), "test('unstaged edit', () => {});");
    writeFileSync(path.join(root, 'tests/unit/new test.test.ts'), "test('new', () => {});");
    rmSync(path.join(root, 'tests/unit/deleted.test.ts'));
    assert.deepEqual(scope().testFiles.sort(), [
      'tests/unit/committed.test.ts', 'tests/unit/new test.test.ts',
      'tests/unit/renamed.test.ts', 'tests/unit/unstaged.test.ts',
    ]);
    assert.deepEqual(scope().scriptTests, ['scripts/check-architecture-boundaries.test.mjs']);
    assert.equal(scope('--full').testFiles, null);
    assert.equal(scope('--base', 'missing-base').testFiles, null);
    writeFileSync(path.join(root, 'unknown-config'), 'new');
    assert.equal(scope().testFiles, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('documentation-only changes skip the CI workflow and select only the documentation test', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  for (const event of ['push', 'pull_request']) {
    assert.deepEqual(workflow.on[event]['paths-ignore'], documentationPaths, event);
  }
  for (const file of ['assets/Preview.png', 'LICENSE', '.github/ISSUE_TEMPLATE/bug_report.yml', '.github/PULL_REQUEST_TEMPLATE.md']) {
    assert.deepEqual(select([file]).testFiles, [docs], file);
  }
  assert.equal(select(['.github/workflows/ci.yml']).testFiles, null);
});

const jobs = result => ({
  build: result.build, dependencies: result.dependencies, workflows: result.workflows,
});
const noJobs = { build: false, dependencies: false, workflows: false };

test('pipeline jobs run only for the changes they verify', () => {
  assert.deepEqual(jobs(select(['src/core/prompt/mainAgent.ts'], [prompt])), { ...noJobs, build: true });
  assert.deepEqual(jobs(select([prompt, 'scripts/run-tests.test.mjs'])), noJobs);
  assert.deepEqual(jobs(select(['README.md'])), noJobs);
  assert.deepEqual(jobs(select(['scripts/check-lockfile-parity.mjs'])), { ...noJobs, build: true, dependencies: true });
  for (const full of [select(['package.json']), select([], [], 'workflow_call')]) {
    assert.deepEqual(jobs(full), { build: true, dependencies: true, workflows: true });
  }
});

test('repository automation and lint configuration select only their own checks', () => {
  const architecture = 'scripts/check-architecture-boundaries.test.mjs';
  for (const change of [{ status: 'M', path: '.github/workflows/stale.yml' }, { status: 'D', path: '.github/workflows/stale.yml' }]) {
    const workflow = select([change]);
    assert.deepEqual(workflow.testFiles, [], change.status);
    assert.deepEqual(workflow.scriptTests, [architecture], change.status);
    assert.equal(workflow.crossPlatform, false, change.status);
    assert.deepEqual(jobs(workflow), { ...noJobs, workflows: true }, change.status);
  }
  const codeql = select(['.github/codeql/codeql-config.yml']);
  assert.deepEqual([codeql.testFiles, codeql.scriptTests], [[], []]);
  assert.deepEqual(jobs(codeql), noJobs);
  const eslint = select(['eslint.config.mjs']);
  assert.deepEqual([eslint.testFiles, eslint.scriptTests], [[], ['scripts/check-eslint-config.test.mjs']]);
  assert.deepEqual(jobs(eslint), noJobs);
});

test('CI jobs are gated by their selection outputs', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  for (const [job, output] of [
    ['workflow-lint', 'workflows'], ['dependencies', 'dependencies'], ['dependency-review', 'dependencies'],
    ['build-artifacts', 'build'],
  ]) {
    assert.ok(workflow.jobs[job].needs.includes('test-scope'), job);
    assert.match(workflow.jobs[job].if, new RegExp(`needs\\.test-scope\\.outputs\\.${output} == 'true'`), job);
    assert.equal(workflow.jobs['test-scope'].outputs[output], `\${{ steps.scope.outputs.${output} }}`, output);
  }
});

test('dependency audit runs for every change that triggers CI and gates the build', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  const audit = workflow.jobs['dependency-audit'];
  assert.equal(audit.if, undefined);
  assert.equal(audit.needs, undefined);
  assert.ok(audit.steps.some(step => step.run === 'npm audit --audit-level=moderate'));
  assert.ok(workflow.jobs.build.needs.includes('dependency-audit'));
  for (const job of ['typecheck', 'lint', 'dependencies']) {
    assert.equal(workflow.jobs[job].steps.some(step => step.run?.startsWith('npm audit')), false, job);
  }
});

test('CI starts independent checks immediately', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  assert.equal(workflow.jobs.quality, undefined);
  for (const job of ['typecheck', 'lint', 'dependency-audit', 'test-scope', 'diff-hygiene']) {
    assert.equal(workflow.jobs[job].needs, undefined, job);
  }
  assert.ok(workflow.jobs.typecheck.steps.some(step => step.run === 'npm run typecheck'));
  assert.ok(workflow.jobs.lint.steps.some(step => step.run === 'npm run lint'));
  for (const job of ['typecheck', 'lint']) assert.ok(workflow.jobs.build.needs.includes(job), job);
});
