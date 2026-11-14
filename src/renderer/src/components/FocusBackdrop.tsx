import type { VideoItem } from '@shared/types';

/** 选中视频时，用封面铺一层虚化背景；没有封面时保持纯色底。 */
export function FocusBackdrop({ item }: { item: VideoItem | null }) {
  const url = item?.localCoverUrl ?? item?.thumbUrl ?? item?.coverUrl ?? null;
  if (!url) return null;

  return (
    <div className="focus-backdrop" aria-hidden="true">
      <img key={url} src={url} alt="" draggable={false} />
      <div className="focus-backdrop-veil" />
    </div>
  );
}
