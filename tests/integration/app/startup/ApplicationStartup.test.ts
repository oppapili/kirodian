import { DesktopVault } from '@test/helpers/core/DesktopVault';
import { DEFAULT_CLAUDIAN_SETTINGS } from '@test/helpers/defaultSettings';

import { SettingsCoordinator } from '@/app/settings/SettingsCoordinator';
import { type ApplicationDomains, startApplication } from '@/app/startup/ApplicationStartup';
import { ProviderExecutionLifecycleRegistry } from '@/core/execution/ProviderExecutionLifecycleRegistry';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';

// Provider history readers touch the filesystem through Node's fs.
jest.mock('fs');

// Kiro is the sole provider, so conversations hydrate through the kiro
// native-history resolver, which reads the real fs sync API directly. Under
// `jest.mock('fs')` those reads return undefined and crash path containment.
// Resolve no native session directory, so hydration is a no-op and returns the
// conversation unchanged (the production path when no native history file exists).
jest.mock('@/providers/kiro/history/KiroHistoryPathResolver', () => ({
  ...jest.requireActual('@/providers/kiro/history/KiroHistoryPathResolver'),
  resolveKiroSessionDirectory: () => null,
}));

import '@/providers';

/**
 * The committed defaults after startup, which projects the active provider's
 * state. kiro is the sole visible provider and defaults to enabled (#88), so
 * startup resolves `settingsProvider` to kiro, projects its normal permission
 * mode and default model, and computes its environment hash. The hash is
 * environment-derived, so it is matched loosely to stay stable across CI hosts.
 */
function expectedDefaultStartupSettings(): Record<string, unknown> {
  const defaults = JSON.parse(JSON.stringify(DEFAULT_CLAUDIAN_SETTINGS)) as Record<string, unknown>;
  const providerConfigs = defaults.providerConfigs as Record<string, Record<string, unknown>>;
  delete defaults.effortLevel;
  return {
    ...defaults,
    settingsProvider: 'kiro',
    permissionMode: 'normal',
    savedProviderModel: { kiro: 'haiku' },
    savedProviderPermissionMode: { kiro: 'normal' },
    providerConfigs: {
      ...providerConfigs,
      kiro: { ...providerConfigs.kiro, environmentHash: expect.any(String) },
    },
  };
}

describe('startApplication', () => {
  let mockApp: any;
  let plugin: { app: any; loadData: jest.Mock; saveData: jest.Mock };
  const disposals: Array<() => Promise<void>> = [];

  async function loadApplication(
    overrides: { providers?: typeof ProviderRegistry } = {},
  ): Promise<ApplicationDomains> {
    const domains = await startApplication({
      plugin: plugin as never,
      defaultSettings: DEFAULT_CLAUDIAN_SETTINGS,
      providers: overrides.providers ?? ProviderRegistry,
      providerSettings: ProviderSettingsCoordinator,
      executionLifecycle: new ProviderExecutionLifecycleRegistry(),
      isUnloading: () => false,
      publishCommittedSettings: async () => undefined,
      onConversationDeleted: async () => undefined,
      onConversationListChanged: () => undefined,
      onAllMetadataLoaded: () => undefined,
      ensureProviderWorkspace: async () => undefined,
      getSessionArchive: async () => null,
    });
    disposals.push(async () => {
      await domains.sessionMetadata.dispose();
      await domains.nativeSessionArchives.dispose();
      await domains.projects?.dispose();
    });
    // Upstream removed the eager `deferNonRestoredSessionMetadata: false` startup
    // option; non-restored metadata now loads on demand. Load it here so these
    // tests observe the fully-hydrated set as before.
    await domains.sessionMetadata.ensureAllLoaded();
    return domains;
  }

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockApp = {
      vault: {
        adapter: {
          basePath: '/test/vault',
          exists: jest.fn().mockResolvedValue(false),
          read: jest.fn().mockResolvedValue(''),
          write: jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
          mkdir: jest.fn().mockResolvedValue(undefined),
          list: jest.fn().mockResolvedValue({ files: [], folders: [] }),
          stat: jest.fn().mockResolvedValue(null),
          rename: jest.fn().mockResolvedValue(undefined),
        },
      },
      workspace: {
        layoutReady: true,
        onLayoutReady: jest.fn(),
      },
    };
    plugin = {
      app: mockApp,
      loadData: jest.fn().mockResolvedValue({}),
      saveData: jest.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(async () => {
    await Promise.allSettled(disposals.splice(0).map(dispose => dispose()));
  });

  describe('settings', () => {
    it('should merge saved data with defaults', async () => {
      // Mock claudian-settings.json exists with custom values (Claudian-specific settings)
      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        return path === '.claudian/claudian-settings.json';
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.claudian/claudian-settings.json') {
          return JSON.stringify({
            userName: 'TestUser',
          });
        }
        return '';
      });

      const domains = await loadApplication();

      expect(domains.settings.getCommittedSettings().userName).toBe('TestUser');
      expect(domains.settings.getCommittedSettings().hiddenCommands).toEqual(DEFAULT_CLAUDIAN_SETTINGS.hiddenCommands);
    });

    it('should use defaults when no saved data', async () => {
      // No settings file exists
      mockApp.vault.adapter.exists.mockResolvedValue(false);
      plugin.loadData.mockResolvedValue(null);

      const domains = await loadApplication();

      // Compare persisted values; provider discovery may attach transient symbol metadata.
      expect(JSON.parse(JSON.stringify(domains.settings.getCommittedSettings())))
        .toEqual(expectedDefaultStartupSettings());
    });

    it('should use defaults when loadData returns empty object', async () => {
      // No settings file exists
      mockApp.vault.adapter.exists.mockResolvedValue(false);
      plugin.loadData.mockResolvedValue({});

      const domains = await loadApplication();

      // Compare persisted values; provider discovery may attach transient symbol metadata.
      expect(JSON.parse(JSON.stringify(domains.settings.getCommittedSettings())))
        .toEqual(expectedDefaultStartupSettings());
    });

    it('preserves the saved model while applying environment configuration', async () => {
      // Mock claudian-settings.json with environment variables
      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        return path === '.claudian/claudian-settings.json';
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.claudian/claudian-settings.json') {
          return JSON.stringify({
            providerConfigs: { kiro: { environmentVariables: 'KIRO_CUSTOM_ENV=custom-value' } },
            lastEnvHash: '',
          });
        }
        return '';
      });

      const saveSpy = jest.spyOn(SettingsCoordinator.prototype, 'persistCurrent');
      const domains = await loadApplication();

      expect(domains.settings.getCommittedSettings().model).toBe(DEFAULT_CLAUDIAN_SETTINGS.model);
      expect(saveSpy).toHaveBeenCalled();
    });
  });

  describe('session metadata', () => {
    it('should preserve provider metadata during startup when local native history is missing', async () => {
      const timestamp = Date.now();
      const sessionMeta = JSON.stringify({
        id: 'conv-stale-1',
        providerId: 'kiro',
        title: 'Stale Chat',
        createdAt: timestamp,
        lastActivityAt: timestamp,
        sessionId: 'missing-session',
      });

      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        return path === '.claudian/claudian-settings.json'
          || path === '.claudian/sessions'
          || path === '.claudian/sessions/conv-stale-1.meta.json';
      });
      mockApp.vault.adapter.list.mockImplementation(async (path: string) => {
        if (path === '.claudian/sessions') {
          return { files: ['.claudian/sessions/conv-stale-1.meta.json'], folders: [] };
        }
        return { files: [], folders: [] };
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.claudian/sessions/conv-stale-1.meta.json') {
          return sessionMeta;
        }
        if (path === '.claudian/claudian-settings.json') {
          return JSON.stringify({});
        }
        return '';
      });

      const domains = await loadApplication();

      expect(domains.conversations.getConversationList()).toHaveLength(1);
      expect(mockApp.vault.adapter.remove).not.toHaveBeenCalledWith(
        '.claudian/sessions/conv-stale-1.meta.json',
      );
    });

    it('should load saved conversations from metadata files', async () => {
      const timestamp = Date.now();
      const sessionMeta = JSON.stringify({
        id: 'conv-saved-1',
        title: 'Saved Chat',
        createdAt: timestamp,
        lastActivityAt: timestamp,
        sessionId: 'saved-session',
      });

      // Mock files exist
      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        // Session files
        if (path === '.claudian/sessions' || path === '.claudian/sessions/conv-saved-1.meta.json') {
          return true;
        }
        // claudian-settings.json exists
        if (path === '.claudian/claudian-settings.json') {
          return true;
        }
        return false;
      });
      mockApp.vault.adapter.list.mockImplementation(async (path: string) => {
        if (path === '.claudian/sessions') {
          return { files: ['.claudian/sessions/conv-saved-1.meta.json'], folders: [] };
        }
        return { files: [], folders: [] };
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.claudian/sessions/conv-saved-1.meta.json') {
          return sessionMeta;
        }
        if (path === '.claudian/claudian-settings.json') {
          return JSON.stringify({});
        }
        return '';
      });

      // data.json is minimal (no state - already migrated)
      plugin.loadData.mockResolvedValue({});

      const domains = await loadApplication();

      const loaded = await domains.conversations.getConversationById('conv-saved-1');
      expect(loaded?.id).toBe('conv-saved-1');
      expect(loaded?.title).toBe('Saved Chat');
    });

    it('should ignore legacy activeConversationId when no sessions exist', async () => {
      // No sessions exist
      mockApp.vault.adapter.exists.mockResolvedValue(false);
      mockApp.vault.adapter.list.mockResolvedValue({ files: [], folders: [] });

      plugin.loadData.mockResolvedValue({
        activeConversationId: 'non-existent',
        migrationVersion: 2,
      });

      const domains = await loadApplication();

      expect(domains.conversations.getConversationList()).toHaveLength(0);
    });

    it('should load messages from previousProviderSessionIds when present', async () => {
      const timestamp = Date.now();

      // Setup conversation with previousProviderSessionIds
      const sessionMeta = JSON.stringify({
        type: 'meta',
        id: 'conv-multi-session',
        title: 'Multi Session Chat',
        createdAt: timestamp,
        lastActivityAt: timestamp,
        providerState: {
          providerSessionId: 'session-B',
          previousProviderSessionIds: ['session-A'],
        },
      });

      mockApp.vault.adapter.exists.mockImplementation(async (path: string) => {
        return path === '.claudian/claudian-settings.json' ||
          path === '.claudian/sessions' ||
          path === '.claudian/sessions/conv-multi-session.meta.json';
      });
      mockApp.vault.adapter.list.mockImplementation(async (path: string) => {
        if (path === '.claudian/sessions') {
          return { files: ['.claudian/sessions/conv-multi-session.meta.json'], folders: [] };
        }
        return { files: [], folders: [] };
      });
      mockApp.vault.adapter.read.mockImplementation(async (path: string) => {
        if (path === '.claudian/sessions/conv-multi-session.meta.json') {
          return sessionMeta;
        }
        if (path === '.claudian/claudian-settings.json') {
          return JSON.stringify({});
        }
        return '';
      });

      plugin.loadData.mockResolvedValue({});

      const domains = await loadApplication();

      const loaded = await domains.conversations.getConversationById('conv-multi-session');
      expect((loaded?.providerState as any)?.previousProviderSessionIds).toEqual(['session-A']);
      expect((loaded?.providerState as any)?.providerSessionId).toBe('session-B');
    });
  });
  describe('projects', () => {
    it('loads project records and member metadata before startup completes, preserving unparsable files', async () => {
      // Upstream #1807 moved project storage onto the managed-file API, which reaches
      // the real desktop filesystem rather than the Obsidian adapter mock, so this
      // uses a real temporary vault.
      const timestamp = Date.now();
      const vault = await DesktopVault.create();
      disposals.push(() => vault.dispose());
      await vault.write('.claudian/projects/project-a.json', JSON.stringify({
        id: 'project-a', name: 'Launch', instructions: 'Ship.', memoryPath: '.claudian/projects/launch-project.md',
        isPinned: true, createdAt: timestamp,
      }));
      await vault.write('.claudian/projects/broken.json', '{"id": "broken"');
      await vault.write('.claudian/sessions/conv-member.meta.json', JSON.stringify({
        id: 'conv-member', title: 'Member', createdAt: timestamp, lastActivityAt: timestamp,
        sessionId: null, projectId: 'project-a',
      }));
      plugin.app = vault.app;

      const domains = await loadApplication();

      expect(domains.projects.list()).toEqual([expect.objectContaining({ id: 'project-a', name: 'Launch' })]);
      expect(domains.conversations.getConversationList()).toEqual([
        expect.objectContaining({ id: 'conv-member', projectId: 'project-a' }),
      ]);
      // The unparsable file is left untouched rather than rewritten or removed.
      expect(await vault.read('.claudian/projects/broken.json')).toBe('{"id": "broken"');
    });
  });
});
