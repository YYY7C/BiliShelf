import type { RemoteState } from '@shared/types';
import type { RemoteSeed } from '../db/sources';

/** UP 主投稿列表（`x/space/wbi/arc/search`）里的单条稿件。 */
export interface SpaceVlistItem {
  aid?: number;
  bvid?: string;
  title?: string;
  pic?: string;
  description?: string;
  created?: number;
  length?: string | number;
  author?: string;
  mid?: number;
  is_pay?: number;
  is_pay_video?: number;
  is_ugc_pay?: number;
  is_union_video?: number;
  is_lesson_video?: number;
  /** 充电专属稿件（实测字段） */
  is_charging_arc?: number;
  elec_arc_type?: number;
  elec_arc_badge?: string;
}

/** 合集 / 系列接口里的单条稿件。 */
export interface ArchiveItem {
  aid?: number;
  bvid?: string;
  title?: string;
  pic?: string;
  pubdate?: number;
  ctime?: number;
  duration?: number;
  state?: number;
  ugc_pay?: number;
  is_ugc_pay?: number;
  is_lesson_video?: number;
  is_pay_video?: number;
  rights?: { pay?: number };
}

/** 收藏夹 / 视频列表接口里的单条稿件。 */
export interface MediaItem {
  id?: number;
  bvid?: string;
  title?: string;
  cover?: string;
  pic?: string;
  duration?: number;
  cid?: number;
  upper?: { mid?: number; name?: string };
  owner?: { mid?: number; name?: string };
  pubtime?: number;
  pubdate?: number;
  fav_time?: number;
  ctime?: number;
  attr?: number;
  ugc_pay?: number;
  is_ugc_pay?: number;
  is_pay_video?: number;
  state?: number;
}

const BV_PATTERN = /^BV[0-9A-Za-z]{10}$/;
const UNAVAILABLE_TITLE = /已失效|已删除|稿件不可见|视频已下架/;

export function isBvid(value: unknown): value is string {
  return typeof value === 'string' && BV_PATTERN.test(value);
}

export function httpsUrl(url?: string | null): string | null {
  if (!url) return null;
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url;
}

export function isoFromEpoch(seconds?: number | null): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

/** `"12:34"` / `"1:02:03"` / 秒数 → 秒。 */
export function parseDuration(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  if (typeof value !== 'string') return null;
  const parts = value.trim().split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isFinite(part) || part < 0)) return null;
  return numbers.reduce((total, part) => total * 60 + part, 0);
}

function flag(value: unknown): boolean {
  return typeof value === 'number' ? value === 1 : value === true;
}

/** 充电专属 / 付费稿件。 */
export function isPaidItem(item: Record<string, unknown> | null | undefined): boolean {
  if (!item) return false;
  if (flag(item['is_pay_video']) || flag(item['is_ugc_pay']) || flag(item['ugc_pay'])) return true;
  if (flag(item['is_charge_video']) || flag(item['is_lesson_video'])) return true;
  // 空间投稿列表的实际字段：is_pay / is_charging_arc / elec_arc_type / elec_arc_badge
  if (flag(item['is_pay']) || flag(item['is_charging_arc'])) return true;
  const arcType = item['elec_arc_type'];
  if (typeof arcType === 'number' && arcType > 0) return true;
  const badge = item['elec_arc_badge'];
  if (typeof badge === 'string' && badge.trim()) return true;
  const rights = item['rights'] as { pay?: unknown } | undefined;
  return flag(rights?.pay);
}

/** 稿件是否已失效（UP 删除 / 退回 / 收藏夹里被标记）。 */
export function isUnavailableItem(item: Record<string, unknown> | null | undefined): boolean {
  if (!item) return true;
  const title = typeof item['title'] === 'string' ? item['title'] : '';
  if (UNAVAILABLE_TITLE.test(title)) return true;
  if (typeof item['state'] === 'number' && item['state'] < 0) return true;
  const attr = item['attr'];
  // 收藏夹接口的 attr bit0 = 失效
  return typeof attr === 'number' && (attr & 1) === 1;
}

function stateOf(item: Record<string, unknown>): RemoteState {
  if (isUnavailableItem(item)) return 'unavailable';
  if (isPaidItem(item)) return 'paid';
  return 'available';
}

export interface UpIdentity {
  mid: number | null;
  name: string | null;
}

/** UP 主投稿列表 → 清单条目。 */
export function mapSpaceItem(item: SpaceVlistItem, up: UpIdentity): RemoteSeed | null {
  if (!isBvid(item.bvid)) return null;
  return {
    bvid: item.bvid,
    cid: null,
    page: 1,
    title: item.title?.trim() || item.bvid,
    coverUrl: httpsUrl(item.pic),
    duration: parseDuration(item.length),
    upName: item.author ?? up.name,
    upMid: item.mid ?? up.mid,
    pubTime: isoFromEpoch(item.created),
    favTime: null,
    state: stateOf(item as Record<string, unknown>)
  };
}

/** 合集 / 系列稿件 → 清单条目。 */
export function mapArchiveItem(item: ArchiveItem, up: UpIdentity): RemoteSeed | null {
  if (!isBvid(item.bvid)) return null;
  return {
    bvid: item.bvid,
    cid: null,
    page: 1,
    title: item.title?.trim() || item.bvid,
    coverUrl: httpsUrl(item.pic),
    duration: parseDuration(item.duration ?? null),
    upName: up.name,
    upMid: up.mid,
    pubTime: isoFromEpoch(item.pubdate ?? item.ctime),
    favTime: null,
    state: stateOf(item as Record<string, unknown>)
  };
}

/** 收藏夹 / 视频列表条目 → 清单条目。 */
export function mapMediaItem(item: MediaItem): RemoteSeed | null {
  if (!isBvid(item.bvid)) return null;
  const owner = item.upper ?? item.owner;
  return {
    bvid: item.bvid,
    cid: item.cid ?? null,
    page: 1,
    title: item.title?.trim() || item.bvid,
    coverUrl: httpsUrl(item.cover ?? item.pic),
    duration: parseDuration(item.duration ?? null),
    upName: owner?.name ?? null,
    upMid: owner?.mid ?? null,
    pubTime: isoFromEpoch(item.pubtime ?? item.pubdate ?? item.ctime),
    favTime: isoFromEpoch(item.fav_time),
    state: stateOf(item as Record<string, unknown>)
  };
}

/** 批量映射并丢掉重复 / 无效条目，保留接口顺序。 */
export function mapSeeds<T>(
  items: T[],
  map: (item: T) => RemoteSeed | null,
  seen = new Set<string>()
): RemoteSeed[] {
  const seeds: RemoteSeed[] = [];
  for (const item of items) {
    const seed = map(item);
    if (!seed) continue;
    if (seen.has(seed.bvid)) continue;
    seen.add(seed.bvid);
    seeds.push(seed);
  }
  return seeds;
}
