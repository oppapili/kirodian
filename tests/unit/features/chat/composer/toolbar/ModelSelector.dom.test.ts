/** @jest-environment jsdom */

import '@/providers';

import { fireEvent, within } from '@testing-library/dom';

import { ModelSelector } from '@/features/chat/composer/toolbar/ModelSelector';
import type { ToolbarCallbacks } from '@/features/chat/composer/toolbar/types';
import { kiroChatUIConfig } from '@/providers/kiro/ui/KiroChatUIConfig';
import { updateCurrentKiroCatalog, updateKiroProviderSettings } from '@/providers/kiro/settings';

HTMLElement.prototype.empty = function () { this.replaceChildren(); };
HTMLElement.prototype.addClass = function (...classes) { this.classList.add(...classes); };
HTMLElement.prototype.removeClass = function (...classes) { this.classList.remove(...classes); };
HTMLElement.prototype.hasClass = function (name) { return this.classList.contains(name); };
HTMLElement.prototype.toggleClass = function (classes, value) {
  for (const name of typeof classes === 'string' ? [classes] : classes) this.classList.toggle(name, value);
};

afterEach(() => {
  document.body.replaceChildren();
});

function kiroSettingsWithModels(selectedOrder: string[]): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  updateCurrentKiroCatalog(settings, {
    models: ['opus', 'haiku', 'sonnet'].map(rawId => ({
      rawId,
      displayName: rawId,
      description: '',
      reasoningEfforts: [],
      supportsReasoning: false,
    })),
  });
  updateKiroProviderSettings(settings, { enabled: true, visibleModels: selectedOrder });
  settings.model = 'kiro/haiku';
  return settings;
}

it('renders saved model order top-to-bottom through the real provider UI config', () => {
  const host = document.body.createDiv();
  let settings = kiroSettingsWithModels(['haiku', 'sonnet', 'opus']);
  const selector = new ModelSelector(host, {
    getSettings: () => settings,
    getUIConfig: () => kiroChatUIConfig,
  } as unknown as ToolbarCallbacks);
  fireEvent.click(within(host).getByRole('button', { name: /^Model: haiku/ }));
  const labels = () => within(host).getAllByRole('option').map(node => node.textContent);
  // Rendered through the real kiro UI config; its selection-aware ordering.
  expect(labels()).toEqual(['opus', 'sonnet', 'haiku']);
  // A single-provider list takes the view's active-provider brand; rows name no provider.
  expect(within(host).getAllByRole('option').map(node => node.getAttribute('data-provider'))).toEqual([null, null, null]);
  // Changing the saved selection re-renders a different order through the config.
  settings = kiroSettingsWithModels(['sonnet', 'opus', 'haiku']);
  selector.renderOptions();
  expect(labels()).toEqual(['haiku', 'opus', 'sonnet']);
});
