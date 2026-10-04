import {
  KIRO_COMMANDS_AVAILABLE_NOTIFICATION_METHODS,
  KIRO_SKILL_PROMPT_SERVER_NAME,
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

    // Commands are normalized to SlashCommand form (leading slash stripped).
    expect(result?.map((command) => command.name)).toEqual(['agent', 'model']);
    expect(result?.every((command) => command.kind !== 'skill')).toBe(true);
  });

  it('returns null when the payload has no commands array', () => {
    expect(parseKiroAvailableCommandsNotification({})).toBeNull();
    expect(parseKiroAvailableCommandsNotification({ commands: 'x' })).toBeNull();
    expect(parseKiroAvailableCommandsNotification(null)).toBeNull();
  });

  // Regression (issue #7): Kiro ships agent skills in the `prompts` array of the
  // same notification, with `serverName: "skill:config"`. The previous parser read
  // only `commands`, so skills were never surfaced. These two tests pin the fix:
  // skills must be returned, tagged `kind: 'skill'`, and MCP prompts excluded.
  it('surfaces skill prompts (serverName skill:config) as kind:skill entries', () => {
    const params = {
      commands: [{ name: '/agent', description: 'Select or list available agents' }],
      prompts: [
        {
          name: 'hello-skill',
          description: 'A test skill that greets you',
          arguments: [],
          serverName: KIRO_SKILL_PROMPT_SERVER_NAME,
        },
      ],
    };

    const result = parseKiroAvailableCommandsNotification(params);
    const skills = result?.filter((entry) => entry.kind === 'skill');

    expect(skills).toEqual([
      expect.objectContaining({
        id: 'acp-skill:hello-skill',
        kind: 'skill',
        name: 'hello-skill',
        description: 'A test skill that greets you',
        source: 'sdk',
      }),
    ]);
  });

  it('excludes prompts from other servers (MCP prompts are not skills)', () => {
    const params = {
      commands: [{ name: '/model' }],
      prompts: [
        { name: 'kiro-skill', description: 'user skill', arguments: [], serverName: KIRO_SKILL_PROMPT_SERVER_NAME },
        { name: 'mcp-prompt', description: 'from an MCP server', arguments: [], serverName: 'some-mcp-server' },
        { description: 'prompt without a name', serverName: KIRO_SKILL_PROMPT_SERVER_NAME },
      ],
    };

    const result = parseKiroAvailableCommandsNotification(params);
    const skillNames = result?.filter((entry) => entry.kind === 'skill').map((entry) => entry.name);

    expect(skillNames).toEqual(['kiro-skill']);
  });

  it('tolerates a payload with no prompts field (commands only)', () => {
    const result = parseKiroAvailableCommandsNotification({
      commands: [{ name: '/agent' }],
    });

    expect(result).toHaveLength(1);
    expect(result?.[0]).toMatchObject({ name: 'agent' });
    expect(result?.some((entry) => entry.kind === 'skill')).toBe(false);
  });
});
