import {
  buildSystemPrompt,
  type SystemPromptSettings,
} from '../../../core/prompt/mainAgent';

export type KiroSystemPromptSettings = SystemPromptSettings;

export function buildKiroSystemPrompt(
  settings: KiroSystemPromptSettings,
): string {
  return buildSystemPrompt(settings);
}
