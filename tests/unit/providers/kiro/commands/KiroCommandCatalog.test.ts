import { KiroCommandCatalog } from '@/providers/kiro/commands/KiroCommandCatalog';

describe('KiroCommandCatalog', () => {
  it('maps a plain command to a kind:command entry inserted and shown with /', async () => {
    const catalog = new KiroCommandCatalog();
    catalog.setCommandSnapshot([
      { id: 'acp:agent', name: 'agent', description: 'Select agent', content: '', source: 'sdk' },
    ]);

    const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });

    expect(entries).toEqual([
      expect.objectContaining({
        id: 'acp:agent',
        providerId: 'kiro',
        kind: 'command',
        name: 'agent',
        displayPrefix: '/',
        insertPrefix: '/',
      }),
    ]);
  });

  it('maps a skill to a kind:skill entry shown with $ but inserted with /', async () => {
    const catalog = new KiroCommandCatalog();
    catalog.setCommandSnapshot([
      {
        id: 'acp-skill:hello-skill',
        name: 'hello-skill',
        description: 'A test skill',
        content: '',
        kind: 'skill',
        source: 'sdk',
      },
    ]);

    const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });

    expect(entries).toEqual([
      expect.objectContaining({
        id: 'acp-skill:hello-skill',
        providerId: 'kiro',
        kind: 'skill',
        name: 'hello-skill',
        displayPrefix: '$',
        insertPrefix: '/',
      }),
    ]);
  });

  it('advertises $ as a skill trigger alongside / in the dropdown config', () => {
    const catalog = new KiroCommandCatalog();

    expect(catalog.getDropdownConfig()).toEqual({
      providerId: 'kiro',
      triggerChars: ['/', '$'],
      builtInPrefix: '/',
      skillPrefix: '$',
      commandPrefix: '/',
    });
  });
});
