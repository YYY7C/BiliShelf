import log from 'electron-log/main';
import type { QualityPreset, SourceKind, SourceSummary } from '@shared/types';
import { all, one, run } from '../db/index';
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
import { findActiveJob } from '../db/jobs';

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

  // 新增来源默认参与“同步全部”
  run('UPDATE sources SET sync_enabled = 1 WHERE sync_enabled = 0');
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

export async function syncSource(sourceId: number): Promise<SyncResult> {
  const source = getSource(sourceId);
  if (!source) throw new Error('来源不存在');

  const runId = startSyncRun(sourceId);
  try {
    let seeds: RemoteSeed[] = [];

    if (source.kind === 'favorite') {
      const items = await listFavoriteItems(Number(source.remote_id));
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

    const stats = applyRemoteItems(sourceId, seeds);
    touchSourceSync(sourceId);
    finishSyncRun(runId, 'ok', { ...stats, scanned: seeds.length });
    log.info('[sources] synced', sourceId, stats);
    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishSyncRun(runId, 'failed', {}, message);
    throw error;
  }
}

export async function syncAllSources(): Promise<SyncResult> {
  const rows = all<{ id: number; last_synced_at: string | null }>(
    'SELECT id, last_synced_at FROM sources WHERE sync_enabled = 1'
  );
  const results: SyncResult[] = [];
  const errors: string[] = [];

  for (const row of rows) {
    try {
      results.push(await syncSource(row.id));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (results.length === 0 && errors.length > 0) throw new Error(errors[0]);
  return mergeResults(results);
}

export async function enqueueRemoteItems(
  remoteItemIds: number[],
  quality?: QualityPreset
): Promise<{ queued: number; skipped: number }> {
  const inputs = [];
  for (const id of remoteItemIds) {
    const item = one<{
      id: number;
      source_id: number;
      bvid: string;
      cid: number | null;
      page: number;
      title: string;
      state: string;
    }>('SELECT id, source_id, bvid, cid, page, title, state FROM remote_items WHERE id = ?', [id]);
    if (!item) continue;
    if (item.state === 'unavailable') continue;

    const key = videoKeyFor(item.bvid, item.cid, item.page);
    const existing = one<{ id: number }>(
      "SELECT id FROM videos WHERE video_key = ? AND status = 'present'",
      [key]
    );
    if (existing) continue;
    if (findActiveJob(key)) continue;

    inputs.push({
      bvid: item.bvid,
      cid: item.cid,
      page: item.page,
      title: item.title,
      sourceId: item.source_id,
      remoteItemId: item.id,
      quality
    });
  }

  return downloadManager.enqueue(inputs);
}
