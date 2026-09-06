import {
  buildSystemPrompt,
  computeSystemPromptKey,
  type SystemPromptSettings,
} from '../../../core/prompt/mainAgent';

export type KiroSystemPromptSettings = SystemPromptSettings;

export interface KiroSystemPromptOptions {
  readonly dynamicSections?: readonly string[];
}

export function buildKiroSystemPrompt(
  settings: KiroSystemPromptSettings,
  options: KiroSystemPromptOptions = {},
): string {
  return buildSystemPrompt(settings, {
    dynamicSections: options.dynamicSections ? [...options.dynamicSections] : undefined,
  });
}

export function computeKiroSystemPromptKey(
  settings: KiroSystemPromptSettings,
  options: KiroSystemPromptOptions = {},
): string {
  return computeSystemPromptKey(settings, {
    dynamicSections: options.dynamicSections ? [...options.dynamicSections] : undefined,
  });
}
