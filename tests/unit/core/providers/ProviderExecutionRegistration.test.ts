import '@/providers';

import { ProviderExecutionLifecycleRegistry } from '@/core/execution';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { ClaudeExecutionBackend } from '@/providers/claude/execution/ClaudeExecutionBackend';
import { ClaudeSubagentHistoryService } from '@/providers/claude/history/ClaudeSubagentHistoryService';

function createHost(): any {
  const executionLifecycleRegistry = new ProviderExecutionLifecycleRegistry();
  return {
    app: {
      vault: { adapter: { basePath: '/tmp/provider-registration' } },
    },
    executionLifecycleRegistry,
    getActiveEnvironmentVariables: jest.fn(() => ''),
    getResolvedProviderCliPath: jest.fn(),
    manifest: { version: 'test' },
    runProviderExecutionTransition: (
      providerIds: string[],
      mutation: () => Promise<unknown>,
    ) => executionLifecycleRegistry.runTransition(providerIds as any, mutation),
    settings: {
      providerConfigs: {
        claude: { enabled: true },
      },
    },
  };
}

describe('provider execution registration', () => {
  afterEach(() => {
    ProviderWorkspaceRegistry.setServices('claude', undefined);
  });

  it('constructs every registered backend without creating a provider session', () => {
    const host = createHost();

    expect(ProviderRegistry.createExecutionBackend(host, 'claude'))
      .toBeInstanceOf(ClaudeExecutionBackend);
  });

  it('registers Claude transcript recovery without provider parity placeholders', () => {
    const host = createHost();

    expect(ProviderRegistry.createSubagentHistoryService(host, 'claude'))
      .toBeInstanceOf(ClaudeSubagentHistoryService);
  });
});
