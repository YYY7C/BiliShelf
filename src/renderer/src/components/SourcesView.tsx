import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  HardDrive,
  Link2,
  Loader2,
  LogIn,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { QualityPreset, RemoteItem, SourceSummary } from '@shared/types';
import { formatDuration, formatRelative, shorten } from '../lib/format';
import { api } from '../lib/bridge';
import { useUi } from '../lib/store';
import { Button, Chip, IconButton, Select, Tag, TextInput } from './ui';

interface SourcesViewProps {
  sources: SourceSummary[];
  activeSourceId: number | null;
  onSelectSource: (id: number | null) => void;
  loggedIn: boolean;
  engineReady: boolean;
  defaultQuality: QualityPreset;
  onLogin: () => void;
  onChanged: () => void;
}

const KIND_LABEL: Record<string, string> = {
  favorite: '收藏夹',
  watch_later: '稍后再看',
  space: 'UP 主投稿',
  collection: '合集',
  manual: '手动'
};

const QUALITY_OPTIONS: Array<{ value: QualityPreset; label: string }> = [
  { value: 'best', label: '最高画质（4K+）' },
  { value: 'compat', label: '1080P 兼容优先' },
  { value: '720', label: '720P 省空间' },
  { value: 'audio', label: '仅音频' }
];

const JOB_LABEL: Record<string, string> = {
  queued: '排队中',
  resolving: '解析中',
  downloading: '下载中',
  postprocessing: '处理中',
  done: '已完成',
  failed: '失败',
  paused: '已暂停',
  canceled: '已取消'
};

export function SourcesView({
  sources,
  activeSourceId,
  onSelectSource,
  loggedIn,
  engineReady,
  defaultQuality,
  onLogin,
  onChanged
}: SourcesViewProps) {
  const pushToast = useUi((state) => state.pushToast);
  const sourcesVersion = useUi((state) => state.sourcesVersion);
  const [items, setItems] = useState<RemoteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [onlyUndownloaded, setOnlyUndownloaded] = useState(false);
  const [onlyUnavailable, setOnlyUnavailable] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [quality, setQuality] = useState<QualityPreset>(defaultQuality);
  const [addOpen, setAddOpen] = useState(false);
  const [addKind, setAddKind] = useState<'space' | 'collection'>('space');
  const [addUrl, setAddUrl] = useState('');

  useEffect(() => {
    setQuality(defaultQuality);
  }, [defaultQuality]);

  const activeSource = useMemo(
    () => sources.find((source) => source.id === activeSourceId) ?? null,
    [sources, activeSourceId]
  );

  const load = useCallback(async () => {
    if (!activeSourceId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const result = await api.sources.items({
        sourceId: activeSourceId,
        search: search.trim() || undefined,
        onlyUndownloaded,
        onlyUnavailable,
        limit: 500
      });
      setItems(result.items);
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeSourceId, search, onlyUndownloaded, onlyUnavailable, pushToast, sourcesVersion]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelected([]);
  }, [activeSourceId, search, onlyUndownloaded, onlyUnavailable]);

  const addFavorite = async () => {
    try {
      const next = await api.sources.add({ kind: 'favorite' });
      pushToast('success', `已读取 ${next.length} 个来源`);
      onChanged();
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const addWatchLater = async () => {
    try {
      await api.sources.add({ kind: 'watch_later' });
      pushToast('success', '已添加「稍后再看」');
      onChanged();
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const addUrlSource = async () => {
    try {
      if (!addUrl.trim()) throw new Error('请输入链接');
      await api.sources.add({ kind: addKind, url: addUrl.trim() });
      pushToast('success', '已添加来源');
      setAddOpen(false);
      setAddUrl('');
      onChanged();
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const syncActive = async () => {
    if (!activeSource) return;
    setSyncing(true);
    try {
      const result = await api.sources.sync(activeSource.id);
      pushToast('success', `同步完成：新增 ${result.added}，更新 ${result.updated}，失效 ${result.unavailable}`);
      await load();
      onChanged();
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const syncAll = async () => {
    setSyncing(true);
    try {
      const result = await api.sources.syncAll();
      pushToast('success', `全部同步完成：新增 ${result.added}，更新 ${result.updated}`);
      await load();
      onChanged();
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const enqueue = async () => {
    if (selected.length === 0) return;
    if (!engineReady) {
      pushToast('warn', '下载引擎未就绪，请先在设置中指定 yt-dlp 与 ffmpeg');
      return;
    }
    try {
      const result = await api.sources.enqueue(selected, quality);
      pushToast('success', `已加入队列 ${result.queued} 个，跳过 ${result.skipped} 个`);
      setSelected([]);
      onChanged();
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const toggle = (id: number) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  };

  const removeSource = async (id: number) => {
    try {
      await api.sources.remove(id);
      if (activeSourceId === id) onSelectSource(null);
      onChanged();
      pushToast('info', '已移除来源（不会删除本地文件）');
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  if (!activeSourceId) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line2 px-4 py-3">
          <Button variant="primary" size="sm" onClick={() => void addFavorite()} disabled={!loggedIn}>
            <RefreshCw size={12} />
            拉取我的收藏夹
          </Button>
          <Button variant="subtle" size="sm" onClick={() => void addWatchLater()} disabled={!loggedIn}>
            稍后再看
          </Button>
          <Button variant="subtle" size="sm" onClick={() => setAddOpen((open) => !open)}>
            <Link2 size={12} />
            UP 主 / 合集
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void syncAll()} disabled={!loggedIn || syncing}>
            {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            同步全部
          </Button>
          {!loggedIn ? (
            <Button variant="ghost" size="sm" className="text-blue" onClick={onLogin}>
              <LogIn size={12} />
              登录 B 站
            </Button>
          ) : null}
        </div>

        {addOpen ? (
          <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line2 bg-panel2/40 px-4 py-2">
            <Select
              value={addKind}
              onChange={(value) => setAddKind(value as 'space' | 'collection')}
              options={[
                { value: 'space', label: 'UP 主空间' },
                { value: 'collection', label: '合集 / 系列' }
              ]}
            />
            <TextInput
              value={addUrl}
              onChange={(event) => setAddUrl(event.target.value)}
              placeholder="https://space.bilibili.com/12345/video"
              className="max-w-lg flex-1"
            />
            <Button variant="primary" size="sm" onClick={() => void addUrlSource()}>
              <Plus size={12} />
              添加
            </Button>
          </div>
        ) : null}

        <div className="scroll-thin flex-1 overflow-y-auto p-4">
          {sources.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-panel2 text-dim">
                <HardDrive size={20} />
              </div>
              <div>
                <div className="text-[14px] font-medium text-fg">还没有来源</div>
                <p className="mt-1 max-w-md text-[12px] leading-5 text-dim">
                  登录后点「拉取我的收藏夹」，应用只会读取列表与元数据，不会自动下载。
                  你也可以添加 UP 主或合集链接。
                </p>
              </div>
              {!loggedIn ? (
                <Button variant="primary" size="sm" onClick={onLogin}>
                  <LogIn size={13} />
                  登录 B 站
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-3">
              {sources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => onSelectSource(source.id)}
                  className="group flex flex-col rounded-xl border border-line/70 bg-panel p-3 text-left transition-colors hover:border-line hover:bg-panel2"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-pink/12 text-pink">
                      {source.kind === 'watch_later' ? <Star size={13} /> : <HardDrive size={13} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-fg">{source.title}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-dim">
                        <Tag tone="pink">{KIND_LABEL[source.kind] ?? source.kind}</Tag>
                        <span>{source.lastSyncedAt ? formatRelative(source.lastSyncedAt) : '尚未同步'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-1 text-center">
                    <div>
                      <div className="font-mono text-[13px] text-fg">{source.itemCount}</div>
                      <div className="text-[10px] text-dim">条目</div>
                    </div>
                    <div>
                      <div className="font-mono text-[13px] text-green">{source.downloadedCount}</div>
                      <div className="text-[10px] text-dim">已下载</div>
                    </div>
                    <div>
                      <div className="font-mono text-[13px] text-red">{source.unavailableCount}</div>
                      <div className="text-[10px] text-dim">失效</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line2 px-4 py-2.5">
        <IconButton label="返回来源列表" onClick={() => onSelectSource(null)}>
          <ArrowLeft size={15} />
        </IconButton>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-fg">{activeSource?.title}</div>
          <div className="text-[10.5px] text-dim">
            {activeSource ? `${KIND_LABEL[activeSource.kind]} · ${activeSource.itemCount} 条 · ${activeSource.lastSyncedAt ? formatRelative(activeSource.lastSyncedAt) : '尚未同步'}` : ''}
          </div>
        </div>

        <div className="relative ml-auto w-56">
          <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-dim" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="过滤标题 / UP"
            className="h-7 w-full rounded-md border border-line bg-panel2 pl-7 pr-2 text-[11.5px] text-fg placeholder:text-dim focus:border-blue/40 focus:outline-none"
          />
        </div>
        <Chip active={onlyUndownloaded} onClick={() => setOnlyUndownloaded((value) => !value)} tone="blue">
          仅未下载
        </Chip>
        <Chip active={onlyUnavailable} onClick={() => setOnlyUnavailable((value) => !value)} tone="red">
          仅失效
        </Chip>
        <Button variant="subtle" size="sm" onClick={() => void syncActive()} disabled={syncing}>
          {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          同步
        </Button>
        <IconButton label="移除来源" onClick={() => (activeSource ? void removeSource(activeSource.id) : undefined)}>
          <Trash2 size={14} />
        </IconButton>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-[12px] text-dim">
            <Loader2 size={14} className="animate-spin" />
            读取清单…
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-[12px] text-dim">
            <div>还没有条目，点右上角「同步」拉取列表。</div>
            <div className="text-[11px]">同步只读取列表与元数据，不会开始下载。</div>
          </div>
        ) : (
          <ul className="divide-y divide-line2">
            {items.map((item) => {
              const checked = selected.includes(item.id);
              const disabled = item.state === 'unavailable' || Boolean(item.downloadedVideoId);
              return (
                <li
                  key={item.id}
                  className={clsx(
                    'flex items-center gap-3 px-4 py-2 transition-colors hover:bg-panel2/50',
                    checked && 'bg-pink/[0.05]'
                  )}
                >
                  <button
                    type="button"
                    aria-label="选择"
                    onClick={() => toggle(item.id)}
                    disabled={disabled}
                    className={clsx(
                      'flex h-4 w-4 flex-none items-center justify-center rounded border transition-colors',
                      checked
                        ? 'border-pink bg-pink text-white'
                        : disabled
                          ? 'border-line/50 bg-panel3 text-transparent'
                          : 'border-line bg-panel2 text-transparent hover:border-pink/60'
                    )}
                  >
                    <CheckCircle2 size={10} />
                  </button>

                  <div className="relative h-10 w-[71px] flex-none overflow-hidden rounded bg-panel3">
                    {item.coverUrl ? (
                      <img src={item.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : null}
                    <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 font-mono text-[9px] text-white/90">
                      {formatDuration(item.duration)}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] text-fg/90" title={item.title}>
                      {shorten(item.title, 90)}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-dim">
                      <span className="truncate">{item.upName ?? '—'}</span>
                      <span>·</span>
                      <span>{item.favTime ? formatRelative(item.favTime) : item.pubTime ? formatRelative(item.pubTime) : '—'}</span>
                      {item.state === 'unavailable' ? (
                        <Tag tone="red">
                          <AlertTriangle size={9} />
                          已失效
                        </Tag>
                      ) : null}
                      {item.downloadedVideoId ? <Tag tone="green">已下载</Tag> : null}
                      {item.jobStatus && !item.downloadedVideoId ? (
                        <Tag tone="yellow">{JOB_LABEL[item.jobStatus] ?? item.jobStatus}</Tag>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-none items-center gap-1">
                    {item.tags.slice(0, 2).map((tag) => (
                      <span key={tag} className="hidden rounded bg-panel3 px-1 text-[10px] text-muted lg:inline">
                        {tag}
                      </span>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-none flex-wrap items-center gap-2 border-t border-line2 bg-panel/60 px-4 py-2">
        <span className="text-[11.5px] text-muted">
          已选 <span className="font-mono text-pink">{selected.length}</span> / {items.length}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={quality}
            onChange={(value) => setQuality(value as QualityPreset)}
            options={QUALITY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          />
          <Button variant="primary" size="sm" onClick={() => void enqueue()} disabled={selected.length === 0}>
            <Download size={12} />
            加入下载队列
          </Button>
        </div>
      </div>
    </div>
  );
}
