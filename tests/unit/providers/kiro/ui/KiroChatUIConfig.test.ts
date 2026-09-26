import {
  getKiroProviderSettings,
  reconcileKiroSessionAgentModes,
  updateCurrentKiroAgentModes,
  updateKiroProviderSettings,
} from '@/providers/kiro/settings';
import { kiroChatUIConfig } from '@/providers/kiro/ui/KiroChatUIConfig';

function settingsWithModes(): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  updateCurrentKiroAgentModes(settings, {
    currentModeId: 'kiro_default',
    modes: [
      { id: 'kiro_default', name: 'Default' },
      { id: 'kiro_planner', name: 'Planner', description: 'Plans first' },
      { id: 'kiro_guide', name: 'Guide' },
      { id: 'taskmaster', name: 'Taskmaster' },
    ],
  });
  return settings;
}

describe('kiroChatUIConfig.getModeSelector', () => {
  it('returns null when the session has advertised no modes yet', () => {
    expect(kiroChatUIConfig.getModeSelector?.({})).toBeNull();
  });

  it('builds a selector from every advertised availableMode', () => {
    const config = kiroChatUIConfig.getModeSelector?.(settingsWithModes());

    expect(config).not.toBeNull();
    expect(config?.label).toBe('Agent');
    expect(config?.options.map((option) => option.value)).toEqual([
      'kiro_default',
      'kiro_planner',
      'kiro_guide',
      'taskmaster',
    ]);
    expect(config?.options[1]).toEqual({
      value: 'kiro_planner',
      label: 'Planner',
      description: 'Plans first',
    });
  });

  it('defaults the value to the session currentModeId when nothing is selected', () => {
    const config = kiroChatUIConfig.getModeSelector?.(settingsWithModes());
    expect(config?.value).toBe('kiro_default');
  });

  it('reflects an explicit selection in the value', () => {
    const settings = settingsWithModes();
    kiroChatUIConfig.applyModeSelection?.('taskmaster', settings);
    expect(getKiroProviderSettings(settings).selectedAgentMode).toBe('taskmaster');
    expect(kiroChatUIConfig.getModeSelector?.(settings)?.value).toBe('taskmaster');
  });

  it('ignores an unknown id so the execution layer never drives an invalid set_mode', () => {
    const settings = settingsWithModes();
    kiroChatUIConfig.applyModeSelection?.('not_a_real_mode', settings);
    expect(getKiroProviderSettings(settings).selectedAgentMode).toBeNull();
    // Falls back to currentModeId rather than the rejected id.
    expect(kiroChatUIConfig.getModeSelector?.(settings)?.value).toBe('kiro_default');
  });

  it('is independent of the permission (normal/yolo) toggle', () => {
    const settings = settingsWithModes();
    kiroChatUIConfig.applyModeSelection?.('kiro_guide', settings);
    kiroChatUIConfig.applyPermissionMode?.('yolo', settings);

    expect(kiroChatUIConfig.resolvePermissionMode?.(settings)).toBe('yolo');
    expect(kiroChatUIConfig.getModeSelector?.(settings)?.value).toBe('kiro_guide');
    expect(getKiroProviderSettings(settings).selectedAgentMode).toBe('kiro_guide');
  });

  it('drops a persisted selection once the mode leaves availableModes', () => {
    const settings = settingsWithModes();
    kiroChatUIConfig.applyModeSelection?.('taskmaster', settings);

    // The next session no longer advertises taskmaster.
    updateKiroProviderSettings(settings, {
      agentModesByHost: {},
    });
    updateCurrentKiroAgentModes(settings, {
      currentModeId: 'kiro_default',
      modes: [
        { id: 'kiro_default', name: 'Default' },
        { id: 'kiro_planner', name: 'Planner' },
      ],
    });

    // Selection persists in storage but must not be surfaced as a sendable value.
    expect(kiroChatUIConfig.getModeSelector?.(settings)?.value).toBe('kiro_default');
  });

  it('sources the catalog∪session union and lets a session-only mode be selected', () => {
    const settings: Record<string, unknown> = {};
    // Prefetched CLI catalog (primary source).
    updateCurrentKiroAgentModes(settings, {
      currentModeId: 'kiro_default',
      modes: [
        { id: 'kiro_default', name: 'kiro_default' },
        { id: 'kirocrew', name: 'kirocrew' },
      ],
    });
    // A live session advertises an extra mode absent from the CLI catalog; it is
    // folded into the same snapshot as a supplement.
    reconcileKiroSessionAgentModes(settings, {
      currentModeId: 'kiro_default',
      modes: [
        { id: 'kiro_default', name: 'kiro_default' },
        { id: 'session_only', name: 'session_only' },
      ],
    });

    const config = kiroChatUIConfig.getModeSelector?.(settings);
    // Catalog agents lead (primary), the session-only mode is appended (supplement).
    expect(config?.options.map((option) => option.value)).toEqual([
      'kiro_default',
      'kirocrew',
      'session_only',
    ]);

    // A session-supplemented id is part of the known union, so selecting it sticks.
    kiroChatUIConfig.applyModeSelection?.('session_only', settings);
    expect(getKiroProviderSettings(settings).selectedAgentMode).toBe('session_only');
    expect(kiroChatUIConfig.getModeSelector?.(settings)?.value).toBe('session_only');
  });

  it('never surfaces a currentModeId that is absent from the rendered options', () => {
    const settings: Record<string, unknown> = {};
    updateCurrentKiroAgentModes(settings, {
      // currentModeId points at an id that is NOT in modes (a stale/mismatched snapshot).
      currentModeId: 'ghost_mode',
      modes: [
        { id: 'kiro_default', name: 'Default' },
        { id: 'kiro_planner', name: 'Planner' },
      ],
    });

    const config = kiroChatUIConfig.getModeSelector?.(settings);
    // The guarded fallback rejects the unlisted currentModeId and shows the first option.
    expect(config?.value).toBe('kiro_default');
    expect(config?.options.map((option) => option.value)).not.toContain('ghost_mode');
  });
});
