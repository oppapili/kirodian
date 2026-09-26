import {
  getKiroProviderSettings,
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
});
