import clsx from 'clsx';
import { Ban, ListChecks, Pause, Play, RefreshCw, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { AiBatch, AiProgress, AiQueueSnapshot, AiRunDetail, AiRunSummary } from '@shared/types';
import { api } from '../../lib/bridge';
import { useUi } from '../../lib/store';
import { AI_STAGE_LABEL, formatTokens } from '../../lib/ai';
import { formatRelative } from '../../lib/format';
import { Button, Modal } from '../ui';
import { AiFrameStrip } from './AiFrameStrip';

interface AiQueueViewProps {
  onStart: () => void;
}

const BATCH_STATUS_LABEL: Record<AiBatch['status'], string> = {
  queued: '排队中',
  running: '运行中',
  paused: '已暂停',
  done: '完成',
  canceled: '已取消'
};

const RUN_STATUS_LABEL: Record<AiRunSummary['status'], string> = {
  queued: '排队中',
  running: '运行中',
  done: '完成',
  failed: '失败',
  canceled: '已取消'
};

function statusClass(status: string): string {
  if (status === 'done') return 'border-green/30 bg-green/10 text-green';
  if (status === 'running') return 'border-blue/30 bg-blue/10 text-blue';
  if (status === 'failed') return 'border-red/30 bg-red/10 text-red';
  if (status === 'paused') return 'border-yellow/30 bg-yellow/10 text-yellow';
  return 'border-line bg-panel2 text-dim';
}

export function AiQueueView({ onStart }: AiQueueViewProps) {
  const pushToast = useUi((state) => state.pushToast);
  const [queue, setQueue] = useState<AiQueueSnapshot | null>(null);
  const [runs, setRuns] = useState<AiRunSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedBatch, setSelectedBatch] = useState<number | null>(null);
  const [detail, setDetail] = useState<AiRunDetail | null>(null);
  const [progress, setProgress] = useState<AiProgress | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [nextQueue, nextRuns] = await Promise.all([
        api.ai.queue.batches(),
        api.ai.queue.runs({ batchId: selectedBatch ?? undefined, limit: 100 })
      ]);
      setQueue(nextQueue);
      setRuns(nextRuns.items);
      setTotal(nextRuns.total);
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  }, [pushToast, selectedBatch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const offQueue = api.ai.queue.onQueue((snapshot) => setQueue(snapshot));
    const offProgress = api.ai.queue.onProgress((next) => setProgress(next));
    return () => {
      offQueue();
      offProgress();
    };
  }, []);

  useEffect(() => {
    if (!progress) return;
    const timer = window.setTimeout(() => void refresh(), 500);
    return () => window.clearTimeout(timer);
  }, [progress, refresh]);

  const action = async (fn: () => Promise<void>, message: string) => {
    setBusy(true);
    try {
      await fn();
      pushToast('success', message);
      await refresh();
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (runId: number) => {
    try {
      setDetail(await api.ai.queue.getRun(runId));
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line2 px-4 py-2.5">
        <div className="text-[12.5px] font-medium text-fg">打标任务</div>
        <span className="text-[10.5px] text-dim">
          {queue?.running ?? 0} 个运行中 · {queue?.pendingReview ?? 0} 个待审核标签
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="subtle" onClick={() => void refresh()}>
            <RefreshCw size={11} />
            刷新
          </Button>
          <Button size="sm" variant="primary" onClick={onStart}>
            <Play size={11} />
            开始打标
          </Button>
        </div>
      </div>

      {progress ? (
        <div className="flex flex-none items-center gap-2 border-b border-blue/20 bg-blue/[0.05] px-4 py-1.5 text-[11px] text-blue">
          <span className="font-mono text-[10px]">#{progress.runId}</span>
          <span className="min-w-0 flex-1 truncate">{progress.title}</span>
          <span className="shrink-0 text-blue/80">{AI_STAGE_LABEL[progress.stage]}</span>
          <div className="h-1 w-28 shrink-0 overflow-hidden rounded bg-blue/15">
            <div className="h-full w-2/3 animate-pulse bg-blue" />
          </div>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-3 p-4 lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line/70 bg-panel/35">
          <div className="flex flex-none items-center gap-2 border-b border-line/60 px-3 py-2">
            <span className="text-[12px] font-medium text-fg">批次</span>
            <span className="font-mono text-[10px] text-dim">{queue?.batches.length ?? 0}</span>
            <span className="ml-auto text-[10px] text-dim">点击批次筛选右侧记录</span>
          </div>
          {queue?.batches.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-panel2 text-dim">
                <ListChecks size={17} />
              </div>
              <div className="text-[12px] text-muted">还没有批次</div>
              <div className="text-[10.5px] leading-4 text-dim">
                发起第一轮打标后，批次和运行记录会出现在这里。
              </div>
              <Button size="sm" variant="primary" onClick={onStart}>
                <Play size={11} />
                开始打标
              </Button>
            </div>
          ) : (
            <div className="scroll-thin scroll-stable min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
              {(queue?.batches ?? []).map((batch) => (
                <div
                  key={batch.id}
                  className={clsx(
                    'rounded-lg border px-2.5 py-2 transition-colors',
                    selectedBatch === batch.id
                      ? 'border-pink/35 bg-pink/[0.04]'
                      : 'border-line/60 bg-panel2/35 hover:border-line'
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSelectedBatch(selectedBatch === batch.id ? null : batch.id)}
                      className="font-mono text-[10px] text-dim hover:text-fg"
                    >
                      #{batch.id}
                    </button>
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-fg">
                      {batch.profileName ?? '未记录方案'}
                    </span>
                    <span
                      className={clsx(
                        'shrink-0 rounded border px-1.5 py-0.5 text-[9.5px]',
                        statusClass(batch.status)
                      )}
                    >
                      {BATCH_STATUS_LABEL[batch.status]}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[9.5px] text-dim">
                    <span className="min-w-0 flex-1 truncate">{batch.model ?? '未记录模型'}</span>
                    <span className="shrink-0">{batch.requestCount} 请求</span>
                    {batch.musicRequestCount > 0 ? (
                      <span className="shrink-0">ACR {batch.musicRequestCount}</span>
                    ) : null}
                    <span className="shrink-0">{formatRelative(batch.createdAt)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1 min-w-0 flex-1 overflow-hidden rounded bg-panel3">
                      <div
                        className="h-full bg-blue transition-all"
                        style={{ width: `${Math.min(100, (batch.done / Math.max(batch.total, 1)) * 100)}%` }}
                      />
                    </div>
                    <span className="shrink-0 font-mono text-[9.5px] text-dim">
                      {batch.done}/{batch.total}
                      {batch.failed > 0 ? ` · ${batch.failed} 失败` : ''}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-0.5">
                    {batch.status === 'running' || batch.status === 'queued' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        className="h-6 px-1.5 text-[10px]"
                        onClick={() => void action(() => api.ai.queue.pause(batch.id), '已暂停')}
                      >
                        <Pause size={10} />
                        暂停
                      </Button>
                    ) : null}
                    {batch.status === 'paused' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        className="h-6 px-1.5 text-[10px]"
                        onClick={() => void action(() => api.ai.queue.resume(batch.id), '已继续')}
                      >
                        <Play size={10} />
                        继续
                      </Button>
                    ) : null}
                    {batch.failed > 0 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        className="h-6 px-1.5 text-[10px]"
                        onClick={() => void action(() => api.ai.queue.retryFailed(batch.id), '已重试失败项')}
                      >
                        <RotateCcw size={10} />
                        重试失败
                      </Button>
                    ) : null}
                    {batch.status !== 'done' && batch.status !== 'canceled' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        className="h-6 px-1.5 text-[10px]"
                        onClick={() => void action(() => api.ai.queue.cancel(batch.id), '已取消')}
                      >
                        <Ban size={10} />
                        取消
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line/70 bg-panel/35">
          <div className="flex flex-none items-center gap-2 border-b border-line/60 px-3 py-2">
            <span className="text-[12px] font-medium text-fg">运行记录</span>
            <span className="text-[10.5px] text-dim">
              {selectedBatch ? `批次 #${selectedBatch}` : '全部'} · {total} 条
            </span>
            {selectedBatch ? (
              <button
                type="button"
                onClick={() => setSelectedBatch(null)}
                className="inline-flex items-center gap-1 text-[10.5px] text-dim hover:text-fg"
              >
                <X size={10} />
                清除筛选
              </button>
            ) : null}
            <span className="ml-auto text-[10px] text-dim">点击记录查看抽帧、提示词与原始响应</span>
          </div>
          {runs.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
              <div className="text-[12px] text-muted">还没有运行记录</div>
              <div className="text-[10.5px] leading-4 text-dim">
                选择左侧批次可以过滤；完成的任务会在这里保留。
              </div>
            </div>
          ) : (
            <div className="scroll-thin scroll-stable min-h-0 flex-1 divide-y divide-line/50 overflow-y-auto">
              {runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => void openDetail(run.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-panel2/60"
                >
                  <div className="h-8 w-14 flex-none overflow-hidden rounded border border-line/60 bg-panel3">
                    {run.coverUrl ? (
                      <img src={run.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[11.5px] text-muted">{run.videoTitle}</span>
                      <span
                        className={clsx(
                          'shrink-0 rounded border px-1 py-0.5 text-[9px]',
                          statusClass(run.status)
                        )}
                      >
                        {RUN_STATUS_LABEL[run.status]}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[9.5px] text-dim">
                      <span className="font-mono">#{run.id}</span>
                      {run.batchId ? <span className="font-mono">· 批次 #{run.batchId}</span> : null}
                      <span>·</span>
                      <span className="truncate">{run.model ?? '未记录模型'}</span>
                      <span className="shrink-0">· {run.requestCount} 请求</span>
                      {run.musicRequestCount > 0 ? (
                        <span className="shrink-0">· ACR {run.musicRequestCount}</span>
                      ) : null}
                      <span className="shrink-0">· {formatRelative(run.createdAt)}</span>
                    </div>
                    {run.error ? (
                      <div className="mt-0.5 truncate text-[9.5px] text-red" title={run.error}>
                        {run.error}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex w-20 flex-none flex-col items-end gap-0.5 text-[9.5px] text-dim">
                    {run.stage ? <span>{AI_STAGE_LABEL[run.stage]}</span> : null}
                    <span className="font-mono">
                      {formatTokens(run.inputTokens)}/{formatTokens(run.outputTokens)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {detail ? (
        <Modal
          title={`运行 #${detail.id} · ${detail.videoTitle}`}
          subtitle={`${detail.status} · ${detail.model ?? ''}`}
          onClose={() => setDetail(null)}
          width="max-w-3xl"
        >
          <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
            {detail.frames.length > 0 ? (
              <div>
                <div className="mb-1 text-[11px] text-dim">抽帧</div>
                <AiFrameStrip frames={detail.frames} />
              </div>
            ) : null}
            {detail.error ? (
              <div className="rounded-lg border border-red/30 bg-red/[0.06] px-3 py-2 text-[11.5px] text-red">
                {detail.error}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2 text-[10.5px] text-dim">
              <div className="rounded-lg border border-line/60 bg-panel2/40 px-2 py-1.5">
                tokens：{formatTokens(detail.inputTokens)} in / {formatTokens(detail.outputTokens)} out
              </div>
              <div className="rounded-lg border border-line/60 bg-panel2/40 px-2 py-1.5">
                模型请求：{detail.requestCount} 次
              </div>
              <div className="rounded-lg border border-line/60 bg-panel2/40 px-2 py-1.5">
                ACRCloud：{detail.musicRequestCount} 次
              </div>
              <div className="rounded-lg border border-line/60 bg-panel2/40 px-2 py-1.5">
                工具调用：{detail.toolCalls.length} 次
              </div>
            </div>
            {detail.systemPrompt ? (
              <details className="rounded-lg border border-line/60 bg-panel2/40 px-3 py-2">
                <summary className="cursor-pointer text-[11.5px] text-muted">系统提示词</summary>
                <pre className="scroll-thin mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-4 text-dim">
                  {detail.systemPrompt}
                </pre>
              </details>
            ) : null}
            {detail.userPrompt ? (
              <details className="rounded-lg border border-line/60 bg-panel2/40 px-3 py-2">
                <summary className="cursor-pointer text-[11.5px] text-muted">用户提示词</summary>
                <pre className="scroll-thin mt-1 max-h-56 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-4 text-dim">
                  {detail.userPrompt}
                </pre>
              </details>
            ) : null}
            {detail.toolCalls.length > 0 ? (
              <details className="rounded-lg border border-line/60 bg-panel2/40 px-3 py-2">
                <summary className="cursor-pointer text-[11.5px] text-muted">工具调用</summary>
                <pre className="scroll-thin mt-1 max-h-56 overflow-auto font-mono text-[10px] leading-4 text-dim">
                  {JSON.stringify(detail.toolCalls, null, 2)}
                </pre>
              </details>
            ) : null}
            {detail.rawResponse ? (
              <details className="rounded-lg border border-line/60 bg-panel2/40 px-3 py-2">
                <summary className="cursor-pointer text-[11.5px] text-muted">原始响应</summary>
                <pre className="scroll-thin mt-1 max-h-56 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-4 text-dim">
                  {detail.rawResponse}
                </pre>
              </details>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
