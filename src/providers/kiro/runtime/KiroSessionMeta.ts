import { decodeKiroModelId } from '../models';
import {
  buildKiroSystemPrompt,
  type KiroSystemPromptSettings,
} from '../prompt/KiroSystemPrompt';

export interface KiroSessionMeta {
  modelId?: string;
  systemPromptOverride: string;
  yoloMode: boolean;
}

export interface KiroSessionMetaBuildOptions {
  model: string;
  permissionMode: unknown;
  promptSettings: KiroSystemPromptSettings;
}

export function buildKiroSessionMeta(
  options: KiroSessionMetaBuildOptions,
): KiroSessionMeta {
  const modelId = decodeKiroModelId(options.model);
  return {
    ...(modelId ? { modelId } : {}),
    systemPromptOverride: buildKiroSystemPrompt(options.promptSettings),
    yoloMode: options.permissionMode === 'yolo',
  };
}
