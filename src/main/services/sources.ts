import log from 'electron-log/main';
import type { QualityPreset, SourceKind, SourceSummary, SyncProgress } from '@shared/types';
import { all, tx } from '../db/index';
import {
  addSource,
  applyRemoteItems,
  finishSyncRun,
  getSource,
  listSources,
  removeSource,
  startSyncRun,
  touchSourceSync,
  type RemoteSeed
} from '../db/sources';
import { downloadManager } from './downloads';
import { getAuthStatus, exportCookiesFile, deleteCookiesFile } from './auth';
import { isUnavailableMedia, listFavoriteFolders, listFavoriteItems, listWatchLater } from './biliApi';
import { listFlatPlaylist } from '../engine/ytdlp';
import { videoKeyFor } from '../db/videos';

function isoFromEpoch(seconds?: number | null): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

/** B 站部分封面返回 http://，统一升级为 https，避免被 CSP 拦截。 */
function httpsUrl(url?: string | null): string | null {
  if (!url) return null;
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url;
}

export async function addSources(input: {
  kind: SourceKind;
  url?: string;
  remoteId?: string;
  title?: string;
}): Promise<SourceSummary[]> {
  const auth = await getAuthStatus();

  if (input.kind === 'favorite') {
    if (input.remoteId) {
      addSource({
        kind: 'favorite',
        remoteId: input.remoteId,
        title: input.title || `收藏夹 ${input.remoteId}`,
        ownerMid: auth.mid
      });
    } else {
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
    }
  } else if (input.kind === 'watch_later') {
    if (!auth.loggedIn) throw new Error('请先登录 B 站，才能读取稍后再看');
    addSource({
      kind: 'watch_later',
      remoteId: String(auth.mid ?? 'me'),
      title: input.title || '稍后再看',
      ownerMid: auth.mid
    });
  } else if (input.kind === 'space' || input.kind === 'collection') {
    const url = (input.url ?? '').trim();
    if (!/^https?:\/\/(space|www)\.bilibili\.com\//i.test(url)) {
      throw new Error('请输入 space.bilibili.com 的 UP 主或合集链接');
    }
    const midMatch = url.match(/space\.bilibili\.com\/(\d+)/i);
    addSource({
      kind: input.kind,
      remoteId: url,
      title: input.title || (midMatch ? `UP ${midMatch[1]}` : 'B 站合集'),
      ownerMid: midMatch ? Number(midMatch[1]) : null
    });
  } else {
    throw new Error('不支持的来源类型');
  }

  // 新来源在 addSource 里默认 sync_enabled = 1，不会影响已关闭的来源
  return listSources();
}

export async function removeSources(id: number): Promise<SourceSummary[]> {
  removeSource(id);
  return listSources();
}

interface SyncResult {
  added: number;
  updated: number;
  unavailable: number;
}

export interface SyncOptions {
  onProgress?: (progress: SyncProgress) => void;
}

function mergeResults(results: SyncResult[]): SyncResult {
  return results.reduce<SyncResult>(
    (acc, item) => ({
      added: acc.added + item.added,
      updated: acc.updated + item.updated,
      unavailable: acc.unavailable + item.unavailable
    }),
    { added: 0, updated: 0, unavailable: 0 }
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

async function syncSourceInternal(
  sourceId: number,
  options: SyncOptions,
  progressBase: ProgressBase
): Promise<SyncResult> {
  const source = getSource(sourceId);
  if (!source) throw new Error('来源不存在');

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
  try {
    let seeds: RemoteSeed[] = [];

    if (source.kind === 'favorite') {
      const items = await listFavoriteItems(Number(source.remote_id), 200, {
        onPage: emit,
        shouldCancel: () => syncCanceled
      });
      seeds = items.map((item) => ({
        bvid: item.bvid,
        cid: null,
        page: 1,
        title: item.title || item.bvid,
        coverUrl: httpsUrl(item.cover),
        duration: item.duration ?? null,
        upName: item.upper?.name ?? null,
        upMid: item.upper?.mid ?? null,
        pubTime: isoFromEpoch(item.pubtime),
        favTime: isoFromEpoch(item.fav_time),
        state: isUnavailableMedia(item) ? 'unavailable' : 'available'
      }));
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
      emit(0);
      const cookiesFile = await exportCookiesFile();
      try {
        const entries = await listFlatPlaylist(source.remote_id, cookiesFile);
        seeds = entries.map((entry) => {
          const bvidMatch = `${entry.id} ${entry.url ?? ''}`.match(/BV[0-9A-Za-z]{10}/);
          return {
            bvid: bvidMatch?.[0] ?? entry.id,
            cid: null,
            page: 1,
            title: entry.title || entry.id,
            coverUrl: httpsUrl(entry.thumbnail),
            duration: typeof entry.duration === 'number' ? entry.duration : null,
            upName: entry.uploader ?? null,
            upMid: entry.uploader_id ? Number(entry.uploader_id) : null,
            pubTime: isoFromEpoch(entry.timestamp),
            favTime: null,
            state: 'available'
          };
        });
      } finally {
        await deleteCookiesFile(cookiesFile);
      }
    } else {
      throw new Error('该来源不需要同步');
    }

    checkCanceled();
    const stats = applyRemoteItems(sourceId, seeds);
    touchSourceSync(sourceId);
    finishSyncRun(runId, 'ok', { ...stats, scanned: seeds.length });
    emit(seeds.length);
    log.info('[sources] synced', sourceId, stats);
    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishSyncRun(runId, 'failed', {}, message);
    throw error;
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
    `SELECT id, source_id, bvid, cid, page, title, state FROM remote_items WHERE id IN (${placeholders(ids.length)})`,
    ids
  );
  const candidates = rows.filter((row) => row.state !== 'unavailable');
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
  const where = ["r.state <> 'unavailable'"];
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
