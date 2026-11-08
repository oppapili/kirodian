import '@/providers';

import {
  BUILT_IN_COMMANDS,
  getBuiltInCommandsForDropdown,
} from '@/core/commands/builtInCommands';

describe('getBuiltInCommandsForDropdown - provider filtering', () => {
  it('returns every built-in command when all capabilities are supported', () => {
    const commands = getBuiltInCommandsForDropdown({
      supportsNativeHistory: true,
      supportsFork: true,
      supportsFastMode: true,
    });
    expect(commands.length).toBe(BUILT_IN_COMMANDS.length);
    expect(commands.map(c => c.name)).toEqual(['new', 'compact', 'sessions', 'fast', 'side']);
  });

  it('returns the full set when no capability context is provided', () => {
    const commands = getBuiltInCommandsForDropdown();
    expect(commands.length).toBe(BUILT_IN_COMMANDS.length);
  });

  it('excludes capability-gated commands the provider does not support', () => {
    const commands = getBuiltInCommandsForDropdown({
      supportsNativeHistory: false,
      supportsFork: false,
      supportsFastMode: false,
    });
    expect(commands.map(c => c.name)).toEqual(['new', 'compact']);
    expect(commands.map(c => c.name)).not.toContain('sessions');
    expect(commands.map(c => c.name)).not.toContain('fast');
    expect(commands.map(c => c.name)).not.toContain('side');
  });

  it('resolves capabilities for the kiro provider id', () => {
    const commands = getBuiltInCommandsForDropdown('kiro');
    // kiro is the only registered provider; it must at least expose /new.
    expect(commands.map(c => c.name)).toContain('new');
  });
});
