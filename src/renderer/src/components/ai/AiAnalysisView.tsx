import clsx from 'clsx';
import { AlertTriangle, Brain, CheckCircle2, Loader2, Play, Save, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AiAnalysisEstimate,
  AiAnalysisInput,
  AiAnalysisProgress,
  AiAnalysisRun,
  AiProviderSummary,
  AiTagProfile,
  SourceSummary,
  VideoItem
} from '@shared/types';
import { MAX_ANALYSIS_SAMPLES, MIN_SAMPLES_PER_GROUP } from '@shared/aiDefaults';
import { api } from '../../lib/bridge';
import { useUi } from '../../lib/store';
import { categoryClass, formatTokens } from '../../lib/ai';
import { Button, Field, Select, TextInput, Toggle } from '../ui';

type AnalysisMode = AiAnalysisInput['mode'];
type SampleMode = AiAnalysisInput['sampleMode'];

const MODE_LABEL: Record<AiAnalysisRun['mode'], string> = {
  text: '仅文本',
  vision: '仅视觉',
  hybrid: '混合'
};

export function AiAnalysisView() {
  const pushToast = useUi((state) => state.pushToast);
  const [providers, setProviders] = useState<AiProviderSummary[]>([]);
  const [profiles, setProfiles] = useState<AiTagProfile[]>([]);
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [providerId, setProviderId] = useState<string>('');
  const [mode, setMode] = useState<AnalysisMode>('hybrid');
  const [sampleMode, setSampleMode] = useState<SampleMode>('random');
  const [sampleSize, setSampleSize] = useState(24);
  const [instructions, setInstructions] = useState('');
  const [selectedVideoIds, setSelectedVideoIds] = useState<number[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [videoSearch, setVideoSearch] = useState('');
  const [estimate, setEstimate] = useState<AiAnalysisEstimate | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<AiAnalysisProgress | null>(null);
  const [result, setResult] = useState<AiAnalysisRun | null>(null);
  const [history, setHistory] = useState<AiAnalysisRun[]>([]);
  const [saveName, setSaveName] = useState('AI 生成方案');
  const [saveScope, setSaveScope] = useState<'global' | 'source'>('global');
  const [saveSourceId, setSaveSourceId] = useState<number | null>(null);
  const [saveDefault, setSaveDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const resultRef = useRef<HTMLDivElement | null>(null);

  // 结果面板在表单下方，跑完自动滚过去，否则看起来像「点了没反应」
  useEffect(() => {
    if (!result) return;
    resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [result]);

  const input = useMemo<AiAnalysisInput>(
    () => ({
      mode,
      sampleMode,
      sampleSize,
      videoIds: sampleMode === 'manual' ? selectedVideoIds : undefined,
      providerId: providerId || undefined,
      instructions: instructions.trim() || undefined
    }),
    [instructions, mode, providerId, sampleMode, sampleSize, selectedVideoIds]
  );

  useEffect(() => {
    void Promise.all([
      api.ai.providers.list(),
      api.ai.profiles.list(),
      api.sources.list(),
      api.ai.analysis.history()
    ])
      .then(([nextProviders, nextProfiles, nextSources, nextHistory]) => {
        setProviders(nextProviders);
        setProfiles(nextProfiles);
        setSources(nextSources);
        setHistory(nextHistory);
        setProviderId(
          (current) =>
            current || nextProviders.find((item) => item.isDefault)?.id || nextProviders[0]?.id || ''
        );
        setSaveSourceId((current) => current ?? nextSources[0]?.id ?? null);
      })
      .catch((error: unknown) => pushToast('error', (error as Error).message));
  }, [pushToast]);

  useEffect(() => api.ai.analysis.onProgress((next) => setProgress(next)), []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void api.ai.analysis
        .estimate(input)
        .then(setEstimate)
        .catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [input]);

  const loadVideos = useCallback(async () => {
    try {
      const page = await api.library.query({
        search: videoSearch.trim() || undefined,
        status: 'present',
        sort: 'recent',
        limit: 200
      });
      setVideos(page.items);
    } catch {
      // ignore
    }
  }, [videoSearch]);

  useEffect(() => {
    if (sampleMode !== 'manual') return;
    const timer = window.setTimeout(() => void loadVideos(), 200);
    return () => window.clearTimeout(timer);
  }, [loadVideos, sampleMode]);

  const toggleVideo = (id: number) => {
    setSelectedVideoIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  };

  const run = async () => {
    if (!providerId) {
      pushToast('warn', '请先配置模型 Provider');
      return;
    }
    setRunning(true);
    setProgress(null);
    setResult(null);
    let ok = false;
    try {
      const next = await api.ai.analysis.run(input);
      setResult(next);
      ok = true;
      pushToast('success', '库级分析完成');
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setRunning(false);
      // 失败也要刷新，否则失败的运行既看不到记录也看不到原因
      const next = await api.ai.analysis.history().catch(() => null);
      if (next) {
        setHistory(next);
        if (!ok) setResult(next[0] ?? null);
      }
    }
  };

  const save = async () => {
    if (!result) return;
    if (!saveName.trim()) {
      pushToast('warn', '方案名称不能为空');
      return;
    }
    setBusy(true);
    try {
      const next = await api.ai.analysis.saveAsProfile({
        runId: result.id,
        name: saveName.trim(),
        scope: saveScope,
        sourceId: saveScope === 'source' ? saveSourceId : null,
        isDefault: saveDefault
      });
      setProfiles(next);
      pushToast('success', '已保存为标签方案，可在「标签方案」继续编辑');
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadHistory = async (id: number) => {
    try {
      const run = await api.ai.analysis.get(id);
      if (run) setResult(run);
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line2 px-4 py-2.5">
        <Brain size={15} className="text-purple" />
        <div className="text-[12.5px] font-medium text-fg">库级分析</div>
        <span className="text-[10.5px] text-dim">让 AI 先总结整个库，再生成一套通用的标签方案</span>
      </div>

      <div className="scroll-thin scroll-stable min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
          <div className="space-y-3 self-start">
            <div className="rounded-xl border border-line/70 bg-panel/35 p-3">
              <div className="grid gap-2 md:grid-cols-2">
                <Field label="模型 Provider">
                  <Select
                    value={providerId}
                    onChange={setProviderId}
                    options={providers.map((provider) => ({
                      value: provider.id,
                      label: `${provider.name}${provider.isDefault ? '（默认）' : ''}`
                    }))}
                  />
                </Field>
                <Field label="分析方式">
                  <Select
                    value={mode}
                    onChange={(value) => setMode(value as AnalysisMode)}
                    options={[
                      { value: 'hybrid', label: '混合：文本聚类 + 代表视频视觉校验（推荐）' },
                      { value: 'text', label: '仅文本：只发元数据，便宜' },
                      { value: 'vision', label: '仅视觉：逐条代表视频，贵但准' }
                    ]}
                  />
                </Field>
                <Field label="采样方式">
                  <Select
                    value={sampleMode}
                    onChange={(value) => setSampleMode(value as SampleMode)}
                    options={[
                      { value: 'random', label: '随机' },
                      { value: 'source', label: '按来源分层' },
                      { value: 'up', label: '按 UP 主分层' },
                      { value: 'manual', label: '手动选择素材' }
                    ]}
                  />
                </Field>
                <Field
                  label="采样数量"
                  hint={
                    sampleMode === 'manual'
                      ? '手动模式下以勾选数量为准。'
                      : `默认 24 条，最多 ${MAX_ANALYSIS_SAMPLES} 条；按来源 / UP 分层时每组保底 ${MIN_SAMPLES_PER_GROUP} 条，必要时自动提升样本数。`
                  }
                >
                  <TextInput
                    type="number"
                    min={1}
                    max={MAX_ANALYSIS_SAMPLES}
                    value={sampleSize}
                    onChange={(event) => setSampleSize(Number(event.target.value) || 24)}
                    disabled={sampleMode === 'manual'}
                  />
                </Field>
              </div>
              <Field
                label="额外要求（可选）"
                hint="例如：这是某个主题的收藏夹，重点关注人物、服饰、场景和 BGM。"
              >
                <TextInput
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  placeholder="告诉 AI 这个库的特点…"
                />
              </Field>

              {estimate ? (
                <div className="mt-2 rounded-lg border border-line/60 bg-panel2/40 px-2.5 py-1.5 text-[10.5px] leading-4 text-dim">
                  {estimate.videos} 个视频 · {estimate.requests} 次请求 · {estimate.imageCount} 张图片 · 约{' '}
                  {formatTokens(estimate.approxInputTokens)} tokens
                  {estimate.warnings.length > 0 ? (
                    <div className="mt-0.5 text-yellow">{estimate.warnings.join('；')}</div>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-2 flex items-center gap-1.5">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void run()}
                  disabled={
                    running || !providerId || (sampleMode === 'manual' && selectedVideoIds.length === 0)
                  }
                >
                  {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                  {running ? '分析中…' : '开始分析'}
                </Button>
                <span className="text-[10px] text-dim">
                  分析结果不会直接改素材库，保存为方案后才用于打标。
                </span>
              </div>

              {progress ? (
                <div className="mt-2 flex items-center gap-2 text-[10.5px] text-blue">
                  <span className="font-mono">
                    {progress.done}/{progress.total}
                  </span>
                  <div className="h-1 flex-1 overflow-hidden rounded bg-panel3">
                    <div
                      className="h-full bg-blue transition-all"
                      style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
                    />
                  </div>
                  <span className="max-w-[260px] truncate">{progress.message}</span>
                </div>
              ) : null}
            </div>

            <div className="rounded-xl border border-line/60 bg-panel2/25 p-3">
              <div className="text-[11.5px] font-medium text-fg">采样建议</div>
              <ul className="mt-1 space-y-1 text-[10px] leading-4 text-dim">
                <li>先用随机 24 条跑一遍，再按来源 / UP 分层复核，避免被单个收藏夹主导。</li>
                <li>混合模式成本最低；素材画面差异大时，改用仅视觉逐条校验。</li>
                <li>结果保存为方案后才会用于打标，分析本身不会修改素材库。</li>
              </ul>
            </div>
          </div>

          <div className="flex min-h-0 flex-col self-stretch rounded-xl border border-line/70 bg-panel/35 p-3">
            <div className="flex flex-none items-center gap-2">
              <span className="text-[12px] font-medium text-fg">分析历史</span>
              <span className="font-mono text-[10px] text-dim">{history.length}</span>
              {result ? <span className="ml-auto text-[10px] text-dim">当前查看 #{result.id}</span> : null}
            </div>
            {history.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-8 text-center">
                <span className="text-[11px] text-muted">还没有分析记录</span>
                <span className="max-w-[260px] text-[10px] leading-4 text-dim">
                  分析完成后会自动保存历史，可以随时载入结果或另存为方案。
                </span>
              </div>
            ) : (
              <div className="scroll-thin scroll-stable mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                {history.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void loadHistory(item.id)}
                    className="flex w-full items-center gap-2 rounded-lg border border-line/50 bg-panel2/40 px-2 py-1 text-left text-[10.5px] transition-colors hover:border-line"
                  >
                    <span className="font-mono text-dim">#{item.id}</span>
                    <span
                      className="min-w-0 flex-1 truncate text-muted"
                      title={item.error ?? item.result?.summary ?? MODE_LABEL[item.mode]}
                    >
                      {item.status === 'failed' && item.error
                        ? item.error
                        : (item.result?.summary ?? MODE_LABEL[item.mode])}
                    </span>
                    <span
                      className={clsx(
                        'rounded border px-1 py-0.5 text-[9px]',
                        item.status === 'done'
                          ? 'border-green/30 bg-green/10 text-green'
                          : item.status === 'failed'
                            ? 'border-red/30 bg-red/10 text-red'
                            : 'border-line bg-panel2 text-dim'
                      )}
                    >
                      {item.status}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2 flex-none border-t border-line/50 pt-2">
              <div className="text-[10px] font-medium text-dim">分析流程</div>
              <ol className="mt-1 space-y-1 text-[10px] leading-4 text-dim">
                <li>1. 按范围采样，先归纳标题 / UP / 标签的共性。</li>
                <li>2. 混合模式会用代表视频的画面校验分类。</li>
                <li>3. 保存为方案后，回到「标签方案」微调即可用于打标。</li>
              </ol>
            </div>
          </div>
        </div>

        {sampleMode === 'manual' ? (
          <div className="mt-3 rounded-xl border border-line/70 bg-panel/35 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-medium text-fg">选择分析素材</span>
              <span className="text-[10.5px] text-dim">已选 {selectedVideoIds.length} 条</span>
              <TextInput
                value={videoSearch}
                onChange={(event) => setVideoSearch(event.target.value)}
                placeholder="搜索标题 / UP…"
                className="ml-auto h-7 w-52 text-[11px]"
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedVideoIds(videos.map((video) => video.id))}
              >
                全选当前
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedVideoIds([])}>
                清空
              </Button>
            </div>
            <div className="scroll-thin mt-2 grid max-h-[260px] gap-1.5 overflow-y-auto pr-1 md:grid-cols-2">
              {videos.map((video) => (
                <button
                  key={video.id}
                  type="button"
                  onClick={() => toggleVideo(video.id)}
                  className={clsx(
                    'flex items-center gap-2 rounded-lg border px-2 py-1 text-left transition-colors',
                    selectedVideoIds.includes(video.id)
                      ? 'border-pink/35 bg-pink/[0.05]'
                      : 'border-line/50 bg-panel2/40 hover:border-line'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selectedVideoIds.includes(video.id)}
                    onChange={() => toggleVideo(video.id)}
                    className="h-3 w-3 accent-pink"
                  />
                  <div className="h-8 w-14 flex-none overflow-hidden rounded bg-panel3">
                    {video.thumbUrl ? (
                      <img src={video.thumbUrl} alt="" className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[10.5px] text-muted">{video.title}</div>
                    <div className="truncate text-[9.5px] text-dim">
                      {video.upName ?? '未知'} · {video.sourceName ?? '无来源'}
                    </div>
                  </div>
                </button>
              ))}
              {videos.length === 0 ? (
                <div className="col-span-2 py-4 text-center text-[11px] text-dim">没有匹配的视频。</div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div ref={resultRef}>
          {result && !result.result && result.status === 'failed' ? (
            <div className="mt-3 rounded-xl border border-red/30 bg-red/[0.06] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <AlertTriangle size={14} className="text-red" />
                <span className="text-[12.5px] font-medium text-fg">分析失败</span>
                <span className="font-mono text-[10px] text-dim">#{result.id}</span>
                <span className="ml-auto text-[10px] text-dim">
                  {result.model ?? '未知模型'} · 输入 {formatTokens(result.inputTokens)} / 输出{' '}
                  {formatTokens(result.outputTokens)} tokens
                </span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-5 text-red/90">{result.error}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="subtle" onClick={() => void run()} disabled={running}>
                  <Play size={11} />
                  重新分析
                </Button>
                <span className="max-w-[520px] text-[10px] leading-4 text-dim">
                  常见原因：推理模型把输出额度用在了推理上（提高 Provider
                  输出上限即可）、样本过多导致输出被截断，或网关不支持 JSON 模式。
                </span>
              </div>
            </div>
          ) : null}

          {result?.result ? (
            <div className="mt-3 rounded-xl border border-line/70 bg-panel/35 p-3">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-pink" />
                <span className="text-[12.5px] font-medium text-fg">分析结果</span>
                <span className="text-[10.5px] text-dim">
                  {result.result.categories.length} 个分类 · {result.result.focus.length} 个关注点
                </span>
              </div>
              <p className="mt-1.5 text-[11.5px] leading-5 text-muted">{result.result.summary}</p>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {result.result.categories.map((category) => (
                  <div key={category.name} className="rounded-lg border border-line/60 bg-panel2/40 p-2">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={clsx(
                          'rounded border px-1.5 py-0.5 text-[10px]',
                          categoryClass(category.name)
                        )}
                      >
                        {category.name}
                      </span>
                      <span className="truncate text-[10px] text-dim">{category.description}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {category.tags.slice(0, 16).map((tag) => (
                        <span
                          key={tag}
                          className="rounded border border-line bg-panel px-1 py-0.5 text-[10px] text-muted"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="text-[10.5px] text-dim">关注点：</span>
                {result.result.focus.map((focus) => (
                  <span key={focus} className="rounded bg-pink/10 px-1.5 py-0.5 text-[10px] text-pink">
                    {focus}
                  </span>
                ))}
              </div>
              <details className="mt-2 rounded-lg border border-line/60 bg-panel2/40 px-2 py-1.5">
                <summary className="cursor-pointer text-[10.5px] text-muted">
                  查看生成的系统提示词与模板
                </summary>
                <pre className="scroll-thin mt-1 max-h-56 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-4 text-dim">
                  {result.result.systemPrompt}
                  {'\n\n--- 用户模板 ---\n\n'}
                  {result.result.promptTemplate}
                </pre>
              </details>

              <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto_auto_auto]">
                <TextInput
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                  placeholder="方案名称"
                />
                <Select
                  value={saveScope}
                  onChange={(value) => setSaveScope(value as 'global' | 'source')}
                  options={[
                    { value: 'global', label: '全局方案' },
                    { value: 'source', label: '来源覆盖' }
                  ]}
                />
                {saveScope === 'source' ? (
                  <Select
                    value={saveSourceId ? String(saveSourceId) : ''}
                    onChange={(value) => setSaveSourceId(value ? Number(value) : null)}
                    options={sources.map((source) => ({ value: String(source.id), label: source.title }))}
                  />
                ) : (
                  <div />
                )}
                <Button variant="primary" size="sm" onClick={() => void save()} disabled={busy}>
                  <Save size={11} />
                  保存为方案
                </Button>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <Toggle checked={saveDefault} onChange={setSaveDefault} label="保存后设为全局默认方案" />
                {profiles.length > 0 ? (
                  <span className="text-[10px] text-dim">已有 {profiles.length} 个方案</span>
                ) : null}
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-green">
                  <CheckCircle2 size={10} />
                  可继续在「标签方案」编辑
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
