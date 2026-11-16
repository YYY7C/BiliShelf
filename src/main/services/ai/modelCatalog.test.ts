import { describe, expect, it } from 'vitest';
import {
  anthropicModelsEndpoint,
  geminiModelsEndpoint,
  openAiModelsEndpoint,
  parseAnthropicModelCatalog,
  parseGeminiModelCatalog,
  parseOpenAiModelCatalog
} from './modelCatalog';

describe('parseOpenAiModelCatalog', () => {
  it('maps OpenCode-style capability metadata', () => {
    const [model] = parseOpenAiModelCatalog({
      data: [
        {
          id: 'deepseek-v4.1-flash',
          name: 'DeepSeek V4.1 Flash',
          modalities: { input: ['text', 'image/png', 'image/jpeg'] },
          capabilities: { tools: { supported: true }, structured_output: true },
          limit: { context: 1_000_000, output: 384_000 },
          cost: { text: { input: { price: 0.15 }, output: { price: 0.6 } } }
        }
      ]
    });
    expect(model).toMatchObject({
      id: 'deepseek-v4.1-flash',
      vision: true,
      tools: true,
      jsonMode: true,
      maxOutputTokens: 384_000,
      contextWindow: 1_000_000,
      pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6, currency: 'USD' }
    });
  });

  it('leaves capabilities unknown for plain OpenAI /models responses', () => {
    const [model] = parseOpenAiModelCatalog({ data: [{ id: 'some-model' }] });
    expect(model).toMatchObject({ id: 'some-model', name: 'some-model' });
    expect(model.vision).toBeUndefined();
    expect(model.tools).toBeUndefined();
    expect(model.jsonMode).toBeUndefined();
  });
});

describe('parseAnthropicModelCatalog', () => {
  it('maps Claude model capabilities', () => {
    const [model] = parseAnthropicModelCatalog({
      data: [{ id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' }]
    });
    expect(model).toMatchObject({
      id: 'claude-sonnet-5',
      name: 'Claude Sonnet 5',
      vision: true,
      tools: true,
      jsonMode: true
    });
  });
});

describe('parseGeminiModelCatalog', () => {
  it('maps Gemini model limits', () => {
    const [model] = parseGeminiModelCatalog({
      models: [
        {
          name: 'models/gemini-3-pro',
          displayName: 'Gemini 3 Pro',
          inputTokenLimit: 1_000_000,
          outputTokenLimit: 65_536,
          supportedGenerationMethods: ['generateContent']
        }
      ]
    });
    expect(model).toMatchObject({
      id: 'gemini-3-pro',
      name: 'Gemini 3 Pro',
      vision: true,
      tools: true,
      maxOutputTokens: 65_536,
      contextWindow: 1_000_000
    });
  });
});

describe('model endpoints', () => {
  it('builds model-list endpoints for each protocol', () => {
    expect(openAiModelsEndpoint('https://opencode.ai/zen/go/v1')).toBe(
      'https://opencode.ai/zen/go/v1/models'
    );
    expect(anthropicModelsEndpoint('https://api.anthropic.com/v1')).toBe(
      'https://api.anthropic.com/v1/models'
    );
    expect(geminiModelsEndpoint('https://generativelanguage.googleapis.com')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models'
    );
  });
});
