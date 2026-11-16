import { app, safeStorage } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';
import type {
  AcrCloudInput,
  AcrCloudSummary,
  AiCapabilities,
  AiCustomConfig,
  AiImageDetail,
  AiPricing,
  AiProtocol,
  AiProviderInput,
  AiProviderSummary
} from '@shared/types';

const FILE_NAME = 'ai-config.json';
const VERSION = 1;

interface StoredProvider {
  id: string;
  name: string;
  protocol: AiProtocol;
  baseUrl: string;
  model: string;
  secret: string | null;
  capabilities: AiCapabilities;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  maxRetries: number;
  imageDetail: AiImageDetail;
  pricing: AiPricing | null;
  isDefault: boolean;
  custom: AiCustomConfig | null;
}

interface StoredAcrCloud {
  enabled: boolean;
  host: string;
  secret: string | null;
}

interface StoredConsent {
  acceptedAt: string | null;
  hosts: string[];
}

interface StoredConfig {
  version: number;
  providers: StoredProvider[];
  acrcloud: StoredAcrCloud;
  consent: StoredConsent;
}

interface ProviderSecret {
  apiKey: string;
  headers: Record<string, string>;
}

export interface ProviderRuntime {
  summary: AiProviderSummary;
  apiKey: string;
  headers: Record<string, string>;
}

export interface AcrCloudRuntime {
  host: string;
  accessKey: string;
  accessSecret: string;
}

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

function emptyConfig(): StoredConfig {
  return {
    version: VERSION,
    providers: [],
    acrcloud: { enabled: false, host: 'identify-eu-west-1.acrcloud.com', secret: null },
    consent: { acceptedAt: null, hosts: [] }
  };
}

function sanitizeCapabilities(input: Partial<AiCapabilities> | null | undefined): AiCapabilities {
  return {
    vision: input?.vision !== false,
    tools: input?.tools !== false,
    jsonMode: input?.jsonMode !== false,
    audio: Boolean(input?.audio)
  };
}

function sanitizePricing(input: AiPricing | null | undefined): AiPricing | null {
  if (!input) return null;
  const inputPerMillion = Number(input.inputPerMillion);
  const outputPerMillion = Number(input.outputPerMillion);
  if (!Number.isFinite(inputPerMillion) && !Number.isFinite(outputPerMillion)) return null;
  return {
    inputPerMillion: Number.isFinite(inputPerMillion) ? Math.max(0, inputPerMillion) : 0,
    outputPerMillion: Number.isFinite(outputPerMillion) ? Math.max(0, outputPerMillion) : 0,
    currency: String(input.currency || 'CNY').trim() || 'CNY'
  };
}

function sanitizeCustom(input: AiCustomConfig | null | undefined): AiCustomConfig | null {
  if (!input) return null;
  const compatMode = ['openai', 'anthropic', 'gemini', 'template'].includes(input.compatMode)
    ? input.compatMode
    : 'openai';
  return {
    compatMode,
    bodyTemplate: String(input.bodyTemplate ?? ''),
    responsePath: String(input.responsePath ?? '')
  };
}

function sanitizeBaseUrl(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('Base URL 不能为空');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Base URL 格式不正确');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Base URL 仅支持 http/https');
  return raw.replace(/\/+$/, '');
}

function sanitizeProvider(input: StoredProvider): StoredProvider {
  return {
    ...input,
    name: String(input.name ?? '').trim(),
    baseUrl: sanitizeBaseUrl(input.baseUrl),
    model: String(input.model ?? '').trim(),
    capabilities: sanitizeCapabilities(input.capabilities),
    temperature: Number.isFinite(input.temperature) ? Math.min(2, Math.max(0, input.temperature)) : 0.2,
    maxTokens: Number.isFinite(input.maxTokens)
      ? Math.min(32000, Math.max(128, Math.round(input.maxTokens)))
      : 1200,
    timeoutMs: Number.isFinite(input.timeoutMs)
      ? Math.min(600_000, Math.max(10_000, Math.round(input.timeoutMs)))
      : 120_000,
    maxRetries: Number.isFinite(input.maxRetries)
      ? Math.min(5, Math.max(0, Math.round(input.maxRetries)))
      : 2,
    imageDetail: ['low', 'auto', 'high'].includes(input.imageDetail) ? input.imageDetail : 'auto',
    pricing: sanitizePricing(input.pricing),
    custom: sanitizeCustom(input.custom)
  };
}

function readConfig(): StoredConfig {
  const file = filePath();
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoredConfig>;
    const providers = Array.isArray(parsed.providers)
      ? parsed.providers
          .filter((provider): provider is StoredProvider => Boolean(provider?.id && provider?.baseUrl))
          .flatMap((provider) => {
            try {
              return [sanitizeProvider(provider)];
            } catch (error) {
              log.warn('[ai-config] skip invalid provider', provider?.id, (error as Error).message);
              return [];
            }
          })
      : [];
    return {
      version: VERSION,
      providers,
      acrcloud: {
        enabled: Boolean(parsed.acrcloud?.enabled),
        host: String(parsed.acrcloud?.host ?? 'identify-eu-west-1.acrcloud.com').trim(),
        secret: parsed.acrcloud?.secret ? String(parsed.acrcloud.secret) : null
      },
      consent: {
        acceptedAt: parsed.consent?.acceptedAt ? String(parsed.consent.acceptedAt) : null,
        hosts: Array.isArray(parsed.consent?.hosts)
          ? Array.from(new Set(parsed.consent.hosts.map((host) => String(host).trim()).filter(Boolean)))
          : []
      }
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('[ai-config] read failed', (error as Error).message);
    }
    return emptyConfig();
  }
}

function writeConfig(config: StoredConfig): void {
  const file = filePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function encryptSecret(secret: ProviderSecret | null): string | null {
  if (!secret || (!secret.apiKey && Object.keys(secret.headers).length === 0)) return null;
  const json = JSON.stringify(secret);
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return `enc:v1:${safeStorage.encryptString(json).toString('base64')}`;
    }
  } catch (error) {
    log.warn('[ai-config] encrypt failed', (error as Error).message);
  }
  return `plain:v1:${Buffer.from(json, 'utf8').toString('base64')}`;
}

function decryptSecret(value: string | null | undefined): ProviderSecret | null {
  if (!value) return null;
  try {
    if (value.startsWith('enc:v1:')) {
      const buffer = Buffer.from(value.slice('enc:v1:'.length), 'base64');
      const json = safeStorage.decryptString(buffer);
      return JSON.parse(json) as ProviderSecret;
    }
    if (value.startsWith('plain:v1:')) {
      const json = Buffer.from(value.slice('plain:v1:'.length), 'base64').toString('utf8');
      return JSON.parse(json) as ProviderSecret;
    }
  } catch (error) {
    log.warn('[ai-config] decrypt failed', (error as Error).message);
  }
  return null;
}

function summaryFor(provider: StoredProvider): AiProviderSummary {
  const secret = decryptSecret(provider.secret);
  const apiKey = secret?.apiKey ?? '';
  return {
    id: provider.id,
    name: provider.name,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    model: provider.model,
    hasApiKey: Boolean(apiKey),
    apiKeyHint: apiKey ? `…${apiKey.slice(-4)}` : null,
    headerKeys: Object.keys(secret?.headers ?? {}),
    capabilities: provider.capabilities,
    temperature: provider.temperature,
    maxTokens: provider.maxTokens,
    timeoutMs: provider.timeoutMs,
    maxRetries: provider.maxRetries,
    imageDetail: provider.imageDetail,
    pricing: provider.pricing,
    isDefault: provider.isDefault,
    custom: provider.custom
  };
}

function ensureDefault(providers: StoredProvider[]): StoredProvider[] {
  if (providers.length === 0) return providers;
  if (providers.some((provider) => provider.isDefault)) return providers;
  return providers.map((provider, index) => ({ ...provider, isDefault: index === 0 }));
}

export function listProviders(): AiProviderSummary[] {
  return readConfig().providers.map(summaryFor);
}

export function getProvider(id: string): AiProviderSummary | null {
  const provider = readConfig().providers.find((item) => item.id === id);
  return provider ? summaryFor(provider) : null;
}

export function getDefaultProvider(): AiProviderSummary | null {
  const config = readConfig();
  const provider = config.providers.find((item) => item.isDefault) ?? config.providers[0];
  return provider ? summaryFor(provider) : null;
}

export function getProviderRuntime(id?: string | null): ProviderRuntime | null {
  const config = readConfig();
  const provider = id
    ? config.providers.find((item) => item.id === id)
    : config.providers.find((item) => item.isDefault);
  if (!provider) return null;
  const secret = decryptSecret(provider.secret);
  return {
    summary: summaryFor(provider),
    apiKey: secret?.apiKey ?? '',
    headers: secret?.headers ?? {}
  };
}

export function saveProvider(input: AiProviderInput): AiProviderSummary[] {
  const config = readConfig();
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('Provider 名称不能为空');
  const baseUrl = sanitizeBaseUrl(input.baseUrl);
  const model = String(input.model ?? '').trim();
  if (!model) throw new Error('模型名不能为空');
  const protocol: AiProtocol = ['openai', 'anthropic', 'gemini', 'custom'].includes(input.protocol)
    ? input.protocol
    : 'openai';
  const id = input.id ?? crypto.randomUUID();
  const existing = config.providers.find((provider) => provider.id === id);
  const existingSecret = decryptSecret(existing?.secret);
  const apiKey = input.clearApiKey
    ? ''
    : input.apiKey !== undefined
      ? String(input.apiKey)
      : (existingSecret?.apiKey ?? '');
  const headers = input.headers !== undefined ? input.headers : (existingSecret?.headers ?? {});
  const secret = encryptSecret({ apiKey, headers });
  const isDefault = Boolean(input.isDefault) || config.providers.length === 0;
  const next: StoredProvider = sanitizeProvider({
    id,
    name,
    protocol,
    baseUrl,
    model,
    secret,
    capabilities: sanitizeCapabilities(input.capabilities),
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    timeoutMs: input.timeoutMs,
    maxRetries: input.maxRetries,
    imageDetail: input.imageDetail,
    pricing: sanitizePricing(input.pricing),
    isDefault,
    custom: sanitizeCustom(input.custom)
  });

  let providers = existing
    ? config.providers.map((provider) => (provider.id === id ? next : provider))
    : [...config.providers, next];
  if (isDefault) {
    providers = providers.map((provider) => ({ ...provider, isDefault: provider.id === id }));
  }
  providers = ensureDefault(providers);
  writeConfig({ ...config, providers });
  return providers.map(summaryFor);
}

export function removeProvider(id: string): AiProviderSummary[] {
  const config = readConfig();
  const providers = ensureDefault(config.providers.filter((provider) => provider.id !== id));
  writeConfig({ ...config, providers });
  return providers.map(summaryFor);
}

export function setDefaultProvider(id: string): AiProviderSummary[] {
  const config = readConfig();
  if (!config.providers.some((provider) => provider.id === id)) throw new Error('Provider 不存在');
  const providers = config.providers.map((provider) => ({ ...provider, isDefault: provider.id === id }));
  writeConfig({ ...config, providers });
  return providers.map(summaryFor);
}

/* --------------------------------- ACRCloud -------------------------------- */

export function getAcrCloudSummary(): AcrCloudSummary {
  const acrcloud = readConfig().acrcloud;
  const secret = decryptSecret(acrcloud.secret);
  return {
    configured: Boolean(acrcloud.host && secret?.apiKey && secret?.headers?.['accessSecret']),
    enabled: acrcloud.enabled,
    host: acrcloud.host,
    accessKeyHint: secret?.apiKey ? `…${secret.apiKey.slice(-4)}` : null,
    hasSecret: Boolean(secret?.headers?.['accessSecret']),
    callsToday: 0
  };
}

export function getAcrCloudRuntime(): AcrCloudRuntime | null {
  const acrcloud = readConfig().acrcloud;
  const secret = decryptSecret(acrcloud.secret);
  if (!acrcloud.enabled || !acrcloud.host || !secret?.apiKey || !secret?.headers?.['accessSecret']) {
    return null;
  }
  return {
    host: acrcloud.host,
    accessKey: secret.apiKey,
    accessSecret: secret.headers['accessSecret']
  };
}

export function saveAcrCloud(input: AcrCloudInput): AcrCloudSummary {
  const config = readConfig();
  const existing = decryptSecret(config.acrcloud.secret);
  const accessKey = input.accessKey !== undefined ? String(input.accessKey) : (existing?.apiKey ?? '');
  const accessSecret =
    input.clearSecret || input.accessSecret === ''
      ? ''
      : input.accessSecret !== undefined
        ? String(input.accessSecret)
        : (existing?.headers?.['accessSecret'] ?? '');
  const host = String(input.host ?? config.acrcloud.host).trim() || 'identify-eu-west-1.acrcloud.com';
  const secret = encryptSecret({ apiKey: accessKey, headers: { accessSecret } });
  writeConfig({
    ...config,
    acrcloud: {
      enabled: input.enabled !== undefined ? Boolean(input.enabled) : config.acrcloud.enabled,
      host,
      secret
    }
  });
  return getAcrCloudSummary();
}

/* --------------------------------- consent --------------------------------- */

export function getConsent(): StoredConsent {
  return readConfig().consent;
}

export function hasConsentForHosts(hosts: string[]): boolean {
  const consent = readConfig().consent;
  const normalized = hosts.map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (normalized.length === 0) return true;
  const allowed = new Set(consent.hosts.map((host) => host.trim().toLowerCase()));
  return normalized.every((host) => allowed.has(host));
}

export function rememberConsentHosts(hosts: string[]): void {
  const config = readConfig();
  const merged = Array.from(
    new Set([...config.consent.hosts, ...hosts.map((host) => host.trim()).filter(Boolean)])
  );
  writeConfig({
    ...config,
    consent: { acceptedAt: new Date().toISOString(), hosts: merged }
  });
}

export function isLocalHost(host: string): boolean {
  const value = host.toLowerCase().trim();
  let hostname: string;
  try {
    hostname = value.includes('://') ? new URL(value).hostname : value.split(':')[0];
  } catch {
    hostname = value;
  }
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost')
  );
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
