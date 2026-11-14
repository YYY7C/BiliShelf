import log from 'electron-log/main';
import { getSettings } from '../store';
import { biliSession } from './auth';

const API = 'https://api.bilibili.com';
/**
 * 只带 Referer，不要带 Origin：
 * 实测带 Origin 时部分接口会返回 code:0 但 data:null。
 */
const HEADERS = {
  Referer: 'https://www.bilibili.com/'
};

export class BiliApiError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.name = 'BiliApiError';
  }
}

let chain: Promise<unknown> = Promise.resolve();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 所有平台请求串行 + 固定间隔，避免高并发。
 * 风控（412 / -352 / -799）直接抛错，由上层暂停队列，不做绕过。
 */
async function apiGet<T>(pathname: string): Promise<T> {
  const task = async (): Promise<T> => {
    await wait(getSettings().requestDelayMs);
    const response = await biliSession().fetch(`${API}${pathname}`, { headers: HEADERS });
    if (response.status === 412) throw new BiliApiError(412, '请求被限制（412），请稍后重试');
    if (!response.ok) throw new BiliApiError(response.status, `接口返回 HTTP ${response.status}`);
    const json = (await response.json()) as { code?: number; message?: string; data?: T };
    const code = json.code ?? 0;
    if (code !== 0) {
      throw new BiliApiError(code, json.message || `接口错误 ${code}`);
    }
    return json.data as T;
  };

  const result = chain.then(task, task);
  chain = result.catch(() => undefined);
  return result;
}

export interface NavData {
  isLogin: boolean;
  mid: number;
  uname: string;
  face: string;
}

export interface FavFolder {
  id: number;
  fid: number;
  mid: number;
  title: string;
  media_count: number;
}

export async function listFavoriteFolders(mid: number): Promise<FavFolder[]> {
  try {
    const data = await apiGet<{ list?: FavFolder[] } | null>(
      `/x/v3/fav/folder/created/list-all?up_mid=${mid}&jsonp=jsonp`
    );
    if (data?.list?.length) return data.list;
  } catch (error) {
    log.warn('[bili] list-all favorite folders failed', (error as Error).message);
  }

  // 回退：分页接口（某些账号 list-all 会返回 data:null）
  try {
    const data = await apiGet<{ list?: FavFolder[] }>(
      `/x/v3/fav/folder/created/list?up_mid=${mid}&pn=1&ps=50&jsonp=jsonp`
    );
    return data?.list ?? [];
  } catch (error) {
    log.warn('[bili] list favorite folders failed', (error as Error).message);
    return [];
  }
}

export interface FavMedia {
  id: number;
  bvid: string;
  title: string;
  cover: string;
  duration: number;
  upper?: { mid: number; name: string };
  pubtime?: number;
  fav_time?: number;
  attr?: number;
  cid?: number;
}

export async function listFavoriteItems(
  mediaId: number,
  maxPages = 200,
  options: { onPage?: (count: number) => void; shouldCancel?: () => boolean } = {}
): Promise<FavMedia[]> {
  const collected: FavMedia[] = [];
  const seen = new Set<string>();
  const pageSize = 40;

  for (let page = 1; page <= maxPages; page += 1) {
    if (options.shouldCancel?.()) throw new Error('已取消同步');
    const data = await apiGet<{
      medias?: FavMedia[] | null;
      has_more?: boolean;
      info?: { media_count?: number };
    }>(
      `/x/v3/fav/resource/list?media_id=${mediaId}&pn=${page}&ps=${pageSize}&platform=web&order=mtime&type=0&tid=0`
    );

    const medias = data?.medias ?? [];
    for (const media of medias) {
      if (!media?.bvid || seen.has(media.bvid)) continue;
      seen.add(media.bvid);
      collected.push(media);
    }
    options.onPage?.(collected.length);
    if (!data?.has_more || medias.length === 0) break;
    log.debug('[bili] favorite page', page, collected.length);
  }

  return collected;
}

export interface WatchLaterItem {
  bvid: string;
  title: string;
  pic?: string;
  duration?: number;
  cid?: number;
  owner?: { mid: number; name: string };
  pubdate?: number;
  add_at?: number;
  aid?: number;
}

export async function listWatchLater(): Promise<WatchLaterItem[]> {
  const data = await apiGet<{ list?: WatchLaterItem[] }>('/x/v2/history/toview?jsonp=jsonp');
  return data?.list ?? [];
}

export interface VideoMeta {
  cid: number | null;
  aid: number | null;
  title: string | null;
  description: string | null;
  upName: string | null;
  upMid: number | null;
  coverUrl: string | null;
  pageCount: number;
}

interface ViewData {
  aid?: number;
  cid?: number;
  title?: string;
  desc?: string;
  pic?: string;
  owner?: { mid?: number; name?: string };
  pages?: Array<{ cid?: number; page?: number; part?: string }>;
}

/**
 * 读取视频元数据（cid / aid / 简介 / UP）。
 * yt-dlp 的 info.json 不包含 cid，弹幕和分 P 去重需要它，所以这里单独查一次。
 * 该接口是视频页本身就会调用的轻量接口，不走列表同步的 600ms 串行队列。
 */
export async function fetchVideoMeta(bvid: string, page = 1): Promise<VideoMeta | null> {
  try {
    const response = await biliSession().fetch(
      `${API}/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
      { headers: HEADERS, signal: AbortSignal.timeout(10_000) }
    );
    if (!response.ok) return null;
    const json = (await response.json()) as { code?: number; data?: ViewData };
    if (json.code !== 0 || !json.data) return null;
    const data = json.data;
    const pages = data.pages ?? [];
    const target = pages.find((item) => Number(item.page) === page) ?? pages[0];
    const cid = Number(target?.cid ?? data.cid);
    return {
      cid: Number.isFinite(cid) && cid > 0 ? cid : null,
      aid: Number.isFinite(Number(data.aid)) ? Number(data.aid) : null,
      title: data.title ?? null,
      description: data.desc ?? null,
      upName: data.owner?.name ?? null,
      upMid: data.owner?.mid ?? null,
      coverUrl: data.pic ? httpsUrl(data.pic) : null,
      pageCount: pages.length || 1
    };
  } catch (error) {
    log.debug('[bili] view meta failed', bvid, (error as Error).message);
    return null;
  }
}

function httpsUrl(url: string): string {
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url;
}

export function isUnavailableMedia(media: FavMedia): boolean {
  if (!media) return true;
  const title = media.title ?? '';
  if (title.includes('已失效') || title.includes('已删除')) return true;
  // attr 位掩码：bit0 表示失效
  if (typeof media.attr === 'number') return (media.attr & 1) === 1;
  return false;
}

/** 弹幕 XML（公开接口，按 cid 获取；失败不阻塞下载）。 */
export async function fetchDanmakuXml(cid: number): Promise<string | null> {
  try {
    const response = await biliSession().fetch(`${API}/x/v1/dm/list.so?oid=${cid}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) return null;
    const text = await response.text();
    return text.includes('<d ') ? text : null;
  } catch (error) {
    log.warn('[bili] danmaku fetch failed', (error as Error).message);
    return null;
  }
}
