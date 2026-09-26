import {
  getKiroProviderSettings,
  updateCurrentKiroAgentCatalog,
  updateCurrentKiroAgentModes,
  updateKiroProviderSettings,
} from '@/providers/kiro/settings';
import { kiroChatUIConfig } from '@/providers/kiro/ui/KiroChatUIConfig';

// The pre-fetched `kiro-cli agent list` catalog is the PRIMARY option source, so
// tests seed it via updateCurrentKiroAgentCatalog. The session-derived modes are
// demoted to supplementing/validating the catalog.
function settingsWithCatalog(): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  updateCurrentKiroAgentCatalog(settings, {
    agents: [
      { id: 'kiro_default', name: 'Default', scope: 'built-in' },
      { id: 'kiro_planner', name: 'Planner', description: 'Plans first', scope: 'built-in' },
      { id: 'kiro_guide', name: 'Guide', scope: 'built-in' },
      { id: 'taskmaster', name: 'Taskmaster', scope: 'global' },
    ],
    currentAgentId: 'kiro_default',
    fingerprint: 'fp-1',
    refreshedAt: Date.now(),
  });
  return settings;
}

describe('kiroChatUIConfig.getModeSelector', () => {
  it('returns null when neither the catalog nor a session has any agents', () => {
    expect(kiroChatUIConfig.getModeSelector?.({})).toBeNull();
  });

  it('builds a selector from the pre-fetched catalog before any session exists', () => {
    // No session snapshot present: proves the selector renders at startup.
    const settings = settingsWithCatalog();
    expect(getKiroProviderSettings(settings).currentAgentModes).toBeNull();

    const config = kiroChatUIConfig.getModeSelector?.(settings);

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

  it('defaults the value to the catalog currentAgentId when nothing is selected', () => {
    const config = kiroChatUIConfig.getModeSelector?.(settingsWithCatalog());
    expect(config?.value).toBe('kiro_default');
  });

  it('reflects an explicit selection in the value', () => {
    const settings = settingsWithCatalog();
    kiroChatUIConfig.applyModeSelection?.('taskmaster', settings);
    expect(getKiroProviderSettings(settings).selectedAgentMode).toBe('taskmaster');
    expect(kiroChatUIConfig.getModeSelector?.(settings)?.value).toBe('taskmaster');
  });

  it('ignores an unknown id so the execution layer never drives an invalid set_mode', () => {
    const settings = settingsWithCatalog();
    kiroChatUIConfig.applyModeSelection?.('not_a_real_mode', settings);
    expect(getKiroProviderSettings(settings).selectedAgentMode).toBeNull();
    // Falls back to the catalog currentAgentId rather than the rejected id.
    expect(kiroChatUIConfig.getModeSelector?.(settings)?.value).toBe('kiro_default');
  });

  it('is independent of the permission (normal/yolo) toggle', () => {
    const settings = settingsWithCatalog();
    kiroChatUIConfig.applyModeSelection?.('kiro_guide', settings);
    kiroChatUIConfig.applyPermissionMode?.('yolo', settings);

    expect(kiroChatUIConfig.resolvePermissionMode?.(settings)).toBe('yolo');
    expect(kiroChatUIConfig.getModeSelector?.(settings)?.value).toBe('kiro_guide');
    expect(getKiroProviderSettings(settings).selectedAgentMode).toBe('kiro_guide');
  });

  it('supplements the catalog with session-only modes and validates against both', () => {
    const settings = settingsWithCatalog();
    // The live session advertises an extra custom agent not in the catalog.
    updateCurrentKiroAgentModes(settings, {
      currentModeId: 'kiro_default',
      modes: [
        { id: 'kiro_default', name: 'Default' },
        { id: 'session-only', name: 'Session Only' },
      ],
    });

    const config = kiroChatUIConfig.getModeSelector?.(settings);
    expect(config?.options.map((option) => option.value)).toEqual([
      'kiro_default',
      'kiro_planner',
      'kiro_guide',
      'taskmaster',
      'session-only',
    ]);

    // A session-only id is a valid, sendable selection.
    kiroChatUIConfig.applyModeSelection?.('session-only', settings);
    expect(getKiroProviderSettings(settings).selectedAgentMode).toBe('session-only');
    expect(kiroChatUIConfig.getModeSelector?.(settings)?.value).toBe('session-only');
  });

  it('falls back to a session snapshot when no catalog is present', () => {
    const settings: Record<string, unknown> = {};
    updateCurrentKiroAgentModes(settings, {
      currentModeId: 'kiro_planner',
      modes: [
        { id: 'kiro_default', name: 'Default' },
        { id: 'kiro_planner', name: 'Planner' },
      ],
    });

    const config = kiroChatUIConfig.getModeSelector?.(settings);
    expect(config?.options.map((option) => option.value)).toEqual([
      'kiro_default',
      'kiro_planner',
    ]);
    expect(config?.value).toBe('kiro_planner');
  });

  it('drops a persisted selection once the agent leaves the available set', () => {
    const settings = settingsWithCatalog();
    kiroChatUIConfig.applyModeSelection?.('taskmaster', settings);

    // The next pre-fetch no longer lists taskmaster.
    updateKiroProviderSettings(settings, { agentCatalogsByHost: {} });
    updateCurrentKiroAgentCatalog(settings, {
      agents: [
        { id: 'kiro_default', name: 'Default', scope: 'built-in' },
        { id: 'kiro_planner', name: 'Planner', scope: 'built-in' },
      ],
      currentAgentId: 'kiro_default',
      fingerprint: 'fp-2',
      refreshedAt: Date.now(),
    });

    // Selection persists in storage but must not be surfaced as a sendable value.
    expect(kiroChatUIConfig.getModeSelector?.(settings)?.value).toBe('kiro_default');
  });
});
