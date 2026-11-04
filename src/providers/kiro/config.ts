import type { HostnameCLIPaths } from '../../core/types/settings';
import type { KiroAgentMode } from './execution/KiroSessionModeMetadata';
import type { KiroDiscoveredModel } from './models';
import type { KiroAgentDirectories } from './runtime/KiroAgentModelLock';

/**
 * Runtime-safe Kiro provider configuration: the persisted shape, its defaults, and the
 * plain config predicates. These never touch the application settings document (no
 * `getProviderConfig`/`providerEnvironment` imports), so provider runtime modules may
 * read them within their architecture boundary. The settings-document adapters that
 * wrap these values live in `./settings` and re-export this module's types.
 */

export interface KiroCatalogSnapshot {
  models: KiroDiscoveredModel[];
  defaultModelId: string | null;
  fingerprint: string;
  refreshedAt: number;
}

/** Runtime snapshot of the agent modes advertised by the live ACP session. */
export interface KiroAgentModeSnapshot {
  modes: KiroAgentMode[];
  currentModeId: string | null;
  /**
   * Agent-definition directories from the CLI-prefetched `agent list` headers, used to
   * resolve a selected custom agent's `<dir>/<id>.json` (and its pinned `"model"`). Absent
   * for a session-only snapshot, which never carries these paths.
   */
  directories?: KiroAgentDirectories;
}

export interface PersistedKiroProviderSettings {
  enabled: boolean;
  cliPath: string;
  cliPathsByHost: HostnameCLIPaths;
  catalogsByHost: Record<string, KiroCatalogSnapshot>;
  environmentVariables: string;
  environmentHash: string;
  visibleModels: string[] | null;
  modelAliases: Record<string, string>;
  preferredReasoningByModel: Record<string, string>;
  /** Runtime snapshot of the live session's agent modes, keyed by host. Not user-authored. */
  agentModesByHost: Record<string, KiroAgentModeSnapshot>;
  /** The user's explicitly chosen agent mode id, independent of the permission toggle. */
  selectedAgentMode: string | null;
}

export interface KiroProviderSettings extends PersistedKiroProviderSettings {
  currentCatalog: KiroCatalogSnapshot | null;
  /** Agent modes for the current host, resolved from `agentModesByHost`. */
  currentAgentModes: KiroAgentModeSnapshot | null;
}

export const DEFAULT_KIRO_PROVIDER_SETTINGS: Readonly<PersistedKiroProviderSettings> = Object.freeze({
  agentModesByHost: {},
  catalogsByHost: {},
  cliPath: '',
  cliPathsByHost: {},
  // Kiro is Kirodian's primary and only user-visible provider. On a fresh
  // install with no persisted settings it must default to enabled, otherwise
  // the provider menu renders empty (claude is hidden, kiro would be disabled)
  // and a new user is stuck with no selectable provider (#88).
  enabled: true,
  environmentHash: '',
  environmentVariables: '',
  modelAliases: {},
  preferredReasoningByModel: {},
  selectedAgentMode: null,
  visibleModels: null,
});

/**
 * Whether the Kiro provider is enabled, read from its own provider configuration
 * (e.g. `ProviderRuntimeHost.config`) without touching the application settings
 * document, so provider runtime modules stay within their architecture boundary.
 */
export function isKiroProviderEnabled(config: Readonly<Record<string, unknown>>): boolean {
  return typeof config.enabled === 'boolean'
    ? config.enabled
    : DEFAULT_KIRO_PROVIDER_SETTINGS.enabled;
}
