import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  KeyRound,
  Loader2,
  Plus,
  Radar,
  RefreshCw,
  Save,
  Star,
  Trash2,
  Wrench
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  AcrCloudSummary,
  AiCapabilities,
  AiCustomConfig,
  AiImageDetail,
  AiModelInfo,
  AiProviderInput,
  AiProviderSummary,
  AppSettings
} from '@shared/types';
import { api } from '../../lib/bridge';
import { useUi } from '../../lib/store';
import { AI_COMPAT_LABEL, AI_PROTOCOL_LABEL } from '../../lib/ai';
import { Button, Field, Modal, Select, TextArea, TextInput, Toggle } from '../ui';

interface ProviderPreset {
  label: string;
  protocol: AiProviderInput['protocol'];
  baseUrl: string;
  model: string;
  capabilities?: Partial<AiCapabilities>;
  custom?: AiCustomConfig;
  headers?: Record<string, string>;
}

const PRESETS: ProviderPreset[] = [
  {
    label: '通义千问 VL',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-vl-max'
  },
  {
    label: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini'
  },
  {
    label: 'Gemini',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.5-flash'
  },
  {
    label: 'Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-20250514'
  },
  {
    label: 'OpenRouter',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-2.5-flash'
  },
  {
    label: '硅基流动',
    protocol: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-VL-72B-Instruct'
  },
  {
    label: 'Ollama（本地）',
    protocol: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5vl:7b'
  },
  {
    label: 'LM Studio（本地）',
    protocol: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'local-vlm'
  },
  {
    label: 'OpenCode Go',
    protocol: 'openai',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    model: 'gpt-6-luna',
    capabilities: { vision: true, tools: true, jsonMode: true, audio: false },
    headers: { 'x-opencode-session': 'bilishelf' }
  },
  {
    label: 'DeepSeek（文本模型）',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    capabilities: { vision: false, tools: false }
  }
];

function blankProvider(): AiProviderInput {
  return {
    name: '',
    protocol: 'openai',
    baseUrl: '',
    model: '',
    apiKey: '',
    capabilities: { vision: true, tools: true, jsonMode: true, audio: false },
    temperature: 0.2,
    maxTokens: 1200,
    timeoutMs: 120_000,
    maxRetries: 2,
    imageDetail: 'auto',
    pricing: null,
    custom: null,
    isDefault: false
  };
}

function fromSummary(provider: AiProviderSummary): AiProviderInput {
  return {
    id: provider.id,
    name: provider.name,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    model: provider.model,
    capabilities: { ...provider.capabilities },
    temperature: provider.temperature,
    maxTokens: provider.maxTokens,
    timeoutMs: provider.timeoutMs,
    maxRetries: provider.maxRetries,
    imageDetail: provider.imageDetail,
    pricing: provider.pricing,
    custom: provider.custom,
    isDefault: provider.isDefault
  };
}

export function AiModelSettings() {
  const pushToast = useUi((state) => state.pushToast);
  const [providers, setProviders] = useState<AiProviderSummary[]>([]);
  const [acrcloud, setAcrcloud] = useState<AcrCloudSummary | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [consentHosts, setConsentHosts] = useState<string[]>([]);
  const [editing, setEditing] = useState<AiProviderInput | null>(null);
  const [headersText, setHeadersText] = useState('');
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeMessage, setProbeMessage] = useState<string | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<AiModelInfo[]>([]);

  const [acrHost, setAcrHost] = useState('');
  const [acrKey, setAcrKey] = useState('');
  const [acrSecret, setAcrSecret] = useState('');
  const [acrEnabled, setAcrEnabled] = useState(false);

  const load = async () => {
    try {
      const [nextProviders, nextAcrcloud, nextSettings, consent] = await Promise.all([
        api.ai.providers.list(),
        api.ai.acrcloud.get(),
        api.settings.get(),
        api.ai.consent.get()
      ]);
      setProviders(nextProviders);
      setAcrcloud(nextAcrcloud);
      setSettings(nextSettings);
      setConsentHosts(consent.hosts);
      setAcrHost(nextAcrcloud.host);
      setAcrEnabled(nextAcrcloud.enabled);
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetProbe = () => {
    setDiscoveredModels([]);
    setProbeMessage(null);
  };

  const openNew = () => {
    setEditing(blankProvider());
    setHeadersText('');
    setTestResult(null);
    resetProbe();
  };

  const openEdit = (provider: AiProviderSummary) => {
    setEditing(fromSummary(provider));
    setHeadersText('');
    setTestResult(null);
    resetProbe();
  };

  const applyPreset = (label: string) => {
    const preset = PRESETS.find((item) => item.label === label);
    if (!preset || !editing) return;
    resetProbe();
    setEditing({
      ...editing,
      name: editing.name || preset.label,
      protocol: preset.protocol,
      baseUrl: preset.baseUrl,
      model: preset.model,
      capabilities: {
        ...editing.capabilities,
        ...(preset.capabilities ?? {})
      },
      custom: preset.custom ?? (preset.protocol === 'custom' ? { compatMode: 'openai' } : null)
    });
    setHeadersText(preset.headers ? JSON.stringify(preset.headers, null, 2) : '{}');
  };

  const applyModelInfo = (info: AiModelInfo) => {
    setEditing((current) => {
      if (!current) return current;
      const capabilities = { ...current.capabilities };
      if (info.vision !== undefined) capabilities.vision = info.vision;
      if (info.tools !== undefined) capabilities.tools = info.tools;
      if (info.jsonMode !== undefined) capabilities.jsonMode = info.jsonMode;
      const maxTokens = info.maxOutputTokens
        ? Math.min(32000, Math.max(128, Math.round(info.maxOutputTokens)))
        : current.maxTokens;
      return {
        ...current,
        model: info.id,
        capabilities,
        maxTokens,
        pricing: info.pricing ?? current.pricing
      };
    });
    const state = (value: boolean | undefined) => (value === undefined ? '未提供' : value ? '是' : '否');
    setProbeMessage(
      `已应用 ${info.name} 的能力：视觉 ${state(info.vision)}、工具 ${state(info.tools)}、JSON ${state(info.jsonMode)}`
    );
  };

  const probeModels = async () => {
    if (!editing) return;
    let headers: Record<string, string> | undefined;
    if (headersText.trim()) {
      try {
        headers = JSON.parse(headersText) as Record<string, string>;
      } catch {
        pushToast('error', '请求头不是合法 JSON');
        return;
      }
    }
    setProbing(true);
    setProbeMessage(null);
    setDiscoveredModels([]);
    try {
      const result = await api.ai.providers.probe({ ...editing, headers });
      setDiscoveredModels(result.models);
      setProbeMessage(result.message);
      const match = result.models.find((model) => model.id === editing.model);
      if (match) applyModelInfo(match);
    } catch (error) {
      const message = (error as Error).message;
      setProbeMessage(message);
      pushToast('error', message);
    } finally {
      setProbing(false);
    }
  };

  const saveProvider = async () => {
    if (!editing) return;
    let headers: Record<string, string> | undefined;
    if (headersText.trim()) {
      try {
        headers = JSON.parse(headersText) as Record<string, string>;
      } catch {
        pushToast('error', '请求头不是合法 JSON');
        return;
      }
    }
    setBusy(true);
    try {
      const next = await api.ai.providers.save({ ...editing, headers });
      setProviders(next);
      pushToast('success', 'Provider 已保存');
      setEditing(null);
      setHeadersText('');
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const test = async (id: string) => {
    setBusy(true);
    setTestResult(null);
    try {
      const result = await api.ai.providers.test(id);
      setTestResult(
        `${result.ok ? '连接成功' : '连接失败'} · ${result.latencyMs}ms${
          result.visionOk === false ? ' · 视觉不可用' : ''
        }${result.jsonOk === false ? ' · JSON 模式不可用' : ''}\n${result.message}`
      );
      pushToast(result.ok ? 'success' : 'error', result.message);
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeProvider = async (provider: AiProviderSummary) => {
    if (!window.confirm(`确定删除 Provider「${provider.name}」？`)) return;
    try {
      setProviders(await api.ai.providers.remove(provider.id));
      pushToast('info', 'Provider 已删除');
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const setDefaultProvider = async (provider: AiProviderSummary) => {
    try {
      setProviders(await api.ai.providers.setDefault(provider.id));
      pushToast('success', '已设为默认 Provider');
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const saveAcrcloud = async (testAfter = false) => {
    setBusy(true);
    try {
      const summary = await api.ai.acrcloud.save({
        enabled: acrEnabled,
        host: acrHost,
        accessKey: acrKey || undefined,
        accessSecret: acrSecret || undefined
      });
      setAcrcloud(summary);
      setAcrKey('');
      setAcrSecret('');
      pushToast('success', 'ACRCloud 配置已保存');
      if (testAfter) {
        const result = await api.ai.acrcloud.test();
        pushToast(result.ok ? 'success' : 'error', result.message);
      }
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const updateSetting = async (patch: Partial<AppSettings>) => {
    if (!settings) return;
    setSettings({ ...settings, ...patch });
    try {
      const next = await api.settings.update(patch);
      setSettings(next);
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line2 px-4 py-2.5">
        <div className="text-[12.5px] font-medium text-fg">模型与工具</div>
        <span className="text-[10.5px] text-dim">Provider、ACRCloud、抽帧与队列参数</span>
        <Button size="sm" variant="primary" className="ml-auto" onClick={openNew}>
          <Plus size={11} />
          添加 Provider
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="scroll-thin scroll-stable min-h-0 space-y-2 overflow-y-auto pr-1">
          <div className="grid gap-2 xl:grid-cols-2">
            {providers.map((provider) => (
              <div key={provider.id} className="rounded-xl border border-line/70 bg-panel/35 p-3">
                <div className="flex items-center gap-2">
                  <Cpu size={14} className="text-blue" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-fg">
                    {provider.name}
                  </span>
                  {provider.isDefault ? (
                    <span className="rounded border border-yellow/30 bg-yellow/10 px-1.5 py-0.5 text-[9.5px] text-yellow">
                      默认
                    </span>
                  ) : null}
                  <span className="rounded border border-line bg-panel2 px-1.5 py-0.5 text-[9.5px] text-muted">
                    {AI_PROTOCOL_LABEL[provider.protocol] ?? provider.protocol}
                  </span>
                </div>
                <div className="mt-1 truncate font-mono text-[10.5px] text-dim" title={provider.baseUrl}>
                  {provider.model} · {provider.baseUrl}
                </div>
                {provider.pricing ? (
                  <div className="mt-0.5 text-[9.5px] text-dim">
                    价格：{provider.pricing.currency} {provider.pricing.inputPerMillion} in /{' '}
                    {provider.pricing.outputPerMillion} out · 每 1M tokens
                  </div>
                ) : null}
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[9.5px]">
                  {provider.capabilities.vision ? (
                    <span className="rounded bg-blue/10 px-1 py-0.5 text-blue">视觉</span>
                  ) : null}
                  {provider.capabilities.tools ? (
                    <span className="rounded bg-green/10 px-1 py-0.5 text-green">工具</span>
                  ) : null}
                  {provider.capabilities.jsonMode ? (
                    <span className="rounded bg-purple/10 px-1 py-0.5 text-purple">JSON</span>
                  ) : null}
                  {provider.hasApiKey ? (
                    <span className="inline-flex items-center gap-0.5 rounded bg-panel2 px-1 py-0.5 text-dim">
                      <KeyRound size={8} />
                      {provider.apiKeyHint}
                    </span>
                  ) : (
                    <span className="rounded bg-yellow/10 px-1 py-0.5 text-yellow">无 Key</span>
                  )}
                  {provider.custom ? (
                    <span className="rounded bg-panel2 px-1 py-0.5 text-muted">
                      {AI_COMPAT_LABEL[provider.custom.compatMode] ?? provider.custom.compatMode}
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <Button size="sm" variant="subtle" onClick={() => void test(provider.id)} disabled={busy}>
                    测试连接
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(provider)}>
                    编辑
                  </Button>
                  {!provider.isDefault ? (
                    <Button size="sm" variant="ghost" onClick={() => void setDefaultProvider(provider)}>
                      <Star size={10} />
                      设为默认
                    </Button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void removeProvider(provider)}
                    className="ml-auto text-dim hover:text-red"
                    aria-label={`删除 ${provider.name}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={openNew}
              className="flex min-h-[154px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line bg-panel/20 px-3 py-6 text-center text-dim transition-colors hover:border-pink/35 hover:bg-pink/[0.03] hover:text-fg"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-panel2">
                <Plus size={14} />
              </span>
              <span className="text-[12px]">添加 Provider</span>
              <span className="max-w-[220px] text-[10px] leading-4">
                支持 OpenAI 兼容、Anthropic、Gemini、自定义模板与本地 Ollama。
              </span>
            </button>
            {providers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line px-3 py-8 text-center text-[11.5px] text-dim xl:col-span-2">
                还没有 Provider。点击上方卡片，或选择预设快速填入。
              </div>
            ) : null}
          </div>

          {testResult ? (
            <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-line/60 bg-panel2/40 px-3 py-2 font-mono text-[10px] leading-4 text-muted">
              {testResult}
            </pre>
          ) : null}

          <div className="rounded-xl border border-line/60 bg-panel2/25 p-3">
            <div className="text-[11.5px] font-medium text-fg">接入提示</div>
            <div className="mt-1.5 grid gap-2 text-[10px] leading-4 text-dim md:grid-cols-3">
              <div className="rounded-lg border border-line/50 bg-panel/40 px-2 py-1.5">
                <div className="text-[10.5px] text-muted">OpenAI 兼容</div>
                适合通义千问、OpenRouter、Ollama、OpenCode Go 等。OpenCode Go 预设会自动带上
                <code className="mx-0.5 font-mono text-[9.5px]">x-opencode-session</code>。
              </div>
              <div className="rounded-lg border border-line/50 bg-panel/40 px-2 py-1.5">
                <div className="text-[10.5px] text-muted">能力开关</div>
                打标需要「视觉」；只有开启「工具调用」且 ACRCloud 已配置时，模型才能识别 BGM。
              </div>
              <div className="rounded-lg border border-line/50 bg-panel/40 px-2 py-1.5">
                <div className="text-[10.5px] text-muted">本机保存</div>
                API Key 与请求头使用系统加密存储；页面只显示 Key 的尾号提示。
              </div>
            </div>
          </div>
        </div>

        <div className="scroll-thin scroll-stable min-h-0 space-y-3 overflow-y-auto pr-1">
          <div className="rounded-xl border border-line/70 bg-panel/35 p-3">
            <div className="flex items-center gap-2">
              <Wrench size={14} className="text-green" />
              <span className="text-[12.5px] font-medium text-fg">ACRCloud BGM 识别</span>
              {acrcloud?.configured ? (
                <CheckCircle2 size={12} className="text-green" />
              ) : (
                <AlertTriangle size={12} className="text-yellow" />
              )}
            </div>
            <p className="mt-1 text-[10.5px] leading-4 text-dim">
              模型判断是音乐/舞蹈类视频时，会调用该工具识别 15 秒音频片段。未配置时只使用 B 站标签和文本推断。
            </p>
            <p className="mt-1 text-[10px] leading-4 text-dim/80">
              需要 AVR 项目的 Host / Access Key / Access Secret；控制台个人访问令牌（JWT）不能直接用于识别。
            </p>
            <div className="mt-2 space-y-2">
              <Field label="Host">
                <TextInput
                  value={acrHost}
                  onChange={(event) => setAcrHost(event.target.value)}
                  placeholder="identify-eu-west-1.acrcloud.com"
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Access Key">
                  <TextInput
                    value={acrKey}
                    onChange={(event) => setAcrKey(event.target.value)}
                    placeholder={acrcloud?.accessKeyHint ?? '未配置'}
                  />
                </Field>
                <Field label="Access Secret">
                  <TextInput
                    type="password"
                    value={acrSecret}
                    onChange={(event) => setAcrSecret(event.target.value)}
                    placeholder={acrcloud?.hasSecret ? '已配置，留空不修改' : '未配置'}
                  />
                </Field>
              </div>
              <Toggle checked={acrEnabled} onChange={setAcrEnabled} label="启用 ACRCloud" />
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="subtle" onClick={() => void saveAcrcloud(false)} disabled={busy}>
                  <Save size={10} />
                  保存
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void saveAcrcloud(true)} disabled={busy}>
                  保存并测试
                </Button>
                {acrcloud?.callsToday ? (
                  <span className="ml-auto text-[10px] text-dim">今日 {acrcloud.callsToday} 次</span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-line/70 bg-panel/35 p-3">
            <div className="flex items-center gap-2">
              <RefreshCw size={14} className="text-pink" />
              <span className="text-[12.5px] font-medium text-fg">抽帧与队列</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="每视频帧数">
                <TextInput
                  type="number"
                  min={0}
                  max={8}
                  value={settings?.aiFrameCount ?? 3}
                  onChange={(event) => void updateSetting({ aiFrameCount: Number(event.target.value) || 0 })}
                />
              </Field>
              <Field label="帧最大边长">
                <Select
                  value={String(settings?.aiFrameWidth ?? 768)}
                  onChange={(value) => void updateSetting({ aiFrameWidth: Number(value) })}
                  options={[
                    { value: '512', label: '512px' },
                    { value: '768', label: '768px' },
                    { value: '1024', label: '1024px' }
                  ]}
                />
              </Field>
              <Field label="并发">
                <TextInput
                  type="number"
                  min={1}
                  max={4}
                  value={settings?.aiConcurrency ?? 2}
                  onChange={(event) => void updateSetting({ aiConcurrency: Number(event.target.value) || 1 })}
                />
              </Field>
              <Field label="请求间隔（ms）">
                <TextInput
                  type="number"
                  min={0}
                  max={5000}
                  value={settings?.aiRequestDelayMs ?? 300}
                  onChange={(event) =>
                    void updateSetting({ aiRequestDelayMs: Number(event.target.value) || 0 })
                  }
                />
              </Field>
              <Field label="超时（ms）">
                <TextInput
                  type="number"
                  min={10000}
                  max={600000}
                  value={settings?.aiTimeoutMs ?? 120000}
                  onChange={(event) =>
                    void updateSetting({ aiTimeoutMs: Number(event.target.value) || 120000 })
                  }
                />
              </Field>
              <Field label="最大重试">
                <TextInput
                  type="number"
                  min={0}
                  max={5}
                  value={settings?.aiMaxRetries ?? 2}
                  onChange={(event) => void updateSetting({ aiMaxRetries: Number(event.target.value) || 0 })}
                />
              </Field>
              <Field label="最大工具轮次">
                <TextInput
                  type="number"
                  min={0}
                  max={5}
                  value={settings?.aiMaxToolRounds ?? 3}
                  onChange={(event) =>
                    void updateSetting({ aiMaxToolRounds: Number(event.target.value) || 0 })
                  }
                />
              </Field>
              <Field label="缓存保留（天）">
                <TextInput
                  type="number"
                  min={1}
                  max={365}
                  value={settings?.aiCacheDays ?? 30}
                  onChange={(event) => void updateSetting({ aiCacheDays: Number(event.target.value) || 30 })}
                />
              </Field>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <Toggle
                checked={settings?.aiIncludeCover ?? true}
                onChange={(next) => void updateSetting({ aiIncludeCover: next })}
                label="把封面一起发给模型"
              />
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() =>
                  void api.ai.maintenance
                    .cleanup()
                    .then((result) => pushToast('success', result.details))
                    .catch((error: unknown) => pushToast('error', (error as Error).message))
                }
              >
                清理 AI 缓存
              </Button>
            </div>
          </div>
          <div className="rounded-xl border border-line/70 bg-panel/35 p-3">
            <div className="text-[12px] font-medium text-fg">上传确认记录</div>
            <p className="mt-1 text-[10.5px] leading-4 text-dim">
              {consentHosts.length > 0
                ? `已确认的 host：${consentHosts.join('、')}`
                : '尚未确认任何外部 host；首次发起打标时会弹出确认。'}
            </p>
          </div>
        </div>
      </div>

      {editing ? (
        <Modal
          title={editing.id ? '编辑 Provider' : '添加 Provider'}
          subtitle="配置保存在本机，API Key 使用系统加密存储"
          onClose={() => setEditing(null)}
          width="max-w-2xl"
        >
          <div className="max-h-[68vh] space-y-3 overflow-y-auto pr-1">
            <Field label="快速预设">
              <Select
                value=""
                onChange={(value) => applyPreset(value)}
                options={[
                  { value: '', label: '选择预设…' },
                  ...PRESETS.map((preset) => ({ value: preset.label, label: preset.label }))
                ]}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="名称">
                <TextInput
                  value={editing.name}
                  onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                />
              </Field>
              <Field label="协议">
                <Select
                  value={editing.protocol}
                  onChange={(value) => {
                    resetProbe();
                    setEditing({
                      ...editing,
                      protocol: value as AiProviderInput['protocol'],
                      custom: value === 'custom' ? (editing.custom ?? { compatMode: 'openai' }) : null
                    });
                  }}
                  options={[
                    { value: 'openai', label: 'OpenAI 兼容' },
                    { value: 'anthropic', label: 'Anthropic Messages' },
                    { value: 'gemini', label: 'Google Generative AI' },
                    { value: 'custom', label: '自定义' }
                  ]}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Base URL">
                <TextInput
                  value={editing.baseUrl}
                  onChange={(event) => {
                    resetProbe();
                    setEditing({ ...editing, baseUrl: event.target.value });
                  }}
                  placeholder="https://…"
                />
              </Field>
              <Field label="模型名" hint="可手动填写；支持 /models 的网关可自动探测能力。">
                <div className="flex items-center gap-1.5">
                  <TextInput
                    value={editing.model}
                    onChange={(event) => setEditing({ ...editing, model: event.target.value })}
                    placeholder="qwen-vl-max"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-9 shrink-0 px-2.5"
                    onClick={() => void probeModels()}
                    disabled={probing || !editing.baseUrl.trim()}
                    title="读取 /models 并自动填入视觉、工具、JSON、输出上限与价格"
                  >
                    {probing ? <Loader2 size={12} className="animate-spin" /> : <Radar size={12} />}
                    {probing ? '探测中' : '探测'}
                  </Button>
                </div>
              </Field>
            </div>

            {discoveredModels.length > 0 || probeMessage ? (
              <div className="space-y-1.5 rounded-lg border border-line/60 bg-panel2/40 p-2">
                {discoveredModels.length > 0 ? (
                  <Select
                    value={discoveredModels.some((model) => model.id === editing.model) ? editing.model : ''}
                    onChange={(value) => {
                      const model = discoveredModels.find((item) => item.id === value);
                      if (model) applyModelInfo(model);
                    }}
                    options={[
                      { value: '', label: `检测到 ${discoveredModels.length} 个模型，选择以应用` },
                      ...discoveredModels.map((model) => ({
                        value: model.id,
                        label: `${model.name}${model.vision ? ' · 视觉' : ''}${model.tools ? ' · 工具' : ''}${model.jsonMode ? ' · JSON' : ''}`
                      }))
                    ]}
                  />
                ) : null}
                {probeMessage ? <div className="text-[10px] leading-4 text-dim">{probeMessage}</div> : null}
                {discoveredModels.length > 0 ? (
                  <div className="text-[9.5px] leading-4 text-dim/80">
                    选择模型会自动填入能力、输出上限和价格；仍可手动修改。
                  </div>
                ) : null}
              </div>
            ) : null}
            <Field label="API Key" hint={editing.id ? '留空表示不修改；勾选下方清除。' : '只保存在本机。'}>
              <TextInput
                type="password"
                value={editing.apiKey ?? ''}
                onChange={(event) => setEditing({ ...editing, apiKey: event.target.value })}
                placeholder={editing.id ? '留空不修改' : 'sk-…'}
              />
            </Field>
            <Toggle
              checked={Boolean(editing.clearApiKey)}
              onChange={(next) => setEditing({ ...editing, clearApiKey: next })}
              label="清除已保存的 API Key"
            />

            {editing.protocol === 'custom' ? (
              <div className="space-y-2 rounded-lg border border-line/60 bg-panel2/40 p-2">
                <Field
                  label="兼容模式"
                  hint="OpenAI/Anthropic/Gemini 兼容模式支持工具调用；纯模板模式不支持。"
                >
                  <Select
                    value={editing.custom?.compatMode ?? 'openai'}
                    onChange={(value) =>
                      setEditing({
                        ...editing,
                        custom: {
                          compatMode: value as AiCustomConfig['compatMode'],
                          bodyTemplate: editing.custom?.bodyTemplate,
                          responsePath: editing.custom?.responsePath
                        }
                      })
                    }
                    options={[
                      { value: 'openai', label: 'OpenAI 兼容端点' },
                      { value: 'anthropic', label: 'Anthropic 兼容端点' },
                      { value: 'gemini', label: 'Gemini 兼容端点' },
                      { value: 'template', label: '纯模板（无工具）' }
                    ]}
                  />
                </Field>
                {editing.custom?.compatMode === 'template' ? (
                  <>
                    <Field
                      label="请求体模板（JSON）"
                      hint="支持 {{model}} {{system}} {{prompt}} {{imagesDataUrl}} {{imagesBase64}} {{imageParts}}"
                    >
                      <TextArea
                        value={editing.custom?.bodyTemplate ?? ''}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            custom: {
                              ...(editing.custom ?? { compatMode: 'template' }),
                              bodyTemplate: event.target.value
                            }
                          })
                        }
                        className="min-h-[120px] font-mono text-[10.5px]"
                      />
                    </Field>
                    <Field label="响应文本路径">
                      <TextInput
                        value={editing.custom?.responsePath ?? ''}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            custom: {
                              ...(editing.custom ?? { compatMode: 'template' }),
                              responsePath: event.target.value
                            }
                          })
                        }
                        placeholder="choices.0.message.content"
                      />
                    </Field>
                  </>
                ) : null}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <Field label="温度">
                <TextInput
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={editing.temperature}
                  onChange={(event) => setEditing({ ...editing, temperature: Number(event.target.value) })}
                />
              </Field>
              <Field label="最大输出 tokens">
                <TextInput
                  type="number"
                  min={128}
                  max={32000}
                  value={editing.maxTokens}
                  onChange={(event) => setEditing({ ...editing, maxTokens: Number(event.target.value) })}
                />
              </Field>
              <Field label="超时（ms）">
                <TextInput
                  type="number"
                  min={10000}
                  max={600000}
                  value={editing.timeoutMs}
                  onChange={(event) => setEditing({ ...editing, timeoutMs: Number(event.target.value) })}
                />
              </Field>
              <Field label="最大重试">
                <TextInput
                  type="number"
                  min={0}
                  max={5}
                  value={editing.maxRetries}
                  onChange={(event) => setEditing({ ...editing, maxRetries: Number(event.target.value) })}
                />
              </Field>
              <Field label="图片细节">
                <Select
                  value={editing.imageDetail}
                  onChange={(value) => setEditing({ ...editing, imageDetail: value as AiImageDetail })}
                  options={[
                    { value: 'low', label: 'low（省 tokens）' },
                    { value: 'auto', label: 'auto' },
                    { value: 'high', label: 'high（更清晰）' }
                  ]}
                />
              </Field>
              <Field label="能力">
                <div className="flex flex-wrap gap-2 text-[10.5px]">
                  {(
                    [
                      ['vision', '视觉'],
                      ['tools', '工具调用'],
                      ['jsonMode', 'JSON 模式'],
                      ['audio', '音频']
                    ] as Array<[keyof AiCapabilities, string]>
                  ).map(([key, label]) => (
                    <label key={key} className="inline-flex items-center gap-1 text-muted">
                      <input
                        type="checkbox"
                        checked={editing.capabilities[key]}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            capabilities: { ...editing.capabilities, [key]: event.target.checked }
                          })
                        }
                        className="h-3 w-3 accent-pink"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </Field>
            </div>

            <Field label="请求头（JSON，可选）" hint="留空表示保持已有请求头；填写会整体覆盖。值会加密存储。">
              <TextArea
                value={headersText}
                onChange={(event) => setHeadersText(event.target.value)}
                className="min-h-[70px] font-mono text-[10.5px]"
                placeholder='{"HTTP-Referer":"https://…"}'
              />
            </Field>
            {editing.id ? (
              <div className="text-[10px] text-dim">
                已保存的请求头键：
                {providers.find((provider) => provider.id === editing.id)?.headerKeys.join('、') || '无'}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2 border-t border-line2 pt-3">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                取消
              </Button>
              <Button variant="primary" onClick={() => void saveProvider()} disabled={busy}>
                <Save size={12} />
                保存 Provider
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
