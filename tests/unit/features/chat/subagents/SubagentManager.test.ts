import '@/providers';

import type { SubagentInfo } from '@/core/types';
import { SubagentManager } from '@/features/chat/subagents/SubagentManager';

jest.mock('@/features/chat/subagents/SubagentRenderer', () => ({
  createSubagentBlock: jest.fn((_parentEl: any, info: SubagentInfo) => ({ info, wrapperEl: {} })),
  createAsyncSubagentBlock: jest.fn((_parentEl: any, info: SubagentInfo) => ({ info, wrapperEl: {}, statusTextEl: {} })),
  updateSubagentBlock: jest.fn(),
  updateAsyncSubagentBlock: jest.fn(),
}));

const createMockEl = () => ({ createDiv: jest.fn(), appendChild: jest.fn() } as any);

describe('SubagentManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sync subagent operations', () => {
    it('handles task tool use without throwing', () => {
      const updates: SubagentInfo[] = [];
      const manager = new SubagentManager((subagent) => {
        updates.push({ ...subagent });
      });
      const parentEl = createMockEl();

      const result = manager.handleTaskToolUse(
        'task-sync',
        { prompt: 'test' },
        parentEl
      );

      // When the interpreter can't determine async mode (NOOP case),
      // the result may be buffered or created depending on input
      expect(result).toBeDefined();
      expect(['buffered', 'created_sync']).toContain(result.action);
    });

    it('returns null when finalizing nonexistent subagent', () => {
      const manager = new SubagentManager(() => {});
      const result = manager.finalizeSyncSubagent('nonexistent', 'Done', false);
      expect(result).toBeNull();
    });

    it('returns null for unknown tool id in renderPendingTask', () => {
      const manager = new SubagentManager(() => {});
      const result = manager.renderPendingTask('unknown-id', createMockEl());
      expect(result).toBeNull();
    });

    it('resets spawned count', () => {
      const manager = new SubagentManager(() => {});
      const parentEl = createMockEl();

      manager.handleTaskToolUse('task-1', { prompt: 'test' }, parentEl);
      manager.resetSpawnedCount();
      expect(manager.subagentsSpawnedThisStream).toBe(0);
    });

    it('clears all state', () => {
      const manager = new SubagentManager(() => {});
      manager.clear();
      // Should not throw
      expect(manager.subagentsSpawnedThisStream).toBe(0);
    });
  });
});
