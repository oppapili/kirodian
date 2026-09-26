import { NOOP_TASK_RESULT_INTERPRETER } from '../../core/providers/NoopTaskResultInterpreter';
import { getProviderConfig } from '../../core/providers/providerConfig';
import { hasStoredConfigNormalization } from '../../core/providers/settings/storedSettings';
import type { ProviderModule } from '../../core/providers/types';
import {
  getKiroWorkspaceServices,
  kiroWorkspaceRegistration,
} from './app/KiroWorkspaceServices';
import { KIRO_PROVIDER_CAPABILITIES } from './capabilities';
import { kiroSettingsReconciler } from './env/KiroSettingsReconciler';
import { KiroExecutionBackend } from './execution/KiroExecutionBackend';
import { KiroConversationHistoryService } from './history/KiroConversationHistoryService';
import { kiroSubagentLifecycleAdapter } from './normalization/kiroSubagentNormalization';
import { getKiroProviderSettings, updateKiroProviderSettings } from './settings';
import { kiroChatUIConfig } from './ui/KiroChatUIConfig';

export const kiroProviderRegistration: ProviderModule = {
  id: 'kiro',
  blankTabOrder: 12,
  capabilities: KIRO_PROVIDER_CAPABILITIES,
  chatUIConfig: kiroChatUIConfig,
  createExecutionBackend: (plugin) => {
    const workspace = getKiroWorkspaceServices();
    return new KiroExecutionBackend(plugin, {
      commandCatalog: workspace.commandCatalog,
      modelCatalogCoordinator: workspace.modelCatalogCoordinator,
    });
  },
  displayName: 'Kiro',
  environmentKeyPatterns: [/^KIRO_/i, /^AWS_/i],
  historyService: new KiroConversationHistoryService(),
  isEnabled: settings => getKiroProviderSettings(settings).enabled,
  setEnabled: (settings, enabled) => updateKiroProviderSettings(settings, { enabled }),
  settingsReconciler: kiroSettingsReconciler,
  settingsStorage: {
    hostScopedFields: [
      'cliPathsByHost',
      'catalogsByHost',
      'agentCatalogsByHost',
      'agentModesByHost',
    ],
    normalizeStored(target, stored) {
      const storedConfig = getProviderConfig(stored, 'kiro');
      updateKiroProviderSettings(target, getKiroProviderSettings(stored));
      return hasStoredConfigNormalization(
        storedConfig,
        getProviderConfig(target, 'kiro'),
      );
    },
  },
  subagentAdapter: kiroSubagentLifecycleAdapter,
  taskResultInterpreter: NOOP_TASK_RESULT_INTERPRETER,
  workspace: kiroWorkspaceRegistration,
};
