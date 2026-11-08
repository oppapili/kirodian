import '@/providers';

import { DEFAULT_CLAUDIAN_SETTINGS as DEFAULT_SETTINGS } from '@test/helpers/defaultSettings';
import type { Mocked } from 'vitest';

import {
  CLAUDIAN_SETTINGS_PATH,
  ClaudianSettingsStorage
} from '@/app/settings/ClaudianSettingsStorage';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { getKiroProviderSettings } from '@/providers/kiro/settings';



const mockGetHostnameKey = vi.fn(() => 'host-a');
const mockGetLegacyDeviceSettingsKey = vi.fn<(...args: []) => string | null>(() => null);
const originalPlatform = process.platform;

const mockAdapter = {
  exists: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  delete: vi.fn(),
} as unknown as Mocked<VaultFileAdapter>;

vi.mock('@/core/device/InstallationKey', async () => ({
  ...(await vi.importActual<typeof import('@/core/device/InstallationKey')>('@/core/device/InstallationKey')),
  getInstallationKey: () => mockGetHostnameKey(),
  getLegacyDeviceSettingsKey: () => mockGetLegacyDeviceSettingsKey(),
}));

describe('ClaudianSettingsStorage', () => {
  let storage: ClaudianSettingsStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    // Reset mock implementations to default resolved values
    mockAdapter.exists.mockResolvedValue(false);
    mockAdapter.read.mockResolvedValue('{}');
    mockAdapter.write.mockResolvedValue(undefined);
    mockAdapter.delete.mockResolvedValue(undefined);
    mockGetHostnameKey.mockReturnValue('host-a');
    mockGetLegacyDeviceSettingsKey.mockReturnValue(null);
    storage = new ClaudianSettingsStorage(mockAdapter, DEFAULT_SETTINGS);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  describe('load', () => {
    it('retires obsolete saved settings while preserving current settings and provider configuration', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({
        ...DEFAULT_SETTINGS,
        persistentExternalContextPaths: ['/old/project'],
        maxWarmAgentProcesses: 7,
        projectSort: 'created',
        userName: 'Ada',
        providerConfigs: { kiro: { cliPath: '/custom/kiro-cli' } },
      }));

      const loaded = await storage.load();
      const written = JSON.parse(mockAdapter.write.mock.calls.at(-1)![1]);

      expect(loaded.userName).toBe('Ada');
      expect(written.userName).toBe('Ada');
      expect(written.providerConfigs.kiro.cliPath).toBe('/custom/kiro-cli');
      expect(loaded).not.toHaveProperty('persistentExternalContextPaths');
      expect(written).not.toHaveProperty('persistentExternalContextPaths');
      expect(loaded).not.toHaveProperty('maxWarmAgentProcesses');
      expect(written).not.toHaveProperty('maxWarmAgentProcesses');
      expect(written).not.toHaveProperty('projectSort');
    });


    it('should return defaults when file does not exist', async () => {
      mockAdapter.exists.mockResolvedValue(false);

      const result = await storage.load();

      expect(result.model).toBe(DEFAULT_SETTINGS.model);
      expect(result.permissionMode).toBe(DEFAULT_SETTINGS.permissionMode);
      expect(result.requireCommandOrControlEnterToSend).toBe(false);
      expect(result.titleGenerationLocale).toBe('');
      expect(result.lastSelectedChatModel).toBeNull();
      expect(result.enableDualPane).toBe(true);
      expect(result.dualPaneSide).toBe('right');
      expect(result.restoreTabsOnStartup).toBe(true);
      expect(result.enableZenMode).toBe(true);
      expect(mockAdapter.read).not.toHaveBeenCalled();
    });

    it('ignores retired .claude settings without modifying them', async () => {
      mockAdapter.exists.mockImplementation(async path => path === '.claude/claudian-settings.json');
      mockAdapter.read.mockResolvedValue(JSON.stringify({ userName: 'Retired' }));
      expect((await storage.load()).userName).toBe(DEFAULT_SETTINGS.userName);
      expect(mockAdapter.read).not.toHaveBeenCalled();
      expect(mockAdapter.write).not.toHaveBeenCalled();
      expect(mockAdapter.delete).not.toHaveBeenCalled();
    });

    it('should parse valid JSON and merge with defaults', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({
        model: 'claude-opus-4-5',
        userName: 'TestUser',
      }));

      const result = await storage.load();

      expect(result.model).toBe('claude-opus-4-5');
      expect(result.userName).toBe('TestUser');
      // Defaults should still be present for unspecified fields
      expect(result.effortLevel).toBe(DEFAULT_SETTINGS.effortLevel);
    });


    it('preserves an explicitly stored null chat model selection', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({
        lastSelectedChatModel: null,
      }));

      const result = await storage.load();

      expect(result.lastSelectedChatModel).toBeNull();
      expect(mockAdapter.write).not.toHaveBeenCalled();
    });

    it('normalizes a malformed stored chat model selection to null', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({
        lastSelectedChatModel: {
          providerId: 'kiro',
          model: 42,
        },
      }));

      const result = await storage.load();
      const writtenContent = JSON.parse(mockAdapter.write.mock.calls[0][1]);

      expect(result.lastSelectedChatModel).toBeNull();
      expect(writtenContent.lastSelectedChatModel).toBeNull();
    });

    it('drops an explicitly stored selection on a hidden provider', async () => {
      // A persisted selection written before Claude was hidden is no longer a
      // valid visible selection; load discards it (migrates to null) and persists.
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({
        lastSelectedChatModel: {
          providerId: 'claude',
          model: 'opus',
        },
      }));

      const result = await storage.load();
      const writtenContent = JSON.parse(mockAdapter.write.mock.calls[0][1]);

      expect(result.lastSelectedChatModel).toBeNull();
      expect(writtenContent.lastSelectedChatModel).toBeNull();
    });




    it('coerces a retired Claude legacy selection to the default provider', async () => {
      // Claude's source was removed, so it is no longer registered. A legacy
      // settingsProvider pointing at it must land on the default (kiro) and
      // must NOT carry the now-invalid claude top-level model. With no kiro
      // top-level/saved model to carry over, the selection resolves to null.
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({
        settingsProvider: 'claude',
        model: 'opus',
      }));

      const result = await storage.load();

      expect(result.lastSelectedChatModel).toBeNull();
    });

    it('coerces a retired Claude legacy selection to kiro when a kiro model exists', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({
        settingsProvider: 'claude',
        model: 'opus',
        savedProviderModel: {
          kiro: 'kiro/claude-sonnet-4',
        },
      }));

      const result = await storage.load();

      expect(result.lastSelectedChatModel).toEqual({
        providerId: 'kiro',
        model: 'kiro/claude-sonnet-4',
      });
    });

    it('uses the default provider for an unknown legacy provider only when a top-level model exists', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({
        settingsProvider: 'unknown-provider',
        model: 'kiro/claude-sonnet-4',
      }));

      const result = await storage.load();

      expect(result.lastSelectedChatModel).toEqual({
        providerId: 'kiro',
        model: 'kiro/claude-sonnet-4',
      });
    });

    it('ignores retired placement and flat provider settings', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({ openInMainTab: true, claudeCliPath: '/retired', codexCliPath: '/retired', environmentVariables: 'ANTHROPIC_API_KEY=retired\nHTTP_PROXY=retired', hiddenSlashCommands: ['retired'] }));
      const result = await storage.load();
      expect(result.chatViewPlacement).toBe(DEFAULT_SETTINGS.chatViewPlacement);
      expect(getKiroProviderSettings(result).cliPath).toBe('');
      expect(getKiroProviderSettings(result).environmentVariables).toBe('');
      expect(result.sharedEnvironmentVariables).toBe('');
      expect(result.hiddenCommands).toEqual([]);
    });

    it('normalizes invalid chatViewPlacement values', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({
        chatViewPlacement: 'floating-window',
      }));

      const result = await storage.load();
      const writtenContent = JSON.parse(mockAdapter.write.mock.calls[0][1]);

      expect(result.chatViewPlacement).toBe('right-sidebar');
      expect(writtenContent.chatViewPlacement).toBe('right-sidebar');
    });

    it('normalizes dual-pane preferences and removes the legacy file pane setting', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({
        enableDualPane: 'yes',
        enableFilePane: 'yes',
        dualPaneSide: 'top',
      }));

      const result = await storage.load();
      const writtenContent = JSON.parse(mockAdapter.write.mock.calls[0][1]);

      expect(result.enableDualPane).toBe(true);
      expect(result.dualPaneSide).toBe('right');
      expect(result).not.toHaveProperty('enableFilePane');
      expect(writtenContent.enableDualPane).toBe(true);
      expect(writtenContent.dualPaneSide).toBe('right');
      expect(writtenContent).not.toHaveProperty('enableFilePane');
    });

    it('normalizes invalid startup tab restore values', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({
        restoreTabsOnStartup: 'yes',
      }));

      const result = await storage.load();
      const writtenContent = JSON.parse(mockAdapter.write.mock.calls[0][1]);

      expect(result.restoreTabsOnStartup).toBe(true);
      expect(writtenContent.restoreTabsOnStartup).toBe(true);
    });

    it('preserves a disabled startup tab restore toggle', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({
        restoreTabsOnStartup: false,
      }));

      const result = await storage.load();
      const writtenContent = JSON.parse(mockAdapter.write.mock.calls[0][1]);

      expect(result.restoreTabsOnStartup).toBe(false);
      expect(writtenContent.restoreTabsOnStartup).toBe(false);
    });

    it.each([
      ['missing', {}, true],
      ['disabled', { enableZenMode: false }, false],
      ['enabled', { enableZenMode: true }, true],
    ])('loads a %s zen mode preference', async (_label, stored, expected) => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify(stored));

      const result = await storage.load();

      expect(result.enableZenMode).toBe(expected);
      const writtenValues = mockAdapter.write.mock.calls
        .map(([, content]) => (JSON.parse(content) as Record<string, unknown>).enableZenMode)
        .filter(value => value !== undefined);
      expect(writtenValues.every(value => value === expected)).toBe(true);
    });

    it('persists a normalized invalid zen mode preference', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({ enableZenMode: 'yes' }));

      const result = await storage.load();

      expect(result.enableZenMode).toBe(true);
      expect(JSON.parse(mockAdapter.write.mock.calls.at(-1)![1]).enableZenMode).toBe(true);
    });

    it.each([
      ['missing', {}, null],
      ['docked', { zenModePosition: null }, null],
      ['moved', { zenModePosition: { x: -0.2, y: 0.375 } }, { x: -0.2, y: 0.375 }],
      ['malformed', { zenModePosition: { x: '1', y: 0.5 } }, null],
    ])('loads a %s zen panel position', async (_label, stored, expected) => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify(stored));

      const result = await storage.load();

      expect(result.zenModePosition).toEqual(expected);
    });

    it('normalizes kiro provider CLI paths from loaded data', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({
        providerConfigs: {
          kiro: {
            cliPathsByHost: {
          'host-a': '/custom/path-a',
          'host-b': '/custom/path-b',
        }
        }
        },
      }));

      const result = await storage.load();

      expect(getKiroProviderSettings(result).cliPathsByHost['host-a']).toBe('/custom/path-a');
      expect(getKiroProviderSettings(result).cliPathsByHost['host-b']).toBe('/custom/path-b');
    });

    it('preserves hostname-scoped provider settings without assigning them to the current device', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      mockGetHostnameKey.mockReturnValue('device:current');
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({
        lastSelectedChatModel: null,
        providerConfigs: {
          kiro: {
            cliPathsByHost: {
              'host-a': '/custom/kiro-a',
              'host-b': '/custom/kiro-b',
            },
          },
        },
      }));

      const result = await storage.load();
      const kiroSettings = getKiroProviderSettings(result);

      // The foreign-host paths are preserved verbatim and NOT reassigned to the
      // current device key ('device:current' must not appear).
      expect(kiroSettings.cliPathsByHost).toEqual({
        'host-a': '/custom/kiro-a',
        'host-b': '/custom/kiro-b',
      });
      expect(kiroSettings.cliPathsByHost).not.toHaveProperty('device:current');
    });

    it('migrates current-device provider maps from the colon key to the portable key', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      mockGetHostnameKey.mockReturnValue('device-portable');
      mockGetLegacyDeviceSettingsKey.mockReturnValue('device:legacy');
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({
        lastSelectedChatModel: null,
        providerConfigs: {
          kiro: {
            cliPathsByHost: {
              'device:legacy': '/legacy/kiro',
              'device:other': '/other/kiro',
            },
          },
        },
      }));

      const result = await storage.load();
      const kiroSettings = getKiroProviderSettings(result);
      const persisted = JSON.parse(mockAdapter.write.mock.calls[0][1]);

      expect(kiroSettings.cliPathsByHost).toEqual({
        'device-portable': '/legacy/kiro',
        'device:other': '/other/kiro',
      });
      expect(persisted.providerConfigs.kiro.cliPathsByHost)
        .toEqual(kiroSettings.cliPathsByHost);
    });

    it('merges per-provider hidden commands into one global list and retires the old key', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({
        hiddenProviderCommands: {
          claude: ['commit', '/Review'],
          codex: ['$commit'],
          pi: ['skill:review', 'review'],
        },
        hiddenSlashCommands: ['legacy'],
      }));

      const result = await storage.load();
      const writtenContent = JSON.parse(mockAdapter.write.mock.calls[0][1]);

      expect(result.hiddenCommands).toEqual(['commit', 'Review', 'skill:review']);
      expect(writtenContent.hiddenCommands).toEqual(['commit', 'Review', 'skill:review']);
      expect(writtenContent).not.toHaveProperty('hiddenProviderCommands');
      expect(result).not.toHaveProperty('hiddenProviderCommands');
    });

    it('loads the vault-wide skills sync flag as a boolean', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({}));
      expect((await storage.load()).skillsSynced).toBe(false);

      mockAdapter.read.mockResolvedValue(JSON.stringify({ skillsSynced: true }));
      expect((await storage.load()).skillsSynced).toBe(true);

      mockAdapter.read.mockResolvedValue(JSON.stringify({ skillsSynced: 'yes' }));
      expect((await storage.load()).skillsSynced).toBe(false);
    });

    it('keeps an existing global hidden list over a stale per-provider map', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({
        hiddenCommands: ['kept', ' /kept ', ''],
        hiddenProviderCommands: { claude: ['stale'] },
      }));

      const result = await storage.load();
      const writtenContent = JSON.parse(mockAdapter.write.mock.calls[0][1]);

      expect(result.hiddenCommands).toEqual(['kept']);
      expect(writtenContent.hiddenCommands).toEqual(['kept']);
      expect(writtenContent).not.toHaveProperty('hiddenProviderCommands');
    });

    it('preserves explicit scope on stored mixed environment snippets', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({
        envSnippets: [{
          id: 'snippet-1',
          name: 'Mixed snippet',
          description: '',
          envVars: 'PATH=/usr/local/bin\nANTHROPIC_MODEL=claude-custom',
          scope: 'shared',
        }],
      }));

      const result = await storage.load();
      const writtenContent = JSON.parse(mockAdapter.write.mock.calls[0][1]);

      expect(result.envSnippets).toEqual([{
        id: 'snippet-1',
        name: 'Mixed snippet',
        description: '',
        envVars: 'PATH=/usr/local/bin\nANTHROPIC_MODEL=claude-custom',
        scope: 'shared',
        contextLimits: undefined,
        modelAliases: undefined,
      }]);
      expect(writtenContent.envSnippets[0].scope).toBe('shared');
    });

    it('normalizes custom model aliases on load', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(JSON.stringify({
        providerConfigs: {
          kiro: {
            modelAliases: {
          ' custom-model ': '  Friendly model  ',
          empty: '   ',
          ignored: 123,
        }
        }
        },
        envSnippets: [{
          id: 'snippet-1',
          name: 'Aliased snippet',
          description: '',
          envVars: 'KIRO_MODEL=custom-model',
          modelAliases: {
            ' custom-model ': '  Snippet model  ',
            ignored: 123,
          },
        }],
      }));

      const result = await storage.load();
      const writtenContent = JSON.parse(mockAdapter.write.mock.calls[0][1]);

      expect(result).not.toHaveProperty('customModelAliases');
      expect(result.providerConfigs.kiro?.modelAliases).toEqual({
        'custom-model': 'Friendly model',
      });
      expect(result.envSnippets[0].modelAliases).toEqual({
        'custom-model': 'Snippet model',
      });
      // With no discovered catalog, kiro retains the normalized alias on persist.
      expect(writtenContent.providerConfigs.kiro.modelAliases).toEqual({
        'custom-model': 'Friendly model',
      });
      expect(writtenContent.envSnippets[0].modelAliases).toEqual({
        'custom-model': 'Snippet model',
      });
    });

    it('should throw on JSON parse error', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue('invalid json');

      await expect(storage.load()).rejects.toThrow();
    });

    it('should throw on read error', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockRejectedValue(new Error('Read failed'));

      await expect(storage.load()).rejects.toThrow('Read failed');
    });
  });

  describe('save', () => {
    it('should write settings to file', async () => {
      const settings = {
        ...DEFAULT_SETTINGS,
        model: 'claude-opus-4-5' as const,
      };

      await storage.save(settings);

      expect(mockAdapter.write).toHaveBeenCalledWith(
        CLAUDIAN_SETTINGS_PATH,
        expect.any(String)
      );
      const writtenContent = JSON.parse(mockAdapter.write.mock.calls[0][1]);
      expect(writtenContent.model).toBe('claude-opus-4-5');
    });

    it('should throw on write error', async () => {
      mockAdapter.write.mockRejectedValue(new Error('Write failed'));

      await expect(storage.save(DEFAULT_SETTINGS)).rejects.toThrow('Write failed');
    });
  });
});

function createAdapter(
  stored: Record<string, unknown>,
): Mocked<VaultFileAdapter> {
  return {
    exists: vi.fn().mockImplementation(async (path: string) => (
      path === CLAUDIAN_SETTINGS_PATH
    )),
    read: vi.fn().mockResolvedValue(JSON.stringify(stored)),
    write: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  } as unknown as Mocked<VaultFileAdapter>;
}

describe('ClaudianSettingsStorage Linked content migration', () => {
  it('imports legacy organization and pinned paths before defaults and awaits canonical persistence', async () => {
    const adapter = createAdapter({
      sessionManagerOrganization: 'linked-note',
      pinnedLinkedNotePaths: [
        'Notes\\Plan.md',
        './Notes/Plan.md',
        'Projects//Research',
        '../outside',
      ],
    });
    let releaseWrite!: () => void;
    let signalWriteStarted!: () => void;
    const writeStarted = new Promise<void>((resolve) => {
      signalWriteStarted = resolve;
    });
    adapter.write.mockImplementation(() => new Promise<void>((resolve) => {
      signalWriteStarted();
      releaseWrite = resolve;
    }));
    const storage = new ClaudianSettingsStorage(adapter, DEFAULT_SETTINGS);

    let resolved = false;
    const load = storage.load().then((settings) => {
      resolved = true;
      return settings;
    });
    await writeStarted;

    expect(adapter.write).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(false);
    releaseWrite();

    await expect(load).resolves.toMatchObject({
      sessionManagerOrganization: 'linked-content',
      pinnedLinkedContentPaths: [
        'Notes/Plan.md',
        'Projects/Research',
      ],
    });
    const persisted = JSON.parse(adapter.write.mock.calls[0][1]);
    expect(persisted.sessionManagerOrganization).toBe('linked-content');
    expect(persisted.pinnedLinkedContentPaths).toEqual([
      'Notes/Plan.md',
      'Projects/Research',
    ]);
    expect(persisted).not.toHaveProperty('pinnedLinkedNotePaths');
  });

  it('lets an explicitly stored canonical empty list win over legacy pins', async () => {
    const adapter = createAdapter({
      pinnedLinkedContentPaths: [],
      pinnedLinkedNotePaths: ['Notes/Legacy.md'],
    });
    const storage = new ClaudianSettingsStorage(adapter, DEFAULT_SETTINGS);

    const settings = await storage.load();

    expect(settings.pinnedLinkedContentPaths).toEqual([]);
    expect(adapter.write).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(adapter.write.mock.calls[0][1]);
    expect(persisted.pinnedLinkedContentPaths).toEqual([]);
    expect(persisted).not.toHaveProperty('pinnedLinkedNotePaths');
  });

  it('normalizes canonical pins without falling back to the legacy field', async () => {
    const adapter = createAdapter({
      pinnedLinkedContentPaths: [
        'Projects\\Current',
        './Projects/Current',
        '../invalid',
      ],
      pinnedLinkedNotePaths: ['Notes/Legacy.md'],
    });
    const storage = new ClaudianSettingsStorage(adapter, DEFAULT_SETTINGS);

    const settings = await storage.load();

    expect(settings.pinnedLinkedContentPaths).toEqual(['Projects/Current']);
    const persisted = JSON.parse(adapter.write.mock.calls[0][1]);
    expect(persisted.pinnedLinkedContentPaths).toEqual(['Projects/Current']);
    expect(persisted).not.toHaveProperty('pinnedLinkedNotePaths');
  });

  it('omits legacy pinned paths from future writes', async () => {
    const adapter = createAdapter({});
    const storage = new ClaudianSettingsStorage(adapter, DEFAULT_SETTINGS);

    await storage.save({
      ...await storage.load(),
      pinnedLinkedContentPaths: ['Projects/Current'],
      pinnedLinkedNotePaths: ['Notes/Legacy.md'],
    });

    const persisted = JSON.parse(adapter.write.mock.calls.at(-1)![1]);
    expect(persisted.pinnedLinkedContentPaths).toEqual(['Projects/Current']);
    expect(persisted).not.toHaveProperty('pinnedLinkedNotePaths');
  });
});

describe('ClaudianSettingsStorage project settings', () => {
  it('replaces the retired projects organization with the default', async () => {
    const adapter = createAdapter({ sessionManagerOrganization: 'projects' });

    const settings = await new ClaudianSettingsStorage(adapter, DEFAULT_SETTINGS).load();

    expect(settings.sessionManagerOrganization).toBe('list');
    const written = JSON.parse(adapter.write.mock.calls.at(-1)![1]);
    expect(written.sessionManagerOrganization).toBe('list');
  });

});
