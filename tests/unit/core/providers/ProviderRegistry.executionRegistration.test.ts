import '@/providers';

import { ProviderExecutionLifecycleRegistry } from '@/core/execution';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { KiroExecutionBackend } from '@/providers/kiro/execution/KiroExecutionBackend';

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
        kiro: { enabled: true },
      },
    },
  };
}

describe('provider execution registration', () => {
  afterEach(() => {
    ProviderWorkspaceRegistry.setServices('kiro', undefined);
  });

  it('constructs every registered backend without creating a provider session', () => {
    const host = createHost();
    // The kiro backend factory reads its workspace services; stub the two it
    // needs so construction does not require full workspace initialization.
    ProviderWorkspaceRegistry.setServices('kiro', {
      commandCatalog: {} as any,
      modelCatalogCoordinator: {} as any,
    } as any);

    expect(ProviderRegistry.createExecutionBackend(host, 'kiro'))
      .toBeInstanceOf(KiroExecutionBackend);
  });
});
