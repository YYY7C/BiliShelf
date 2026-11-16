import clsx from 'clsx';
import {
  AlertTriangle,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
  X
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { VideoItem } from '@shared/types';
import { formatBytes, formatDate, formatDuration, codecLabel, resolutionLabel } from '../lib/format';
import { AI_TAG_SOURCE_LABEL, categoryClass, formatConfidence } from '../lib/ai';
import { api } from '../lib/bridge';
import { useUi } from '../lib/store';
import { Button, IconButton, SectionLabel, Tag, TextInput } from './ui';

interface InspectorProps {
  item: VideoItem | null;
  tagSuggestions: string[];
  folderSuggestions: string[];
  onClose: () => void;
  onRefresh: () => void;
  onPlay: (id: number) => void;
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line2 py-1 last:border-0">
      <span className="flex-none text-[11px] text-dim">{label}</span>
      <span className="min-w-0 truncate text-right text-[11.5px] text-muted" title={value}>
        {value}
      </span>
    </div>
  );
}

export function Inspector({
  item,
  tagSuggestions,
  folderSuggestions,
  onClose,
  onRefresh,
  onPlay
}: InspectorProps) {
  const pushToast = useUi((state) => state.pushToast);
  const openAiReview = useUi((state) => state.openAiReview);
  const [note, setNote] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [folderInput, setFolderInput] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNote(item?.note ?? '');
    setTagInput('');
    setFolderInput('');
  }, [item?.id, item?.note]);

  if (!item) {
    return (
      <aside className="relative z-10 flex h-full w-[292px] flex-none flex-col border-l border-line2 bg-panel/50">
        <div className="flex h-12 items-center justify-between border-b border-line2 px-3">
          <span className="text-[12px] font-medium text-muted">检查器</span>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] leading-5 text-dim">
          选中一个素材查看详情、标签与备注。
        </div>
      </aside>
    );
  }

  const save = async (patch: Parameters<typeof api.library.update>[1]) => {
    try {
      await api.library.update(item.id, patch);
      onRefresh();
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const addTag = async () => {
    const value = tagInput.trim();
    if (!value) return;
    try {
      await api.library.setTag(item.id, value, true);
      setTagInput('');
      onRefresh();
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const removeTag = async (tag: string) => {
    try {
      await api.library.setTag(item.id, tag, false);
      onRefresh();
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const addFolder = async () => {
    const value = folderInput.trim();
    if (!value) return;
    try {
      await api.library.setFolder(item.id, value, true);
      setFolderInput('');
      onRefresh();
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const removeFolder = async (folder: string) => {
    try {
      await api.library.setFolder(item.id, folder, false);
      onRefresh();
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const unapproveAiTag = async (tag: VideoItem['aiTags'][number]) => {
    try {
      await api.ai.review.unapprove({ videoId: item.id, name: tag.name, category: tag.category });
      pushToast('info', '已取消通过该 AI 标签');
      onRefresh();
    } catch (error) {
      pushToast('error', (error as Error).message);
    }
  };

  const retag = async () => {
    setBusy(true);
    try {
      const result = await api.ai.queue.enqueue({ videoIds: [item.id], force: true });
      pushToast(
        result.queued > 0 ? 'success' : 'warn',
        result.queued > 0 ? '已加入打标队列' : '未能加入队列'
      );
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (action: 'trash' | 'redownload' | 'reveal' | 'openSource') => {
    if (busy) return;
    setBusy(true);
    try {
      if (action === 'trash') {
        await api.library.bulk({ ids: [item.id], action: 'trash' });
        pushToast('info', '已移入回收站');
        onRefresh();
      } else if (action === 'redownload') {
        if (!item.bvid) throw new Error('本地导入的素材没有来源地址，无法重新下载');
        await api.library.bulk({ ids: [item.id], action: 'redownload' });
        pushToast('success', '已加入下载队列');
      } else if (action === 'reveal') {
        await api.library.reveal(item.id);
      } else if (action === 'openSource') {
        if (!item.bvid) throw new Error('该条目没有 B 站来源');
        await api.app.openExternal(`https://www.bilibili.com/video/${item.bvid}`);
      }
    } catch (error) {
      pushToast('error', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const aiGroups = new Map<string, VideoItem['aiTags']>();
  for (const tag of item.aiTags) {
    if (!aiGroups.has(tag.category)) aiGroups.set(tag.category, []);
    aiGroups.get(tag.category)!.push(tag);
  }

  return (
    <aside className="relative z-10 flex h-full w-[292px] flex-none flex-col border-l border-line2 bg-panel/50">
      <div className="flex h-12 flex-none items-center justify-between border-b border-line2 px-3">
        <span className="text-[12px] font-medium text-muted">检查器</span>
        <IconButton label="关闭检查器" onClick={onClose}>
          <X size={15} />
        </IconButton>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto px-3 pb-6">
        <div className="relative mt-3 overflow-hidden rounded-lg border border-line bg-panel3">
          <div className="aspect-video w-full bg-gradient-to-br from-panel3 to-surface">
            {(item.thumbUrl ?? item.coverUrl) ? (
              <img src={item.thumbUrl ?? item.coverUrl ?? ''} alt="" className="h-full w-full object-cover" />
            ) : null}
          </div>
          {item.videoUrl ? (
            <button
              type="button"
              onClick={() => onPlay(item.id)}
              className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity hover:opacity-100"
              aria-label="播放"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/40 bg-white/15 text-white backdrop-blur">
                <Play size={16} fill="currentColor" />
              </span>
            </button>
          ) : null}
        </div>

        <h3 className="mt-3 text-[13px] font-medium leading-5 text-fg">{item.title}</h3>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-dim">
          <span className="truncate">{item.upName ?? '本地导入'}</span>
          {item.sourceName ? (
            <>
              <span>·</span>
              <span className="truncate">{item.sourceName}</span>
            </>
          ) : null}
        </div>

        {item.status !== 'present' ? (
          <div
            className={clsx(
              'mt-2 flex items-start gap-2 rounded-lg border px-2 py-1.5 text-[11px] leading-4',
              item.status === 'missing'
                ? 'border-yellow/30 bg-yellow/10 text-yellow'
                : 'border-red/30 bg-red/10 text-red'
            )}
          >
            <AlertTriangle size={12} className="mt-0.5 flex-none" />
            <span>
              {item.status === 'missing'
                ? '本地文件已丢失，可尝试重新下载或重新定位。'
                : '源内容已失效，本地文件仍可用。'}
            </span>
          </div>
        ) : null}

        <div className="mt-3 flex gap-1.5">
          <Button
            variant="primary"
            size="sm"
            className="flex-1"
            onClick={() => onPlay(item.id)}
            disabled={!item.videoUrl}
          >
            <Play size={12} />
            播放
          </Button>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => void runAction('reveal')}
            title="在资源管理器中显示"
          >
            <FolderOpen size={12} />
          </Button>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => void runAction('openSource')}
            title="打开 B 站源地址"
          >
            <ExternalLink size={12} />
          </Button>
        </div>

        <SectionLabel>评分</SectionLabel>
        <div className="flex items-center gap-1 px-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`评分 ${value}`}
              onClick={() => void save({ rating: item.rating === value ? 0 : value })}
              className={clsx(
                'transition-colors',
                value <= item.rating ? 'text-yellow' : 'text-muted/35 hover:text-yellow/60'
              )}
            >
              <Star size={16} fill={value <= item.rating ? 'currentColor' : 'none'} />
            </button>
          ))}
          <span className="ml-1 font-mono text-[10.5px] text-dim">{item.rating || '—'}</span>
        </div>

        <SectionLabel>标签</SectionLabel>
        <div className="flex flex-wrap gap-1 px-1">
          {item.tags.length === 0 ? <span className="text-[11px] text-dim">暂无标签</span> : null}
          {item.tags.map((tag) => (
            <span
              key={tag}
              className="group inline-flex items-center gap-1 rounded border border-line bg-panel2 px-1.5 py-0.5 text-[11px] text-muted"
            >
              {tag}
              <button
                type="button"
                aria-label={`移除标签 ${tag}`}
                onClick={() => void removeTag(tag)}
                className="text-dim opacity-0 transition-opacity hover:text-red group-hover:opacity-100"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <div className="mt-1.5 flex gap-1">
          <TextInput
            list="tag-suggestions"
            value={tagInput}
            onChange={(event) => setTagInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void addTag();
            }}
            placeholder="添加标签后回车"
            className="h-7 text-[11.5px]"
          />
          <datalist id="tag-suggestions">
            {tagSuggestions.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
          <IconButton label="添加标签" onClick={() => void addTag()}>
            <Plus size={13} />
          </IconButton>
        </div>

        <SectionLabel
          right={
            item.aiPendingCount > 0 ? (
              <button
                type="button"
                onClick={() => openAiReview(item.id)}
                className="inline-flex items-center gap-1 text-[10px] text-yellow hover:underline"
              >
                {item.aiPendingCount} 待审
              </button>
            ) : undefined
          }
        >
          AI 标签
        </SectionLabel>
        {item.aiTags.length === 0 ? (
          <span className="px-1 text-[11px] text-dim">暂无 AI 标签</span>
        ) : (
          <div className="space-y-1.5">
            {Array.from(aiGroups.entries()).map(([category, tags]) => (
              <div key={category} className="px-1">
                <span
                  className={clsx(
                    'inline-block rounded border px-1.5 py-0.5 text-[10px]',
                    categoryClass(category)
                  )}
                >
                  {category}
                </span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <span
                      key={`${tag.name}-${tag.category}`}
                      className="group inline-flex items-center gap-1 rounded border border-line bg-panel2 px-1.5 py-0.5 text-[11px] text-muted"
                      title={`${AI_TAG_SOURCE_LABEL[tag.source]} · 置信度 ${formatConfidence(tag.confidence)}`}
                    >
                      <Sparkles size={8} className="text-blue/70" />
                      {tag.name}
                      <span className="font-mono text-[9px] text-dim">
                        {formatConfidence(tag.confidence)}
                      </span>
                      <button
                        type="button"
                        aria-label={`取消通过 AI 标签 ${tag.name}`}
                        onClick={() => void unapproveAiTag(tag)}
                        className="text-dim opacity-0 transition-opacity hover:text-red group-hover:opacity-100"
                      >
                        <X size={9} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-1.5 flex gap-1 px-1">
          <Button size="sm" variant="subtle" onClick={() => openAiReview(item.id)}>
            审核
            {item.aiPendingCount > 0 ? ` (${item.aiPendingCount})` : ''}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void retag()} disabled={busy}>
            <RefreshCw size={11} />
            重新打标
          </Button>
        </div>
        {item.aiSummary ? (
          <p className="mt-1 px-1 text-[10.5px] leading-4 text-dim">AI 摘要：{item.aiSummary}</p>
        ) : null}

        <SectionLabel>文件夹</SectionLabel>
        <div className="flex flex-wrap gap-1 px-1">
          {item.folders.length === 0 ? <span className="text-[11px] text-dim">未归类</span> : null}
          {item.folders.map((folder) => (
            <span
              key={folder}
              className="group inline-flex items-center gap-1 rounded border border-blue/25 bg-blue/10 px-1.5 py-0.5 text-[11px] text-blue"
            >
              {folder}
              <button
                type="button"
                aria-label={`移出文件夹 ${folder}`}
                onClick={() => void removeFolder(folder)}
                className="opacity-0 transition-opacity hover:text-red group-hover:opacity-100"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <div className="mt-1.5 flex gap-1">
          <TextInput
            list="folder-suggestions"
            value={folderInput}
            onChange={(event) => setFolderInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void addFolder();
            }}
            placeholder="移入文件夹后回车"
            className="h-7 text-[11.5px]"
          />
          <datalist id="folder-suggestions">
            {folderSuggestions.map((folder) => (
              <option key={folder} value={folder} />
            ))}
          </datalist>
          <IconButton label="移入文件夹" onClick={() => void addFolder()}>
            <Plus size={13} />
          </IconButton>
        </div>

        <SectionLabel>备注</SectionLabel>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => {
            if (note !== item.note) void save({ note });
          }}
          placeholder="记录为什么收藏它、可复用的片段、时间戳…"
          rows={4}
          className="w-full resize-y rounded-lg border border-line bg-panel2 px-2 py-1.5 text-[11.5px] leading-5 text-fg placeholder:text-dim focus:border-blue/40 focus:outline-none"
        />

        <SectionLabel>信息</SectionLabel>
        <div className="rounded-lg border border-line/70 bg-panel2/50 px-2 py-1">
          <MetaRow label="时长" value={formatDuration(item.duration)} />
          <MetaRow label="分辨率" value={resolutionLabel(item.width, item.height)} />
          <MetaRow
            label="编码"
            value={`${codecLabel(item.vcodec)} / ${(item.acodec ?? '—').toUpperCase()}`}
          />
          <MetaRow label="大小" value={formatBytes(item.fileSize)} />
          <MetaRow label="添加" value={formatDate(item.createdAt)} />
          <MetaRow label="下载" value={formatDate(item.downloadedAt)} />
          <MetaRow label="BV" value={item.bvid || '—'} />
          {item.playPosition > 0 ? (
            <MetaRow label="上次进度" value={formatDuration(item.playPosition)} />
          ) : null}
        </div>

        <div className="mt-3 flex gap-1.5">
          <Button
            variant="subtle"
            size="sm"
            className="flex-1"
            onClick={() => void runAction('redownload')}
            disabled={!item.bvid || busy}
          >
            <RefreshCw size={12} />
            重新下载
          </Button>
          <Button variant="danger" size="sm" onClick={() => void runAction('trash')} disabled={busy}>
            <Trash2 size={12} />
            回收站
          </Button>
        </div>

        <div className="mt-2 flex items-center gap-1 text-[10.5px] text-dim">
          <HardDrive size={10} />
          <span className="truncate">{item.qualityLabel ?? '未知画质'}</span>
          {item.hasDanmaku ? <Tag tone="pink">弹幕</Tag> : null}
          {item.hasSubtitle ? <Tag tone="blue">字幕</Tag> : null}
        </div>
      </div>
    </aside>
  );
}
