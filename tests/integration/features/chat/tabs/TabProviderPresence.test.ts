/** @vitest-environment jsdom */
import { useNextTaskAnimationFrames } from '@test/helpers/dom/animationFrames';
import { registerChatTestProvider } from '@test/helpers/features/chat/ChatProviderFixture';
import { conversationRecord, createManager, createPlugin, deferred } from '@test/helpers/features/chat/TabManagerIntegrationHarness';
import { Notice } from 'obsidian';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';

// Upstream exercised passive shared-runtime startup across a primary (`claude`)
// and a secondary provider (`codex`/`opencode`). This fork ships only `kiro`, so
// the multi-provider dimension collapses to a single provider: the mechanism keys
// on `startsSharedRuntimeOnTabPresence`, which kiro's built-in capabilities leave
// off, so each test opts the kiro test provider into the flag and supplies the
// shared-runtime `startRuntime` workspace. The deleted-provider `it.each` cases
// were folded into one kiro run each.
function providerFixture(startRuntime: () => Promise<void>) {
  return registerChatTestProvider('kiro', {
    models: [{ value: 'kiro-default', label: 'Kiro' }, { value: 'kiro-alternate', label: 'Alternate' }],
    capabilities: { startsSharedRuntimeOnTabPresence: true },
    workspace: { startRuntime },
  });
}

// Upstream contrasted a non-flagged primary (`claude`) visible tab against a
// flagged secondary (`codex`/`opencode`) hidden tab so only the secondary's
// runtime started. A kiro-only fork cannot register a second provider, and kiro
// is both the default and the flagged provider, so the visible/hidden contrast is
// dropped: the restored inactive tab is the only committed tab, and startup is
// still asserted to fire exactly once per provider for it without assembling the
// tab or creating a session.
it.each([
  { restored: { conversationId: 'kiro-history' } as const },
  { restored: { conversationId: null, providerId: 'kiro' as const, draftModel: 'kiro-default' } },
])('starts a shared runtime for an inactive restored tab without creating execution: %o', async ({ restored }) => {
  const started = deferred<void>();
  const startRuntime = vi.fn(async () => { started.resolve(); });
  const provider = providerFixture(startRuntime);
  const plugin = await createPlugin({
    getCachedConversation: id => conversationRecord(id, { providerId: 'kiro' }),
  });
  ProviderRegistry.setEnabled('kiro', plugin.settings, true);
  const { manager } = await createManager(plugin);
  await manager.restoreState({
    openTabs: [{ tabId: 'visible', conversationId: null }, { tabId: 'hidden', ...restored }],
    activeTabId: 'visible',
  });
  await started.promise;
  expect(startRuntime).toHaveBeenCalledTimes(1);
  expect(manager.getTab('hidden')).toBeNull();
  expect(provider.sessions).toEqual([]);
});

it('starts a shared runtime when a blank tab selects a shared-runtime model without preparing execution', async () => {
  const started = deferred<void>();
  const startRuntime = vi.fn(async () => { started.resolve(); });
  const provider = providerFixture(startRuntime);
  const plugin = await createPlugin();
  ProviderRegistry.setEnabled('kiro', plugin.settings, true);
  const { manager } = await createManager(plugin);
  const tab = (await manager.createTab())!;
  tab.session.selectDraft('kiro', 'kiro-alternate');
  manager.reconcileProviderAvailability();
  await started.promise;
  expect(startRuntime).toHaveBeenCalledTimes(1);
  expect(provider.sessions).toEqual([]);
  expect(tab.executionCoordinator.state).toBe('absent');
});

it('keeps repeated passive runtime startup failures silent', async () => {
  let nextAttempt = deferred<void>();
  const startRuntime = vi.fn(async () => { nextAttempt.resolve(); throw new Error('Kiro runtime missing'); });
  const provider = providerFixture(startRuntime);
  const plugin = await createPlugin();
  ProviderRegistry.setEnabled('kiro', plugin.settings, true);
  const { manager } = await createManager(plugin);
  // The first committed kiro tab attempts passive startup and fails.
  await manager.createTab();
  await nextAttempt.promise;
  // A later tab action retries passive startup after the failed attempt.
  nextAttempt = deferred<void>();
  await manager.createTab();
  manager.reconcileProviderAvailability();
  await nextAttempt.promise;
  expect(startRuntime).toHaveBeenCalledTimes(2);
  expect(Notice).not.toHaveBeenCalled();
  expect(provider.sessions).toEqual([]);
});

beforeEach(() => { useNextTaskAnimationFrames(); });
