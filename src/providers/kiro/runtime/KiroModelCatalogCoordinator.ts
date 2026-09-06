import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type {
  ProviderModelCatalogRefreshResult,
  ProviderTransitionOwnerContext,
} from '../../../core/providers/types';
import { toError } from '../../../utils/error';
import { computeKiroEnvironmentHash } from '../env/KiroSettingsReconciler';
import {
  clearKiroReasoningMetadata,
  type KiroDiscoveredModel,
  mergeKiroDiscoveredModels,
  normalizeKiroDiscoveredModels,
} from '../models';
import {
  getCurrentKiroCatalog,
  getKiroProviderSettings,
  type KiroCatalogSnapshot,
  updateCurrentKiroCatalog,
} from '../settings';
import type {
  KiroModelCatalogDiscoveryResult,
  KiroModelCatalogServiceLike,
} from './KiroModelCatalogService';

const CATALOG_TTL_MS = 5 * 60 * 1000;

export type KiroCatalogState = 'failed' | 'idle' | 'ready' | 'refreshing';

export interface KiroCatalogResult {
  catalog: KiroCatalogSnapshot | null;
  changed: boolean;
  diagnostics?: string;
  kind: 'completed' | 'skipped';
  persistedSettingsChanged: boolean;
}

export interface KiroCatalogEnsureResult extends KiroCatalogResult {
  backgroundRefresh?: Promise<KiroCatalogResult>;
}

export class KiroModelCatalogCoordinator {
  private readonly activeMetadataOperations = new Set<Promise<unknown>>();
  private abortController: AbortController | null = null;
  private disposed = false;
  private inFlightRefresh: {
    contextKey: string;
    generation: number;
    promise: Promise<KiroCatalogResult>;
    transitionOwner: boolean;
  } | null = null;
  private liveContextKey: string | null = null;
  private liveDefaultModelId: string | null = null;
  private liveDefaultRevision = 0;
  private readonly liveModelsById = new Map<
    string,
    { model: KiroDiscoveredModel; revision: number }
  >();
  private liveRevision = 0;
  private readonly pendingLiveRevisions = new Set<number>();
  private refreshGeneration = 0;
  private state: KiroCatalogState = 'idle';
  private transitionActive = false;
  private readonly transitionWaiters = new Set<() => void>();

  constructor(
    private readonly plugin: ProviderHost,
    private readonly service: KiroModelCatalogServiceLike,
  ) {}

  getCachedCatalog(): KiroCatalogSnapshot | null {
    return getCurrentKiroCatalog(this.plugin.settings);
  }

  getState(): KiroCatalogState {
    return this.state;
  }

  getStatus(
    context?: ProviderTransitionOwnerContext,
  ): Promise<'fresh' | 'missing' | 'stale'> {
    if (this.disposed) {
      return Promise.resolve(this.getCachedCatalog() ? 'stale' : 'missing');
    }
    return this.runMetadataOperation(
      () => this.getStatusUnfenced(context),
      context?.providerTransitionOwner === true,
      () => this.getCachedCatalog() ? 'stale' : 'missing',
    );
  }

  private async getStatusUnfenced(
    context?: ProviderTransitionOwnerContext,
  ): Promise<'fresh' | 'missing' | 'stale'> {
    const catalog = this.getCachedCatalog();
    if (!catalog || catalog.models.length === 0 || !catalog.fingerprint) {
      return 'missing';
    }
    const fingerprint = await this.service.getCatalogFingerprint(undefined, context);
    if (fingerprint !== catalog.fingerprint) {
      return 'stale';
    }
    return Date.now() - catalog.refreshedAt > CATALOG_TTL_MS ? 'stale' : 'fresh';
  }

  ensureFresh(
    _reason: string,
    options: { force?: boolean } = {},
  ): Promise<KiroCatalogEnsureResult> {
    if (this.disposed || !getKiroProviderSettings(this.plugin.settings).enabled) {
      return Promise.resolve(this.skippedResult());
    }
    return this.runMetadataOperation(
      () => this.ensureFreshUnfenced(options),
      false,
      () => this.skippedResult(),
    );
  }

  private async ensureFreshUnfenced(
    options: { force?: boolean },
  ): Promise<KiroCatalogEnsureResult> {
    if (options.force) {
      return this.refreshUnfenced();
    }

    let status: 'fresh' | 'missing' | 'stale';
    try {
      status = await this.getStatusUnfenced();
    } catch {
      status = this.getCachedCatalog() ? 'stale' : 'missing';
    }
    if (status === 'fresh') {
      return this.completedResult();
    }
    if (status === 'missing') {
      return this.refreshUnfenced();
    }

    return {
      ...this.completedResult(),
      backgroundRefresh: this.refreshUnfenced(),
    };
  }

  refresh(context?: ProviderTransitionOwnerContext): Promise<KiroCatalogResult> {
    if (this.disposed || !getKiroProviderSettings(this.plugin.settings).enabled) {
      return Promise.resolve(this.skippedResult());
    }
    return this.runMetadataOperation(
      () => this.refreshUnfenced(context),
      context?.providerTransitionOwner === true,
      () => this.skippedResult(),
    );
  }

  private async refreshUnfenced(
    context?: ProviderTransitionOwnerContext,
  ): Promise<KiroCatalogResult> {
    if (
      this.transitionActive
      && context?.providerTransitionOwner !== true
    ) {
      return this.skippedResult();
    }
    const contextKey = this.getContextKey();
    const transitionOwner = context?.providerTransitionOwner === true;
    this.prepareLiveContext(contextKey);
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

  async refreshModelCatalog(
    context?: ProviderTransitionOwnerContext,
  ): Promise<ProviderModelCatalogRefreshResult> {
    const result = await this.refresh(context);
    return {
      changed: result.changed,
      ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
      ...(result.persistedSettingsChanged
        ? { persistedSettingsChanged: true }
        : {}),
    };
  }

  mergeLiveModels(
    liveModels: KiroDiscoveredModel[],
    defaultModelId?: string,
    sourceContextKey?: string,
  ): Promise<ProviderModelCatalogRefreshResult> {
    if (this.disposed) {
      return Promise.resolve({ changed: false });
    }
    return this.runMetadataOperation(
      () => this.mergeLiveModelsUnfenced(
        liveModels,
        defaultModelId,
        sourceContextKey,
      ),
      false,
      () => ({ changed: false }),
    );
  }

  private async mergeLiveModelsUnfenced(
    liveModels: KiroDiscoveredModel[],
    defaultModelId?: string,
    sourceContextKey?: string,
  ): Promise<ProviderModelCatalogRefreshResult> {
    const contextKey = this.getContextKey();
    if (sourceContextKey && sourceContextKey !== contextKey) {
      return { changed: false };
    }
    this.prepareLiveContext(contextKey);
    const settings = getKiroProviderSettings(this.plugin.settings);
    const enabledModelIds = new Set(settings.visibleModels ?? []);
    const normalizedLiveModels = normalizeKiroDiscoveredModels(liveModels)
      .map(model => (
        settings.visibleModels === null || enabledModelIds.has(model.rawId)
          ? model
          : clearKiroReasoningMetadata(model)
      ));
    if (normalizedLiveModels.length === 0) {
      return { changed: false };
    }
    const revision = ++this.liveRevision;
    for (const model of normalizedLiveModels) {
      const currentLive = this.liveModelsById.get(model.rawId);
      this.liveModelsById.set(
        model.rawId,
        {
          model: currentLive
            ? mergeKiroDiscoveredModels([currentLive.model], [model])[0]
            : model,
          revision,
        },
      );
    }
    const normalizedDefaultModelId = defaultModelId?.trim() || null;
    if (normalizedDefaultModelId) {
      this.liveDefaultModelId = normalizedDefaultModelId;
      this.liveDefaultRevision = revision;
    }

    this.pendingLiveRevisions.add(revision);
    let persisted: ProviderModelCatalogRefreshResult;
    try {
      persisted = await this.persistLiveModels(
        normalizedLiveModels,
        revision,
        contextKey,
      );
    } finally {
      this.pendingLiveRevisions.delete(revision);
    }
    if (persisted.changed) {
      this.plugin.notifyProviderChatOptionsChanged('kiro');
    }
    return persisted;
  }

  cancel(): void {
    this.abortController?.abort();
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
    const activeOperations = [...this.activeMetadataOperations];
    this.refreshGeneration += 1;
    this.abortController?.abort();
    if (flight) {
      await flight.promise.catch(() => undefined);
      if (this.inFlightRefresh === flight) this.inFlightRefresh = null;
    }
    await Promise.all(activeOperations.map(operation => operation.catch(() => undefined)));
    this.liveContextKey = null;
    this.liveDefaultModelId = null;
    this.liveDefaultRevision = 0;
    this.liveModelsById.clear();
    this.pendingLiveRevisions.clear();
    this.state = 'idle';
  }

  dispose(): void {
    this.disposed = true;
    this.transitionActive = false;
    this.releaseTransitionWaiters();
    this.cancel();
  }

  private runMetadataOperation<T>(
    operation: () => Promise<T>,
    transitionOwner: boolean,
    disposedResult: () => T,
  ): Promise<T> {
    if (this.disposed) return Promise.resolve(disposedResult());
    if (this.transitionActive && !transitionOwner) {
      return this.waitForTransition().then(() =>
        this.runMetadataOperation(operation, transitionOwner, disposedResult));
    }

    let promise: Promise<T>;
    try {
      promise = operation();
    } catch (error) {
      promise = Promise.reject(toError(error, 'Kiro metadata operation failed'));
    }
    this.activeMetadataOperations.add(promise);
    void promise.then(
      () => this.activeMetadataOperations.delete(promise),
      () => this.activeMetadataOperations.delete(promise),
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
  ): Promise<KiroCatalogResult> {
    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;
    this.state = 'refreshing';
    const refreshStartRevision = this.liveRevision;
    const pendingLiveRevisionsAtStart = new Set(this.pendingLiveRevisions);

    try {
      const discovery = await this.service.discoverCatalog(
        abortController.signal,
        context,
      );
      if (!this.isCurrentRefresh(generation)) {
        if (this.disposed) this.state = 'idle';
        return this.skippedResult();
      }
      if (contextKey !== this.getContextKey()) {
        if (this.abortController === abortController) this.state = 'idle';
        return this.skippedResult();
      }
      if (discovery.kind === 'skipped') {
        this.state = this.getCachedCatalog() ? 'ready' : 'idle';
        return this.skippedResult();
      }
      if (discovery.diagnostics || discovery.models.length === 0) {
        this.state = 'failed';
        return {
          ...this.completedResult(),
          diagnostics: discovery.diagnostics ?? 'Kiro models returned no available models',
        };
      }

      const persisted = await this.persistDiscovery(
        discovery,
        refreshStartRevision,
        pendingLiveRevisionsAtStart,
        contextKey,
        generation,
      );
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
        diagnostics: 'Kiro model catalog refresh failed',
      };
    } finally {
      if (this.abortController === abortController) {
        this.abortController = null;
      }
    }
  }

  private async persistDiscovery(
    discovery: Extract<KiroModelCatalogDiscoveryResult, { kind: 'completed' }>,
    refreshStartRevision: number,
    pendingLiveRevisionsAtStart: ReadonlySet<number>,
    expectedContextKey: string,
    expectedGeneration: number,
  ): Promise<{ changed: boolean; persistedSettingsChanged: boolean }> {
    return this.persistCatalog(expectedContextKey, (current) => {
      const isApplicableLiveRevision = (revision: number): boolean => (
        revision > refreshStartRevision
        || pendingLiveRevisionsAtStart.has(revision)
      );
      const liveModels = this.liveContextKey === expectedContextKey
        ? Array.from(this.liveModelsById.values())
          .filter(entry => isApplicableLiveRevision(entry.revision))
          .map(entry => entry.model)
        : [];
      const liveDefaultModelId = this.liveContextKey === expectedContextKey
        && isApplicableLiveRevision(this.liveDefaultRevision)
        ? this.liveDefaultModelId
        : null;
      return snapshotFromDiscovery(
        discovery,
        current,
        liveModels,
        liveDefaultModelId,
      );
    }, expectedGeneration);
  }

  private async persistLiveModels(
    liveModels: KiroDiscoveredModel[],
    revision: number,
    expectedContextKey: string,
  ): Promise<{ changed: boolean; persistedSettingsChanged: boolean }> {
    return this.persistCatalog(expectedContextKey, (current) => {
      const latestModels = liveModels.map((model) => {
        const latest = this.liveContextKey === expectedContextKey
          ? this.liveModelsById.get(model.rawId)
          : null;
        return latest && latest.revision >= revision ? latest.model : model;
      });
      const latestDefaultModelId = this.liveContextKey === expectedContextKey
        && this.liveDefaultRevision >= revision
        ? this.liveDefaultModelId
        : null;
      return {
        defaultModelId: latestDefaultModelId ?? current?.defaultModelId ?? null,
        fingerprint: current?.fingerprint ?? '',
        models: mergeKiroDiscoveredModels(current?.models ?? [], latestModels),
        refreshedAt: current?.refreshedAt ?? 0,
      };
    });
  }

  private async persistCatalog(
    expectedContextKey: string,
    buildSnapshot: (current: KiroCatalogSnapshot | null) => KiroCatalogSnapshot,
    expectedGeneration?: number,
  ): Promise<{ changed: boolean; persistedSettingsChanged: boolean }> {
    let result = { changed: false, persistedSettingsChanged: false };
    await this.plugin.mutateSettingsConditionally((settings) => {
      if (
        this.disposed
        || (
          expectedGeneration !== undefined
          && !this.isCurrentRefresh(expectedGeneration)
        )
        || computeKiroEnvironmentHash(settings) !== expectedContextKey
      ) {
        return false;
      }
      const current = getCurrentKiroCatalog(settings);
      const builtSnapshot = buildSnapshot(current);
      const visibleModels = getKiroProviderSettings(settings).visibleModels;
      const enabledModelIds = new Set(visibleModels ?? []);
      const snapshot = visibleModels === null
        ? builtSnapshot
        : {
          ...builtSnapshot,
          models: builtSnapshot.models.map(model => (
            enabledModelIds.has(model.rawId)
              ? model
              : clearKiroReasoningMetadata(model)
          )),
        };
      const changed = !sameCatalogContent(current, snapshot);
      const persistedSettingsChanged = !sameValue(current, snapshot);
      if (persistedSettingsChanged) {
        updateCurrentKiroCatalog(settings, snapshot);
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

  private prepareLiveContext(contextKey: string): void {
    if (this.liveContextKey === contextKey) return;
    this.liveContextKey = contextKey;
    this.liveDefaultModelId = null;
    this.liveDefaultRevision = 0;
    this.liveModelsById.clear();
    this.pendingLiveRevisions.clear();
  }

  private completedResult(): KiroCatalogResult {
    return {
      catalog: this.getCachedCatalog(),
      changed: false,
      kind: 'completed',
      persistedSettingsChanged: false,
    };
  }

  private skippedResult(): KiroCatalogResult {
    return {
      catalog: this.getCachedCatalog(),
      changed: false,
      kind: 'skipped',
      persistedSettingsChanged: false,
    };
  }
}

function snapshotFromDiscovery(
  discovery: Extract<KiroModelCatalogDiscoveryResult, { kind: 'completed' }>,
  current: KiroCatalogSnapshot | null,
  liveModels: KiroDiscoveredModel[],
  liveDefaultModelId: string | null,
): KiroCatalogSnapshot {
  const currentModelsById = new Map(
    (current?.models ?? []).map(model => [model.rawId, model] as const),
  );
  return {
    defaultModelId: liveDefaultModelId ?? discovery.defaultModelId,
    fingerprint: discovery.fingerprint,
    models: mergeKiroDiscoveredModels(discovery.models.map((discoveredModel) => {
      const currentModel = currentModelsById.get(discoveredModel.rawId);
      return currentModel
        ? mergeKiroDiscoveredModels([currentModel], [discoveredModel])[0]
        : discoveredModel;
    }), liveModels),
    refreshedAt: Date.now(),
  };
}

function sameCatalogContent(
  current: KiroCatalogSnapshot | null,
  next: KiroCatalogSnapshot,
): boolean {
  return current !== null && sameValue(
    { defaultModelId: current.defaultModelId, models: current.models },
    { defaultModelId: next.defaultModelId, models: next.models },
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
