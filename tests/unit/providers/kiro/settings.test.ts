import {
  getCurrentKiroAgentModes,
  reconcileKiroSessionAgentModes,
  updateCurrentKiroAgentModes,
} from '@/providers/kiro/settings';

function withPrefetchedCatalog(): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  updateCurrentKiroAgentModes(settings, {
    currentModeId: 'kiro_default',
    modes: [
      { id: 'kiro_default', name: 'kiro_default', description: 'Default agent' },
      { id: 'kiro_planner', name: 'kiro_planner' },
      { id: 'kirocrew', name: 'kirocrew' },
    ],
  });
  return settings;
}

describe('reconcileKiroSessionAgentModes', () => {
  it('populates the catalog from the session when no prefetch exists yet', () => {
    const settings: Record<string, unknown> = {};

    const result = reconcileKiroSessionAgentModes(settings, {
      currentModeId: 'kiro_default',
      modes: [{ id: 'kiro_default', name: 'Default' }],
    });

    expect(result?.modes.map((mode) => mode.id)).toEqual(['kiro_default']);
    expect(getCurrentKiroAgentModes(settings)?.modes).toHaveLength(1);
  });

  it('preserves the prefetched mode list as the option source', () => {
    const settings = withPrefetchedCatalog();

    // The session advertises FEWER modes than the CLI prefetch discovered.
    reconcileKiroSessionAgentModes(settings, {
      currentModeId: 'kiro_planner',
      modes: [{ id: 'kiro_default', name: 'Default' }, { id: 'kiro_planner', name: 'Planner' }],
    });

    // All three prefetched modes survive; the session does not shrink the list.
    expect(getCurrentKiroAgentModes(settings)?.modes.map((mode) => mode.id)).toEqual([
      'kiro_default',
      'kiro_planner',
      'kirocrew',
    ]);
  });

  it('refreshes currentModeId from the session', () => {
    const settings = withPrefetchedCatalog();

    reconcileKiroSessionAgentModes(settings, {
      currentModeId: 'kirocrew',
      modes: [{ id: 'kiro_default', name: 'Default' }],
    });

    expect(getCurrentKiroAgentModes(settings)?.currentModeId).toBe('kirocrew');
  });

  it('appends a session-only mode absent from the prefetched catalog', () => {
    const settings = withPrefetchedCatalog();

    reconcileKiroSessionAgentModes(settings, {
      currentModeId: 'kiro_default',
      modes: [{ id: 'session_only_agent', name: 'Session Only' }],
    });

    const ids = getCurrentKiroAgentModes(settings)?.modes.map((mode) => mode.id);
    expect(ids).toContain('session_only_agent');
    expect(ids).toEqual(['kiro_default', 'kiro_planner', 'kirocrew', 'session_only_agent']);
  });

  it('makes no change when the session adds nothing and keeps the same current mode', () => {
    const settings = withPrefetchedCatalog();
    const before = getCurrentKiroAgentModes(settings);

    const result = reconcileKiroSessionAgentModes(settings, {
      currentModeId: 'kiro_default',
      modes: [{ id: 'kiro_default', name: 'Default' }],
    });

    expect(result).toEqual(before);
    expect(getCurrentKiroAgentModes(settings)).toEqual(before);
  });

  it('ignores a session snapshot with no modes', () => {
    const settings = withPrefetchedCatalog();

    expect(
      reconcileKiroSessionAgentModes(settings, { currentModeId: null, modes: [] }),
    ).toBeNull();
    expect(getCurrentKiroAgentModes(settings)?.modes).toHaveLength(3);
  });
});
