import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type { ProviderTransitionOwnerContext } from '../../../core/providers/types';
import { toError } from '../../../utils/error';
import { computeKiroEnvironmentHash } from '../env/KiroSettingsReconciler';
import {
  getCurrentKiroAgentCatalog,
  getKiroProviderSettings,
  type KiroAgentCatalogSnapshot,
  updateCurrentKiroAgentCatalog,
} from '../settings';
import type {
  KiroAgentCatalogDiscoveryResult,
  KiroAgentCatalogServiceLike,
} from './KiroAgentCatalogService';

const AGENT_CATALOG_TTL_MS = 5 * 60 * 1000;

export type KiroAgentCatalogState = 'failed' | 'idle' | 'ready' | 'refreshing';

export interface KiroAgentCatalogResult {
  catalog: KiroAgentCatalogSnapshot | null;
  changed: boolean;
  diagnostics?: string;
  kind: 'completed' | 'skipped';
  persistedSettingsChanged: boolean;
}

/**
 * Leaner sibling of {@link KiroModelCatalogCoordinator}: agents only need
 * discover -> persist plus environment-transition quiescing. There is no live
 * session-merge machinery because the agent list is sourced solely from the
 * pre-fetched `kiro-cli agent list` output.
 */
export class KiroAgentCatalogCoordinator {
  private readonly activeOperations = new Set<Promise<unknown>>();
  private abortController: AbortController | null = null;
  private disposed = false;
  private inFlightRefresh: {
    contextKey: string;
    generation: number;
    promise: Promise<KiroAgentCatalogResult>;
    transitionOwner: boolean;
  } | null = null;
  private refreshGeneration = 0;
  private state: KiroAgentCatalogState = 'idle';
  private transitionActive = false;
  private readonly transitionWaiters = new Set<() => void>();

  constructor(
    private readonly plugin: ProviderHost,
    private readonly service: KiroAgentCatalogServiceLike,
  ) {}

  getCachedCatalog(): KiroAgentCatalogSnapshot | null {
    return getCurrentKiroAgentCatalog(this.plugin.settings);
  }

  getState(): KiroAgentCatalogState {
    return this.state;
  }

  ensureFresh(
    _reason: string,
    options: { force?: boolean } = {},
  ): Promise<KiroAgentCatalogResult> {
    if (this.disposed || !getKiroProviderSettings(this.plugin.settings).enabled) {
      return Promise.resolve(this.skippedResult());
    }
    return this.runOperation(
      () => this.ensureFreshUnfenced(options),
      false,
      () => this.skippedResult(),
    );
  }

  private ensureFreshUnfenced(
    options: { force?: boolean },
  ): Promise<KiroAgentCatalogResult> {
    if (options.force || this.isStale()) {
      return this.refreshUnfenced();
    }
    return Promise.resolve(this.completedResult());
  }

  refresh(context?: ProviderTransitionOwnerContext): Promise<KiroAgentCatalogResult> {
    if (this.disposed || !getKiroProviderSettings(this.plugin.settings).enabled) {
      return Promise.resolve(this.skippedResult());
    }
    return this.runOperation(
      () => this.refreshUnfenced(context),
      context?.providerTransitionOwner === true,
      () => this.skippedResult(),
    );
  }

  private async refreshUnfenced(
    context?: ProviderTransitionOwnerContext,
  ): Promise<KiroAgentCatalogResult> {
    if (this.transitionActive && context?.providerTransitionOwner !== true) {
      return this.skippedResult();
    }
    const contextKey = this.getContextKey();
    const transitionOwner = context?.providerTransitionOwner === true;
    if (
      this.inFlightRefresh?.contextKey === contextKey
      && (!transitionOwner || this.inFlightRefresh.transitionOwner)
    ) {
      return this.inFlightRefresh.promise;
    }
    if (this.inFlightRefresh) this.abortController?.abort();

    const generation = ++this.refreshGeneration;
    const promise = this.runRefresh(generation, contextKey, context);
    const flight = { contextKey, generation, promise, transitionOwner };
    this.inFlightRefresh = flight;
    try {
      return await promise;
    } finally {
      if (this.inFlightRefresh === flight) this.inFlightRefresh = null;
    }
  }

  beginEnvironmentTransition(): void {
    if (!this.disposed) this.transitionActive = true;
  }

  endEnvironmentTransition(): void {
    if (this.disposed) return;
    this.transitionActive = false;
    this.releaseTransitionWaiters();
  }

  async quiesceForEnvironmentChange(): Promise<void> {
    const flight = this.inFlightRefresh;
    const activeOperations = [...this.activeOperations];
    this.refreshGeneration += 1;
    this.abortController?.abort();
    if (flight) {
      await flight.promise.catch(() => undefined);
      if (this.inFlightRefresh === flight) this.inFlightRefresh = null;
    }
    await Promise.all(activeOperations.map(operation => operation.catch(() => undefined)));
    this.state = 'idle';
  }

  cancel(): void {
    this.abortController?.abort();
  }

  dispose(): void {
    this.disposed = true;
    this.transitionActive = false;
    this.releaseTransitionWaiters();
    this.cancel();
  }

  private isStale(): boolean {
    const catalog = this.getCachedCatalog();
    if (!catalog || catalog.agents.length === 0 || !catalog.fingerprint) {
      return true;
    }
    return Date.now() - catalog.refreshedAt > AGENT_CATALOG_TTL_MS;
  }

  private runOperation<T>(
    operation: () => Promise<T>,
    transitionOwner: boolean,
    disposedResult: () => T,
  ): Promise<T> {
    if (this.disposed) return Promise.resolve(disposedResult());
    if (this.transitionActive && !transitionOwner) {
      return this.waitForTransition().then(() =>
        this.runOperation(operation, transitionOwner, disposedResult));
    }

    let promise: Promise<T>;
    try {
      promise = operation();
    } catch (error) {
      promise = Promise.reject(toError(error, 'Kiro agent catalog operation failed'));
    }
    this.activeOperations.add(promise);
    void promise.then(
      () => this.activeOperations.delete(promise),
      () => this.activeOperations.delete(promise),
    );
    return promise;
  }

  private waitForTransition(): Promise<void> {
    if (this.disposed || !this.transitionActive) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.transitionWaiters.add(resolve);
    });
  }

  private releaseTransitionWaiters(): void {
    const waiters = [...this.transitionWaiters];
    this.transitionWaiters.clear();
    for (const resolve of waiters) resolve();
  }

  private async runRefresh(
    generation: number,
    contextKey: string,
    context?: ProviderTransitionOwnerContext,
  ): Promise<KiroAgentCatalogResult> {
    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;
    this.state = 'refreshing';

    try {
      const discovery = await this.service.discoverCatalog(
        abortController.signal,
        context,
      );
      if (!this.isCurrentRefresh(generation) || contextKey !== this.getContextKey()) {
        if (this.disposed || this.abortController === abortController) this.state = 'idle';
        return this.skippedResult();
      }
      if (discovery.kind === 'skipped') {
        this.state = this.getCachedCatalog() ? 'ready' : 'idle';
        return this.skippedResult();
      }
      if (discovery.diagnostics || discovery.agents.length === 0) {
        this.state = 'failed';
        return {
          ...this.completedResult(),
          diagnostics: discovery.diagnostics
            ?? 'Kiro agent list returned no available agents',
        };
      }

      const persisted = await this.persistDiscovery(discovery, contextKey, generation);
      if (!this.isCurrentRefresh(generation)) {
        if (this.disposed) this.state = 'idle';
        return this.skippedResult();
      }
      this.state = 'ready';
      if (persisted.changed) {
        this.plugin.notifyProviderChatOptionsChanged('kiro');
      }
      return {
        catalog: this.getCachedCatalog(),
        kind: 'completed',
        ...persisted,
      };
    } catch {
      if (!this.isCurrentRefresh(generation)) {
        if (this.disposed) this.state = 'idle';
        return this.skippedResult();
      }
      this.state = 'failed';
      return {
        ...this.completedResult(),
        diagnostics: 'Kiro agent catalog refresh failed',
      };
    } finally {
      if (this.abortController === abortController) {
        this.abortController = null;
      }
    }
  }

  private async persistDiscovery(
    discovery: Extract<KiroAgentCatalogDiscoveryResult, { kind: 'completed' }>,
    expectedContextKey: string,
    expectedGeneration: number,
  ): Promise<{ changed: boolean; persistedSettingsChanged: boolean }> {
    let result = { changed: false, persistedSettingsChanged: false };
    await this.plugin.mutateSettingsConditionally((settings) => {
      if (
        this.disposed
        || !this.isCurrentRefresh(expectedGeneration)
        || computeKiroEnvironmentHash(settings) !== expectedContextKey
      ) {
        return false;
      }
      const current = getCurrentKiroAgentCatalog(settings);
      const snapshot: KiroAgentCatalogSnapshot = {
        agents: discovery.agents,
        currentAgentId: discovery.currentAgentId,
        fingerprint: discovery.fingerprint,
        refreshedAt: Date.now(),
      };
      const changed = !sameCatalogContent(current, snapshot);
      const persistedSettingsChanged = !sameValue(current, snapshot);
      if (persistedSettingsChanged) {
        updateCurrentKiroAgentCatalog(settings, snapshot);
      }
      result = { changed, persistedSettingsChanged };
      return persistedSettingsChanged;
    });
    return result;
  }

  private getContextKey(): string {
    return computeKiroEnvironmentHash(this.plugin.settings);
  }

  private isCurrentRefresh(generation: number): boolean {
    return !this.disposed && generation === this.refreshGeneration;
  }

  private completedResult(): KiroAgentCatalogResult {
    return {
      catalog: this.getCachedCatalog(),
      changed: false,
      kind: 'completed',
      persistedSettingsChanged: false,
    };
  }

  private skippedResult(): KiroAgentCatalogResult {
    return {
      catalog: this.getCachedCatalog(),
      changed: false,
      kind: 'skipped',
      persistedSettingsChanged: false,
    };
  }
}

function sameCatalogContent(
  current: KiroAgentCatalogSnapshot | null,
  next: KiroAgentCatalogSnapshot,
): boolean {
  return current !== null && sameValue(
    { agents: current.agents, currentAgentId: current.currentAgentId },
    { agents: next.agents, currentAgentId: next.currentAgentId },
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
