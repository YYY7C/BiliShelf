/**
 * 视频去重键：同一视频的不同分 P 视为不同条目。
 * 只用 bvid + page，不包含 cid —— 收藏夹接口没有 cid，
 * 若把 cid 放进键里，同一视频从收藏夹和稍后再看下载会被当成两个视频。
 */
export function videoKeyFor(bvid: string, page: number): string {
  return `bv:${bvid}:${page}`;
}

/** 清单条目键：收藏夹接口不返回 cid，用 0 占位。 */
export function remoteItemKey(bvid: string, cid: number | null | undefined, page: number): string {
  return `${bvid}:${cid ?? 0}:${page}`;
}
