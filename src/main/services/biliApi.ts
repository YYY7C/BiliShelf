import log from 'electron-log/main';
import { getSettings } from '../store';
import { biliSession } from './auth';
import type { ArchiveItem, MediaItem, SpaceVlistItem } from './biliFeed';
import { getWbiKey, resetWbiKeyCache, signWbiQuery } from './biliWbi';

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
  pubTime: string | null;
  duration: number | null;
}

interface ViewData {
  aid?: number;
  cid?: number;
  title?: string;
  desc?: string;
  pic?: string;
  pubdate?: number;
  duration?: number;
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
      pageCount: pages.length || 1,
      pubTime:
        typeof data.pubdate === 'number' && data.pubdate > 0
          ? new Date(data.pubdate * 1000).toISOString()
          : null,
      duration: typeof data.duration === 'number' && data.duration > 0 ? data.duration : null
    };
  } catch (error) {
    log.debug('[bili] view meta failed', bvid, (error as Error).message);
    return null;
  }
}

function httpsUrl(url: string): string {
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url;
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

/* ------------------------- 订阅：UP / 合集 / 系列 ------------------------- */

export interface PagingOptions {
  onPage?: (count: number, total: number | null) => void;
  shouldCancel?: () => boolean;
}

function checkCancel(options: PagingOptions): void {
  if (options.shouldCancel?.()) throw new Error('已取消同步');
}

export interface BiliUserCard {
  mid: number;
  name: string;
  face: string | null;
  sign: string | null;
}

/** UP 主名片（公开接口，不需要签名）。 */
export async function fetchUserCard(mid: number): Promise<BiliUserCard | null> {
  try {
    const data = await apiGet<{ card?: { mid?: number; name?: string; face?: string; sign?: string } } | null>(
      `/x/web-interface/card?mid=${mid}`
    );
    const card = data?.card;
    if (!card?.mid) return null;
    return {
      mid: card.mid,
      name: card.name || `UP ${card.mid}`,
      face: card.face ? httpsUrl(card.face) : null,
      sign: card.sign ?? null
    };
  } catch (error) {
    log.warn('[bili] user card failed', mid, (error as Error).message);
    return null;
  }
}

/** nav 接口未登录时 code=-101 但 data 里有 wbi_img，所以不能走 apiGet。 */
async function fetchWbiNav(): Promise<unknown> {
  const response = await biliSession().fetch(`${API}/x/web-interface/nav`, { headers: HEADERS });
  if (!response.ok) throw new BiliApiError(response.status, `nav 接口返回 HTTP ${response.status}`);
  return (await response.json()) as unknown;
}

interface SpaceSearchData {
  list?: { vlist?: SpaceVlistItem[] | null } | null;
  page?: { count?: number; pn?: number; ps?: number } | null;
}

async function fetchSpacePage(
  mid: number,
  pn: number,
  ps: number
): Promise<{ data: SpaceSearchData; via: 'wbi' | 'legacy' }> {
  const viaWbi = async (): Promise<SpaceSearchData> => {
    const key = await getWbiKey(fetchWbiNav);
    const query = signWbiQuery(
      { mid, pn, ps, order: 'pubdate', platform: 'web', web_location: 1550101 },
      key,
      Math.floor(Date.now() / 1000)
    );
    try {
      return await apiGet<SpaceSearchData>(`/x/space/wbi/arc/search?${query}`);
    } catch (error) {
      // 密钥过期时 w_rid 会被拒绝，清缓存后下一次请求会重新取 key
      resetWbiKeyCache();
      throw error;
    }
  };

  try {
    return { data: await viaWbi(), via: 'wbi' };
  } catch (error) {
    const code = error instanceof BiliApiError ? error.code : 0;
    log.warn('[bili] space wbi search failed', mid, pn, code, (error as Error).message);
  }

  try {
    const data = await apiGet<SpaceSearchData>(
      `/x/space/arc/search?mid=${mid}&pn=${pn}&ps=${ps}&order=pubdate`
    );
    return { data, via: 'legacy' };
  } catch (error) {
    log.warn('[bili] space legacy search failed', mid, pn, (error as Error).message);
    throw error;
  }
}

export interface SpaceListResult {
  items: SpaceVlistItem[];
  total: number | null;
  via: 'wbi' | 'legacy';
}

/**
 * UP 主投稿列表。
 * 优先走 WBI 签名接口；失败后回退到旧接口。两条都失败时抛错，由上层决定是否退回 yt-dlp。
 */
export async function listSpaceVideos(
  mid: number,
  maxItems = 5000,
  options: PagingOptions = {}
): Promise<SpaceListResult> {
  const pageSize = 30;
  const items: SpaceVlistItem[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  let via: 'wbi' | 'legacy' = 'wbi';

  for (let pn = 1; items.length < maxItems; pn += 1) {
    checkCancel(options);
    const page = await fetchSpacePage(mid, pn, pageSize);
    via = page.via;
    const vlist = page.data.list?.vlist ?? [];
    if (typeof page.data.page?.count === 'number') total = page.data.page.count;
    if (vlist.length === 0) break;

    for (const item of vlist) {
      if (!item?.bvid || seen.has(item.bvid)) continue;
      seen.add(item.bvid);
      items.push(item);
      if (items.length >= maxItems) break;
    }
    options.onPage?.(items.length, total);

    if (total !== null && pn * pageSize >= total) break;
    if (vlist.length < pageSize) break;
  }

  return { items, total, via };
}

export interface SeasonMeta {
  mid: number;
  seasonId: number;
  title: string;
  cover: string | null;
  description: string | null;
  total: number;
}

interface SeasonsArchivesData {
  archives?: ArchiveItem[] | null;
  aids?: number[] | null;
  meta?: {
    mid?: number;
    season_id?: number;
    title?: string;
    name?: string;
    cover?: string;
    description?: string;
    total?: number;
  } | null;
  page?: { total?: number; page_num?: number; page_size?: number } | null;
}

function mapSeasonMeta(data: SeasonsArchivesData | null | undefined): SeasonMeta | null {
  const meta = data?.meta;
  if (!meta?.season_id) return null;
  return {
    mid: Number(meta.mid ?? 0),
    seasonId: Number(meta.season_id),
    title: meta.title || meta.name || `合集 ${meta.season_id}`,
    cover: meta.cover ? httpsUrl(meta.cover) : null,
    description: meta.description ?? null,
    total: Number(meta.total ?? data?.page?.total ?? 0)
  };
}

const SEASON_PATH = '/x/polymer/web-space/seasons_archives_list';

/** 合集（season）详情：标题 / 封面 / 总条数。 */
export async function fetchSeasonMeta(mid: number, sid: number): Promise<SeasonMeta | null> {
  try {
    const data = await apiGet<SeasonsArchivesData>(
      `${SEASON_PATH}?mid=${mid}&season_id=${sid}&sort_reverse=false&page_num=1&page_size=1`
    );
    return mapSeasonMeta(data);
  } catch (error) {
    log.warn('[bili] season meta failed', mid, sid, (error as Error).message);
    return null;
  }
}

export interface SeasonListResult {
  meta: SeasonMeta | null;
  items: ArchiveItem[];
  total: number | null;
}

/** 合集（season）稿件列表，按接口返回顺序（一般是从旧到新）。 */
export async function listSeasonArchives(
  mid: number,
  sid: number,
  maxItems = 5000,
  options: PagingOptions = {}
): Promise<SeasonListResult> {
  const pageSize = 30;
  const items: ArchiveItem[] = [];
  const seen = new Set<string>();
  let meta: SeasonMeta | null = null;
  let total: number | null = null;

  for (let pageNum = 1; items.length < maxItems; pageNum += 1) {
    checkCancel(options);
    const data = await apiGet<SeasonsArchivesData>(
      `${SEASON_PATH}?mid=${mid}&season_id=${sid}&sort_reverse=false&page_num=${pageNum}&page_size=${pageSize}`
    );
    meta = meta ?? mapSeasonMeta(data);
    if (typeof data.page?.total === 'number') total = data.page.total;
    const archives = data.archives ?? [];
    if (archives.length === 0) break;

    for (const item of archives) {
      if (!item?.bvid || seen.has(item.bvid)) continue;
      seen.add(item.bvid);
      items.push(item);
      if (items.length >= maxItems) break;
    }
    options.onPage?.(items.length, total);

    if (total !== null && pageNum * pageSize >= total) break;
    if (archives.length < pageSize) break;
  }

  return { meta, items, total };
}

export interface SeriesMeta {
  mid: number;
  seriesId: number;
  title: string;
  cover: string | null;
  total: number;
}

interface SeriesListData {
  items_lists?: {
    series_list?: Array<{
      meta?: {
        mid?: number;
        series_id?: number;
        name?: string;
        title?: string;
        cover?: string;
        total?: number;
      } | null;
    }> | null;
  } | null;
}

/**
 * 系列（series）详情。
 * `/x/series/archives` 不返回系列名，只能去 UP 的合集/系列总表里按 series_id 找。
 */
export async function fetchSeriesMeta(mid: number, sid: number): Promise<SeriesMeta | null> {
  try {
    for (let pageNum = 1; pageNum <= 8; pageNum += 1) {
      const data = await apiGet<SeriesListData>(
        `/x/polymer/web-space/seasons_series_list?mid=${mid}&page_num=${pageNum}&page_size=20`
      );
      const list = data.items_lists?.series_list ?? [];
      const hit = list.find((entry) => Number(entry?.meta?.series_id) === sid);
      if (hit?.meta) {
        return {
          mid: Number(hit.meta.mid ?? mid),
          seriesId: sid,
          title: hit.meta.name || hit.meta.title || `系列 ${sid}`,
          cover: hit.meta.cover ? httpsUrl(hit.meta.cover) : null,
          total: Number(hit.meta.total ?? 0)
        };
      }
      if (list.length === 0) break;
    }
    return null;
  } catch (error) {
    log.warn('[bili] series meta failed', mid, sid, (error as Error).message);
    return null;
  }
}

interface SeriesArchivesData {
  archives?: ArchiveItem[] | null;
  page?: { total?: number } | null;
}

/** 系列（series）稿件列表。 */
export async function listSeriesArchives(
  mid: number,
  sid: number,
  maxItems = 5000,
  options: PagingOptions = {}
): Promise<{ items: ArchiveItem[]; total: number | null }> {
  const pageSize = 30;
  const items: ArchiveItem[] = [];
  const seen = new Set<string>();
  let total: number | null = null;

  for (let pn = 1; items.length < maxItems; pn += 1) {
    checkCancel(options);
    const data = await apiGet<SeriesArchivesData>(
      `/x/series/archives?mid=${mid}&series_id=${sid}&only_normal=true&sort=desc&pn=${pn}&ps=${pageSize}`
    );
    if (typeof data.page?.total === 'number') total = data.page.total;
    const archives = data.archives ?? [];
    if (archives.length === 0) break;

    for (const item of archives) {
      if (!item?.bvid || seen.has(item.bvid)) continue;
      seen.add(item.bvid);
      items.push(item);
      if (items.length >= maxItems) break;
    }
    options.onPage?.(items.length, total);

    if (total !== null && pn * pageSize >= total) break;
    if (archives.length < pageSize) break;
  }

  return { items, total };
}

export interface MediaListMeta {
  mediaId: number;
  title: string;
  cover: string | null;
  count: number;
  ownerMid: number | null;
}

/** 视频列表 / 收藏夹详情（标题、封面、条数）。 */
export async function fetchMediaListMeta(mediaId: number): Promise<MediaListMeta | null> {
  try {
    const data = await apiGet<{
      id?: number;
      title?: string;
      cover?: string;
      media_count?: number;
      upper?: { mid?: number };
    } | null>(`/x/v3/fav/folder/info?media_id=${mediaId}`);
    if (!data?.id) return null;
    return {
      mediaId: data.id,
      title: data.title || `视频列表 ${data.id}`,
      cover: data.cover ? httpsUrl(data.cover) : null,
      count: Number(data.media_count ?? 0),
      ownerMid: data.upper?.mid ?? null
    };
  } catch (error) {
    log.warn('[bili] media list meta failed', mediaId, (error as Error).message);
    return null;
  }
}

/**
 * 视频列表 / 收藏夹条目。
 * 与「我的收藏夹」同一个接口，只是 media_id 可以是别人的公开列表。
 */
export async function listMediaListItems(
  mediaId: number,
  maxItems = 5000,
  options: PagingOptions = {}
): Promise<{ items: MediaItem[]; total: number | null }> {
  const pageSize = 40;
  const items: MediaItem[] = [];
  const seen = new Set<string>();
  let total: number | null = null;

  for (let pn = 1; items.length < maxItems; pn += 1) {
    checkCancel(options);
    const data = await apiGet<{
      medias?: MediaItem[] | null;
      has_more?: boolean;
      info?: { media_count?: number };
    }>(
      `/x/v3/fav/resource/list?media_id=${mediaId}&pn=${pn}&ps=${pageSize}&platform=web&order=mtime&type=0&tid=0`
    );
    if (typeof data?.info?.media_count === 'number') total = data.info.media_count;
    const medias = data?.medias ?? [];
    if (medias.length === 0) break;

    for (const item of medias) {
      if (!item?.bvid || seen.has(item.bvid)) continue;
      seen.add(item.bvid);
      items.push(item);
      if (items.length >= maxItems) break;
    }
    options.onPage?.(items.length, total);

    if (!data?.has_more || medias.length < pageSize) break;
  }

  return { items, total };
}

