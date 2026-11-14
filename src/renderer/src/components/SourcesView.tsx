import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  HardDrive,
  Inbox,
  LayoutGrid,
  Link2,
  List,
  Loader2,
  LogIn,
  Plus,
  RefreshCw,
  Search,
  Star,
  StickyNote,
  Trash2
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { QualityPreset, RemoteItem, SourcePatch, SourceSummary, SyncProgress } from '@shared/types';
import {
  codecLabel,
  formatBytes,
  formatCount,
  formatDateTime,
  formatDuration,
  formatExact,
  formatRelative,
  resolutionLabel,
  shorten
} from '../lib/format';
import { api } from '../lib/bridge';
import { useUi } from '../lib/store';
import { Button, Chip, IconButton, Modal, Select, Tag, TextInput } from './ui';

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

type ViewLayout = 'grid' | 'list';

const PAGE_SIZE = 120;

function sourceLink(source: SourceSummary): string | null {
  if (source.kind === 'favorite') {
    return source.ownerMid
      ? `https://space.bilibili.com/${source.ownerMid}/favlist?fid=${encodeURIComponent(source.remoteId)}`
      : `https://www.bilibili.com/medialist/detail/ml${encodeURIComponent(source.remoteId)}`;
  }
  if (source.kind === 'watch_later') return 'https://www.bilibili.com/watchlater/';
  if (source.kind === 'space' || source.kind === 'collection') {
    return /^https?:\/\//i.test(source.remoteId) ? source.remoteId : null;
  }
  return null;
}

function sourceSubtitle(source: SourceSummary): string {
  if (source.kind === 'favorite') {
    return `收藏夹 ID ${source.remoteId}${source.ownerMid ? ` · UP ${source.ownerMid}` : ''}`;
  }
  if (source.kind === 'watch_later') return '当前账号的稍后再看';
  if (source.kind === 'space') return `UP 主${source.ownerMid ? ` · UID ${source.ownerMid}` : ''}`;
  if (source.kind === 'collection') return `合集 · ${source.remoteId}`;
  return source.remoteId;
}

function MiniSwitch({
  checked,
  onChange,
  title
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
      className={clsx(
        'relative h-4 w-7 flex-none rounded-full border transition-colors',
        checked ? 'border-pink/50 bg-pink/70' : 'border-line bg-panel3'
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all',
          checked ? 'left-[14px]' : 'left-0.5'
        )}
      />
    </button>
  );
}

function CountStat({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'red' }) {
  return (
    <div className="min-w-0">
      <div
        title={formatExact(value)}
        className={clsx(
          'truncate font-mono text-[12px]',
          tone === 'green' ? 'text-green' : tone === 'red' ? 'text-red' : 'text-fg'
        )}
      >
        {formatCount(value)}
      </div>
      <div className="text-[9.5px] text-dim">{label}</div>
    </div>
  );
}

function FormatBadges({ item }: { item: RemoteItem }) {
  if (!item.downloadedVideoId) return null;
  const measured = resolutionLabel(item.width, item.height);
  const resolution = measured !== '—' ? measured : item.qualityLabel;
  return (
    <>
      {resolution && resolution !== '—' ? <Tag tone="blue">{resolution}</Tag> : null}
      {item.vcodec ? <Tag>{codecLabel(item.vcodec)}</Tag> : null}
      {item.fileSize ? <Tag>{formatBytes(item.fileSize)}</Tag> : null}
    </>
  );
}

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
  const [items, setItems] = useState<RemoteItem[]>([]);
  const itemsRef = useRef<RemoteItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [onlyUndownloaded, setOnlyUndownloaded] = useState(false);
  const [onlyUnavailable, setOnlyUnavailable] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [quality, setQuality] = useState<QualityPreset>(defaultQuality);
  const [addOpen, setAddOpen] = useState(false);
  const [addKind, setAddKind] = useState<'space' | 'collection'>('space');
  const [addUrl, setAddUrl] = useState('');
  const [sourceLayout, setSourceLayout] = useState<ViewLayout>(() =>
    localStorage.getItem('bilishelf-sources-layout') === 'list' ? 'list' : 'grid'
  );
  const [itemLayout, setItemLayout] = useState<ViewLayout>(() =>
    localStorage.getItem('bilishelf-source-items-layout') === 'list' ? 'list' : 'grid'
  );
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const noteCancelRef = useRef(false);
  const [pendingSourceId, setPendingSourceId] = useState<number | null>(null);
  const [removeTarget, setRemoveTarget] = useState<SourceSummary | null>(null);
  const [downloadAll, setDownloadAll] = useState<{
    scope: 'source' | 'favorites';
    sourceId?: number;
    title: string;
    eligible: number;
  } | null>(null);
  const [enqueueingAll, setEnqueueingAll] = useState(false);

  const changeSourceLayout = (next: ViewLayout) => {
    setSourceLayout(next);
    localStorage.setItem('bilishelf-sources-layout', next);
  };

  const changeItemLayout = (next: ViewLayout) => {
    setItemLayout(next);
    localStorage.setItem('bilishelf-source-items-layout', next);
  };

  useEffect(() => {
    setQuality(defaultQuality);
  }, [defaultQuality]);

  const activeSource = useMemo(
    () => sources.find((source) => source.id === activeSourceId) ?? null,
    [sources, activeSourceId]
  );

  const filtered = Boolean(search.trim() || onlyUndownloaded || onlyUnavailable);

  const eligibleOf = (source: SourceSummary) =>
    Math.max(0, source.itemCount - source.downloadedCount - source.unavailableCount);

  const favoriteEligible = useMemo(
    () =>
      sources
        .filter((source) => source.kind === 'favorite')
        .reduce((sum, source) => sum + Math.max(0, source.itemCount - source.downloadedCount - source.unavailableCount), 0),
    [sources]
  );

  // 搜索防抖，避免每敲一个字都拉 120 条清单
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(
    async (mode: 'reset' | 'more' = 'reset') => {
      if (!activeSourceId) {
        itemsRef.current = [];
        setItems([]);
        setTotalItems(0);
        return;
      }
      if (mode === 'reset') setLoading(true);
      else setLoadingMore(true);
      try {
        const result = await api.sources.items({
          sourceId: activeSourceId,
          search: search.trim() || undefined,
          onlyUndownloaded,
          onlyUnavailable,
          limit: PAGE_SIZE,
          offset: mode === 'reset' ? 0 : itemsRef.current.length
        });
        const next = mode === 'reset' ? result.items : [...itemsRef.current, ...result.items];
        itemsRef.current = next;
        setItems(next);
        setTotalItems(result.total);
      } catch (error) {
        pushToast('error', (error as Error).message);
      } finally {
        if (mode === 'reset') setLoading(false);
        else setLoadingMore(false);
      }
    },
    [activeSourceId, search, onlyUndownloaded, onlyUnavailable, pushToast]
  );

  useEffect(() => {
    void load('reset');
  }, [load]);

  useEffect(() => {
    setSelected([]);
  }, [activeSourceId, search, onlyUndownloaded, onlyUnavailable]);

  useEffect(() => {
    return api.events.onSyncProgress((progress) => setSyncProgress(progress));
  }, []);

  useEffect(() => {
    setNoteDraft(null);
    noteCancelRef.current = false;
  }, [activeSourceId]);

  const openSource = (source: SourceSummary) => {
    const link = sourceLink(source);
    if (!link) return;
    void api.app.openExternal(link).catch((error: Error) => pushToast('error', error.message));
  };

  const openVideo = (bvid: string) => {
    void api.app
      .openExternal(`https://www.bilibili.com/video/${encodeURIComponent(bvid)}`)
      .catch((error: Error) => pushToast('error', error.message));
  };

  const patchSource = async (id: number, patch: SourcePatch, message?: string) => {
    setPendingSourceId(id);
    try {
      await api.sources.update(id, patch);
      onChanged();
      if (message) pushToast('success', message);
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setPendingSourceId(null);
    }
  };

  const toggleSync = (source: SourceSummary) => {
    void patchSource(
      source.id,
      { syncEnabled: !source.syncEnabled },
      source.syncEnabled ? '已设为不参与「同步全部」' : '已设为参与「同步全部」'
    );
  };

  const saveNote = async () => {
    if (noteDraft === null) return;
    const draft = noteDraft;
    setNoteDraft(null);
    if (noteCancelRef.current) {
      noteCancelRef.current = false;
      return;
    }
    if (!activeSource) return;
    const next = draft.trim();
    if (next === (activeSource.note ?? '')) return;
    await patchSource(activeSource.id, { note: next || null }, '备注已保存');
  };

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
    setSyncProgress(null);
    try {
      const result = await api.sources.sync(activeSource.id);
      pushToast('success', `同步完成：新增 ${result.added}，更新 ${result.updated}，失效 ${result.unavailable}`);
      await load('reset');
      onChanged();
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  const syncAll = async () => {
    setSyncing(true);
    setSyncProgress(null);
    try {
      const result = await api.sources.syncAll();
      pushToast(
        result.failed > 0 ? 'warn' : 'success',
        `全部同步完成：新增 ${result.added}，更新 ${result.updated}${result.failed > 0 ? `，${result.failed} 个来源失败` : ''}`
      );
      await load('reset');
      onChanged();
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  const cancelSyncing = () => {
    void api.sources.cancelSync().catch(() => undefined);
  };

  const openDownloadAll = async (source?: SourceSummary) => {
    if (!engineReady) {
      pushToast('warn', '下载引擎未就绪，请先在设置中指定 yt-dlp 与 ffmpeg');
      return;
    }
    try {
      // 用与入队完全相同的条件计算数量，避免把回收站 / 跨收藏夹重复算进去
      const preview = await api.sources.enqueuePreview({ sourceId: source?.id ?? null });
      setDownloadAll({
        scope: source ? 'source' : 'favorites',
        sourceId: source?.id,
        title: source?.title ?? '全部收藏夹',
        eligible: preview.total
      });
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const confirmDownloadAll = async () => {
    if (!downloadAll || downloadAll.eligible === 0) return;
    setEnqueueingAll(true);
    try {
      const result = await api.sources.enqueueAll({
        sourceId: downloadAll.scope === 'source' ? downloadAll.sourceId ?? null : null,
        quality: downloadAll.scope === 'source' ? quality : defaultQuality
      });
      pushToast(
        result.queued > 0 ? 'success' : 'info',
        `已加入队列 ${formatCount(result.queued)} 个，跳过 ${formatCount(result.skipped)} 个`
      );
      setDownloadAll(null);
      onChanged();
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setEnqueueingAll(false);
    }
  };

  const removeModal = removeTarget ? (
    <Modal
      title={`移除来源「${removeTarget.title}」`}
      subtitle="只删除来源与清单记录，不会删除已下载的本地文件"
      onClose={() => setRemoveTarget(null)}
      width="max-w-sm"
    >
      <div className="space-y-4">
        <p className="text-[12px] leading-5 text-muted">
          移除后该来源的 {formatCount(removeTarget.itemCount)} 条清单记录会被删除；素材库里已下载的视频仍然保留。
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(null)}>
            取消
          </Button>
          <Button variant="primary" size="sm" onClick={() => void confirmRemove()}>
            确认移除
          </Button>
        </div>
      </div>
    </Modal>
  ) : null;

  const downloadAllModal = downloadAll ? (
    <Modal
      title={downloadAll.scope === 'source' ? `下载「${downloadAll.title}」全部条目` : '下载全部收藏夹'}
      subtitle="只加入下载队列，按设置中的并发数逐个下载"
      onClose={() => {
        if (!enqueueingAll) setDownloadAll(null);
      }}
      width="max-w-md"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-line bg-panel2/60 px-3 py-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] text-muted">待加入队列</span>
            <span className="font-mono text-[20px] font-medium text-fg">
              {formatCount(downloadAll.eligible)}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-dim">
            已下载、已失效和队列中的条目会自动跳过；已暂停的任务会继续。
          </p>
        </div>
        <div className="flex items-center justify-between text-[11.5px]">
          <span className="text-dim">画质</span>
          <span className="text-fg">
            {
              QUALITY_OPTIONS.find(
                (option) => option.value === (downloadAll.scope === 'source' ? quality : defaultQuality)
              )?.label
            }
          </span>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={() => setDownloadAll(null)} disabled={enqueueingAll}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void confirmDownloadAll()}
            disabled={enqueueingAll || downloadAll.eligible === 0}
          >
            {enqueueingAll ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            加入队列
          </Button>
        </div>
      </div>
    </Modal>
  ) : null;

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

  const confirmRemove = async () => {
    if (!removeTarget) return;
    const target = removeTarget;
    setRemoveTarget(null);
    try {
      await api.sources.remove(target.id);
      if (activeSourceId === target.id) onSelectSource(null);
      onChanged();
      pushToast('info', '已移除来源（不会删除本地文件）');
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const syncProgressBar = syncing ? (
    <div className="flex flex-none flex-wrap items-center gap-2 border-t border-line2/60 bg-blue/[0.04] px-4 py-1.5 text-[11px] text-dim">
      <Loader2 size={12} className="animate-spin text-blue" />
      <span className="text-fg">
        {syncProgress
          ? `${syncProgress.title} · ${syncProgress.index}/${syncProgress.total} · 已读取 ${formatCount(syncProgress.items)} 条`
          : '准备同步…'}
      </span>
      <div className="h-1 w-40 overflow-hidden rounded bg-panel3">
        <div
          className="h-full bg-blue transition-all"
          style={{
            width: syncProgress ? `${(syncProgress.index / Math.max(syncProgress.total, 1)) * 100}%` : '4%'
          }}
        />
      </div>
      <Button variant="ghost" size="sm" onClick={cancelSyncing}>
        取消同步
      </Button>
    </div>
  ) : null;

  if (!activeSourceId) {
    return (
      <>
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
          <Button
            variant="subtle"
            size="sm"
            onClick={() => void openDownloadAll()}
            disabled={!engineReady || favoriteEligible === 0}
            title={
              engineReady
                ? '把所有收藏夹里未下载的条目加入队列'
                : '下载引擎未就绪，请先在设置中指定 yt-dlp 与 ffmpeg'
            }
          >
            <Download size={12} />
            下载全部收藏夹
          </Button>
          {!loggedIn ? (
            <Button variant="ghost" size="sm" className="text-blue" onClick={onLogin}>
              <LogIn size={12} />
              登录 B 站
            </Button>
          ) : null}
          <div className="ml-auto flex items-center gap-1 rounded-lg border border-line bg-panel2 px-1">
            <IconButton
              label="卡片视图"
              className={clsx('h-7 w-7', sourceLayout === 'grid' && 'bg-panel3 text-fg')}
              onClick={() => changeSourceLayout('grid')}
            >
              <LayoutGrid size={13} />
            </IconButton>
            <IconButton
              label="表格视图"
              className={clsx('h-7 w-7', sourceLayout === 'list' && 'bg-panel3 text-fg')}
              onClick={() => changeSourceLayout('list')}
            >
              <List size={13} />
            </IconButton>
          </div>
        </div>

        {syncProgressBar}

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
          ) : sourceLayout === 'grid' ? (
            <div className="grid grid-cols-1 gap-2 min-[980px]:grid-cols-2 min-[1400px]:grid-cols-3">
              {sources.map((source) => {
                const link = sourceLink(source);
                return (
                  <div
                    key={source.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectSource(source.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelectSource(source.id);
                      }
                    }}
                    className={clsx(
                      'group flex cursor-pointer flex-col rounded-xl border border-line/70 bg-panel p-3 text-left transition-colors hover:border-line hover:bg-panel2',
                      pendingSourceId === source.id && 'opacity-60'
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="relative h-[54px] w-24 flex-none overflow-hidden rounded-lg bg-panel3">
                        {source.cover ? (
                          <img src={source.cover} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-pink/70">
                            {source.kind === 'watch_later' ? <Star size={16} /> : <HardDrive size={16} />}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-1">
                          <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg" title={source.title}>
                            {source.title}
                          </div>
                          {link ? (
                            <button
                              type="button"
                              title="在 B 站打开来源"
                              aria-label="在 B 站打开来源"
                              onClick={(event) => {
                                event.stopPropagation();
                                openSource(source);
                              }}
                              className="flex h-5 w-5 flex-none items-center justify-center rounded text-dim opacity-0 transition-opacity hover:bg-panel3 hover:text-fg group-hover:opacity-100"
                            >
                              <ExternalLink size={12} />
                            </button>
                          ) : null}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-dim">
                          <Tag tone="pink">{KIND_LABEL[source.kind] ?? source.kind}</Tag>
                          <span title={source.lastSyncedAt ? formatDateTime(source.lastSyncedAt) : '尚未同步'}>
                            {source.lastSyncedAt ? `${formatRelative(source.lastSyncedAt)}同步` : '尚未同步'}
                          </span>
                        </div>
                        <div className="mt-1 truncate text-[10.5px] text-dim/80" title={sourceSubtitle(source)}>
                          {sourceSubtitle(source)}
                        </div>
                        {source.note ? (
                          <div className="mt-1 truncate text-[10.5px] text-muted" title={source.note}>
                            {source.note}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-auto flex items-center gap-2 border-t border-line2/70 pt-2">
                      <div className="grid flex-1 grid-cols-3 gap-1 text-center">
                        <CountStat label="条目" value={source.itemCount} />
                        <CountStat label="已下载" value={source.downloadedCount} tone="green" />
                        <CountStat label="失效" value={source.unavailableCount} tone="red" />
                      </div>
                      <button
                        type="button"
                        title="下载此来源全部条目"
                        aria-label="下载此来源全部条目"
                        onClick={(event) => {
                          event.stopPropagation();
                          void openDownloadAll(source);
                        }}
                        disabled={!engineReady || eligibleOf(source) === 0}
                        className="flex h-6 w-6 flex-none items-center justify-center rounded text-dim transition-colors hover:bg-panel3 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Download size={12} />
                      </button>
                      <Chip
                        active={source.syncEnabled}
                        tone={source.syncEnabled ? 'green' : 'default'}
                        onClick={() => toggleSync(source)}
                        title={
                          source.syncEnabled
                            ? '已参与：点「同步全部」时会同步这个来源'
                            : '已跳过：点「同步全部」时不会同步这个来源'
                        }
                      >
                        {source.syncEnabled ? '参与同步全部' : '已跳过'}
                      </Chip>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[680px] overflow-hidden rounded-xl border border-line/70">
                <div className="grid grid-cols-[minmax(0,1fr)_76px_56px_64px_56px_104px_92px] items-center gap-2 border-b border-line2 bg-panel2/60 px-3 py-2 text-[10.5px] text-dim">
                  <span>来源</span>
                  <span>类型</span>
                  <span className="text-right">条目</span>
                  <span className="text-right">已下载</span>
                  <span className="text-right">失效</span>
                  <span>最近同步</span>
                  <span className="text-right">同步全部</span>
                </div>
                {sources.map((source) => {
                  const link = sourceLink(source);
                  return (
                    <div
                      key={source.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectSource(source.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelectSource(source.id);
                        }
                      }}
                      className={clsx(
                        'grid cursor-pointer grid-cols-[minmax(0,1fr)_76px_56px_64px_56px_104px_92px] items-center gap-2 border-b border-line2/60 px-3 py-2 last:border-b-0 hover:bg-panel2/50',
                        pendingSourceId === source.id && 'opacity-60'
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="h-8 w-14 flex-none overflow-hidden rounded bg-panel3">
                          {source.cover ? (
                            <img src={source.cover} alt="" loading="lazy" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-pink/60">
                              <HardDrive size={12} />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="truncate text-[12.5px] text-fg" title={source.title}>
                              {source.title}
                            </span>
                            {link ? (
                              <button
                                type="button"
                                title="在 B 站打开来源"
                                aria-label="在 B 站打开来源"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openSource(source);
                                }}
                                className="flex h-5 w-5 flex-none items-center justify-center rounded text-dim hover:bg-panel3 hover:text-fg"
                              >
                                <ExternalLink size={11} />
                              </button>
                            ) : null}
                          </div>
                          <div className="truncate text-[10px] text-dim" title={sourceSubtitle(source)}>
                            {sourceSubtitle(source)}
                            {source.note ? ` · ${source.note}` : ''}
                          </div>
                        </div>
                      </div>
                      <Tag tone="pink">{KIND_LABEL[source.kind] ?? source.kind}</Tag>
                      <div className="text-right font-mono text-[12px] text-fg" title={formatExact(source.itemCount)}>
                        {formatCount(source.itemCount)}
                      </div>
                      <div className="text-right font-mono text-[12px] text-green" title={formatExact(source.downloadedCount)}>
                        {formatCount(source.downloadedCount)}
                      </div>
                      <div className="text-right font-mono text-[12px] text-red" title={formatExact(source.unavailableCount)}>
                        {formatCount(source.unavailableCount)}
                      </div>
                      <div className="text-[10.5px] text-dim" title={source.lastSyncedAt ? formatDateTime(source.lastSyncedAt) : '尚未同步'}>
                        {source.lastSyncedAt ? formatRelative(source.lastSyncedAt) : '尚未同步'}
                      </div>
                      <div className="flex items-center justify-end gap-1.5">
                        <MiniSwitch
                          checked={source.syncEnabled}
                          onChange={() => toggleSync(source)}
                          title={source.syncEnabled ? '已参与同步全部，点击跳过' : '已跳过同步全部，点击参与'}
                        />
                        <span className="w-8 text-[10px] text-dim">{source.syncEnabled ? '参与' : '跳过'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
        {downloadAllModal}
      </>
    );
  }

  return (
    <>
      <div className="flex h-full flex-col">
        <div className="flex-none border-b border-line2">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <IconButton label="返回来源列表" onClick={() => onSelectSource(null)}>
            <ArrowLeft size={15} />
          </IconButton>
          <div className="relative h-11 w-[78px] flex-none overflow-hidden rounded-lg bg-panel3">
            {activeSource?.cover ? (
              <img src={activeSource.cover} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-pink/70">
                {activeSource?.kind === 'watch_later' ? <Star size={16} /> : <HardDrive size={16} />}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[14px] font-semibold text-fg" title={activeSource?.title}>
                {activeSource?.title}
              </span>
              {activeSource ? <Tag tone="pink">{KIND_LABEL[activeSource.kind] ?? activeSource.kind}</Tag> : null}
              {activeSource && sourceLink(activeSource) ? (
                <button
                  type="button"
                  title="在 B 站打开来源"
                  aria-label="在 B 站打开来源"
                  onClick={() => openSource(activeSource)}
                  className="flex h-5 w-5 flex-none items-center justify-center rounded text-dim hover:bg-panel2 hover:text-fg"
                >
                  <ExternalLink size={12} />
                </button>
              ) : null}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-dim">
              {activeSource ? (
                <>
                  <span title={formatExact(activeSource.itemCount)}>{formatCount(activeSource.itemCount)} 条</span>
                  <span>·</span>
                  <span className="text-green" title={formatExact(activeSource.downloadedCount)}>
                    已下载 {formatCount(activeSource.downloadedCount)}
                  </span>
                  <span>·</span>
                  <span title={activeSource.lastSyncedAt ? formatDateTime(activeSource.lastSyncedAt) : '尚未同步'}>
                    {activeSource.lastSyncedAt ? `${formatRelative(activeSource.lastSyncedAt)}同步` : '尚未同步'}
                  </span>
                  <span>·</span>
                  <span className="max-w-[360px] truncate" title={sourceSubtitle(activeSource)}>
                    {sourceSubtitle(activeSource)}
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex flex-none flex-wrap items-center gap-1.5">
            {activeSource ? (
              <Chip
                active={activeSource.syncEnabled}
                tone={activeSource.syncEnabled ? 'green' : 'default'}
                onClick={() => toggleSync(activeSource)}
                title="参与后，点「同步全部」时会同步这个来源；不会在后台定时同步"
              >
                {activeSource.syncEnabled ? '参与同步全部' : '不参与同步全部'}
              </Chip>
            ) : null}
            <Button variant="primary" size="sm" onClick={() => void syncActive()} disabled={syncing}>
              {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              同步
            </Button>
            <Button
              variant="subtle"
              size="sm"
              onClick={() => (activeSource ? void openDownloadAll(activeSource) : undefined)}
              disabled={!engineReady || !activeSource || eligibleOf(activeSource) === 0}
              title={
                !engineReady
                  ? '下载引擎未就绪，请先在设置中指定 yt-dlp 与 ffmpeg'
                  : '把这个来源里未下载的条目全部加入队列'
              }
            >
              <Download size={12} />
              全部下载
            </Button>
            <IconButton
              label="移除来源"
              onClick={() => (activeSource ? setRemoveTarget(activeSource) : undefined)}
            >
              <Trash2 size={14} />
            </IconButton>
            <div className="flex items-center gap-1 rounded-lg border border-line bg-panel2 px-1">
              <IconButton
                label="卡片视图"
                className={clsx('h-7 w-7', itemLayout === 'grid' && 'bg-panel3 text-fg')}
                onClick={() => changeItemLayout('grid')}
              >
                <LayoutGrid size={13} />
              </IconButton>
              <IconButton
                label="列表视图"
                className={clsx('h-7 w-7', itemLayout === 'list' && 'bg-panel3 text-fg')}
                onClick={() => changeItemLayout('list')}
              >
                <List size={13} />
              </IconButton>
            </div>
          </div>
        </div>

        {syncProgressBar}

        <div className="flex flex-wrap items-center gap-2 border-t border-line2/60 bg-panel/40 px-4 py-2">
          <div className="relative w-64">
            <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-dim" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
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
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {noteDraft === null ? (
              <button
                type="button"
                onClick={() => setNoteDraft(activeSource?.note ?? '')}
                title={activeSource?.note || '添加来源备注'}
                className="flex max-w-[280px] items-center gap-1 rounded-md border border-line/70 bg-panel2 px-2 py-1 text-[10.5px] text-dim hover:text-fg"
              >
                <StickyNote size={11} className="flex-none" />
                <span className="truncate">{activeSource?.note || '添加备注'}</span>
              </button>
            ) : (
              <input
                autoFocus
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                onBlur={() => void saveNote()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') {
                    noteCancelRef.current = true;
                    event.currentTarget.blur();
                  }
                }}
                placeholder="来源备注（回车保存，Esc 取消）"
                className="h-7 w-64 rounded-md border border-line bg-panel2 px-2 text-[11px] text-fg placeholder:text-dim focus:border-blue/40 focus:outline-none"
              />
            )}
          </div>
        </div>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-[12px] text-dim">
            <Loader2 size={14} className="animate-spin" />
            读取清单…
          </div>
        ) : items.length === 0 ? (
          filtered ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-panel2 text-dim">
                <Search size={20} />
              </div>
              <div>
                <div className="text-[14px] font-medium text-fg">没有匹配的条目</div>
                <p className="mt-1 text-[12px] leading-5 text-dim">换个关键词，或清除「仅未下载 / 仅失效」筛选。</p>
              </div>
              <Button
                variant="subtle"
                size="sm"
                onClick={() => {
                  setSearch('');
                  setOnlyUndownloaded(false);
                  setOnlyUnavailable(false);
                }}
              >
                清除筛选
              </Button>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-panel2 text-dim">
                <Inbox size={24} />
              </div>
              <div>
                <div className="text-[14px] font-medium text-fg">还没有同步过这个来源</div>
                <p className="mt-1 max-w-sm text-[12px] leading-5 text-dim">
                  同步只拉取清单与元数据（标题、UP、封面），不会自动下载视频。
                </p>
              </div>
              <Button variant="primary" size="sm" onClick={() => void syncActive()} disabled={syncing}>
                {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                立即同步
              </Button>
            </div>
          )
        ) : itemLayout === 'grid' ? (
          <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {items.map((item) => {
              const checked = selected.includes(item.id);
              const disabled = item.state === 'unavailable' || Boolean(item.downloadedVideoId);
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                  aria-pressed={checked}
                  onClick={() => {
                    if (!disabled) toggle(item.id);
                  }}
                  onKeyDown={(event) => {
                    if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault();
                      toggle(item.id);
                    }
                  }}
                  className={clsx(
                    'group flex flex-col overflow-hidden rounded-xl border bg-panel transition-colors',
                    checked
                      ? 'border-pink/50 bg-pink/[0.05]'
                      : 'border-line/70 hover:border-line hover:bg-panel2',
                    disabled ? 'cursor-default opacity-60' : 'cursor-pointer'
                  )}
                >
                  <div className="relative aspect-video w-full overflow-hidden bg-panel3">
                    {item.coverUrl ? (
                      <img src={item.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : null}
                    <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 font-mono text-[9px] text-white/90">
                      {formatDuration(item.duration)}
                    </span>
                    <span
                      className={clsx(
                        'absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded border',
                        checked
                          ? 'border-pink bg-pink text-white'
                          : 'border-white/40 bg-black/40 text-transparent'
                      )}
                    >
                      <CheckCircle2 size={10} />
                    </span>
                    {item.downloadedVideoId ? (
                      <Tag tone="green" className="absolute right-1 top-1">
                        已下载
                      </Tag>
                    ) : null}
                    {item.state === 'unavailable' ? (
                      <Tag tone="red" className="absolute left-1 top-6">
                        已失效
                      </Tag>
                    ) : null}
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-2">
                    <div className="line-clamp-2 text-[11.5px] leading-4 text-fg/90" title={item.title}>
                      {shorten(item.title, 64)}
                    </div>
                    <div
                      className="truncate text-[10px] text-dim"
                      title={`${item.upName ?? '—'} · ${formatDateTime(item.favTime ?? item.pubTime)}`}
                    >
                      {item.upName ?? '—'} ·{' '}
                      {item.favTime ? formatRelative(item.favTime) : item.pubTime ? formatRelative(item.pubTime) : '—'}
                    </div>
                    <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
                      <FormatBadges item={item} />
                      {item.tags.slice(0, 2).map((tag) => (
                        <Tag key={tag}>{tag}</Tag>
                      ))}
                      {item.state === 'unknown' ? <Tag tone="yellow">状态未知</Tag> : null}
                      {item.jobStatus && !item.downloadedVideoId ? (
                        <Tag tone="yellow">{JOB_LABEL[item.jobStatus] ?? item.jobStatus}</Tag>
                      ) : null}
                      <button
                        type="button"
                        title="在 B 站打开"
                        aria-label="在 B 站打开"
                        onClick={(event) => {
                          event.stopPropagation();
                          openVideo(item.bvid);
                        }}
                        className="ml-auto flex h-5 w-5 flex-none items-center justify-center rounded text-dim hover:bg-panel3 hover:text-fg"
                      >
                        <ExternalLink size={11} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
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
                    'group flex items-center gap-3 px-4 py-2 transition-colors hover:bg-panel2/50',
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
                    <div className="truncate text-[12.5px] text-fg/90" title={`${item.title}\n${item.bvid}`}>
                      {shorten(item.title, 90)}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-dim">
                      <span className="truncate">{item.upName ?? '—'}</span>
                      <span>·</span>
                      <span
                        title={
                          item.favTime
                            ? `收藏于 ${formatDateTime(item.favTime)}`
                            : item.pubTime
                              ? `发布于 ${formatDateTime(item.pubTime)}`
                              : '时间未知'
                        }
                      >
                        {item.favTime ? formatRelative(item.favTime) : item.pubTime ? formatRelative(item.pubTime) : '—'}
                      </span>
                      <FormatBadges item={item} />
                      {item.state === 'unavailable' ? (
                        <Tag tone="red">
                          <AlertTriangle size={9} />
                          已失效
                        </Tag>
                      ) : null}
                      {item.state === 'unknown' ? <Tag tone="yellow">状态未知</Tag> : null}
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
                    <button
                      type="button"
                      title="在 B 站打开"
                      aria-label="在 B 站打开"
                      onClick={() => openVideo(item.bvid)}
                      className="flex h-6 w-6 items-center justify-center rounded text-dim opacity-0 transition-opacity hover:bg-panel3 hover:text-fg group-hover:opacity-100"
                    >
                      <ExternalLink size={12} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {!loading && items.length > 0 && totalItems > items.length ? (
          <div className="px-4 pb-4 pt-2 text-center">
            <Button variant="subtle" size="sm" onClick={() => void load('more')} disabled={loadingMore}>
              {loadingMore ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              加载更多（已显示 {formatCount(items.length)} / {formatCount(totalItems)}）
            </Button>
          </div>
        ) : null}
      </div>

      {items.length > 0 ? (
        <div className="flex flex-none flex-wrap items-center gap-2 border-t border-line2 bg-panel/60 px-4 py-2">
          <span className="text-[11.5px] text-muted">
            已选 <span className="font-mono text-pink">{formatCount(selected.length)}</span> /{' '}
            <span title={formatExact(totalItems)}>{formatCount(totalItems)}</span>
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
      ) : null}
      </div>
      {downloadAllModal}
      {removeModal}
    </>
  );
}
