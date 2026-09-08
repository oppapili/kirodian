import { parseKiroModelsOutput } from '@/providers/kiro/runtime/KiroModelCatalogService';

// Expected values are derived from a captured `kiro-cli chat --list-models
// --format json` payload (kiro-cli 2.18.0), not from the parser implementation.
const REAL_OUTPUT = JSON.stringify({
  default_model: 'auto',
  models: [
    {
      context_window_tokens: 1_000_000,
      description: 'Models chosen by task for optimal usage and consistent quality',
      model_id: 'auto',
      model_name: 'auto',
      rate_multiplier: 1.0,
      rate_unit: 'Credit',
    },
    {
      context_window_tokens: 1_000_000,
      description: 'Claude Opus 5 model with 1M context window',
      model_id: 'claude-opus-5',
      model_name: 'claude-opus-5',
      rate_multiplier: 2.2,
      rate_unit: 'Credit',
    },
    {
      context_window_tokens: 164_000,
      description: 'Experimental preview of DeepSeek V3.2',
      model_id: 'deepseek-3.2',
      model_name: 'deepseek-3.2',
      rate_multiplier: 0.25,
      rate_unit: 'Credit',
    },
  ],
});

describe('parseKiroModelsOutput', () => {
  it('extracts the default model id from the payload', () => {
    expect(parseKiroModelsOutput(REAL_OUTPUT).defaultModelId).toBe('auto');
  });

  it('maps snake_case CLI keys onto discovered-model fields', () => {
    const { models } = parseKiroModelsOutput(REAL_OUTPUT);

    expect(models.map((model) => model.rawId)).toEqual([
      'auto',
      'claude-opus-5',
      'deepseek-3.2',
    ]);
    expect(models[1]).toMatchObject({
      contextWindow: 1_000_000,
      description: 'Claude Opus 5 model with 1M context window',
      displayName: 'claude-opus-5',
      rawId: 'claude-opus-5',
    });
  });

  it('returns an empty result for non-JSON output', () => {
    expect(parseKiroModelsOutput('not json at all')).toEqual({
      defaultModelId: null,
      models: [],
    });
  });

  it('returns no default when default_model is absent', () => {
    const output = JSON.stringify({
      models: [{ model_id: 'auto', model_name: 'auto' }],
    });

    expect(parseKiroModelsOutput(output).defaultModelId).toBeNull();
  });

  it('skips entries that lack a model_id', () => {
    const output = JSON.stringify({
      default_model: 'auto',
      models: [
        { model_name: 'no id here' },
        { model_id: 'auto', model_name: 'auto' },
      ],
    });

    expect(parseKiroModelsOutput(output).models.map((model) => model.rawId)).toEqual([
      'auto',
    ]);
  });

  it('falls back to the raw id when model_name is missing', () => {
    const output = JSON.stringify({
      default_model: 'glm-5',
      models: [{ model_id: 'glm-5' }],
    });

    expect(parseKiroModelsOutput(output).models[0]).toMatchObject({
      displayName: 'glm-5',
      rawId: 'glm-5',
    });
  });
});
