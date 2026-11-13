import Artplayer from 'artplayer';
import clsx from 'clsx';
import Danmaku from 'danmaku';
import { ExternalLink, MessageSquare, MessageSquareOff, Play, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { VideoItem } from '@shared/types';
import { api } from '../lib/bridge';
import { parseBilibiliDanmaku } from '../lib/danmaku';
import { formatDuration } from '../lib/format';
import { IconButton, Spinner } from './ui';

interface PlayerOverlayProps {
  id: number;
  onClose: () => void;
}

export function PlayerOverlay({ id, onClose }: PlayerOverlayProps) {
  const [item, setItem] = useState<VideoItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [danmakuOn, setDanmakuOn] = useState(true);
  const [danmakuCount, setDanmakuCount] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<Artplayer | null>(null);
  const danmakuRef = useRef<Danmaku | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.library
      .get(id)
      .then((video) => {
        if (alive) setItem(video);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement) {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !item?.videoUrl) return;
    let disposed = false;

    const layer = document.createElement('div');
    layer.className = 'danmaku-layer';
    host.appendChild(layer);
    layerRef.current = layer;

    const art = new Artplayer({
      container: host,
      url: item.videoUrl,
      poster: item.thumbUrl ?? item.coverUrl ?? '',
      autoplay: true,
      volume: 0.8,
      hotkey: true,
      setting: true,
      playbackRate: true,
      aspectRatio: true,
      fullscreen: true,
      fullscreenWeb: true,
      pip: true,
      screenshot: true,
      theme: '#fb7299',
      ...(item.subtitleUrl
        ? {
            subtitle: {
              url: item.subtitleUrl,
              type: item.subtitleUrl.toLowerCase().endsWith('.vtt') ? 'vtt' : 'srt',
              escape: false,
              style: {
                color: '#fff',
                fontSize: '20px',
                textShadow: '0 1px 2px rgba(0,0,0,0.9)',
                bottom: '80px'
              }
            }
          }
        : {})
    });
    artRef.current = art;

    art.on('ready', () => {
      if (item.playPosition > 5 && item.playPosition < (item.duration ?? Infinity) - 10) {
        art.currentTime = item.playPosition;
      }
    });

    let lastSaved = 0;
    art.on('video:timeupdate', () => {
      const now = Date.now();
      if (now - lastSaved < 5000) return;
      lastSaved = now;
      void api.player.progress(item.id, art.currentTime);
    });

    // 弹幕：优先读取本地 danmaku.xml
    if (item.danmakuUrl) {
      void fetch(item.danmakuUrl)
        .then((response) => (response.ok ? response.text() : ''))
        .then((xml) => {
          if (disposed) return;
          const comments = parseBilibiliDanmaku(xml);
          setDanmakuCount(comments.length);
          if (comments.length === 0 || !art.video) return;
          const danmaku = new Danmaku({
            container: layer,
            media: art.video,
            comments: comments as never,
            engine: 'canvas',
            speed: 144
          });
          danmakuRef.current = danmaku;
        })
        .catch(() => undefined);
    }

    return () => {
      disposed = true;
      try {
        danmakuRef.current?.destroy();
      } catch {
        // ignore
      }
      danmakuRef.current = null;
      try {
        art.destroy();
      } catch {
        // ignore
      }
      artRef.current = null;
      layer.remove();
      layerRef.current = null;
    };
  }, [item]);

  useEffect(() => {
    const danmaku = danmakuRef.current;
    if (!danmaku) return;
    if (danmakuOn) danmaku.show();
    else danmaku.hide();
  }, [danmakuOn]);

  const openSource = () => {
    if (item?.bvid) void api.app.openExternal(`https://www.bilibili.com/video/${item.bvid}`);
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black/92 backdrop-blur-sm">
      <header className="flex h-12 flex-none items-center gap-3 border-b border-white/10 px-4">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-pink/20 text-pink">
          <Play size={12} fill="currentColor" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] text-white/90">{item?.title ?? '读取中…'}</div>
          <div className="truncate text-[10.5px] text-white/45">
            {item?.upName ?? ''}
            {item?.duration ? ` · ${formatDuration(item.duration)}` : ''}
            {danmakuCount > 0 ? ` · ${danmakuCount} 条弹幕` : ''}
          </div>
        </div>

        {item?.danmakuUrl ? (
          <button
            type="button"
            onClick={() => setDanmakuOn((value) => !value)}
            className={clsx(
              'inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors',
              danmakuOn
                ? 'border-pink/40 bg-pink/15 text-pink'
                : 'border-white/15 bg-white/5 text-white/60 hover:text-white'
            )}
            title={danmakuOn ? '关闭弹幕' : '开启弹幕'}
          >
            {danmakuOn ? <MessageSquare size={12} /> : <MessageSquareOff size={12} />}
            弹幕
          </button>
        ) : null}

        <button
          type="button"
          onClick={openSource}
          disabled={!item?.bvid}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2 text-[11px] text-white/70 transition-colors hover:text-white disabled:opacity-40"
          title="打开 B 站源地址"
        >
          <ExternalLink size={12} />
          源地址
        </button>

        <IconButton label="关闭播放器" className="text-white/70 hover:text-white" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </header>

      <div className="relative min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-[12px] text-white/60">
            <Spinner />
            加载视频…
          </div>
        ) : !item?.videoUrl ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-white/60">
            <div className="text-[14px] text-white/80">没有可播放的本地文件</div>
            <p className="max-w-md text-[12px] leading-5 text-white/45">
              该条目可能只是清单中的远程记录，或本地文件已被移动。请先在「来源清单」下载，或使用「重建索引 / 重新下载」。
            </p>
          </div>
        ) : (
          <div ref={hostRef} className="art-host" />
        )}
      </div>
    </div>
  );
}
