import type { ProviderInteractionPort } from '@/core/execution';
import { KiroExecutionInteractionRouter } from '@/providers/kiro/execution/KiroExecutionInteractionRouter';

function createRouter(): {
  router: KiroExecutionInteractionRouter;
  port: jest.Mocked<ProviderInteractionPort>;
} {
  const port = {
    requestApproval: jest.fn(),
    askUserQuestion: jest.fn(),
    dismissInteraction: jest.fn(),
  } as unknown as jest.Mocked<ProviderInteractionPort>;
  const router = new KiroExecutionInteractionRouter(
    port,
    'session-instance',
    () => 'turn-1',
    () => 'session-1',
  );
  return { router, port };
}

describe('KiroExecutionInteractionRouter', () => {
  it('abandons plan mode without routing a plan-decision interaction', async () => {
    const { router, port } = createRouter();

    await expect(router.handle('x.ai/exit_plan_mode', { sessionId: 'session-1' }))
      .resolves.toEqual({ outcome: 'abandoned' });
    await expect(router.handle('_x.ai/exit_plan_mode', { sessionId: 'session-1' }))
      .resolves.toEqual({ outcome: 'abandoned' });

    expect(port.askUserQuestion).not.toHaveBeenCalled();
    expect(port.dismissInteraction).not.toHaveBeenCalled();
  });

  it('rejects unsupported server requests', async () => {
    const { router } = createRouter();

    await expect(router.handle('x.ai/unknown', {}))
      .rejects.toThrow('Unsupported Kiro server request: x.ai/unknown');
  });
});
