import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Play, Sparkles, Star, StickyNote, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { VideoItem } from '@shared/types';
import { formatBytes, formatDuration, resolutionLabel, shorten } from '../lib/format';

interface VideoCardProps {
  item: VideoItem;
  layout: 'grid' | 'list';
  active: boolean;
  selected: boolean;
  onSelect: (event: React.MouseEvent) => void;
  onOpen: () => void;
}

function StatusBadge({ item }: { item: VideoItem }) {
  if (item.status === 'missing') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-yellow backdrop-blur">
        <AlertTriangle size={10} />
        文件缺失
      </span>
    );
  }
  if (item.status === 'unavailable') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-red backdrop-blur">
        <XCircle size={10} />
        源已失效
      </span>
    );
  }
  return null;
}

export function VideoCard({ item, layout, active, selected, onSelect, onOpen }: VideoCardProps) {
  const [previewing, setPreviewing] = useState(false);
  const timerRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const cover = item.thumbUrl ?? item.coverUrl;
  const canPlay = Boolean(item.videoUrl);
  const progress = item.duration && item.playPosition ? Math.min(1, item.playPosition / item.duration) : 0;
  const seenTags = new Set<string>();
  const topTags = [
    ...item.tags.map((name) => ({ name, ai: false })),
    ...item.aiTags.map((tag) => ({ name: tag.name, ai: true }))
  ]
    .filter((tag) => {
      if (seenTags.has(tag.name)) return false;
      seenTags.add(tag.name);
      return true;
    })
    .slice(0, 3);
  const totalTagCount = new Set([...item.tags, ...item.aiTags.map((tag) => tag.name)]).size;

  const startPreview = () => {
    if (!item.previewUrl && !canPlay) return;
    timerRef.current = window.setTimeout(() => setPreviewing(true), 380);
  };

  const stopPreview = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setPreviewing(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }
  };

  if (layout === 'list') {
    return (
      <div
        onClick={onSelect}
        onDoubleClick={onOpen}
        className={clsx(
          'group flex cursor-default items-center gap-3 rounded-lg border px-2 py-1.5 transition-colors',
          active ? 'border-pink/40 bg-pink/[0.06]' : 'border-transparent hover:border-line hover:bg-panel2/70',
          selected && !active && 'border-line bg-panel2'
        )}
      >
        <div className="relative h-10 w-[71px] flex-none overflow-hidden rounded bg-panel3">
          {cover ? <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
          <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 font-mono text-[9px] text-white/90">
            {formatDuration(item.duration)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className={clsx('truncate text-[12.5px]', active ? 'text-fg' : 'text-muted group-hover:text-fg')}>
            {item.title}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-dim">
            <span className="truncate">{item.upName ?? '本地文件'}</span>
            <span>·</span>
            <span>{resolutionLabel(item.width, item.height)}</span>
            <span>·</span>
            <span>{formatBytes(item.fileSize)}</span>
            {item.tags.slice(0, 2).map((tag) => (
              <span key={tag} className="rounded bg-panel3 px-1 text-[10px] text-muted">
                {tag}
              </span>
            ))}
            {item.aiTags.length > 0 ? (
              <span className="inline-flex items-center gap-0.5 rounded bg-blue/10 px-1 text-[10px] text-blue">
                <Sparkles size={8} />
                {item.aiTags.length}
              </span>
            ) : null}
            {item.aiPendingCount > 0 ? (
              <span className="rounded bg-yellow/10 px-1 text-[10px] text-yellow">
                待审 {item.aiPendingCount}
              </span>
            ) : null}
          </div>
        </div>
        {item.status !== 'present' ? (
          <span className="flex-none">
            <StatusBadge item={item} />
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      onClick={onSelect}
      onDoubleClick={onOpen}
      onMouseEnter={startPreview}
      onMouseLeave={stopPreview}
      className={clsx(
        'group relative cursor-default overflow-hidden rounded-xl border bg-panel transition-all',
        active
          ? 'border-pink/50 shadow-[0_0_0_1px_rgba(251,114,153,0.35)]'
          : 'border-line/70 hover:border-line hover:bg-panel2'
      )}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-gradient-to-br from-panel3 to-surface">
        {cover ? (
          <img
            src={cover}
            alt=""
            loading="lazy"
            className={clsx(
              'h-full w-full object-cover transition-transform duration-500',
              'group-hover:scale-[1.03]',
              item.status !== 'present' && 'opacity-45 grayscale'
            )}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-dim">无封面</div>
        )}

        {previewing && item.previewUrl ? (
          <video
            ref={videoRef}
            src={item.previewUrl}
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : null}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10 opacity-80" />

        <div className="absolute left-2 top-2 flex items-center gap-1">
          <StatusBadge item={item} />
          {item.hasDanmaku ? (
            <span className="rounded bg-black/55 px-1 py-0.5 text-[9.5px] text-white/75 backdrop-blur">弹</span>
          ) : null}
          {item.hasSubtitle ? (
            <span className="rounded bg-black/55 px-1 py-0.5 text-[9.5px] text-white/75 backdrop-blur">字</span>
          ) : null}
        </div>

        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white/90">
          {formatDuration(item.duration)}
        </span>

        {item.rating > 0 ? (
          <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-0.5 rounded bg-black/60 px-1 py-0.5 text-[9.5px] text-yellow">
            <Star size={9} fill="currentColor" />
            {item.rating}
          </span>
        ) : null}

        {canPlay ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            aria-label="播放"
            className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-white/15 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"
          >
            <Play size={14} fill="currentColor" />
          </button>
        ) : null}

        {progress > 0 ? (
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/15">
            <div className="h-full bg-pink" style={{ width: `${progress * 100}%` }} />
          </div>
        ) : null}

        <button
          type="button"
          aria-label={selected ? '取消选择' : '选择'}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(event);
          }}
          className={clsx(
            'absolute left-2 bottom-2 flex h-4 w-4 items-center justify-center rounded border transition-all',
            selected
              ? 'border-pink bg-pink text-white'
              : 'border-white/40 bg-black/35 text-transparent opacity-0 group-hover:opacity-100'
          )}
        >
          <CheckCircle2 size={10} />
        </button>
      </div>

      <div className="px-2 py-1.5">
        <div className="line-clamp-2 text-[12.5px] leading-[1.45] text-fg/90" title={item.title}>
          {item.title}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-dim">
          <span className="min-w-0 flex-1 truncate">{item.upName ?? '本地文件'}</span>
          {item.note ? (
            <span className="flex-none text-yellow/80" title={shorten(item.note, 200)}>
              <StickyNote size={10} />
            </span>
          ) : null}
          {item.fileSize ? <span className="font-mono">{formatBytes(item.fileSize)}</span> : null}
        </div>
        {topTags.length > 0 || item.aiPendingCount > 0 ? (
          <div className="mt-1 flex flex-wrap items-center gap-1 overflow-hidden">
            {topTags.map((tag) => (
              <span
                key={`${tag.ai ? 'ai' : 'tag'}-${tag.name}`}
                className={clsx(
                  'inline-flex max-w-[96px] items-center gap-0.5 truncate rounded border px-1 text-[10px] leading-4',
                  tag.ai
                    ? 'border-blue/25 bg-blue/10 text-blue'
                    : 'border-line/60 bg-panel2 text-muted'
                )}
                title={tag.ai ? `AI 标签：${tag.name}` : tag.name}
              >
                {tag.ai ? <Sparkles size={8} className="shrink-0" /> : null}
                <span className="truncate">{tag.name}</span>
              </span>
            ))}
            {totalTagCount > topTags.length ? (
              <span className="text-[10px] leading-4 text-dim">+{totalTagCount - topTags.length}</span>
            ) : null}
            {item.aiPendingCount > 0 ? (
              <span className="rounded bg-yellow/10 px-1 text-[10px] leading-4 text-yellow">
                待审 {item.aiPendingCount}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

    </div>
  );
}
