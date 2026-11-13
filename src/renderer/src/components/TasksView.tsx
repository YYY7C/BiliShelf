import clsx from 'clsx';
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Clock,
  Download,
  FolderOpen,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X
} from 'lucide-react';
import type { DownloadJob } from '@shared/types';
import { formatEta, formatRelative, formatSpeed } from '../lib/format';
import { api } from '../lib/bridge';
import { useUi } from '../lib/store';
import { Button, IconButton, ProgressBar, Tag } from './ui';

interface TasksViewProps {
  jobs: DownloadJob[];
  engineReady: boolean;
  onRefresh: () => void;
}

const STATUS_META: Record<
  string,
  { label: string; tone: 'pink' | 'blue' | 'green' | 'yellow' | 'red' | 'default' }
> = {
  queued: { label: '排队中', tone: 'default' },
  resolving: { label: '解析中', tone: 'blue' },
  downloading: { label: '下载中', tone: 'pink' },
  postprocessing: { label: '处理中', tone: 'blue' },
  done: { label: '已完成', tone: 'green' },
  failed: { label: '失败', tone: 'red' },
  paused: { label: '已暂停', tone: 'yellow' },
  canceled: { label: '已取消', tone: 'default' }
};

function StatusIcon({ status }: { status: string }) {
  if (status === 'downloading' || status === 'resolving' || status === 'postprocessing') {
    return <Loader2 size={13} className="animate-spin text-pink" />;
  }
  if (status === 'done') return <CheckCircle2 size={13} className="text-green" />;
  if (status === 'failed') return <AlertTriangle size={13} className="text-red" />;
  if (status === 'paused') return <Pause size={13} className="text-yellow" />;
  if (status === 'canceled') return <CircleSlash size={13} className="text-dim" />;
  return <Clock size={13} className="text-dim" />;
}

export function TasksView({ jobs, engineReady, onRefresh }: TasksViewProps) {
  const pushToast = useUi((state) => state.pushToast);
  const patchFilters = useUi((state) => state.patchFilters);
  const setView = useUi((state) => state.setView);

  const active = jobs.filter((job) => ['downloading', 'postprocessing', 'resolving'].includes(job.status));
  const queued = jobs.filter((job) => job.status === 'queued');
  const finished = jobs.filter((job) => ['done', 'failed', 'canceled', 'paused'].includes(job.status));

  const act = async (fn: () => Promise<unknown>, message?: string) => {
    try {
      await fn();
      onRefresh();
      if (message) pushToast('success', message);
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const groups: Array<{ title: string; hint: string; items: DownloadJob[] }> = [
    { title: '进行中', hint: '同一时间按设置的并发数执行', items: active },
    { title: '队列', hint: '等待中的任务', items: queued },
    { title: '已结束', hint: '完成 / 失败 / 暂停', items: finished }
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-line2 px-4 py-2.5">
        <div className="text-[11.5px] text-dim">
          共 {jobs.length} 个任务 · 进行中 {active.length} · 排队 {queued.length}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={onRefresh}>
            <RotateCcw size={12} />
            刷新
          </Button>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => void act(() => api.jobs.clear(), '已清理已完成/失败/取消的任务')}
          >
            <Trash2 size={12} />
            清理已结束
          </Button>
        </div>
      </div>

      {!engineReady ? (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-yellow/30 bg-yellow/10 px-3 py-2 text-[11.5px] leading-5 text-yellow">
          <AlertTriangle size={13} className="mt-0.5 flex-none" />
          <span>下载引擎未就绪：请到「设置 → 引擎」指定 yt-dlp 与 ffmpeg 的可执行文件路径。</span>
        </div>
      ) : null}

      <div className="scroll-thin flex-1 overflow-y-auto px-4 py-3">
        {jobs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-panel2 text-dim">
              <Download size={20} />
            </div>
            <div>
              <div className="text-[14px] font-medium text-fg">没有下载任务</div>
              <p className="mt-1 max-w-md text-[12px] leading-5 text-dim">
                在「来源清单」勾选条目后加入队列；任务会持久化，应用崩溃后仍可恢复。
              </p>
            </div>
          </div>
        ) : (
          groups.map((group) =>
            group.items.length === 0 ? null : (
              <section key={group.title} className="mb-5">
                <div className="mb-2 flex items-baseline gap-2">
                  <h3 className="text-[12.5px] font-medium text-fg">{group.title}</h3>
                  <span className="text-[10.5px] text-dim">{group.hint}</span>
                  <span className="ml-auto font-mono text-[10.5px] text-dim">{group.items.length}</span>
                </div>
                <ul className="space-y-1.5">
                  {group.items.map((job) => {
                    const meta = STATUS_META[job.status] ?? { label: job.status, tone: 'default' as const };
                    const running = ['downloading', 'postprocessing', 'resolving'].includes(job.status);
                    return (
                      <li
                        key={job.id}
                        className={clsx(
                          'rounded-xl border px-3 py-2 transition-colors',
                          job.status === 'failed'
                            ? 'border-red/25 bg-red/[0.04]'
                            : 'border-line/70 bg-panel hover:bg-panel2/70'
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <StatusIcon status={job.status} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12.5px] text-fg/90" title={job.title}>
                              {job.title}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-dim">
                              <Tag tone={meta.tone}>{meta.label}</Tag>
                              {job.sourceName ? <span className="truncate">{job.sourceName}</span> : null}
                              <span>·</span>
                              <span>{job.quality === 'audio' ? '仅音频' : job.quality.toUpperCase()}</span>
                              <span>·</span>
                              <span>{formatRelative(job.createdAt)}</span>
                            </div>
                          </div>

                          <div className="flex flex-none items-center gap-1">
                            {job.status === 'done' ? (
                              <IconButton
                                label="在素材库中查看"
                                onClick={() => {
                                  patchFilters({
                                    search: job.bvid,
                                    status: 'all',
                                    tag: null,
                                    folder: null,
                                    sourceId: null
                                  });
                                  setView('library');
                                }}
                              >
                                <FolderOpen size={13} />
                              </IconButton>
                            ) : null}
                            {running ? (
                              <IconButton label="暂停" onClick={() => void act(() => api.jobs.pause(job.id))}>
                                <Pause size={13} />
                              </IconButton>
                            ) : null}
                            {job.status === 'paused' || job.status === 'queued' ? (
                              <IconButton label="继续" onClick={() => void act(() => api.jobs.resume(job.id))}>
                                <Play size={13} />
                              </IconButton>
                            ) : null}
                            {job.status === 'failed' || job.status === 'canceled' ? (
                              <IconButton label="重试" onClick={() => void act(() => api.jobs.retry(job.id))}>
                                <RotateCcw size={13} />
                              </IconButton>
                            ) : null}
                            {running || job.status === 'queued' || job.status === 'paused' ? (
                              <IconButton label="取消" onClick={() => void act(() => api.jobs.cancel(job.id))}>
                                <X size={13} />
                              </IconButton>
                            ) : null}
                          </div>
                        </div>

                        {running || job.status === 'paused' ? (
                          <div className="mt-2 flex items-center gap-2">
                            <ProgressBar value={job.progress} className="h-1" />
                            <span className="w-24 flex-none text-right font-mono text-[10px] text-dim">
                              {Math.round(job.progress * 100)}%
                              {job.speed ? ` · ${formatSpeed(job.speed)}` : ''}
                              {job.eta ? ` · ${formatEta(job.eta)}` : ''}
                            </span>
                          </div>
                        ) : null}

                        {job.status === 'failed' && job.errorMessage ? (
                          <div className="mt-1.5 rounded-lg border border-red/20 bg-red/[0.06] px-2 py-1 text-[11px] leading-4 text-red/90">
                            {job.errorCode ? <span className="mr-1 font-mono text-[10px] opacity-70">{job.errorCode}</span> : null}
                            {job.errorMessage}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )
          )
        )}
      </div>
    </div>
  );
}
