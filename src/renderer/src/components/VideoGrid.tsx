import { useVirtualizer } from '@tanstack/react-virtual';
import { Film, FolderPlus, Inbox, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { VideoItem } from '@shared/types';
import { useUi } from '../lib/store';
import { Button } from './ui';
import { VideoCard } from './VideoCard';

interface VideoGridProps {
  items: VideoItem[];
  total: number;
  layout: 'grid' | 'list';
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onOpen: (id: number) => void;
  onImport: () => void;
  filtered: boolean;
}

const GAP = 12;
const PADDING = 16;
const TOP_PAD = 14;
const MIN_CARD = 214;

export function VideoGrid({
  items,
  total,
  layout,
  loading,
  hasMore,
  onLoadMore,
  onOpen,
  onImport,
  filtered
}: VideoGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  const selectedId = useUi((state) => state.selectedId);
  const selection = useUi((state) => state.selection);
  const select = useUi((state) => state.select);
  const toggleSelect = useUi((state) => state.toggleSelect);

  useEffect(() => {
    const element = parentRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const cols = useMemo(() => {
    if (layout === 'list') return 1;
    if (width === 0) return 4;
    return Math.max(2, Math.floor((width - PADDING * 2 + GAP) / (MIN_CARD + GAP)));
  }, [width, layout]);

  const cardWidth = Math.max(160, (width - PADDING * 2 - GAP * (cols - 1)) / cols);
  const rowHeight = layout === 'grid' ? Math.round((cardWidth * 9) / 16) + 96 + GAP : 54 + 4;

  const rowCount = layout === 'grid' ? Math.ceil(items.length / cols) : items.length;

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 6
  });

  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, cols, layout, virtualizer]);

  useEffect(() => {
    virtualizer.scrollToOffset(0);
  }, [layout, filtered, virtualizer]);

  const handleScroll = () => {
    const element = parentRef.current;
    if (!element || !hasMore || loading) return;
    if (element.scrollTop + element.clientHeight > element.scrollHeight - 480) {
      onLoadMore();
    }
  };

  const handleSelect = (item: VideoItem, event: React.MouseEvent) => {
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    toggleSelect(item.id, additive);
    if (!additive) select(item.id);
  };

  if (!loading && items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-panel2 text-dim">
          {filtered ? <Inbox size={20} /> : <Film size={20} />}
        </div>
        <div>
          <div className="text-[14px] font-medium text-fg">{filtered ? '没有匹配的素材' : '素材库还是空的'}</div>
          <p className="mt-1 max-w-md text-[12px] leading-5 text-dim">
            {filtered
              ? '试试清除搜索或标签筛选；也可以切到「来源清单」拉取收藏夹后再挑选。'
              : '可以先导入本地视频，或前往「来源清单」登录后拉取 B 站收藏夹/稍后再看的列表。'}
          </p>
        </div>
        {!filtered ? (
          <Button variant="primary" size="sm" onClick={onImport}>
            <FolderPlus size={13} />
            导入本地视频
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={parentRef} onScroll={handleScroll} className="scroll-thin scroll-stable h-full overflow-y-auto">
      <div style={{ height: virtualizer.getTotalSize() + TOP_PAD, position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          if (layout === 'list') {
            const item = items[virtualRow.index];
            if (!item) return null;
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start + TOP_PAD}px)`,
                  padding: `0 ${PADDING}px`
                }}
              >
                <VideoCard
                  item={item}
                  layout="list"
                  active={selectedId === item.id}
                  selected={selection.includes(item.id)}
                  onSelect={(event) => handleSelect(item, event)}
                  onOpen={() => onOpen(item.id)}
                />
              </div>
            );
          }

          const start = virtualRow.index * cols;
          const rowItems = items.slice(start, start + cols);
          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start + TOP_PAD}px)`,
                padding: `0 ${PADDING}px`
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  gap: GAP
                }}
              >
                {rowItems.map((item) => (
                  <VideoCard
                    key={item.id}
                    item={item}
                    layout="grid"
                    active={selectedId === item.id}
                    selected={selection.includes(item.id)}
                    onSelect={(event) => handleSelect(item, event)}
                    onOpen={() => onOpen(item.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-2 py-4 text-[11px] text-dim">
        {loading ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            加载中…
          </>
        ) : hasMore ? (
          <button type="button" onClick={onLoadMore} className="hover:text-fg">
            加载更多（已显示 {items.length} / {total}）
          </button>
        ) : (
          <span>
            共 {total} 条{items.length < total ? ` · 已显示 ${items.length}` : ''}
          </span>
        )}
      </div>
    </div>
  );
}
