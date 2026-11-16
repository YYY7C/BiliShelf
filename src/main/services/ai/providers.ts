import { net } from 'electron';
import type {
  AiImageDetail,
  AiModelInfo,
  AiModelProbeResult,
  AiProviderInput,
  AiProviderSummary,
  AiProviderTestResult
} from '@shared/types';
import { getProviderRuntime, type ProviderRuntime } from './config';
import {
  anthropicModelsEndpoint,
  geminiModelsEndpoint,
  openAiModelsEndpoint,
  parseAnthropicModelCatalog,
  parseGeminiModelCatalog,
  parseOpenAiModelCatalog
} from './modelCatalog';

export type AiRole = 'user' | 'assistant' | 'tool';

export type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mime: string; data: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; result: unknown };

export interface AiMessage {
  role: AiRole;
  parts: AiContentPart[];
}

export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AiToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AiChatRequest {
  system: string;
  messages: AiMessage[];
  tools?: AiToolDefinition[];
  temperature: number;
  maxTokens: number;
  jsonMode: boolean;
  imageDetail: AiImageDetail;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface AiChatResponse {
  text: string;
  toolCalls: AiToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  raw: unknown;
}

export interface AiProviderAdapter {
  chat(request: AiChatRequest): Promise<AiChatResponse>;
}

export class AiChatError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(message: string, status: number | null = null, retryable = false) {
    super(message);
    this.name = 'AiChatError';
    this.status = status;
    this.retryable = retryable;
  }
}

/* --------------------------------- helpers --------------------------------- */

function joinEndpoint(baseUrl: string, suffix: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (base.endsWith(suffix)) return base;
  return `${base}${suffix.startsWith('/') ? '' : '/'}${suffix}`;
}

function anthropicEndpoint(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (base.endsWith('/v1/messages')) return base;
  if (base.endsWith('/v1')) return `${base}/messages`;
  return `${base}/v1/messages`;
}

function geminiEndpoint(baseUrl: string, model: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const root = base.endsWith('/v1beta') ? base : `${base}/v1beta`;
  return `${root}/models/${encodeURIComponent(model)}:generateContent`;
}

function headersFor(runtime: ProviderRuntime, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...extra,
    ...runtime.headers
  };
  return headers;
}

function withTimeout(
  timeoutMs: number,
  external?: AbortSignal
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  const onAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    }
  };
}

interface HttpResult {
  status: number;
  ok: boolean;
  text: string;
  json: unknown;
}

async function requestJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  external?: AbortSignal
): Promise<HttpResult> {
  const { signal, cleanup } = withTimeout(timeoutMs, external);
  try {
    const response = await net.fetch(url, { ...init, signal });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, ok: response.ok, text, json };
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new AiChatError('请求超时或已取消', null, true);
    }
    throw new AiChatError(
      `网络请求失败：${(error as Error).message}。如使用代理，请确认系统代理或 Clash 已开启。`,
      null,
      true
    );
  } finally {
    cleanup();
  }
}

function apiErrorMessage(json: unknown, fallback: string): string {
  const value = json as {
    error?: { message?: string } | string;
    message?: string;
    status?: { msg?: string };
  } | null;
  if (value?.error && typeof value.error === 'object' && value.error.message) return value.error.message;
  if (typeof value?.error === 'string' && value.error) return value.error;
  if (value?.message) return value.message;
  if (value?.status?.msg) return value.status.msg;
  return fallback;
}

function assertOk(result: HttpResult, fallback: string): void {
  if (result.ok) return;
  if (result.status === 401 || result.status === 403) {
    throw new AiChatError('API Key 无效或无权限（401/403）', result.status, false);
  }
  if (result.status === 429) {
    throw new AiChatError('请求过于频繁（429），请稍后重试', result.status, true);
  }
  if (result.status >= 500) {
    throw new AiChatError(
      `服务端错误（${result.status}）：${apiErrorMessage(result.json, fallback)}`,
      result.status,
      true
    );
  }
  throw new AiChatError(
    `${apiErrorMessage(result.json, fallback)}（HTTP ${result.status}）`,
    result.status,
    result.status === 408
  );
}

function textFromParts(parts: AiContentPart[]): string {
  return parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function imagesFromParts(parts: AiContentPart[]): Array<{ mime: string; data: string }> {
  return parts
    .filter((part): part is { type: 'image'; mime: string; data: string } => part.type === 'image')
    .map((part) => ({ mime: part.mime, data: part.data }));
}

function dataUrl(mime: string, data: string): string {
  return `data:${mime || 'image/jpeg'};base64,${data}`;
}

function numberOrZero(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function parseArgs(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { value: parsed };
    } catch {
      return { _raw: value };
    }
  }
  return {};
}

function getByPath(value: unknown, path: string): unknown {
  if (!path) return value;
  return path
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((current, key) => {
      if (current === null || current === undefined) return undefined;
      if (Array.isArray(current)) {
        const index = Number(key);
        return Number.isFinite(index) ? current[index] : undefined;
      }
      if (typeof current === 'object') return (current as Record<string, unknown>)[key];
      return undefined;
    }, value);
}

/* -------------------------------- OpenAI ---------------------------------- */

class OpenAiAdapter implements AiProviderAdapter {
  constructor(private readonly runtime: ProviderRuntime) {}

  private async call(request: AiChatRequest, useMaxCompletionTokens: boolean, includeJsonMode: boolean) {
    const { summary, apiKey } = this.runtime;
    const body: Record<string, unknown> = {
      model: summary.model,
      messages: buildOpenAiMessages(request),
      temperature: request.temperature,
      max_tokens: request.maxTokens
    };
    if (useMaxCompletionTokens) {
      delete body.max_tokens;
      body.max_completion_tokens = request.maxTokens;
    }
    if (includeJsonMode && request.jsonMode) {
      body.response_format = { type: 'json_object' };
    }
    if (request.tools && request.tools.length > 0 && summary.capabilities.tools) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }
      }));
      body.tool_choice = 'auto';
    }
    return requestJson(
      joinEndpoint(summary.baseUrl, '/chat/completions'),
      {
        method: 'POST',
        headers: headersFor(this.runtime, apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        body: JSON.stringify(body)
      },
      request.timeoutMs,
      request.signal
    );
  }

  async chat(request: AiChatRequest): Promise<AiChatResponse> {
    let result = await this.call(request, false, true);
    // 一些新模型只接受 max_completion_tokens；一些兼容网关不接受 response_format。
    if (!result.ok && (result.status === 400 || result.status === 422)) {
      const message = apiErrorMessage(result.json, result.text);
      if (/max_tokens/i.test(message) && !/max_completion_tokens/i.test(message)) {
        result = await this.call(request, true, true);
      } else if (/response_format|json_object/i.test(message)) {
        result = await this.call(request, false, false);
      }
    }
    assertOk(result, '模型请求失败');
    return parseOpenAiResponse(result.json);
  }
}

function buildOpenAiMessages(request: AiChatRequest): unknown[] {
  const messages: unknown[] = [];
  if (request.system.trim()) messages.push({ role: 'system', content: request.system });
  for (const message of request.messages) {
    if (message.role === 'user') {
      const images = imagesFromParts(message.parts);
      const text = textFromParts(message.parts);
      if (images.length === 0) {
        messages.push({ role: 'user', content: text });
      } else {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text },
            ...images.map((image) => ({
              type: 'image_url',
              image_url: { url: dataUrl(image.mime, image.data), detail: request.imageDetail }
            }))
          ]
        });
      }
      continue;
    }
    if (message.role === 'assistant') {
      const toolCalls = message.parts.filter(
        (part): part is { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> } =>
          part.type === 'tool_call'
      );
      const text = textFromParts(message.parts);
      messages.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0
          ? {
              tool_calls: toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.args) }
              }))
            }
          : {})
      });
      continue;
    }
    for (const part of message.parts) {
      if (part.type === 'tool_result') {
        messages.push({
          role: 'tool',
          tool_call_id: part.id,
          content: JSON.stringify(part.result ?? null)
        });
      }
    }
  }
  return messages;
}

function parseOpenAiResponse(json: unknown): AiChatResponse {
  const data = json as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }> | null;
        tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
      };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  } | null;
  const message = data?.choices?.[0]?.message;
  if (!message) throw new AiChatError('模型返回为空', null, true);
  const content = message.content;
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .filter((part) => part?.type === 'text' && typeof part.text === 'string')
            .map((part) => part.text)
            .join('')
        : '';
  const toolCalls: AiToolCall[] = (message.tool_calls ?? [])
    .map((call, index) => ({
      id: call.id || `call_${index + 1}`,
      name: call.function?.name ?? '',
      args: parseArgs(call.function?.arguments)
    }))
    .filter((call) => Boolean(call.name));
  return {
    text: text.trim(),
    toolCalls,
    usage: {
      inputTokens: numberOrZero(data?.usage?.prompt_tokens),
      outputTokens: numberOrZero(data?.usage?.completion_tokens)
    },
    raw: json
  };
}

/* -------------------------------- Anthropic -------------------------------- */

class AnthropicAdapter implements AiProviderAdapter {
  constructor(private readonly runtime: ProviderRuntime) {}

  async chat(request: AiChatRequest): Promise<AiChatResponse> {
    const { summary, apiKey } = this.runtime;
    const body: Record<string, unknown> = {
      model: summary.model,
      system: request.system,
      messages: buildAnthropicMessages(request),
      max_tokens: request.maxTokens,
      temperature: request.temperature
    };
    if (request.tools && request.tools.length > 0 && summary.capabilities.tools) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters
      }));
    }
    const result = await requestJson(
      anthropicEndpoint(summary.baseUrl),
      {
        method: 'POST',
        headers: headersFor(this.runtime, {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        }),
        body: JSON.stringify(body)
      },
      request.timeoutMs,
      request.signal
    );
    assertOk(result, 'Anthropic 请求失败');
    return parseAnthropicResponse(result.json);
  }
}

function buildAnthropicMessages(request: AiChatRequest): unknown[] {
  const messages: unknown[] = [];
  for (const message of request.messages) {
    if (message.role === 'user') {
      const blocks: unknown[] = [];
      const text = textFromParts(message.parts);
      if (text) blocks.push({ type: 'text', text });
      for (const image of imagesFromParts(message.parts)) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: image.mime || 'image/jpeg', data: image.data }
        });
      }
      messages.push({ role: 'user', content: blocks });
      continue;
    }
    if (message.role === 'assistant') {
      const blocks: unknown[] = [];
      const text = textFromParts(message.parts);
      if (text) blocks.push({ type: 'text', text });
      for (const part of message.parts) {
        if (part.type === 'tool_call') {
          blocks.push({ type: 'tool_use', id: part.id, name: part.name, input: part.args });
        }
      }
      messages.push({ role: 'assistant', content: blocks });
      continue;
    }
    const blocks = message.parts
      .filter(
        (part): part is { type: 'tool_result'; id: string; name: string; result: unknown } =>
          part.type === 'tool_result'
      )
      .map((part) => ({
        type: 'tool_result',
        tool_use_id: part.id,
        content: JSON.stringify(part.result ?? null)
      }));
    if (blocks.length > 0) messages.push({ role: 'user', content: blocks });
  }
  return messages;
}

function parseAnthropicResponse(json: unknown): AiChatResponse {
  const data = json as {
    content?: Array<{
      type?: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
    }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  } | null;
  if (!data?.content) throw new AiChatError('Anthropic 返回为空', null, true);
  const text = data.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
    .trim();
  const toolCalls: AiToolCall[] = data.content
    .filter((block) => block.type === 'tool_use')
    .map((block, index) => ({
      id: block.id || `call_${index + 1}`,
      name: block.name ?? '',
      args: parseArgs(block.input)
    }))
    .filter((call) => Boolean(call.name));
  return {
    text,
    toolCalls,
    usage: {
      inputTokens: numberOrZero(data.usage?.input_tokens),
      outputTokens: numberOrZero(data.usage?.output_tokens)
    },
    raw: json
  };
}

/* ---------------------------------- Gemini --------------------------------- */

class GeminiAdapter implements AiProviderAdapter {
  constructor(private readonly runtime: ProviderRuntime) {}

  async chat(request: AiChatRequest): Promise<AiChatResponse> {
    const { summary, apiKey } = this.runtime;
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: buildGeminiContents(request),
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
        ...(request.jsonMode ? { responseMimeType: 'application/json' } : {})
      }
    };
    if (request.tools && request.tools.length > 0 && summary.capabilities.tools) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
          }))
        }
      ];
    }
    const url = `${geminiEndpoint(summary.baseUrl, summary.model)}?key=${encodeURIComponent(apiKey)}`;
    const result = await requestJson(
      url,
      {
        method: 'POST',
        headers: headersFor(this.runtime),
        body: JSON.stringify(body)
      },
      request.timeoutMs,
      request.signal
    );
    assertOk(result, 'Gemini 请求失败');
    return parseGeminiResponse(result.json);
  }
}

function buildGeminiContents(request: AiChatRequest): unknown[] {
  const contents: unknown[] = [];
  for (const message of request.messages) {
    if (message.role === 'user') {
      const parts: unknown[] = [];
      const text = textFromParts(message.parts);
      if (text) parts.push({ text });
      for (const image of imagesFromParts(message.parts)) {
        parts.push({ inline_data: { mime_type: image.mime || 'image/jpeg', data: image.data } });
      }
      contents.push({ role: 'user', parts });
      continue;
    }
    if (message.role === 'assistant') {
      const parts: unknown[] = [];
      const text = textFromParts(message.parts);
      if (text) parts.push({ text });
      for (const part of message.parts) {
        if (part.type === 'tool_call') {
          parts.push({ functionCall: { name: part.name, args: part.args } });
        }
      }
      contents.push({ role: 'model', parts });
      continue;
    }
    const parts = message.parts
      .filter(
        (part): part is { type: 'tool_result'; id: string; name: string; result: unknown } =>
          part.type === 'tool_result'
      )
      .map((part) => ({
        functionResponse: {
          name: part.name,
          response: { result: part.result ?? null }
        }
      }));
    if (parts.length > 0) contents.push({ role: 'user', parts });
  }
  return contents;
}

function parseGeminiResponse(json: unknown): AiChatResponse {
  const data = json as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          functionCall?: { name?: string; args?: unknown };
        }>;
      };
    }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  } | null;
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!parts) throw new AiChatError('Gemini 返回为空', null, true);
  const text = parts
    .filter((part) => typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
    .trim();
  const toolCalls: AiToolCall[] = parts
    .filter((part) => part.functionCall?.name)
    .map((part, index) => ({
      id: `call_${index + 1}`,
      name: part.functionCall?.name ?? '',
      args: parseArgs(part.functionCall?.args)
    }));
  return {
    text,
    toolCalls,
    usage: {
      inputTokens: numberOrZero(data?.usageMetadata?.promptTokenCount),
      outputTokens: numberOrZero(data?.usageMetadata?.candidatesTokenCount)
    },
    raw: json
  };
}

/* ------------------------------ custom template ---------------------------- */

class CustomTemplateAdapter implements AiProviderAdapter {
  constructor(private readonly runtime: ProviderRuntime) {}

  async chat(request: AiChatRequest): Promise<AiChatResponse> {
    const { summary, apiKey } = this.runtime;
    const custom = summary.custom;
    if (!custom || custom.compatMode !== 'template') {
      throw new AiChatError('自定义模板模式配置不完整', null, false);
    }
    if (!custom.bodyTemplate?.trim()) throw new AiChatError('自定义请求体模板为空', null, false);
    let template: unknown;
    try {
      template = JSON.parse(custom.bodyTemplate);
    } catch {
      throw new AiChatError('自定义请求体模板不是合法 JSON', null, false);
    }
    const userMessages = request.messages.filter((message) => message.role === 'user');
    const lastUser = userMessages[userMessages.length - 1];
    const prompt = lastUser ? textFromParts(lastUser.parts) : '';
    const images = userMessages.flatMap((message) => imagesFromParts(message.parts));
    const context: Record<string, unknown> = {
      '{{model}}': summary.model,
      '{{system}}': request.system,
      '{{prompt}}': prompt,
      '{{temperature}}': request.temperature,
      '{{maxTokens}}': request.maxTokens,
      '{{imagesDataUrl}}': images.map((image) => dataUrl(image.mime, image.data)),
      '{{imagesBase64}}': images.map((image) => image.data),
      '{{imageParts}}': images.map((image) => ({ mimeType: image.mime, data: image.data }))
    };
    const body = substitute(template, context);
    const result = await requestJson(
      summary.baseUrl,
      {
        method: 'POST',
        headers: headersFor(this.runtime, apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        body: JSON.stringify(body)
      },
      request.timeoutMs,
      request.signal
    );
    assertOk(result, '自定义接口请求失败');
    const text = getByPath(result.json, custom.responsePath || 'choices.0.message.content');
    if (typeof text !== 'string') {
      throw new AiChatError(
        `无法从响应路径读取文本：${custom.responsePath || 'choices.0.message.content'}`,
        null,
        false
      );
    }
    return {
      text: text.trim(),
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      raw: result.json
    };
  }
}

function substitute(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    if (Object.prototype.hasOwnProperty.call(context, value)) return context[value];
    return value.replace(/\{\{[a-zA-Z0-9_]+\}\}/g, (match) =>
      Object.prototype.hasOwnProperty.call(context, match) ? String(context[match]) : match
    );
  }
  if (Array.isArray(value)) return value.map((item) => substitute(item, context));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = substitute(item, context);
    }
    return result;
  }
  return value;
}

/* --------------------------------- factory --------------------------------- */

export function createAdapter(runtime: ProviderRuntime): AiProviderAdapter {
  const summary = runtime.summary;
  if (summary.protocol === 'custom') {
    const compat = summary.custom?.compatMode ?? 'openai';
    if (compat === 'template') return new CustomTemplateAdapter(runtime);
    if (compat === 'anthropic') return new AnthropicAdapter(runtime);
    if (compat === 'gemini') return new GeminiAdapter(runtime);
    return new OpenAiAdapter(runtime);
  }
  if (summary.protocol === 'anthropic') return new AnthropicAdapter(runtime);
  if (summary.protocol === 'gemini') return new GeminiAdapter(runtime);
  return new OpenAiAdapter(runtime);
}

export function adapterForProvider(id?: string | null): AiProviderAdapter | null {
  const runtime = getProviderRuntime(id);
  return runtime ? createAdapter(runtime) : null;
}

/* ------------------------------- test connection --------------------------- */

const TEST_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function runtimeForProbe(input: AiProviderInput): ProviderRuntime {
  const saved = input.id ? getProviderRuntime(input.id) : null;
  const apiKey = input.apiKey?.trim() || saved?.apiKey || '';
  const headers = input.headers !== undefined ? input.headers : (saved?.headers ?? {});
  const summary: AiProviderSummary = {
    id: input.id ?? 'probe',
    name: input.name || 'probe',
    protocol: input.protocol,
    baseUrl: input.baseUrl,
    model: input.model,
    hasApiKey: Boolean(apiKey),
    apiKeyHint: null,
    headerKeys: Object.keys(headers),
    capabilities: input.capabilities,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    timeoutMs: input.timeoutMs,
    maxRetries: input.maxRetries,
    imageDetail: input.imageDetail,
    pricing: input.pricing ?? null,
    isDefault: false,
    custom: input.custom ?? null
  };
  return { summary, apiKey, headers };
}

export async function probeProviderModels(input: AiProviderInput): Promise<AiModelProbeResult> {
  const runtime = runtimeForProbe(input);
  const compat = input.protocol === 'custom' ? (input.custom?.compatMode ?? 'openai') : input.protocol;
  if (compat === 'template') {
    throw new AiChatError('纯模板模式没有标准模型列表，请手动填写模型名与能力');
  }

  const timeout = Math.min(60_000, Math.max(5_000, input.timeoutMs));
  let url: string;
  let headers: Record<string, string>;
  let parse: (json: unknown) => AiModelInfo[];
  if (compat === 'anthropic') {
    url = anthropicModelsEndpoint(input.baseUrl);
    headers = headersFor(runtime, {
      ...(runtime.apiKey ? { 'x-api-key': runtime.apiKey } : {}),
      'anthropic-version': '2023-06-01'
    });
    parse = parseAnthropicModelCatalog;
  } else if (compat === 'gemini') {
    url = geminiModelsEndpoint(input.baseUrl);
    headers = headersFor(runtime, runtime.apiKey ? { 'x-goog-api-key': runtime.apiKey } : {});
    parse = parseGeminiModelCatalog;
  } else {
    url = openAiModelsEndpoint(input.baseUrl);
    headers = headersFor(runtime, runtime.apiKey ? { Authorization: `Bearer ${runtime.apiKey}` } : {});
    parse = parseOpenAiModelCatalog;
  }

  const result = await requestJson(url, { method: 'GET', headers }, timeout);
  if (!result.ok) {
    throw new AiChatError(
      `读取模型列表失败：${apiErrorMessage(result.json, result.text.slice(0, 300) || `HTTP ${result.status}`)}`,
      result.status,
      result.status === 429 || result.status >= 500
    );
  }
  const models = parse(result.json);
  const hasCapabilities = models.some(
    (model) => model.vision !== undefined || model.tools !== undefined || model.jsonMode !== undefined
  );
  return {
    models,
    message:
      models.length === 0
        ? '接口没有返回模型列表；该网关可能不支持 /models，请手动填写。'
        : hasCapabilities
          ? `已读取 ${models.length} 个模型，包含能力元数据；选择模型会自动填入视觉/工具/JSON 等配置。`
          : `已读取 ${models.length} 个模型，但接口未返回能力元数据；模型名会自动填入，视觉/工具/JSON 请手动确认。`
  };
}

export async function testProvider(id: string): Promise<AiProviderTestResult> {
  const runtime = getProviderRuntime(id);
  if (!runtime) {
    return {
      ok: false,
      latencyMs: 0,
      status: null,
      message: 'Provider 不存在',
      visionOk: null,
      jsonOk: null,
      raw: null
    };
  }
  const adapter = createAdapter(runtime);
  const started = Date.now();
  const baseRequest: AiChatRequest = {
    system: 'You are a connection test. Reply with OK.',
    messages: [{ role: 'user', parts: [{ type: 'text', text: '只回复 OK' }] }],
    temperature: 0,
    maxTokens: 256,
    jsonMode: false,
    imageDetail: 'low',
    timeoutMs: 30_000
  };
  const supportsVision = runtime.summary.capabilities.vision;
  let visionOk: boolean | null = null;
  let message: string;
  let status: number | null = null;
  let raw: string | null = null;
  try {
    if (supportsVision) {
      try {
        const response = await adapter.chat({
          ...baseRequest,
          messages: [
            {
              role: 'user',
              parts: [
                { type: 'text', text: '只回复 OK' },
                { type: 'image', mime: 'image/png', data: TEST_PNG }
              ]
            }
          ]
        });
        visionOk = Boolean(response.text);
        message = response.text || '连接成功';
        raw = response.text.slice(0, 500);
      } catch (error) {
        const failure = error as AiChatError;
        status = failure.status;
        // 有些文本模型不支持视觉；退回纯文本测试，保留视觉失败信息
        const response = await adapter.chat(baseRequest);
        visionOk = false;
        message = `文本连接成功，但视觉请求失败：${failure.message}`;
        raw = response.text.slice(0, 500);
      }
    } else {
      const response = await adapter.chat(baseRequest);
      message = response.text || '连接成功';
      raw = response.text.slice(0, 500);
    }
  } catch (error) {
    const failure = error as AiChatError;
    return {
      ok: false,
      latencyMs: Date.now() - started,
      status: failure.status ?? status,
      message: failure.message,
      visionOk,
      jsonOk: null,
      raw
    };
  }

  let jsonOk: boolean | null = null;
  if (runtime.summary.capabilities.jsonMode) {
    try {
      const response = await adapter.chat({
        ...baseRequest,
        system: 'You are a JSON connection test. Reply with exactly {"ok":true} and nothing else.',
        messages: [{ role: 'user', parts: [{ type: 'text', text: '{"ok":true}' }] }],
        jsonMode: true,
        maxTokens: 512
      });
      const parsed = JSON.parse(response.text) as { ok?: boolean };
      jsonOk = parsed.ok === true;
    } catch {
      jsonOk = false;
    }
  }

  return {
    ok: true,
    latencyMs: Date.now() - started,
    status: status ?? 200,
    message,
    visionOk,
    jsonOk,
    raw
  };
}
