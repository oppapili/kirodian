import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type { ProviderTransitionOwnerContext } from '../../../core/providers/types';
import type { KiroAgentMode } from '../execution/KiroSessionModeMetadata';
import {
  getCurrentKiroAgentModes,
  getKiroProviderSettings,
  type KiroAgentModeSnapshot,
  updateCurrentKiroAgentModes,
} from '../settings';
import {
  type KiroAgentCatalogServiceLike,
  toKiroAgentModes,
} from './KiroAgentCatalogService';

export interface KiroAgentCatalogRefreshResult {
  changed: boolean;
  kind: 'completed' | 'skipped';
}

/**
 * Coordinates the CLI-prefetched agent catalog: runs `KiroAgentCatalogService` discovery,
 * persists the resulting agent modes host-scoped (the same `agentModesByHost` slot the live
 * session snapshot writes), and fires `notifyProviderChatOptionsChanged` so the toolbar's
 * Agent selector renders immediately — before the first prompt establishes a session.
 *
 * Best-effort throughout: while the provider is disabled or discovery yields no agents the
 * prior snapshot is left untouched, and no failure here disrupts a session. In-flight
 * refreshes are de-duplicated so concurrent startup and settings-tab triggers share one run.
 */
export class KiroAgentCatalogCoordinator {
  private disposed = false;
  private inFlight: Promise<KiroAgentCatalogRefreshResult> | null = null;

  constructor(
    private readonly plugin: ProviderHost,
    private readonly service: KiroAgentCatalogServiceLike,
  ) {}

  getCachedAgentModes(): KiroAgentModeSnapshot | null {
    return getCurrentKiroAgentModes(this.plugin.settings);
  }

  refresh(
    context?: ProviderTransitionOwnerContext,
  ): Promise<KiroAgentCatalogRefreshResult> {
    if (this.disposed || !getKiroProviderSettings(this.plugin.settings).enabled) {
      return Promise.resolve({ changed: false, kind: 'skipped' });
    }
    if (this.inFlight) {
      return this.inFlight;
    }
    const flight = this.runRefresh(context).finally(() => {
      if (this.inFlight === flight) {
        this.inFlight = null;
      }
    });
    this.inFlight = flight;
    return flight;
  }

  dispose(): void {
    this.disposed = true;
  }

  private async runRefresh(
    context?: ProviderTransitionOwnerContext,
  ): Promise<KiroAgentCatalogRefreshResult> {
    const discovery = await this.service.discoverCatalog(undefined, context);
    if (this.disposed || discovery.kind === 'skipped') {
      return { changed: false, kind: discovery.kind };
    }
    const modes = toKiroAgentModes(discovery.agents);
    if (modes.length === 0) {
      return { changed: false, kind: 'completed' };
    }
    const changed = await this.persist({
      currentModeId: discovery.currentAgentId,
      modes,
    });
    if (changed) {
      this.plugin.notifyProviderChatOptionsChanged('kiro');
    }
    return { changed, kind: 'completed' };
  }

  private async persist(snapshot: {
    currentModeId: string | null;
    modes: KiroAgentMode[];
  }): Promise<boolean> {
    let changed = false;
    await this.plugin.mutateSettingsConditionally((settings) => {
      if (this.disposed) {
        return false;
      }
      const previous = getCurrentKiroAgentModes(settings);
      changed = !sameSnapshot(previous, snapshot);
      if (changed) {
        updateCurrentKiroAgentModes(settings, snapshot);
      }
      return changed;
    });
    return changed;
  }
}

function sameSnapshot(
  left: KiroAgentModeSnapshot | null,
  right: { currentModeId: string | null; modes: KiroAgentMode[] },
): boolean {
  return left !== null
    && JSON.stringify({ currentModeId: left.currentModeId, modes: left.modes })
      === JSON.stringify({ currentModeId: right.currentModeId, modes: right.modes });
}
