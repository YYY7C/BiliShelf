import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Cpu,
  FileImage,
  ListChecks,
  Play,
  Send,
  Sparkles,
  Tags
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  AcrCloudSummary,
  AiProviderSummary,
  AiQueueSnapshot,
  AiReviewItem,
  AiRunSummary,
  AiStats,
  AiTagProfile
} from '@shared/types';
import { api } from '../../lib/bridge';
import { useUi } from '../../lib/store';
import { formatTokens } from '../../lib/ai';
import { formatRelative } from '../../lib/format';
import { Button, Spinner } from '../ui';
import type { AiTab } from '../../lib/store';

interface AiOverviewProps {
  onStart: () => void;
  onOpenTab: (tab: AiTab) => void;
}

const RUN_STATUS_LABEL: Record<AiRunSummary['status'], string> = {
  queued: '排队',
  running: '运行中',
  done: '完成',
  failed: '失败',
  canceled: '取消'
};

function StatCard({
  icon,
  label,
  value,
  hint,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: 'pink' | 'blue' | 'green' | 'yellow';
}) {
  const toneClass =
    tone === 'pink'
      ? 'text-pink bg-pink/10'
      : tone === 'blue'
        ? 'text-blue bg-blue/10'
        : tone === 'green'
          ? 'text-green bg-green/10'
          : 'text-yellow bg-yellow/10';
  return (
    <div className="rounded-xl border border-line/70 bg-panel/40 p-3">
      <div className="flex items-center gap-2">
        <span className={clsx('flex h-7 w-7 items-center justify-center rounded-lg', toneClass)}>{icon}</span>
        <span className="text-[11.5px] text-muted">{label}</span>
      </div>
      <div className="mt-2 font-mono text-[22px] font-semibold leading-6 text-fg">{value}</div>
      {hint ? <div className="mt-0.5 text-[10.5px] text-dim">{hint}</div> : null}
    </div>
  );
}

export function AiOverview({ onStart, onOpenTab }: AiOverviewProps) {
  const pushToast = useUi((state) => state.pushToast);
  const openAiReview = useUi((state) => state.openAiReview);
  const [stats, setStats] = useState<AiStats | null>(null);
  const [queue, setQueue] = useState<AiQueueSnapshot | null>(null);
  const [providers, setProviders] = useState<AiProviderSummary[]>([]);
  const [profiles, setProfiles] = useState<AiTagProfile[]>([]);
  const [acrcloud, setAcrcloud] = useState<AcrCloudSummary | null>(null);
  const [pendingItems, setPendingItems] = useState<AiReviewItem[]>([]);
  const [recentRuns, setRecentRuns] = useState<AiRunSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      api.ai.stats(),
      api.ai.queue.batches(),
      api.ai.providers.list(),
      api.ai.profiles.list(),
      api.ai.acrcloud.get(),
      api.ai.review.list({ status: 'pending', limit: 4, offset: 0 }),
      api.ai.queue.runs({ limit: 6 })
    ])
      .then(([nextStats, nextQueue, nextProviders, nextProfiles, nextAcrcloud, nextPending, nextRuns]) => {
        if (!alive) return;
        setStats(nextStats);
        setQueue(nextQueue);
        setProviders(nextProviders);
        setProfiles(nextProfiles);
        setAcrcloud(nextAcrcloud);
        setPendingItems(nextPending.items);
        setRecentRuns(nextRuns.items);
      })
      .catch((error: unknown) => pushToast('error', (error as Error).message))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [pushToast]);

  const provider = providers.find((item) => item.isDefault) ?? providers[0] ?? null;
  const defaultProfile = profiles.find((profile) => profile.isDefault) ?? profiles[0] ?? null;
  const activeBatch = queue?.batches.find((batch) => batch.status === 'running' || batch.status === 'queued');

  if (loading && !stats) {
    return (
      <div className="flex h-40 items-center justify-center gap-2 text-[12px] text-dim">
        <Spinner />
        加载概览…
      </div>
    );
  }

  return (
    <div className="scroll-thin scroll-stable flex h-full min-h-0 flex-col overflow-y-auto p-4 xl:overflow-hidden">
      <div className="grid flex-none grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          icon={<FileImage size={14} />}
          label="已打标视频"
          value={String(stats?.taggedVideos ?? 0)}
          tone="blue"
        />
        <StatCard
          icon={<ListChecks size={14} />}
          label="待审核标签"
          value={String(stats?.pendingTags ?? 0)}
          tone="yellow"
        />
        <StatCard
          icon={<CheckCircle2 size={14} />}
          label="已通过标签"
          value={String(stats?.approvedTags ?? 0)}
          tone="green"
        />
        <StatCard
          icon={<Tags size={14} />}
          label="失败任务"
          value={String(stats?.failedRuns ?? 0)}
          tone={stats?.failedRuns ? 'pink' : 'green'}
        />
        <StatCard
          icon={<Cpu size={14} />}
          label="累计 tokens"
          value={formatTokens((stats?.inputTokens ?? 0) + (stats?.outputTokens ?? 0))}
          hint={`${formatTokens(stats?.inputTokens ?? 0)} in / ${formatTokens(stats?.outputTokens ?? 0)} out`}
          tone="blue"
        />
        <StatCard
          icon={<Send size={14} />}
          label="模型请求"
          value={formatTokens(stats?.modelRequests ?? 0)}
          hint={`ACRCloud ${stats?.musicRequests ?? 0} 次`}
          tone="pink"
        />
      </div>

      <div className="mt-3 grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.72fr)]">
        <div className="flex min-h-0 flex-col gap-3">
          <section className="flex-none rounded-xl border border-line/70 bg-panel/40 p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles size={14} className="text-pink" />
              <span className="text-[12.5px] font-medium text-fg">快速开始</span>
              <span className="text-[10.5px] text-dim">用当前默认方案打标，结果先进入审核页</span>
              <Button
                variant="primary"
                size="sm"
                className="ml-auto"
                onClick={onStart}
                disabled={!provider || !defaultProfile}
              >
                <Play size={12} />
                开始打标
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] leading-5 text-dim">
              审核通过的标签会进入侧栏「本地标签」，与 B 站原始标签互相独立；可以随时回退或重跑。
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Button variant="subtle" size="sm" onClick={() => onOpenTab('review')}>
                去审核 {stats?.pendingTags ? `(${stats.pendingTags})` : ''}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onOpenTab('analysis')}>
                让 AI 生成方案
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onOpenTab('models')}>
                模型与工具
              </Button>
            </div>

            {activeBatch ? (
              <div className="mt-3 rounded-lg border border-blue/25 bg-blue/[0.05] px-3 py-2">
                <div className="flex items-center gap-2 text-[11px] text-blue">
                  <span className="font-mono">#{activeBatch.id}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {activeBatch.profileName ?? '未记录方案'} · {activeBatch.done}/{activeBatch.total} 完成
                    {activeBatch.failed > 0 ? `，${activeBatch.failed} 失败` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenTab('queue')}
                    className="inline-flex shrink-0 items-center gap-0.5 text-[10.5px] hover:underline"
                  >
                    查看
                    <ChevronRight size={10} />
                  </button>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded bg-panel3">
                  <div
                    className="h-full bg-blue transition-all"
                    style={{
                      width: `${Math.min(100, (activeBatch.done / Math.max(activeBatch.total, 1)) * 100)}%`
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10.5px] text-dim">
                {['选择范围', 'VLM 抽帧打标', '审核入库'].map((label, index) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-panel3 font-mono text-[9px] text-muted">
                      {index + 1}
                    </span>
                    <span>{label}</span>
                    {index < 2 ? <ArrowRight size={10} className="text-dim/60" /> : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line/70 bg-panel/40">
            <div className="flex flex-none items-center gap-2 border-b border-line/60 px-3 py-2">
              <span className="text-[12px] font-medium text-fg">最近批次</span>
              <span className="text-[10px] text-dim">最近 {Math.min(queue?.batches.length ?? 0, 20)} 条</span>
              <button
                type="button"
                onClick={() => onOpenTab('queue')}
                className="ml-auto inline-flex items-center gap-0.5 text-[10.5px] text-blue hover:underline"
              >
                查看全部
                <ChevronRight size={10} />
              </button>
            </div>
            {queue && queue.batches.length > 0 ? (
              <div className="scroll-thin scroll-stable min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                {queue.batches.slice(0, 20).map((batch) => (
                  <div
                    key={batch.id}
                    className="rounded-lg border border-line/50 bg-panel2/35 px-2.5 py-2 text-[11px] transition-colors hover:border-line hover:bg-panel2/60"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-dim">#{batch.id}</span>
                      <span className="min-w-0 flex-1 truncate text-muted">
                        {batch.profileName ?? '未记录方案'}
                      </span>
                      <span className="font-mono text-[10px] text-dim">
                        {batch.done}/{batch.total}
                        {batch.failed > 0 ? ` · ${batch.failed} 失败` : ''}
                      </span>
                      <span
                        className={clsx(
                          'rounded border px-1.5 py-0.5 text-[9.5px]',
                          batch.status === 'done'
                            ? 'border-green/30 bg-green/10 text-green'
                            : batch.status === 'running'
                              ? 'border-blue/30 bg-blue/10 text-blue'
                              : batch.status === 'paused'
                                ? 'border-yellow/30 bg-yellow/10 text-yellow'
                                : 'border-line bg-panel2 text-dim'
                        )}
                      >
                        {batch.status === 'done'
                          ? '完成'
                          : batch.status === 'running'
                            ? '运行中'
                            : batch.status === 'paused'
                              ? '已暂停'
                              : batch.status === 'canceled'
                                ? '已取消'
                                : '排队中'}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[9.5px] text-dim">
                      <span className="truncate">{batch.model ?? '未记录模型'}</span>
                      <span className="ml-auto shrink-0">{formatRelative(batch.createdAt)}</span>
                    </div>
                    <div className="mt-1 h-0.5 overflow-hidden rounded bg-panel3">
                      <div
                        className="h-full bg-blue/80 transition-all"
                        style={{ width: `${Math.min(100, (batch.done / Math.max(batch.total, 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
                {recentRuns.length > 0 ? (
                  <div className="mt-2 border-t border-line/50 pt-2">
                    <div className="px-0.5 pb-1 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-dim">
                      最近运行
                    </div>
                    {recentRuns.map((run) => (
                      <button
                        key={run.id}
                        type="button"
                        onClick={() => onOpenTab('queue')}
                        className="flex w-full items-center gap-2 rounded px-1 py-1 text-left transition-colors hover:bg-panel3/50"
                        title={run.error ?? '在打标任务中查看'}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[10.5px] text-muted">{run.videoTitle}</div>
                          <div className="truncate text-[8.5px] text-dim">
                            #{run.id} · {run.model ?? '未记录模型'} · {formatRelative(run.createdAt)}
                          </div>
                        </div>
                        <span
                          className={clsx(
                            'shrink-0 rounded border px-1 py-0.5 text-[8.5px]',
                            run.status === 'done'
                              ? 'border-green/30 bg-green/10 text-green'
                              : run.status === 'failed'
                                ? 'border-red/30 bg-red/10 text-red'
                                : run.status === 'running'
                                  ? 'border-blue/30 bg-blue/10 text-blue'
                                  : 'border-line bg-panel2 text-dim'
                          )}
                        >
                          {RUN_STATUS_LABEL[run.status]}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-panel2 text-dim">
                  <ListChecks size={17} />
                </div>
                <div className="text-[12px] text-muted">还没有打标批次</div>
                <Button variant="subtle" size="sm" onClick={onStart}>
                  发起第一次打标
                </Button>
              </div>
            )}
          </section>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <section className="flex-none rounded-xl border border-line/70 bg-panel/40 p-3">
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] font-medium text-fg">配置状态</span>
              <button
                type="button"
                onClick={() => onOpenTab('models')}
                className="ml-auto text-[10.5px] text-blue hover:underline"
              >
                全部设置
              </button>
            </div>
            <div className="mt-2 space-y-1.5 text-[11.5px]">
              <div className="flex items-center gap-2">
                {provider ? (
                  <CheckCircle2 size={12} className="text-green" />
                ) : (
                  <AlertTriangle size={12} className="text-yellow" />
                )}
                <span className="text-muted">模型 Provider</span>
                <span className="ml-auto min-w-0 truncate text-fg">{provider?.name ?? '未配置'}</span>
                <button
                  type="button"
                  onClick={() => onOpenTab('models')}
                  className="shrink-0 text-[10.5px] text-blue hover:underline"
                >
                  配置
                </button>
              </div>
              {provider ? (
                <div className="truncate pl-5 font-mono text-[9.5px] text-dim">
                  {provider.model} · {provider.baseUrl}
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                {defaultProfile ? (
                  <CheckCircle2 size={12} className="text-green" />
                ) : (
                  <AlertTriangle size={12} className="text-yellow" />
                )}
                <span className="text-muted">默认方案</span>
                <span className="ml-auto min-w-0 truncate text-fg">{defaultProfile?.name ?? '未创建'}</span>
                <button
                  type="button"
                  onClick={() => onOpenTab('profiles')}
                  className="shrink-0 text-[10.5px] text-blue hover:underline"
                >
                  编辑
                </button>
              </div>
              <div className="flex items-center gap-2">
                {acrcloud?.configured && acrcloud.enabled ? (
                  <CheckCircle2 size={12} className="text-green" />
                ) : (
                  <AlertTriangle size={12} className="text-yellow" />
                )}
                <span className="text-muted">ACRCloud</span>
                <span className="ml-auto min-w-0 truncate text-fg">
                  {acrcloud?.configured && acrcloud.enabled
                    ? `已启用 · 今日 ${acrcloud.callsToday} 次`
                    : '未启用'}
                </span>
                <button
                  type="button"
                  onClick={() => onOpenTab('models')}
                  className="shrink-0 text-[10.5px] text-blue hover:underline"
                >
                  配置
                </button>
              </div>
            </div>
          </section>

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line/70 bg-panel/40">
            <div className="flex flex-none items-center gap-2 border-b border-line/60 px-3 py-2">
              <span className="text-[12px] font-medium text-fg">待审核</span>
              <span className="rounded bg-yellow/15 px-1.5 py-0.5 font-mono text-[9.5px] text-yellow">
                {stats?.pendingTags ?? 0}
              </span>
              <button
                type="button"
                onClick={() => onOpenTab('review')}
                className="ml-auto inline-flex items-center gap-0.5 text-[10.5px] text-blue hover:underline"
              >
                去审核
                <ChevronRight size={10} />
              </button>
            </div>
            {pendingItems.length > 0 ? (
              <>
                <div className="scroll-thin scroll-stable min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                  {pendingItems.map((item) => {
                    const count = item.aiTags.filter((tag) => tag.status === 'pending').length;
                    return (
                      <button
                        key={item.runId}
                        type="button"
                        onClick={() => openAiReview(item.videoId)}
                        className="group flex w-full items-center gap-2 rounded-lg border border-transparent px-1.5 py-1.5 text-left transition-colors hover:border-line hover:bg-panel2/60"
                      >
                        <div className="h-10 w-[72px] flex-none overflow-hidden rounded border border-line/70 bg-panel3">
                          {item.coverUrl ? (
                            <img
                              src={item.coverUrl}
                              alt=""
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11.5px] text-fg">{item.videoTitle}</div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[9.5px] text-dim">
                            <span className="truncate">{item.upName ?? '未知 UP'}</span>
                            <span>·</span>
                            <span className="shrink-0 text-yellow">{count} 个待审标签</span>
                          </div>
                        </div>
                        <ChevronRight size={11} className="flex-none text-dim group-hover:text-fg" />
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-none items-center gap-2 border-t border-line/60 px-3 py-2 text-[9.5px] text-dim">
                  <span>共 {stats?.pendingTags ?? 0} 个待审标签</span>
                  <span>·</span>
                  <span className="truncate">审核通过后才会进入本地标签</span>
                  <button
                    type="button"
                    onClick={() => onOpenTab('review')}
                    className="ml-auto shrink-0 text-blue hover:underline"
                  >
                    去审核
                  </button>
                </div>
              </>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-panel2 text-green">
                  <CheckCircle2 size={17} />
                </div>
                <div className="text-[12px] text-muted">没有待审核标签</div>
                <div className="text-[10.5px] leading-4 text-dim">
                  打标结果会先停在这里，确认后才进入本地标签。
                </div>
                <Button variant="subtle" size="sm" onClick={onStart}>
                  发起打标
                </Button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
