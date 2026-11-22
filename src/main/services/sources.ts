import log from 'electron-log/main';
import type {
  QualityPreset,
  SourceKind,
  SourcePreview,
  SourceSummary,
  SyncProgress
} from '@shared/types';
import { all, one, tx } from '../db/index';
import {
  addSource,
  applyRemoteItems,
  durationScopeSql,
  finishSyncRun,
  getSource,
  listSources,
  removeSource,
  repairRescuedItems,
  startSyncRun,
  touchSourceSync,
  updateSource,
  updateSourceMeta,
  type RemoteSeed
} from '../db/sources';
import { downloadManager } from './downloads';
import { getAuthStatus, exportCookiesFile, deleteCookiesFile } from './auth';
import {
  fetchMediaListMeta,
  fetchSeasonMeta,
  fetchSeriesMeta,
  fetchUserCard,
  fetchVideoMeta,
  listFavoriteFolders,
  listFavoriteItems,
  listMediaListItems,
  listSeasonArchives,
  listSeriesArchives,
  listSpaceVideos,
  listWatchLater
} from './biliApi';
import { isBvid, mapMediaItem, mapSeeds, mapSpaceItem, mapArchiveItem, type UpIdentity } from './biliFeed';
import {
  describeTarget,
  parseBiliInput,
  parseStoredTarget,
  targetKey,
  targetUrl,
  type BiliTarget
} from './biliUrls';
import { listFlatPlaylist } from '../engine/ytdlp';
import { engineStatus } from '../engine/tools';
import { getSettings } from '../store';
import { describeRange, isRangeEmpty, isWithinRange, normalizeRange, UNLIMITED_RANGE, type DurationRange } from '@shared/durationRange';
import { videoKeyFor } from '../db/videos';

/** 单个来源一次最多同步多少条，避免超大型 UP 把数据库和界面拖垮。 */
const MAX_ITEMS_PER_SOURCE = 5000;

/** yt-dlp 兜底时只会给出 BV 号，最多为多少条补查标题/封面。 */
const FALLBACK_ENRICH_LIMIT = 30;
const FALLBACK_ENRICH_CONCURRENCY = 3;

function isoFromEpoch(seconds?: number | null): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

/** B 站部分封面返回 http://，统一升级为 https，避免被 CSP 拦截。 */
function httpsUrl(url?: string | null): string | null {
  if (!url) return null;
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url;
}

function kindOfTarget(target: BiliTarget): SourceKind {
  if (target.kind === 'space') return 'space';
  if (target.kind === 'favorite') return 'favorite';
  return 'collection';
}

interface ResolvedTarget {
  target: BiliTarget;
  kind: SourceKind;
}

/** 跟随 b23.tv 短链，最多一跳。 */
async function expandShortLink(url: string): Promise<string> {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(12_000),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
    }
  });
  return response.url || url;
}

async function resolveTarget(input: {
  kind?: SourceKind | 'auto';
  url?: string;
  remoteId?: string;
}): Promise<ResolvedTarget> {
  const raw = (input.url ?? input.remoteId ?? '').trim();
  if (!raw) throw new Error('请输入链接或 UP 主 UID');

  const parsed = parseBiliInput(raw);
  if (!parsed.ok) throw new Error(parsed.error);

  let target = parsed.target;
  if (target.kind === 'short') {
    const expanded = await expandShortLink(target.url);
    const retried = parseBiliInput(expanded);
    if (!retried.ok) throw new Error(`短链跳转后仍无法识别：${retried.error}`);
    target = retried.target;
  }

  // 用户手选了类型但链接明确指向另一种时，以链接为准，避免把合集存成 UP 主
  return { target, kind: kindOfTarget(target) };
}

interface TargetMeta {
  title: string;
  cover: string | null;
  ownerMid: number | null;
  ownerName: string | null;
  itemCount: number | null;
}

async function resolveTargetMeta(target: BiliTarget): Promise<TargetMeta> {
  switch (target.kind) {
    case 'space': {
      const card = await fetchUserCard(target.mid);
      return {
        title: card?.name ?? `UP ${target.mid}`,
        cover: card?.face ?? null,
        ownerMid: target.mid,
        ownerName: card?.name ?? null,
        itemCount: null
      };
    }
    case 'season': {
      const meta = await fetchSeasonMeta(target.mid, target.sid);
      return {
        title: meta?.title ?? `合集 ${target.sid}`,
        cover: meta?.cover ?? null,
        ownerMid: target.mid,
        ownerName: null,
        itemCount: meta?.total ?? null
      };
    }
    case 'series': {
      const meta = await fetchSeriesMeta(target.mid, target.sid);
      return {
        title: meta?.title ?? `系列 ${target.sid}`,
        cover: meta?.cover ?? null,
        ownerMid: target.mid,
        ownerName: null,
        itemCount: meta?.total ?? null
      };
    }
    case 'medialist':
    case 'favorite': {
      const meta = await fetchMediaListMeta(target.mediaId);
      return {
        title: meta?.title ?? `视频列表 ${target.mediaId}`,
        cover: meta?.cover ?? null,
        ownerMid: meta?.ownerMid ?? (target.kind === 'favorite' ? target.ownerMid : null),
        ownerName: null,
        itemCount: meta?.count ?? null
      };
    }
    case 'short':
      return { title: target.url, cover: null, ownerMid: null, ownerName: null, itemCount: null };
  }
}

export async function addSources(input: {
  kind?: SourceKind | 'auto';
  url?: string;
  remoteId?: string;
  title?: string;
  minDuration?: number | null;
  maxDuration?: number | null;
}): Promise<SourceSummary[]> {
  const auth = await getAuthStatus();
  const kind = input.kind ?? 'auto';

  if (kind === 'favorite' && !input.url) {
    if (!auth.loggedIn || !auth.mid) {
      throw new Error('请先登录 B 站，才能读取你的收藏夹列表');
    }
    const folders = await listFavoriteFolders(auth.mid);
    if (folders.length === 0) {
      throw new Error('没有读取到收藏夹（可能是未登录或账号无收藏夹）');
    }
    for (const folder of folders) {
      addSource({
        kind: 'favorite',
        remoteId: String(folder.id),
        title: folder.title,
        ownerMid: folder.mid ?? auth.mid
      });
    }
    return listSources();
  }

  if (kind === 'watch_later') {
    if (!auth.loggedIn) throw new Error('请先登录 B 站，才能读取稍后再看');
    addSource({
      kind: 'watch_later',
      remoteId: String(auth.mid ?? 'me'),
      title: input.title || '稍后再看',
      ownerMid: auth.mid
    });
    return listSources();
  }

  const resolved = await resolveTarget({ kind, url: input.url, remoteId: input.remoteId });
  if (resolved.target.kind === 'short') throw new Error('短链解析失败，请直接粘贴空间或合集链接');

  const meta = await resolveTargetMeta(resolved.target);
  if (resolved.target.kind === 'space' && meta.ownerName === null) {
    throw new Error(`没有找到 UID ${resolved.target.mid} 对应的 UP 主`);
  }
  if (resolved.target.kind === 'season' && meta.itemCount === null) {
    throw new Error('合集不存在或不可访问，请检查 sid 是否正确');
  }
  if (resolved.target.kind === 'series' && meta.itemCount === null) {
    throw new Error('系列不存在或不可访问，请检查 sid 是否正确');
  }
  if (resolved.target.kind === 'medialist' && meta.itemCount === null) {
    throw new Error('视频列表不存在或不可访问');
  }

  const existing = one<{ id: number }>('SELECT id FROM sources WHERE kind = ? AND remote_id = ?', [
    resolved.kind,
    targetKey(resolved.target)
  ]);
  const id = addSource({
    kind: resolved.kind,
    remoteId: targetKey(resolved.target),
    title: input.title || meta.title,
    cover: meta.cover,
    ownerMid: meta.ownerMid ?? auth.mid,
    minDuration: input.minDuration,
    maxDuration: input.maxDuration
  });
  // 已存在的来源：同步一次标题/封面，并在显式给了时长区间时更新区间
  if (existing) {
    updateSourceMeta(id, { title: input.title || meta.title, cover: meta.cover });
    if (input.minDuration !== undefined || input.maxDuration !== undefined) {
      updateSource(id, { minDuration: input.minDuration, maxDuration: input.maxDuration });
    }
  }
  return listSources();
}

/**
 * 添加前的识别：返回名称、封面、条数和前几条标题，避免用户添加后才发现链接错了。
 * 拉不到清单（例如未登录时 UP 投稿被风控）不算失败，只在 warning 里说明。
 */
export async function previewSource(input: {
  url?: string;
  remoteId?: string;
  minDuration?: number | null;
  maxDuration?: number | null;
}): Promise<SourcePreview> {
  const resolved = await resolveTarget({ url: input.url, remoteId: input.remoteId });
  const target = resolved.target;
  if (target.kind === 'short') throw new Error('短链解析失败，请直接粘贴空间或合集链接');

  const meta = await resolveTargetMeta(target);
  const key = targetKey(target);
  // 时长区间只对 UP 主投稿生效；预览时用同一套规则过滤样例，避免添加后才发现被过滤空
  const range = target.kind === 'space' ? normalizeRange(input.minDuration, input.maxDuration) : UNLIMITED_RANGE;
  const base: SourcePreview = {
    target: key,
    kind: resolved.kind,
    title: meta.title,
    cover: meta.cover,
    ownerMid: meta.ownerMid,
    ownerName: meta.ownerName,
    itemCount: meta.itemCount,
    samples: [],
    warning:
      target.kind === 'space' && meta.ownerName === null ? `没有找到 UID ${target.mid} 对应的 UP 主` : null,
    url: targetUrl(target),
    description: isRangeEmpty(range)
      ? describeTarget(target, resolved.kind)
      : `${describeTarget(target, resolved.kind)} · 时长 ${describeRange(range)}`
  };

  try {
    const items = await previewItems(target, meta, range);
    const total = items.total ?? base.itemCount;
    const warnings: string[] = [];
    if (base.warning) warnings.push(base.warning);
    if (total !== null && total > MAX_ITEMS_PER_SOURCE) {
      warnings.push(`清单共 ${total} 条，单次最多同步前 ${MAX_ITEMS_PER_SOURCE} 条`);
    }
    if (!isRangeEmpty(range) && items.samples.length === 0) {
      warnings.push(`最新几条都不在时长 ${describeRange(range)} 内，同步后清单可能为空`);
    }
    return {
      ...base,
      itemCount: total,
      samples: items.samples.slice(0, 5),
      warning: warnings.length > 0 ? warnings.join('；') : null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn('[sources] preview failed', key, message);
    return { ...base, warning: `无法读取清单：${message}` };
  }
}

async function previewItems(
  target: BiliTarget,
  meta: TargetMeta,
  range: DurationRange
): Promise<{ total: number | null; samples: string[] }> {
  const up: UpIdentity = { mid: meta.ownerMid, name: meta.ownerName };
  const pick = (seeds: RemoteSeed[]) =>
    seeds.filter((seed) => isWithinRange(seed.duration, range)).map((seed) => seed.title);

  if (target.kind === 'space') {
    const result = await listSpaceVideos(target.mid, 30);
    return {
      total: result.total,
      samples: pick(mapSeeds(result.items, (item) => mapSpaceItem(item, up)))
    };
  }
  if (target.kind === 'season') {
    const result = await listSeasonArchives(target.mid, target.sid, 5);
    return {
      total: result.total,
      samples: pick(mapSeeds(result.items, (item) => mapArchiveItem(item, up)))
    };
  }
  if (target.kind === 'series') {
    const result = await listSeriesArchives(target.mid, target.sid, 5);
    return {
      total: result.total,
      samples: pick(mapSeeds(result.items, (item) => mapArchiveItem(item, up)))
    };
  }
  if (target.kind === 'medialist' || target.kind === 'favorite') {
    const result = await listMediaListItems(target.mediaId, 5);
    return {
      total: result.total,
      samples: pick(mapSeeds(result.items, mapMediaItem))
    };
  }
  return { total: null, samples: [] };
}

export async function removeSources(id: number): Promise<SourceSummary[]> {
  removeSource(id);
  return listSources();
}

interface SyncResult {
  added: number;
  updated: number;
  unavailable: number;
  /** 被订阅时长区间过滤掉、未入库的条数 */
  filtered: number;
}

export interface SyncOptions {
  onProgress?: (progress: SyncProgress) => void;
}

function mergeResults(results: SyncResult[]): SyncResult {
  return results.reduce<SyncResult>(
    (acc, item) => ({
      added: acc.added + item.added,
      updated: acc.updated + item.updated,
      unavailable: acc.unavailable + item.unavailable,
      filtered: acc.filtered + item.filtered
    }),
    { added: 0, updated: 0, unavailable: 0, filtered: 0 }
  );
}

let syncCanceled = false;

export function cancelSync(): void {
  syncCanceled = true;
}

function checkCanceled(): void {
  if (syncCanceled) throw new Error('已取消同步');
}

interface ProgressBase {
  scope: 'source' | 'all';
  index: number;
  total: number;
}

/** 正在同步的来源 id：避免用户连点或「同步全部」与单源同步同时跑同一来源。 */
const syncingSources = new Set<number>();

async function syncSourceInternal(
  sourceId: number,
  options: SyncOptions,
  progressBase: ProgressBase
): Promise<SyncResult> {
  const source = getSource(sourceId);
  if (!source) throw new Error('来源不存在');
  if (syncingSources.has(sourceId)) throw new Error('这个来源正在同步中');

  const emit = (items: number) =>
    options.onProgress?.({
      scope: progressBase.scope,
      sourceId,
      title: source.title,
      index: progressBase.index,
      total: progressBase.total,
      items
    });

  const runId = startSyncRun(sourceId);
  syncingSources.add(sourceId);
  try {
    let seeds: RemoteSeed[] = [];

    if (source.kind === 'favorite') {
      const items = await listFavoriteItems(Number(source.remote_id), 200, {
        onPage: emit,
        shouldCancel: () => syncCanceled
      });
      seeds = mapSeeds(items, mapMediaItem);
    } else if (source.kind === 'watch_later') {
      emit(0);
      const items = await listWatchLater();
      seeds = items.map((item) => ({
        bvid: item.bvid,
        cid: item.cid ?? null,
        page: 1,
        title: item.title || item.bvid,
        coverUrl: httpsUrl(item.pic),
        duration: item.duration ?? null,
        upName: item.owner?.name ?? null,
        upMid: item.owner?.mid ?? null,
        pubTime: isoFromEpoch(item.pubdate),
        favTime: isoFromEpoch(item.add_at),
        state: 'available'
      }));
    } else if (source.kind === 'space' || source.kind === 'collection') {
      seeds = await syncSubscription(source, emit);
    } else {
      throw new Error('该来源不需要同步');
    }

    checkCanceled();
    // 时长区间只对 UP 主投稿生效：超范围的条目直接不入库
    const range =
      source.kind === 'space' ? normalizeRange(source.min_duration, source.max_duration) : UNLIMITED_RANGE;
    let filtered = 0;
    if (!isRangeEmpty(range)) {
      const before = seeds.length;
      seeds = seeds.filter((seed) => isWithinRange(seed.duration, range));
      filtered = before - seeds.length;
    }

    const stats = applyRemoteItems(sourceId, seeds, {
      trustPaid: source.kind === 'space' || source.kind === 'collection',
      keepOutOfRange: range
    });
    // 失效但本地已有副本的条目，直接修回「已补档」，免得一直挂在失效列表里
    const repaired = repairRescuedItems(sourceId);
    touchSourceSync(sourceId);
    const paid = seeds.filter((seed) => seed.state === 'paid').length;
    finishSyncRun(runId, 'ok', {
      added: stats.added,
      updated: stats.updated,
      unavailable: stats.unavailable,
      paid,
      filtered,
      scanned: seeds.length
    });
    emit(seeds.length);
    log.info('[sources] synced', sourceId, {
      added: stats.added,
      updated: stats.updated,
      unavailable: stats.unavailable,
      paid,
      filtered,
      repaired
    });

    if (source.auto_download === 1 && stats.newIds.length > 0) {
      // 订阅来源可以只把「这次新出现的条目」加入队列，避免重复下载旧内容
      if (engineStatus().ready) {
        const queued = enqueueRemoteItems(stats.newIds);
        log.info('[sources] auto download new items', sourceId, queued);
      } else {
        log.warn('[sources] auto download skipped: engine not ready', sourceId, stats.newIds.length);
      }
    }

    return { added: stats.added, updated: stats.updated, unavailable: stats.unavailable, filtered };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishSyncRun(runId, 'failed', {}, message);
    throw error;
  } finally {
    syncingSources.delete(sourceId);
  }
}

/**
 * UP 主投稿 / 合集 / 系列 / 视频列表的同步。
 * 走官方列表接口（带标题、封面、时长、发布时间、充电标记）；
 * 接口被风控时退回 yt-dlp 的扁平清单，再尽量补齐元数据。
 */
async function syncSubscription(
  source: { remote_id: string; kind: SourceKind; title: string; owner_mid: number | null },
  emit: (items: number) => void
): Promise<RemoteSeed[]> {
  const target = parseStoredTarget(source.kind, source.remote_id);
  if (!target) throw new Error('来源链接无法识别，请删除后重新添加');
  emit(0);

  const options = { onPage: emit, shouldCancel: () => syncCanceled };

  try {
    if (target.kind === 'space') {
      const result = await listSpaceVideos(target.mid, MAX_ITEMS_PER_SOURCE, options);
      // UP 来源的 title 就是 UP 名，能省一次名片请求
      const identity = await resolveUpIdentity(target.mid, source.title, true);
      return mapSeeds(result.items, (item) => mapSpaceItem(item, identity));
    }
    if (target.kind === 'season') {
      const up = await resolveUpIdentity(source.owner_mid ?? target.mid, null, false);
      const result = await listSeasonArchives(target.mid, target.sid, MAX_ITEMS_PER_SOURCE, options);
      return mapSeeds(result.items, (item) => mapArchiveItem(item, up));
    }
    if (target.kind === 'series') {
      const up = await resolveUpIdentity(source.owner_mid ?? target.mid, null, false);
      const result = await listSeriesArchives(target.mid, target.sid, MAX_ITEMS_PER_SOURCE, options);
      return mapSeeds(result.items, (item) => mapArchiveItem(item, up));
    }
    if (target.kind === 'medialist' || target.kind === 'favorite') {
      const result = await listMediaListItems(target.mediaId, MAX_ITEMS_PER_SOURCE, options);
      return mapSeeds(result.items, mapMediaItem);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === '已取消同步') throw error;
    log.warn('[sources] api listing failed, falling back to yt-dlp', source.remote_id, message);
  }

  const url = targetUrl(target);
  if (!url) throw new Error('该来源没有可用的清单地址');
  const up: UpIdentity = { mid: source.owner_mid, name: source.kind === 'space' ? source.title : null };
  const seeds = await listViaYtDlp(url, up, emit);
  if (seeds.length === 0) {
    throw new Error('B 站没有返回清单（可能是风控或链接已失效），请先登录 B 站后重试');
  }
  return seeds;
}

/**
 * 补充 UP 名。合集/系列的 sources.title 是合集名，不能直接当 UP 名用；
 * UP 来源则有可信的 title，只有形如「UP 123」的兜底标题才需要查名片。
 */
async function resolveUpIdentity(
  mid: number | null,
  fallbackName: string | null,
  preferFallback: boolean
): Promise<UpIdentity> {
  if (!mid) return { mid: null, name: fallbackName };
  if (preferFallback && fallbackName && !/^UP \d+$/.test(fallbackName)) {
    return { mid, name: fallbackName };
  }
  const card = await fetchUserCard(mid);
  return { mid, name: card?.name ?? fallbackName };
}

/** yt-dlp 兜底：只能拿到 BV 号，必要时为少量条目补查标题与封面。 */
async function listViaYtDlp(url: string, up: UpIdentity, emit: (items: number) => void): Promise<RemoteSeed[]> {
  const cookiesFile = await exportCookiesFile();
  try {
    const entries = await listFlatPlaylist(url, cookiesFile, getSettings().downloadProxy);
    const seeds: RemoteSeed[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      const match = `${entry.id} ${entry.url ?? ''}`.match(/BV[0-9A-Za-z]{10}/);
      const bvid = match?.[0];
      if (!isBvid(bvid) || seen.has(bvid)) continue;
      seen.add(bvid);
      const hasTitle = Boolean(entry.title && entry.title !== entry.id && !isBvid(entry.title));
      seeds.push({
        bvid,
        cid: null,
        page: 1,
        title: hasTitle ? entry.title! : bvid,
        coverUrl: httpsUrl(entry.thumbnail),
        duration: typeof entry.duration === 'number' ? entry.duration : null,
        upName: entry.uploader ?? up.name,
        upMid: entry.uploader_id ? Number(entry.uploader_id) : up.mid,
        pubTime: isoFromEpoch(entry.timestamp),
        favTime: null,
        state: 'available'
      });
    }
    emit(seeds.length);

    const missing = seeds.filter((seed) => seed.title === seed.bvid).slice(0, FALLBACK_ENRICH_LIMIT);
    for (let index = 0; index < missing.length; index += FALLBACK_ENRICH_CONCURRENCY) {
      if (syncCanceled) throw new Error('已取消同步');
      const batch = missing.slice(index, index + FALLBACK_ENRICH_CONCURRENCY);
      await Promise.all(
        batch.map(async (seed) => {
          const meta = await fetchVideoMeta(seed.bvid);
          if (!meta) return;
          seed.title = meta.title ?? seed.title;
          seed.coverUrl = seed.coverUrl ?? meta.coverUrl;
          seed.upName = seed.upName ?? meta.upName;
          seed.upMid = seed.upMid ?? meta.upMid;
          seed.pubTime = seed.pubTime ?? meta.pubTime;
          seed.duration = seed.duration ?? meta.duration;
        })
      );
      emit(index + batch.length);
    }
    return seeds;
  } finally {
    await deleteCookiesFile(cookiesFile);
  }
}

export async function syncSource(sourceId: number, options: SyncOptions = {}): Promise<SyncResult> {
  syncCanceled = false;
  return syncSourceInternal(sourceId, options, { scope: 'source', index: 1, total: 1 });
}

export async function syncAllSources(options: SyncOptions = {}): Promise<SyncResult & { failed: number }> {
  syncCanceled = false;
  const rows = all<{ id: number; last_synced_at: string | null }>(
    'SELECT id, last_synced_at FROM sources WHERE sync_enabled = 1'
  );
  const results: SyncResult[] = [];
  const errors: string[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    checkCanceled();
    try {
      results.push(
        await syncSourceInternal(row.id, options, { scope: 'all', index: index + 1, total: rows.length })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === '已取消同步') throw error;
      errors.push(message);
    }
  }

  if (results.length === 0 && errors.length > 0) throw new Error(errors[0]);
  return { ...mergeResults(results), failed: errors.length };
}

/* ------------------------------- enqueue -------------------------------- */

interface EnqueueRow {
  id: number;
  source_id: number;
  bvid: string;
  cid: number | null;
  page: number;
  title: string;
  state: string;
  /** 是否落在所属来源的时长区间内（UP 主投稿才可能为 0） */
  in_scope: number;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',');
}

/**
 * 把清单条目加入下载队列。
 * 这里一次性预取视频/任务状态，避免 4000 条时产生上万次单行查询。
 */
export function enqueueRemoteItems(
  remoteItemIds: number[],
  quality?: QualityPreset,
  options: { defer?: boolean } = {}
): { queued: number; skipped: number } {
  const ids = Array.from(new Set(remoteItemIds.filter((id) => Number.isFinite(id) && id > 0)));
  if (ids.length === 0) return { queued: 0, skipped: 0 };

  const rows = all<EnqueueRow>(
    `SELECT r.id, r.source_id, r.bvid, r.cid, r.page, r.title, r.state,
       CASE WHEN ${durationScopeSql('s', 'r')} THEN 1 ELSE 0 END AS in_scope
     FROM remote_items r JOIN sources s ON s.id = r.source_id
     WHERE r.id IN (${placeholders(ids.length)})`,
    ids
  );
  const blocked = new Set(['unavailable', 'paid']);
  const candidates = rows.filter((row) => !blocked.has(row.state) && row.in_scope === 1);
  if (candidates.length === 0) return { queued: 0, skipped: rows.length };

  const keys = candidates.map((row) => videoKeyFor(row.bvid, row.page));
  const present = new Set(
    all<{ video_key: string }>(
      `SELECT video_key FROM videos WHERE video_key IN (${placeholders(keys.length)}) AND status IN ('present','trashed')`,
      keys
    ).map((row) => row.video_key)
  );

  const inputs = [];
  for (const row of candidates) {
    const key = videoKeyFor(row.bvid, row.page);
    if (present.has(key)) continue;
    inputs.push({
      bvid: row.bvid,
      cid: row.cid,
      page: row.page,
      title: row.title,
      sourceId: row.source_id,
      remoteItemId: row.id,
      quality
    });
  }

  const result = downloadManager.enqueue(inputs, { defer: options.defer });
  return { queued: result.queued, skipped: result.skipped + (rows.length - candidates.length) };
}

function buildEnqueueWhere(options: { sourceId?: number | null }): { where: string[]; params: unknown[] } {
  // 失效与充电专属都不能直接下载：前者已不可用，后者需要付费/充电权限；
  // 超出订阅时长区间的条目在清单里都看不到，同样不能入队
  const where = ["r.state NOT IN ('unavailable','paid')", durationScopeSql('s', 'r')];
  const params: unknown[] = [];
  if (options.sourceId != null) {
    where.push('r.source_id = ?');
    params.push(options.sourceId);
  } else {
    where.push("s.kind = 'favorite'");
  }
  // 收藏夹条目的 cid 为 NULL，不能用 COALESCE(v.cid,0) 比较（回填后 v.cid 会变成真实值）；
  // 只有清单条目本身带 cid 时才要求 cid 匹配。
  where.push(`NOT EXISTS (
    SELECT 1 FROM videos v
     WHERE v.bvid = r.bvid AND v.page = r.page
       AND (r.cid IS NULL OR v.cid = r.cid)
       AND v.status IN ('present', 'trashed')
  )`);
  where.push(`NOT EXISTS (
    SELECT 1 FROM download_jobs j
     WHERE j.bvid = r.bvid AND j.page = r.page
       AND (r.cid IS NULL OR j.cid = r.cid)
       AND j.status IN ('queued', 'resolving', 'downloading', 'postprocessing')
  )`);
  return { where, params };
}

function listEnqueueCandidateIds(options: { sourceId?: number | null }): number[] {
  const { where, params } = buildEnqueueWhere(options);
  return all<{ id: number }>(
    `SELECT r.id FROM remote_items r JOIN sources s ON s.id = r.source_id
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(r.fav_time, r.pub_time, r.last_seen_at) DESC, r.id DESC`,
    params
  ).map((row) => row.id);
}

/** 「下载全部」确认框里的精确数量，排除已下载、回收站、队列中与跨收藏夹重复。 */
export function countEnqueueCandidates(options: { sourceId?: number | null }): { total: number } {
  return { total: listEnqueueCandidateIds(options).length };
}

export function enqueueAllRemoteItems(options: {
  sourceId?: number | null;
  quality?: QualityPreset;
}): { total: number; queued: number; skipped: number } {
  const ids = listEnqueueCandidateIds(options);
  if (ids.length === 0) return { total: 0, queued: 0, skipped: 0 };

  let queued = 0;
  let skipped = 0;
  // 单事务写入，避免 4000 条任务逐条提交把主进程卡住
  tx(() => {
    for (let index = 0; index < ids.length; index += 500) {
      const result = enqueueRemoteItems(ids.slice(index, index + 500), options.quality, { defer: true });
      queued += result.queued;
      skipped += result.skipped;
    }
  });
  downloadManager.flush();
  return { total: ids.length, queued, skipped };
}
