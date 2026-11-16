import clsx from 'clsx';
import { Maximize2, Play, X } from 'lucide-react';
import { useState } from 'react';
import type { AiFrame } from '@shared/types';
import { formatFrameTime } from '../../lib/ai';

interface AiFrameStripProps {
  frames: AiFrame[];
  onPlay?: (time: number) => void;
  compact?: boolean;
}

export function AiFrameStrip({ frames, onPlay, compact }: AiFrameStripProps) {
  const [preview, setPreview] = useState<AiFrame | null>(null);
  if (frames.length === 0) {
    return <span className="text-[11px] text-dim">没有抽帧</span>;
  }
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {frames.map((frame) => (
          <button
            key={`${frame.index}-${frame.time}`}
            type="button"
            onClick={() => setPreview(frame)}
            className={clsx(
              'group relative overflow-hidden rounded-md border border-line bg-panel3 transition-colors hover:border-pink/40',
              compact ? 'h-14 w-24' : 'h-20 w-32'
            )}
            title={frame.index === -1 ? '封面' : formatFrameTime(frame.time)}
          >
            <img src={frame.url} alt="" className="h-full w-full object-cover" loading="lazy" />
            <span className="absolute bottom-0.5 left-0.5 rounded bg-black/65 px-1 font-mono text-[9px] text-white/90">
              {frame.index === -1 ? '封面' : formatFrameTime(frame.time)}
            </span>
            <span className="absolute right-0.5 top-0.5 rounded bg-black/55 p-0.5 text-white/80 opacity-0 transition-opacity group-hover:opacity-100">
              <Maximize2 size={9} />
            </span>
          </button>
        ))}
      </div>

      {preview ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8 backdrop-blur-sm"
          onClick={() => setPreview(null)}
          role="presentation"
        >
          <div
            className="relative max-h-full max-w-[min(1100px,90vw)] overflow-hidden rounded-xl border border-line bg-ink shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <img src={preview.url} alt="" className="max-h-[78vh] w-auto max-w-full object-contain" />
            <div className="flex items-center gap-2 border-t border-line bg-panel px-3 py-2">
              <span className="font-mono text-[11px] text-muted">
                {preview.index === -1 ? '封面' : formatFrameTime(preview.time)}
              </span>
              {onPlay && preview.index !== -1 ? (
                <button
                  type="button"
                  onClick={() => {
                    onPlay(preview.time);
                    setPreview(null);
                  }}
                  className="ml-auto inline-flex items-center gap-1 rounded-md border border-line bg-panel2 px-2 py-1 text-[11px] text-muted hover:text-fg"
                >
                  <Play size={11} />
                  在播放器中打开
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="ml-auto rounded-md p-1 text-dim hover:bg-panel2 hover:text-fg"
                aria-label="关闭预览"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
