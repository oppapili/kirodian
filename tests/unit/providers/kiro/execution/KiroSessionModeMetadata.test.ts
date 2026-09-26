import { normalizeKiroSessionModeMetadata } from '@/providers/kiro/execution/KiroSessionModeMetadata';

describe('normalizeKiroSessionModeMetadata', () => {
  it('extracts all availableModes from a session/new-style response', () => {
    const result = normalizeKiroSessionModeMetadata({
      modes: {
        availableModes: [
          { id: 'kiro_default', name: 'Default' },
          { id: 'kiro_planner', name: 'Planner', description: 'Plans first' },
          { id: 'kiro_guide', name: 'Guide' },
          { id: 'taskmaster', name: 'Taskmaster' },
        ],
        currentModeId: 'kiro_default',
      },
    });

    expect(result.modes.map((mode) => mode.id)).toEqual([
      'kiro_default',
      'kiro_planner',
      'kiro_guide',
      'taskmaster',
    ]);
    expect(result.currentModeId).toBe('kiro_default');
    expect(result.modes[1]).toEqual({
      id: 'kiro_planner',
      name: 'Planner',
      description: 'Plans first',
    });
  });

  it('collapses duplicate ids and drops blank ids', () => {
    const result = normalizeKiroSessionModeMetadata({
      modes: {
        availableModes: [
          { id: 'kiro_default', name: 'Default' },
          { id: '  ', name: 'Blank' },
          { id: 'kiro_default', name: 'Duplicate' },
        ],
        currentModeId: 'kiro_default',
      },
    });

    expect(result.modes).toHaveLength(1);
    expect(result.modes[0].id).toBe('kiro_default');
  });

  it('falls back to the id when a mode has no name', () => {
    const result = normalizeKiroSessionModeMetadata({
      modes: {
        availableModes: [{ id: 'kirocrew-worker', name: '' }],
        currentModeId: 'kirocrew-worker',
      },
    });

    expect(result.modes[0].name).toBe('kirocrew-worker');
  });

  it('prefers config-option select entries over the modes field', () => {
    const result = normalizeKiroSessionModeMetadata({
      configOptions: [
        {
          category: 'mode',
          currentValue: 'kiro_planner',
          id: 'mode',
          name: 'Agent',
          options: [
            { name: 'Default', value: 'kiro_default' },
            { name: 'Planner', value: 'kiro_planner' },
          ],
          type: 'select',
        },
      ],
      modes: {
        availableModes: [{ id: 'ignored', name: 'Ignored' }],
        currentModeId: 'ignored',
      },
    });

    expect(result.modes.map((mode) => mode.id)).toEqual(['kiro_default', 'kiro_planner']);
    expect(result.currentModeId).toBe('kiro_planner');
  });

  it('returns an empty catalog when no modes are advertised', () => {
    const result = normalizeKiroSessionModeMetadata({});
    expect(result.modes).toEqual([]);
    expect(result.currentModeId).toBeNull();
  });
});
