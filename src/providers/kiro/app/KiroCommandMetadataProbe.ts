import { OwnedProbeRegistry } from '@/core/providers/metadata/OwnedProbeRegistry';
import { ProviderTransitionFence } from '@/core/providers/metadata/ProviderTransitionFence';
import type { ProviderRuntimeHost } from '@/core/providers/ProviderRuntimeHost';
import type { SlashCommand } from '@/core/types';

import type {
  KiroExecutionNativeConnection,
  KiroExecutionNativeFactory,
} from '../execution/KiroExecutionBackend';
import { KiroExecutionNativeConnectionImpl } from '../execution/KiroExecutionNativeConnection';
import { resolveKiroACPArgs } from '../runtime/KiroACPLaunchArgs';
import { buildKiroRuntimeEnv } from '../runtime/KiroRuntimeEnvironment';

const DEFAULT_NATIVE_FACTORY: KiroExecutionNativeFactory = {
  create: options => new KiroExecutionNativeConnectionImpl(options),
};

interface KiroCommandProbeResource {
  readonly cwd: string;
  readonly native: KiroExecutionNativeConnection;
}

const ABORT_MESSAGE = 'Kiro command metadata probe aborted';
const DISPOSED_MESSAGE = 'Kiro command metadata probe is disposed.';

export class KiroCommandMetadataProbe {
  private disposeFlight: Promise<void> | null = null;
  private readonly probes: OwnedProbeRegistry<KiroCommandProbeResource>;
  private readonly transitionFence = new ProviderTransitionFence({
    abortMessage: ABORT_MESSAGE,
  });

  constructor(
    private readonly host: ProviderRuntimeHost,
    private readonly nativeFactory: KiroExecutionNativeFactory = DEFAULT_NATIVE_FACTORY,
  ) {
    this.probes = new OwnedProbeRegistry({
      abortMessage: ABORT_MESSAGE,
      dispose: resource => resource.native.shutdown(),
      unavailableError: () => new Error(DISPOSED_MESSAGE),
    });
  }

  async load(signal?: AbortSignal): Promise<SlashCommand[]> {
    if (this.transitionFence.isUnavailable()) {
      const available = await this.transitionFence.waitUntilAvailable(signal);
      if (!available) throw new Error(DISPOSED_MESSAGE);
    }

    return await this.probes.run({
      create: async (ownedSignal) => {
        const command = await this.host.resolveCliPath() ?? 'kiro-cli';
        ownedSignal.throwIfAborted();
        const cwd = this.host.workingDirectory ?? process.cwd();
        const env = buildKiroRuntimeEnv(this.host.environmentText, command);
        const args = await resolveKiroACPArgs({ command, cwd, env }, ownedSignal);
        ownedSignal.throwIfAborted();
        return {
          cwd,
          native: this.nativeFactory.create({
            args,
            command,
            cwd,
            env,
            requestExtension: async () => null,
            requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
            version: this.host.clientVersion ?? '0.0.0',
          }),
        };
      },
      initialize: resource => resource.native.initialize(),
      query: (resource, ownedSignal) => resource.native.listCommands(
        resource.cwd,
        ownedSignal,
      ),
    }, signal);
  }

  beginEnvironmentTransition(): void {
    this.transitionFence.beginTransition();
  }

  endEnvironmentTransition(): void {
    this.transitionFence.endTransition();
  }

  quiesceForEnvironmentChange(): Promise<void> {
    return this.probes.quiesce();
  }

  dispose(): Promise<void> {
    if (this.disposeFlight) return this.disposeFlight;
    this.transitionFence.dispose();
    this.disposeFlight = (async () => {
      await this.quiesceForEnvironmentChange();
      await this.probes.dispose();
    })();
    return this.disposeFlight;
  }
}
