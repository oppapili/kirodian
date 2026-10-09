import '@/providers';

import {
  BUILT_IN_COMMANDS,
  getBuiltInCommandsForDropdown,
} from '@/core/commands/builtInCommands';

describe('getBuiltInCommandsForDropdown - provider filtering', () => {

  it('returns the full built-in set when no command is provider-restricted', () => {
    const commands = getBuiltInCommandsForDropdown({
      supportsNativeHistory: true,
      supportsFork: true,
      supportsFastMode: true,
    });
    expect(commands.length).toBe(BUILT_IN_COMMANDS.length);
    expect(commands.map(c => c.name)).toContain('clear');
    expect(commands.map(c => c.name)).toContain('resume');
    expect(commands.map(c => c.name)).toContain('fork');
  });
});
