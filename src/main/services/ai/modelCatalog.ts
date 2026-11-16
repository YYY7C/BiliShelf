import type { AiModelInfo, AiPricing } from '@shared/types';

type Obj = Record<string, unknown>;

function asObject(value: unknown): Obj | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function asStringArray(value: unknown): string[] {
  return asArray(value)
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item));
}

function pricingFromOpenAi(model: Obj): AiPricing | null {
  const text = asObject(asObject(model.cost)?.text);
  const input = asNumber(asObject(text?.input)?.price);
  const output = asNumber(asObject(text?.output)?.price);
  if (input === null && output === null) return null;
  return {
    inputPerMillion: input ?? 0,
    outputPerMillion: output ?? 0,
    currency: 'USD'
  };
}

export function parseOpenAiModelCatalog(json: unknown): AiModelInfo[] {
  const root = asObject(json);
  const rows = asArray(root?.data ?? root?.models);
  return rows.flatMap((row) => {
    const model = asObject(row);
    const id = asString(model?.id);
    if (!model || !id) return [];
    const modalities = asObject(model.modalities);
    const inputModalities = asStringArray(modalities?.input);
    const capabilities = asObject(model.capabilities);
    const tools = asObject(capabilities?.tools);
    const limit = asObject(model.limit);
    return [
      {
        id,
        name: asString(model.name) ?? asString(model.display_name) ?? id,
        vision:
          inputModalities.length > 0
            ? inputModalities.some((value) => value === 'image' || value.startsWith('image/'))
            : undefined,
        tools: typeof tools?.supported === 'boolean' ? tools.supported : undefined,
        jsonMode:
          typeof capabilities?.structured_output === 'boolean' ? capabilities.structured_output : undefined,
        maxOutputTokens: asNumber(limit?.output) ?? undefined,
        contextWindow: asNumber(limit?.context) ?? asNumber(limit?.input) ?? undefined,
        pricing: pricingFromOpenAi(model),
        inputModalities: inputModalities.length > 0 ? inputModalities : undefined
      }
    ];
  });
}

export function parseAnthropicModelCatalog(json: unknown): AiModelInfo[] {
  const rows = asArray(asObject(json)?.data);
  return rows.flatMap((row) => {
    const model = asObject(row);
    const id = asString(model?.id);
    if (!model || !id) return [];
    const claude = /claude/i.test(id);
    return [
      {
        id,
        name: asString(model.display_name) ?? id,
        vision: claude ? true : undefined,
        tools: claude ? true : undefined,
        jsonMode: claude ? true : undefined,
        maxOutputTokens: asNumber(model.max_output_tokens) ?? undefined,
        contextWindow: asNumber(model.max_input_tokens) ?? undefined
      }
    ];
  });
}

export function parseGeminiModelCatalog(json: unknown): AiModelInfo[] {
  const rows = asArray(asObject(json)?.models);
  return rows.flatMap((row) => {
    const model = asObject(row);
    const rawName = asString(model?.name);
    if (!model || !rawName) return [];
    const id = rawName.replace(/^models\//, '');
    const methods = asStringArray(model.supportedGenerationMethods);
    if (!methods.includes('generateContent')) return [];
    const gemini = /gemini/i.test(id);
    return [
      {
        id,
        name: asString(model.displayName) ?? id,
        vision: gemini ? true : undefined,
        tools: methods.includes('generateContent') ? true : undefined,
        jsonMode: gemini ? true : undefined,
        maxOutputTokens: asNumber(model.outputTokenLimit) ?? undefined,
        contextWindow: asNumber(model.inputTokenLimit) ?? undefined
      }
    ];
  });
}

export function openAiModelsEndpoint(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  return base.endsWith('/models') ? base : `${base}/models`;
}

export function anthropicModelsEndpoint(baseUrl: string): string {
  const base = baseUrl
    .replace(/\/+$/, '')
    .replace(/\/messages$/, '')
    .replace(/\/v1$/, '');
  return `${base}/v1/models`;
}

export function geminiModelsEndpoint(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '').replace(/\/models$/, '');
  const root = base.endsWith('/v1beta') ? base : `${base}/v1beta`;
  return `${root}/models`;
}
