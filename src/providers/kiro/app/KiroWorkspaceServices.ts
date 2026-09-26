import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderTabWarmupPolicy,
  ProviderTransitionOwnerContext,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { KiroCommandCatalog } from '../commands/KiroCommandCatalog';
import { KiroAgentCatalogCoordinator } from '../runtime/KiroAgentCatalogCoordinator';
import { KiroAgentCatalogService } from '../runtime/KiroAgentCatalogService';
import { KiroCLIResolver } from '../runtime/KiroCLIResolver';
import { KiroModelCatalogCoordinator } from '../runtime/KiroModelCatalogCoordinator';
import { KiroModelCatalogService } from '../runtime/KiroModelCatalogService';
import { createKiroModels } from '../runtime/KiroModels';
import { kiroSettingsTabRenderer } from '../ui/KiroSettingsTab';
import { KiroCommandLoader } from './KiroCommandLoader';
import { KiroCommandMetadataProbe } from './KiroCommandMetadataProbe';

export interface KiroWorkspaceServices extends ProviderWorkspaceServices {
  cliResolver: KiroCLIResolver;
  commandCatalog: ProviderCommandCatalog;
  agentCatalogCoordinator: KiroAgentCatalogCoordinator;
  modelCatalogCoordinator: KiroModelCatalogCoordinator;
  refreshModelCatalog(
    context?: ProviderTransitionOwnerContext,
  ): ReturnType<KiroModelCatalogCoordinator['refreshModelCatalog']>;
  prepareSettings(): Promise<void>;
  dispose(): Promise<void>;
}

export interface KiroWorkspaceServicesOptions {
  readonly commandMetadataProbe?: KiroCommandMetadataProbe;
}

const kiroTabWarmupPolicy: ProviderTabWarmupPolicy = {
  resolveMode() {
    return 'commands';
  },
};

export async function createKiroWorkspaceServices(
  plugin: ProviderHost,
  options: KiroWorkspaceServicesOptions = {},
): Promise<KiroWorkspaceServices> {
  const modelCatalogService = new KiroModelCatalogService(plugin);
  const modelCatalogCoordinator = new KiroModelCatalogCoordinator(
    plugin,
    modelCatalogService,
  );
  const agentCatalogService = new KiroAgentCatalogService(plugin);
  const agentCatalogCoordinator = new KiroAgentCatalogCoordinator(
    plugin,
    agentCatalogService,
  );
  const commandMetadataProbe = options.commandMetadataProbe
    ?? new KiroCommandMetadataProbe(plugin);
  const modelCatalog = createKiroModels(plugin, modelCatalogCoordinator);
  const unregisterTransitionHook =
    plugin.executionLifecycleRegistry.registerTransitionHook('kiro', {
      beforeTransition: async () => {
        modelCatalog.beginTransition();
        modelCatalogCoordinator.beginEnvironmentTransition();
        agentCatalogCoordinator.beginEnvironmentTransition();
        commandMetadataProbe.beginEnvironmentTransition();
        await Promise.all([
          modelCatalogCoordinator.quiesceForEnvironmentChange(),
          agentCatalogCoordinator.quiesceForEnvironmentChange(),
          commandMetadataProbe.quiesceForEnvironmentChange(),
        ]);
      },
      afterTransition: async () => {
        try {
          await Promise.all([
            modelCatalogCoordinator.quiesceForEnvironmentChange(),
            agentCatalogCoordinator.quiesceForEnvironmentChange(),
            commandMetadataProbe.quiesceForEnvironmentChange(),
          ]);
        } finally {
          modelCatalogCoordinator.endEnvironmentTransition();
          agentCatalogCoordinator.endEnvironmentTransition();
          commandMetadataProbe.endEnvironmentTransition();
          modelCatalog.endTransition();
        }
      },
    });

  return {
    cliResolver: new KiroCLIResolver(),
    commandCatalog: new KiroCommandCatalog(),
    agentCatalogCoordinator,
    modelCatalogCoordinator,
    commandLoader: new KiroCommandLoader(commandMetadataProbe),
    settingsTabRenderer: kiroSettingsTabRenderer,
    tabWarmupPolicy: kiroTabWarmupPolicy,
    modelCatalog,
    refreshModelCatalog: context => modelCatalogCoordinator.refreshModelCatalog(context),
    async prepareSettings() {
      // Pre-fetch both catalogs at settings/startup so the model and Agent
      // selectors render before the first prompt establishes a session.
      await Promise.all([
        modelCatalogCoordinator.ensureFresh('settings'),
        agentCatalogCoordinator.ensureFresh('settings'),
      ]);
    },
    async dispose() {
      unregisterTransitionHook();
      modelCatalogCoordinator.dispose();
      agentCatalogCoordinator.dispose();
      await Promise.all([
        modelCatalog.dispose(),
        modelCatalogCoordinator.quiesceForEnvironmentChange(),
        agentCatalogCoordinator.quiesceForEnvironmentChange(),
        commandMetadataProbe.dispose(),
      ]);
    },
  };
}

export const kiroWorkspaceRegistration: ProviderWorkspaceRegistration<KiroWorkspaceServices> = {
  initialize: async ({ plugin }) => createKiroWorkspaceServices(plugin),
};

export function getKiroWorkspaceServices(): KiroWorkspaceServices {
  return ProviderWorkspaceRegistry.requireServices('kiro') as KiroWorkspaceServices;
}
