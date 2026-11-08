import '@/providers';

import { partialMock } from '@test/helpers/partialMock';

import type { SubagentInfo } from '@/core/types';
import { SubagentManager } from '@/features/chat/subagents/SubagentManager';

vi.mock('@/features/chat/subagents/SubagentRenderer', () => ({
  createSubagentBlock: vi.fn((_parentEl: HTMLElement, info: SubagentInfo) => ({ info, wrapperEl: {} })),
  createAsyncSubagentBlock: vi.fn((_parentEl: HTMLElement, info: SubagentInfo) => ({ info, wrapperEl: {}, statusTextEl: {} })),
  updateSubagentBlock: vi.fn(),
  updateAsyncSubagentBlock: vi.fn(),
}));

const createMockEl = () => partialMock<HTMLElement>({ createDiv: vi.fn(), appendChild: vi.fn() });

describe('SubagentManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    it('returns null for unknown tool id in resolvePendingTask', () => {
      const manager = new SubagentManager(() => {});
      const result = manager.resolvePendingTask('unknown-id', createMockEl());
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
