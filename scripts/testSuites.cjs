const crossPlatformTests = [
  'tests/integration/providers/pi/execution/PiRecoveryContext.test.ts',
  // Filesystem, path, URI, and platform-policy regressions need native hosts even without a subprocess.
  'tests/unit/core/process/env.test.ts',
  'tests/unit/core/storage/VaultFileAdapter.test.ts',
  'tests/integration/core/process/ProcessProbe.test.ts',
  'tests/integration/core/process/ManagedStdioProcess.test.ts',
  'tests/integration/core/process/cliBinaryLocator.test.ts',
  'tests/integration/core/process/loginShellPath.test.ts',
  'tests/integration/core/session-tools/LoopbackSessionToolServer.test.ts',
];

const scriptTests = [
  'scripts/check-architecture-boundaries.test.mjs',
  'scripts/check-eslint-config.test.mjs',
  'scripts/check-open-handles.test.mjs',
  'scripts/check-release-version.test.mjs',
  'scripts/summarize-vitest-results.test.mjs',
  'scripts/sync-version.test.mjs',
  'scripts/ciTestSelection.test.mjs',
  'scripts/run-tests.test.mjs',
];

module.exports = { crossPlatformTests, scriptTests };
