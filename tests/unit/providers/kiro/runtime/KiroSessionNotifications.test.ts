import {
  KIRO_COMMANDS_AVAILABLE_NOTIFICATION_METHODS,
  parseKiroAvailableCommandsNotification,
} from '@/providers/kiro/runtime/KiroSessionNotifications';

describe('parseKiroAvailableCommandsNotification', () => {
  it('subscribes to the _kiro.dev commands/available method', () => {
    expect(KIRO_COMMANDS_AVAILABLE_NOTIFICATION_METHODS).toContain(
      '_kiro.dev/commands/available',
    );
  });

  it('returns only well-formed command entries', () => {
    const params = {
      commands: [
        { name: '/agent', description: 'Select or list available agents' },
        { name: '/model' },
        { description: 'no name so dropped' },
        'not an object',
      ],
    };

    const result = parseKiroAvailableCommandsNotification(params);

    expect(result?.map((command) => command.name)).toEqual(['/agent', '/model']);
  });

  it('returns null when the payload has no commands array', () => {
    expect(parseKiroAvailableCommandsNotification({})).toBeNull();
    expect(parseKiroAvailableCommandsNotification({ commands: 'x' })).toBeNull();
    expect(parseKiroAvailableCommandsNotification(null)).toBeNull();
  });
});
