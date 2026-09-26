import { Notice, setIcon } from 'obsidian';

import { formatReasoningValueLabel } from '../../../core/providers/reasoning';
import type {
  ProviderCapabilities,
  ProviderChatUIConfig,
  ProviderModelSelectorLock,
  ProviderModeSelectorConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderServiceTierToggleConfig,
  ProviderUIOption,
} from '../../../core/providers/types';
import type { UsageInfo } from '../../../core/types';
import { createProviderIconSvg } from '../../../shared/icons';
import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../../utils/animationFrame';
import { toggleServiceTier } from '../actions/toggleServiceTier';
import type { ChatSettings } from '../ChatSettings';

function runToolbarAction(action: () => Promise<void>, failureMessage: string): void {
  void action().catch(() => {
    new Notice(failureMessage);
  });
}

export type ToolbarSettings = ChatSettings & Record<string, unknown>;

export interface ToolbarCallbacks {
  onModelChange: (model: string) => Promise<void>;
  onModeChange: (mode: string) => Promise<void>;
  onThinkingBudgetChange: (budget: string) => Promise<void>;
  onEffortLevelChange: (effort: string) => Promise<void>;
  onServiceTierChange: (serviceTier: string) => Promise<void>;
  onPermissionModeChange: (mode: string) => Promise<void>;
  getSettings: () => ToolbarSettings;
  getEnvironmentVariables?: () => string;
  getUIConfig: () => ProviderChatUIConfig;
  getCapabilities: () => ProviderCapabilities;
}

export class ModelSelector {
  private container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'claudian-model-selector' });
    this.render();
    this.container.addEventListener('mouseenter', () => {
      this.updateDisplay();
      this.renderOptions();
    });
  }

  #getAvailableModels() {
    const settings = this.callbacks.getSettings();
    const uiConfig = this.callbacks.getUIConfig();
    return uiConfig.getModelOptions({
      ...settings,
      environmentVariables: this.callbacks.getEnvironmentVariables?.(),
    });
  }

  #getModelSelectorLock(): ProviderModelSelectorLock | null {
    return this.callbacks.getUIConfig().getModelSelectorLock?.(this.callbacks.getSettings())
      ?? null;
  }

  private render() {
    this.container.empty();

    this.buttonEl = this.container.createDiv({ cls: 'claudian-model-btn' });
    this.updateDisplay();

    this.dropdownEl = this.container.createDiv({ cls: 'claudian-model-dropdown' });
    this.renderOptions();
  }

  updateDisplay() {
    if (!this.buttonEl) return;
    const lock = this.#getModelSelectorLock();
    if (lock) {
      this.#renderLockedButton(lock);
      return;
    }
    this.#renderUnlockedButton();
  }

  /**
   * Renders the button for a locked selector: forces the displayed value to the lock's
   * model, marks it disabled and non-interactive for assistive technology, and surfaces the
   * lock reason as the accessible name and tooltip.
   */
  #renderLockedButton(lock: ProviderModelSelectorLock) {
    if (!this.buttonEl) return;
    const models = this.#getAvailableModels();
    const lockedInfo = models.find(m => m.value === lock.lockedToModelId);
    const icon = lockedInfo?.providerIcon
      ?? this.callbacks.getUIConfig().getProviderIcon?.();

    this.buttonEl.empty();
    this.buttonEl.addClass('claudian-model-btn--locked');
    if (icon) {
      createProviderIconSvg(icon, {
        className: 'claudian-model-provider-icon',
        height: 12,
        parent: this.buttonEl,
        width: 12,
      });
    }
    const labelEl = this.buttonEl.createSpan({ cls: 'claudian-model-label' });
    labelEl.setText(lockedInfo?.label || lock.lockedToModelId);
    this.buttonEl.title = lock.reason;
    this.buttonEl.setAttribute('aria-disabled', 'true');
    this.buttonEl.setAttribute('aria-label', lock.reason);
  }

  #renderUnlockedButton() {
    if (!this.buttonEl) return;
    const currentModel = this.callbacks.getSettings().model;
    const models = this.#getAvailableModels();
    const modelInfo = models.find(m => m.value === currentModel);

    const displayModel = modelInfo || models[0];
    const icon = displayModel?.providerIcon
      ?? this.callbacks.getUIConfig().getProviderIcon?.();

    this.buttonEl.empty();
    this.buttonEl.removeClass('claudian-model-btn--locked');
    this.buttonEl.removeAttribute('aria-disabled');
    this.buttonEl.removeAttribute('aria-label');

    if (icon) {
      createProviderIconSvg(icon, {
        className: 'claudian-model-provider-icon',
        height: 12,
        parent: this.buttonEl,
        width: 12,
      });
    }
    const labelEl = this.buttonEl.createSpan({ cls: 'claudian-model-label' });
    labelEl.setText(modelInfo?.label || (currentModel ? 'Model unavailable' : 'Set up models'));
    this.buttonEl.title = modelInfo ? '' : 'Choose an enabled model in provider settings. If discovery failed, refresh the model list.';
  }

  renderOptions() {
    if (!this.dropdownEl) return;
    this.dropdownEl.empty();

    const lock = this.#getModelSelectorLock();
    if (lock) {
      // A locked selector offers no choices: render only the fixed value with the reason,
      // so the dropdown carries an accessible explanation instead of clickable options.
      this.dropdownEl.addClass('claudian-model-dropdown--locked');
      this.dropdownEl.createDiv({
        cls: 'claudian-model-locked-note',
        text: lock.reason,
        attr: { role: 'note' },
      });
      return;
    }
    this.dropdownEl.removeClass('claudian-model-dropdown--locked');

    const currentModel = this.callbacks.getSettings().model;
    const models = this.#getAvailableModels();
    if (!models.length) {
      this.dropdownEl.createDiv({ text: 'No models available. Check provider settings and refresh the model list if discovery failed.', attr: { role: 'status' } });
    }
    const reversed = [...models].reverse();

    let lastGroup: string | undefined;
    for (const model of reversed) {
      if (model.group && model.group !== lastGroup) {
        const separator = this.dropdownEl.createDiv({ cls: 'claudian-model-group' });
        separator.setText(model.group);
        lastGroup = model.group;
      }

      const option = this.dropdownEl.createDiv({ cls: 'claudian-model-option' });
      if (model.value === currentModel) {
        option.addClass('selected');
      }

      const icon = model.providerIcon ?? this.callbacks.getUIConfig().getProviderIcon?.();
      if (icon) {
        createProviderIconSvg(icon, {
          className: 'claudian-model-provider-icon',
          height: 12,
          parent: option,
          width: 12,
        });
      }
      option.createSpan({ text: model.label });
      if (model.description) {
        option.setAttribute('title', model.description);
      }

      option.addEventListener('click', (e) => {
        e.stopPropagation();
        runToolbarAction(async () => {
          await this.callbacks.onModelChange(model.value);
          this.updateDisplay();
          this.renderOptions();
        }, 'Failed to change model');
      });
    }
  }
}

export class ModeSelector {
  private container: HTMLElement;
  private labelEl: HTMLElement | null = null;
  private toggleEl: HTMLElement | null = null;
  private buttonEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private layout: 'empty' | 'toggle' | 'dropdown' = 'empty';
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'claudian-mode-selector' });
    this.updateDisplay();
  }

  #getSelectorConfig(): ProviderModeSelectorConfig | null {
    return this.callbacks.getUIConfig().getModeSelector?.(this.callbacks.getSettings()) ?? null;
  }

  /** Resolves the active/inactive option pair for a two-option toggle. */
  #resolveOptionPair(
    selectorConfig: ProviderModeSelectorConfig,
  ): { active: ProviderUIOption; inactive: ProviderUIOption } {
    const [first, second] = selectorConfig.options;
    const active = selectorConfig.activeValue
      ? selectorConfig.options.find((option) => option.value === selectorConfig.activeValue) ?? second
      : second;
    const inactive = active.value === first.value ? second : first;
    return { active, inactive };
  }

  /** Chooses the layout for the current config: hidden, two-option toggle, or N-option dropdown. */
  #resolveLayout(
    selectorConfig: ProviderModeSelectorConfig | null,
  ): 'empty' | 'toggle' | 'dropdown' {
    if (!selectorConfig || selectorConfig.options.length < 2) {
      return 'empty';
    }
    return selectorConfig.options.length === 2 ? 'toggle' : 'dropdown';
  }

  #buildToggle() {
    this.container.empty();
    this.labelEl = this.container.createSpan({ cls: 'claudian-mode-label' });
    this.toggleEl = this.container.createDiv({ cls: 'claudian-toggle-switch' });
    this.buttonEl = null;
    this.dropdownEl = null;
    this.toggleEl.addEventListener('click', () => {
      runToolbarAction(() => this.toggle(), 'Failed to change mode');
    });
  }

  #buildDropdown() {
    this.container.empty();
    this.buttonEl = this.container.createDiv({ cls: 'claudian-mode-btn' });
    this.dropdownEl = this.container.createDiv({ cls: 'claudian-mode-dropdown' });
    this.labelEl = null;
    this.toggleEl = null;
  }

  updateDisplay() {
    const selectorConfig = this.#getSelectorConfig();
    const layout = this.#resolveLayout(selectorConfig);
    if (layout !== this.layout) {
      this.layout = layout;
      if (layout === 'toggle') {
        this.#buildToggle();
      } else if (layout === 'dropdown') {
        this.#buildDropdown();
      } else {
        this.container.empty();
        this.labelEl = null;
        this.toggleEl = null;
        this.buttonEl = null;
        this.dropdownEl = null;
      }
    }

    if (!selectorConfig || layout === 'empty') {
      this.container.addClass('claudian-hidden');
      return;
    }
    this.container.removeClass('claudian-hidden');

    if (layout === 'toggle') {
      this.#updateToggle(selectorConfig);
    } else {
      this.#updateDropdown(selectorConfig);
    }
  }

  #updateToggle(selectorConfig: ProviderModeSelectorConfig) {
    if (!this.toggleEl || !this.labelEl) {
      return;
    }
    const { active, inactive } = this.#resolveOptionPair(selectorConfig);
    const currentOption = selectorConfig.options.find((option) => option.value === selectorConfig.value)
      ?? selectorConfig.options[0];
    const isActive = currentOption.value === active.value;

    this.labelEl.setText(currentOption.label || selectorConfig.label);
    this.labelEl.toggleClass('active', isActive);
    if (isActive) {
      this.toggleEl.addClass('active');
    } else {
      this.toggleEl.removeClass('active');
    }

    const titleParts = [`${inactive.label} <-> ${active.label}`];
    if (currentOption.description) {
      titleParts.push(currentOption.description);
    }
    this.container.setAttribute('title', titleParts.join('\n'));
  }

  #updateDropdown(selectorConfig: ProviderModeSelectorConfig) {
    if (!this.buttonEl) {
      return;
    }
    const currentOption = selectorConfig.options.find((option) => option.value === selectorConfig.value)
      ?? selectorConfig.options[0];
    this.buttonEl.empty();
    this.buttonEl.createSpan({ cls: 'claudian-mode-btn-prefix', text: `${selectorConfig.label}: ` });
    this.buttonEl.createSpan({ cls: 'claudian-mode-btn-label', text: currentOption.label });
    this.container.setAttribute('title', currentOption.description ?? currentOption.label);
    this.#renderDropdownOptions(selectorConfig, currentOption.value);
  }

  #renderDropdownOptions(selectorConfig: ProviderModeSelectorConfig, currentValue: string) {
    if (!this.dropdownEl) {
      return;
    }
    this.dropdownEl.empty();
    for (const option of [...selectorConfig.options].reverse()) {
      const optionEl = this.dropdownEl.createDiv({ cls: 'claudian-mode-option' });
      if (option.value === currentValue) {
        optionEl.addClass('selected');
      }
      optionEl.createSpan({ text: option.label });
      if (option.description) {
        optionEl.setAttribute('title', option.description);
      }
      optionEl.addEventListener('click', (event) => {
        event.stopPropagation();
        runToolbarAction(async () => {
          await this.callbacks.onModeChange(option.value);
          this.updateDisplay();
        }, 'Failed to change mode');
      });
    }
  }

  renderOptions() {
    this.updateDisplay();
  }

  private async toggle() {
    const selectorConfig = this.#getSelectorConfig();
    if (!selectorConfig || selectorConfig.options.length !== 2) {
      return;
    }

    const { active, inactive } = this.#resolveOptionPair(selectorConfig);
    const nextValue = selectorConfig.value === active.value ? inactive.value : active.value;
    await this.callbacks.onModeChange(nextValue);
    this.updateDisplay();
  }
}

export class ThinkingBudgetSelector {
  private container: HTMLElement;
  private effortEl: HTMLElement | null = null;
  private effortGearsEl: HTMLElement | null = null;
  private budgetEl: HTMLElement | null = null;
  private budgetGearsEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'claudian-thinking-selector' });
    this.render();
  }

  private render() {
    this.container.empty();

    // Effort selector (for adaptive thinking models)
    this.effortEl = this.container.createDiv({ cls: 'claudian-thinking-effort' });
    const effortLabel = this.effortEl.createSpan({ cls: 'claudian-thinking-label-text' });
    effortLabel.setText('Effort:');
    this.effortGearsEl = this.effortEl.createDiv({ cls: 'claudian-thinking-gears' });

    // Legacy budget selector (for custom models)
    this.budgetEl = this.container.createDiv({ cls: 'claudian-thinking-budget' });
    const budgetLabel = this.budgetEl.createSpan({ cls: 'claudian-thinking-label-text' });
    budgetLabel.setText('Thinking:');
    this.budgetGearsEl = this.budgetEl.createDiv({ cls: 'claudian-thinking-gears' });

    this.updateDisplay();
  }

  #renderEffortGears() {
    if (!this.effortGearsEl) return;
    this.effortGearsEl.empty();

    const settings = this.callbacks.getSettings();
    const currentEffort = settings.reasoning;
    const uiConfig = this.callbacks.getUIConfig();
    const model = settings.model;
    const options = uiConfig.getReasoningOptions(model, settings);
    const currentInfo = options.find(e => e.value === currentEffort);

    const currentEl = this.effortGearsEl.createDiv({ cls: 'claudian-thinking-current' });
    currentEl.setText(currentInfo?.label ?? (currentEffort ? formatReasoningValueLabel(currentEffort) : 'Default'));

    const optionsEl = this.effortGearsEl.createDiv({ cls: 'claudian-thinking-options' });

    for (const effort of [...options].reverse()) {
      const gearEl = optionsEl.createDiv({ cls: 'claudian-thinking-gear' });
      gearEl.setText(effort.label);
      if (effort.description) {
        gearEl.setAttribute('title', effort.description);
      }

      if (effort.value === currentEffort) {
        gearEl.addClass('selected');
      }

      gearEl.addEventListener('click', (e) => {
        e.stopPropagation();
        runToolbarAction(async () => {
          await this.callbacks.onEffortLevelChange(effort.value);
          this.updateDisplay();
        }, 'Failed to change effort level');
      });
    }
  }

  #renderBudgetGears() {
    if (!this.budgetGearsEl) return;
    this.budgetGearsEl.empty();

    const settings = this.callbacks.getSettings();
    const currentBudget = settings.reasoning;
    const uiConfig = this.callbacks.getUIConfig();
    const model = settings.model;
    const options: ProviderReasoningOption[] = uiConfig.getReasoningOptions(model, settings);
    const currentBudgetInfo = options.find(b => b.value === currentBudget);

    const currentEl = this.budgetGearsEl.createDiv({ cls: 'claudian-thinking-current' });
    currentEl.setText(currentBudgetInfo?.label ?? (currentBudget ? formatReasoningValueLabel(currentBudget) : 'Default'));

    const optionsEl = this.budgetGearsEl.createDiv({ cls: 'claudian-thinking-options' });

    for (const budget of [...options].reverse()) {
      const gearEl = optionsEl.createDiv({ cls: 'claudian-thinking-gear' });
      gearEl.setText(budget.label);
      const tokens = budget.tokens ?? 0;
      gearEl.setAttribute('title', tokens > 0 ? `${tokens.toLocaleString()} tokens` : 'Disabled');

      if (budget.value === currentBudget) {
        gearEl.addClass('selected');
      }

      gearEl.addEventListener('click', (e) => {
        e.stopPropagation();
        runToolbarAction(async () => {
          await this.callbacks.onThinkingBudgetChange(budget.value);
          this.updateDisplay();
        }, 'Failed to change thinking budget');
      });
    }
  }

  updateDisplay() {
    const capabilities = this.callbacks.getCapabilities();
    if (capabilities.reasoningControl === 'none') {
      this.effortEl?.addClass('claudian-hidden');
      this.budgetEl?.addClass('claudian-hidden');
      return;
    }

    const settings = this.callbacks.getSettings();
    const model = settings.model;
    const uiConfig = this.callbacks.getUIConfig();
    const options = uiConfig.getReasoningOptions(model, settings);
    const defaultValue = uiConfig.getDefaultReasoningValue(model, settings);
    const shouldHide = options.length === 0
      || (options.length === 1 && options[0]?.value === defaultValue);

    if (shouldHide) {
      this.effortEl?.addClass('claudian-hidden');
      this.budgetEl?.addClass('claudian-hidden');
      return;
    }

    const adaptive = uiConfig.isAdaptiveReasoningModel(model, settings);

    if (this.effortEl) {
      this.effortEl.toggleClass('claudian-hidden', !adaptive);
    }
    if (this.budgetEl) {
      this.budgetEl.toggleClass('claudian-hidden', adaptive);
    }

    if (adaptive) {
      this.#renderEffortGears();
    } else {
      this.#renderBudgetGears();
    }
  }
}

export class PermissionToggle {
  private container: HTMLElement;
  private toggleEl: HTMLElement | null = null;
  private labelEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  private visible = true;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'claudian-permission-toggle' });
    this.render();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.updateDisplay();
  }

  private render() {
    this.container.empty();

    this.labelEl = this.container.createSpan({ cls: 'claudian-permission-label' });
    this.toggleEl = this.container.createDiv({ cls: 'claudian-toggle-switch' });

    this.updateDisplay();

    this.toggleEl.addEventListener('click', () => {
      runToolbarAction(() => this.toggle(), 'Failed to change permission mode');
    });
  }

  #getToggleConfig(): ProviderPermissionModeToggleConfig | null {
    const uiConfig = this.callbacks.getUIConfig();
    return uiConfig.getPermissionModeToggle?.() ?? null;
  }

  updateDisplay() {
    if (!this.toggleEl || !this.labelEl) return;

    const toggleConfig = this.#getToggleConfig();
    if (!this.visible || !toggleConfig) {
      this.container.addClass('claudian-hidden');
      return;
    }

    this.container.removeClass('claudian-hidden');
    const mode = this.callbacks.getSettings().permissionMode;
    if (mode === toggleConfig.activeValue) {
      this.toggleEl.addClass('active');
      this.labelEl.setText(toggleConfig.activeLabel);
    } else {
      this.toggleEl.removeClass('active');
      this.labelEl.setText(toggleConfig.inactiveLabel);
    }
  }

  private async toggle() {
    const toggleConfig = this.#getToggleConfig();
    if (!toggleConfig) return;

    const current = this.callbacks.getSettings().permissionMode;
    const newMode = current === toggleConfig.activeValue
      ? toggleConfig.inactiveValue
      : toggleConfig.activeValue;
    await this.callbacks.onPermissionModeChange(newMode);
    this.updateDisplay();
  }
}

export class ServiceTierToggle {
  private container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private iconEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'claudian-service-tier-toggle' });
    this.render();
  }

  private render() {
    this.container.empty();

    this.buttonEl = this.container.createDiv({ cls: 'claudian-service-tier-button' });
    this.iconEl = this.buttonEl.createSpan({ cls: 'claudian-service-tier-icon' });
    setIcon(this.iconEl, 'zap');

    this.updateDisplay();

    this.buttonEl.addEventListener('click', () => {
      runToolbarAction(async () => {
        await this.toggle();
      }, 'Failed to change service tier');
    });
  }

  #getToggleConfig(): ProviderServiceTierToggleConfig | null {
    const uiConfig = this.callbacks.getUIConfig();
    return uiConfig.getServiceTierToggle?.(this.callbacks.getSettings()) ?? null;
  }

  updateDisplay() {
    if (!this.buttonEl || !this.iconEl) return;

    const toggleConfig = this.#getToggleConfig();
    if (!toggleConfig) {
      this.container.addClass('claudian-hidden');
      return;
    }

    this.container.removeClass('claudian-hidden');
    if (toggleConfig.isActive) {
      this.buttonEl.addClass('active');
    } else {
      this.buttonEl.removeClass('active');
    }

    const currentLabel = toggleConfig.isActive
      ? toggleConfig.activeLabel
      : toggleConfig.inactiveLabel;
    this.container.setAttribute('title', `Fast mode: ${currentLabel}`);
  }

  async toggle(): Promise<boolean> {
    const toggled = await toggleServiceTier(this.callbacks);
    if (toggled) {
      this.updateDisplay();
    }
    return toggled;
  }
}

export class ContextUsageMeter {
  private container: HTMLElement;
  private fillPath: SVGPathElement | null = null;
  private percentEl: HTMLElement | null = null;
  private circumference: number = 0;

  constructor(parentEl: HTMLElement) {
    this.container = parentEl.createDiv({ cls: 'claudian-context-meter' });
    this.container.setAttribute('role', 'progressbar');
    this.container.setAttribute('aria-label', 'Context usage');
    this.container.setAttribute('aria-valuemin', '0');
    this.container.setAttribute('aria-valuemax', '100');
    this.render();
    // Initially hidden
    this.container.addClass('claudian-hidden');
  }

  setVisible(visible: boolean): void {
    this.container.toggleClass('claudian-hidden', !visible);
  }

  private render() {
    const size = 16;
    const strokeWidth = 2;
    const radius = (size - strokeWidth) / 2;
    const cx = size / 2;
    const cy = size / 2;

    // 240° arc: from 150° to 390° (upper-left through bottom to upper-right)
    const startAngle = 150;
    const endAngle = 390;
    const arcDegrees = endAngle - startAngle;
    const arcRadians = (arcDegrees * Math.PI) / 180;
    this.circumference = radius * arcRadians;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    const x1 = cx + radius * Math.cos(startRad);
    const y1 = cy + radius * Math.sin(startRad);
    const x2 = cx + radius * Math.cos(endRad);
    const y2 = cy + radius * Math.sin(endRad);

    const gaugeEl = this.container.createDiv({ cls: 'claudian-context-meter-gauge' });
    const svg = gaugeEl.createSvg('svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

    const pathData = `M ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${x2} ${y2}`;
    const backgroundPath = svg.createSvg('path');
    backgroundPath.classList.add('claudian-meter-bg');
    backgroundPath.setAttribute('d', pathData);
    backgroundPath.setAttribute('fill', 'none');
    backgroundPath.setAttribute('stroke-width', String(strokeWidth));
    backgroundPath.setAttribute('stroke-linecap', 'round');

    const fillPath = svg.createSvg('path');
    fillPath.classList.add('claudian-meter-fill');
    fillPath.setAttribute('d', pathData);
    fillPath.setAttribute('fill', 'none');
    fillPath.setAttribute('stroke-width', String(strokeWidth));
    fillPath.setAttribute('stroke-linecap', 'round');
    fillPath.setAttribute('stroke-dasharray', String(this.circumference));
    fillPath.setAttribute('stroke-dashoffset', String(this.circumference));

    svg.appendChild(backgroundPath);
    svg.appendChild(fillPath);
    gaugeEl.appendChild(svg);
    this.fillPath = fillPath;

    this.percentEl = this.container.createSpan({ cls: 'claudian-context-meter-percent' });
  }

  update(usage: UsageInfo | null): void {
    if (!usage || usage.contextTokens <= 0) {
      this.container.addClass('claudian-hidden');
      return;
    }
    this.container.removeClass('claudian-hidden');
    const fillLength = (usage.percentage / 100) * this.circumference;
    if (this.fillPath) {
      this.fillPath.setAttribute('stroke-dashoffset', String(this.circumference - fillLength));
    }

    if (this.percentEl) {
      this.percentEl.setText(`${usage.percentage}%`);
    }

    // Toggle warning class for > 80%
    if (usage.percentage > 80) {
      this.container.addClass('warning');
    } else {
      this.container.removeClass('warning');
    }

    // Set tooltip with detailed usage
    let tooltip = `${this.#formatTokens(usage.contextTokens)} / ${this.#formatTokens(usage.contextWindow)}`;
    if (usage.percentage > 80) {
      tooltip += ' (Approaching limit, run `/compact` to continue)';
    }
    this.container.setAttribute('data-tooltip', tooltip);
    this.container.setAttribute('aria-valuenow', String(usage.percentage));
    this.container.setAttribute(
      'aria-valuetext',
      `${this.#formatTokens(usage.contextTokens)} / ${this.#formatTokens(usage.contextWindow)}`,
    );
  }

  #formatTokens(tokens: number): string {
    if (tokens >= 1000) {
      return `${Math.round(tokens / 1000)}k`;
    }
    return String(tokens);
  }
}

const TOOLBAR_COMPACT_CLASS = 'claudian-input-toolbar--compact';
const ROW_CENTER_TOLERANCE = 1;

/** Hides optional labels only when the full toolbar would wrap. */
export class InputToolbarLayoutController {
  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private pendingLayout: ScheduledAnimationFrame | null = null;

  constructor(private readonly toolbarEl: HTMLElement) {
    try {
      this.#observeLayoutChanges();
      this.#scheduleLayout();
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  refreshLayout(): void {
    this.toolbarEl.classList.remove(TOOLBAR_COMPACT_CLASS);
    this.toolbarEl.classList.toggle(TOOLBAR_COMPACT_CLASS, this.#hasWrappedItems());
  }

  destroy(): void {
    if (this.pendingLayout !== null) {
      cancelScheduledAnimationFrame(this.pendingLayout);
      this.pendingLayout = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
  }

  #hasWrappedItems(): boolean {
    const rowCenters = Array.from(this.toolbarEl.children)
      .map((item) => item.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => rect.top + rect.height / 2);
    const firstRowCenter = rowCenters[0];
    if (firstRowCenter === undefined) return false;

    return rowCenters.some((center) => Math.abs(center - firstRowCenter) > ROW_CENTER_TOLERANCE);
  }

  #scheduleLayout(): void {
    if (this.pendingLayout !== null) {
      cancelScheduledAnimationFrame(this.pendingLayout);
    }
    this.pendingLayout = scheduleAnimationFrame(() => {
      this.pendingLayout = null;
      this.refreshLayout();
    }, this.toolbarEl.ownerDocument.defaultView);
  }

  #observeLayoutChanges(): void {
    const ownerWindow = this.toolbarEl.ownerDocument.defaultView;
    const ResizeObserverConstructor = ownerWindow?.ResizeObserver;
    if (typeof ResizeObserverConstructor === 'function') {
      this.resizeObserver = new ResizeObserverConstructor(() => this.#scheduleLayout());
      this.resizeObserver.observe(this.toolbarEl);
    }

    const MutationObserverConstructor = ownerWindow?.MutationObserver;
    if (typeof MutationObserverConstructor !== 'function') return;

    this.mutationObserver = new MutationObserverConstructor((mutations) => {
      const hasContentChange = mutations.some((mutation) => (
        mutation.type !== 'attributes'
        || mutation.target !== this.toolbarEl
        || mutation.attributeName !== 'class'
      ));
      if (hasContentChange) {
        this.#scheduleLayout();
      }
    });
    this.mutationObserver.observe(this.toolbarEl, {
      attributes: true,
      attributeFilter: ['class'],
      characterData: true,
      childList: true,
      subtree: true,
    });
  }
}

export function createInputToolbar(
  parentEl: HTMLElement,
  callbacks: ToolbarCallbacks
): {
  modelSelector: ModelSelector;
  modeSelector: ModeSelector;
  thinkingBudgetSelector: ThinkingBudgetSelector;
  contextUsageMeter: ContextUsageMeter;
  layoutController: InputToolbarLayoutController;
  permissionToggle: PermissionToggle;
  serviceTierToggle: ServiceTierToggle;
} {
  // DOM order defines the visual left-to-right toolbar layout. The mode (agent)
  // selector sits immediately after the model selector; the permission toggle is
  // appended last and is the ONLY element with `margin-left: auto`, so it always
  // pins to the right edge regardless of how many other controls are shown.
  const modelSelector = new ModelSelector(parentEl, callbacks);
  const modeSelector = new ModeSelector(parentEl, callbacks);
  const thinkingBudgetSelector = new ThinkingBudgetSelector(parentEl, callbacks);
  const serviceTierToggle = new ServiceTierToggle(parentEl, callbacks);
  const contextUsageMeter = new ContextUsageMeter(parentEl);
  const permissionToggle = new PermissionToggle(parentEl, callbacks);
  const layoutController = new InputToolbarLayoutController(parentEl);

  return {
    modelSelector,
    modeSelector,
    thinkingBudgetSelector,
    serviceTierToggle,
    contextUsageMeter,
    layoutController,
    permissionToggle,
  };
}
