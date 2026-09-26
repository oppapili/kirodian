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
import {
  KiroAgentCatalogService,
  type KiroAgentCatalogServiceLike,
} from '../runtime/KiroAgentCatalogService';
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
  modelCatalogCoordinator: KiroModelCatalogCoordinator;
  agentCatalogCoordinator: KiroAgentCatalogCoordinator;
  refreshModelCatalog(
    context?: ProviderTransitionOwnerContext,
  ): ReturnType<KiroModelCatalogCoordinator['refreshModelCatalog']>;
  refreshAgentCatalog(
    context?: ProviderTransitionOwnerContext,
  ): ReturnType<KiroAgentCatalogCoordinator['refresh']>;
  prepareSettings(): Promise<void>;
  dispose(): Promise<void>;
}

export interface KiroWorkspaceServicesOptions {
  readonly commandMetadataProbe?: KiroCommandMetadataProbe;
  readonly agentCatalogService?: KiroAgentCatalogServiceLike;
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
  const agentCatalogCoordinator = new KiroAgentCatalogCoordinator(
    plugin,
    options.agentCatalogService ?? new KiroAgentCatalogService(plugin),
  );
  const commandMetadataProbe = options.commandMetadataProbe
    ?? new KiroCommandMetadataProbe(plugin);
  const modelCatalog = createKiroModels(plugin, modelCatalogCoordinator);
  const unregisterTransitionHook =
    plugin.executionLifecycleRegistry.registerTransitionHook('kiro', {
      beforeTransition: async () => {
        modelCatalog.beginTransition();
        modelCatalogCoordinator.beginEnvironmentTransition();
        commandMetadataProbe.beginEnvironmentTransition();
        await Promise.all([
          modelCatalogCoordinator.quiesceForEnvironmentChange(),
          commandMetadataProbe.quiesceForEnvironmentChange(),
        ]);
      },
      afterTransition: async () => {
        try {
          await Promise.all([
            modelCatalogCoordinator.quiesceForEnvironmentChange(),
            commandMetadataProbe.quiesceForEnvironmentChange(),
          ]);
        } finally {
          modelCatalogCoordinator.endEnvironmentTransition();
          commandMetadataProbe.endEnvironmentTransition();
          modelCatalog.endTransition();
        }
        // Re-prefetch agents against the new environment so the selector tracks a
        // CLI-path or env change without waiting for the first prompt. Best-effort.
        void agentCatalogCoordinator.refresh().catch(() => {});
      },
    });

  // Populate the agent catalog once, the moment these workspace services first go
  // live. This is the same startup seam that readies the model catalog: provider
  // services are initialized lazily through `ProviderWorkspaceRegistry.ensureInitialized`
  // (driven at startup by both the selected-model metadata migration and the first
  // Kiro chat tab's activation), and the model-catalog controller/coordinator built
  // just above become usable at exactly this point. Prefetching here means the Agent
  // selector is populated as soon as a Kiro chat tab is ready, rather than only after
  // the user opens the settings tab (`prepareSettings`) or sends a first prompt.
  //
  // Best-effort and non-blocking: `refresh` no-ops while the provider is disabled,
  // swallows a missing CLI / non-zero exit / parse failure into an empty completed
  // result (leaving the persisted snapshot untouched so the selector simply stays
  // hidden), and fires `notifyProviderChatOptionsChanged('kiro')` itself once it
  // persists a change so the toolbar re-renders without any user action. The `void`
  // + `.catch` keeps every failure off the UI thread and out of the session.
  void agentCatalogCoordinator.refresh().catch(() => {});

  return {
    cliResolver: new KiroCLIResolver(),
    commandCatalog: new KiroCommandCatalog(),
    modelCatalogCoordinator,
    agentCatalogCoordinator,
    commandLoader: new KiroCommandLoader(commandMetadataProbe),
    settingsTabRenderer: kiroSettingsTabRenderer,
    tabWarmupPolicy: kiroTabWarmupPolicy,
    modelCatalog,
    refreshModelCatalog: context => modelCatalogCoordinator.refreshModelCatalog(context),
    refreshAgentCatalog: context => agentCatalogCoordinator.refresh(context),
    async prepareSettings() {
      await Promise.all([
        modelCatalogCoordinator.ensureFresh('settings'),
        agentCatalogCoordinator.refresh(),
      ]);
    },
    async dispose() {
      unregisterTransitionHook();
      modelCatalogCoordinator.dispose();
      agentCatalogCoordinator.dispose();
      await Promise.all([
        modelCatalog.dispose(),
        modelCatalogCoordinator.quiesceForEnvironmentChange(),
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
