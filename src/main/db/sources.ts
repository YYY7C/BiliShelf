import log from 'electron-log/main';
import { remoteItemKey } from '@shared/media';
import type {
  JobStatus,
  RemoteItemsQuery,
  RemoteItemsResult,
  RemoteState,
  RescueListItem,
  SourceKind,
  SourceSummary
} from '@shared/types';
import { isRangeEmpty, normalizeRange, type DurationRange } from '@shared/durationRange';
import { parseStoredTarget } from '../services/biliUrls';
import { all, one, run, tx } from './index';

function now(): string {
  return new Date().toISOString();
}

/**
 * 时长区间的 SQL 条件（只对 UP 主投稿生效，其它来源的 min/max 恒为 NULL）。
 * duration 未知的条目视为不限，否则接口一次缺字段就会把清单过滤空。
 */
export function durationScopeSql(sourceAlias = 's', itemAlias = 'r'): string {
  return `((${sourceAlias}.min_duration IS NULL AND ${sourceAlias}.max_duration IS NULL)
      OR ${itemAlias}.duration IS NULL
      OR ((${sourceAlias}.min_duration IS NULL OR ${itemAlias}.duration >= ${sourceAlias}.min_duration)
          AND (${sourceAlias}.max_duration IS NULL OR ${itemAlias}.duration <= ${sourceAlias}.max_duration)))`;
}

/** 把区间拼成字面量条件（值经过 normalizeRange 保证是整数，可安全内联）。 */
function durationRangeClause(range: DurationRange): string {
  if (isRangeEmpty(range)) return '';
  const parts: string[] = [];
  if (range.min != null) parts.push(`duration >= ${range.min}`);
  if (range.max != null) parts.push(`duration <= ${range.max}`);
  return ` AND (duration IS NULL OR (${parts.join(' AND ')}))`;
}

interface SourceRow {
  id: number;
  kind: SourceKind;
  remote_id: string;
  title: string;
  cover: string | null;
  owner_mid: number | null;
  note: string | null;
  last_synced_at: string | null;
  sync_enabled: number;
  auto_download: number;
  min_duration: number | null;
  max_duration: number | null;
}

/** 列表查询额外带出来的聚合列。 */
interface SourceListRow extends SourceRow {
  item_count: number;
  downloaded_count: number;
  unavailable_count: number;
  paid_count: number;
  last_stats_json: string | null;
  cover_item_id?: number | null;
  remote_cover?: string | null;
}

export type { SourceRow };

function lastAddedOf(statsJson: string | null): number {
  if (!statsJson) return 0;
  try {
    const parsed = JSON.parse(statsJson) as { added?: unknown };
    return typeof parsed.added === 'number' ? parsed.added : 0;
  } catch {
    return 0;
  }
}

export function listSources(): SourceSummary[] {
  const scope = durationScopeSql('s', 'r');
  const rows = all<SourceListRow>(`SELECT s.*,
      (SELECT COUNT(*) FROM remote_items r WHERE r.source_id = s.id AND ${scope}) AS item_count,
      (SELECT COUNT(*) FROM remote_items r JOIN videos v
        ON v.bvid = r.bvid AND v.page = r.page AND (r.cid IS NULL OR v.cid = r.cid)
        WHERE r.source_id = s.id AND v.status IN ('present', 'trashed') AND ${scope}) AS downloaded_count,
      (SELECT COUNT(*) FROM remote_items r
        WHERE r.source_id = s.id AND r.state = 'unavailable' AND ${scope}) AS unavailable_count,
      (SELECT COUNT(*) FROM remote_items r
        WHERE r.source_id = s.id AND r.state = 'paid' AND ${scope}) AS paid_count,
      (SELECT sr.stats_json FROM sync_runs sr
        WHERE sr.source_id = s.id AND sr.status IN ('ok', 'partial')
        ORDER BY sr.id DESC LIMIT 1) AS last_stats_json,
      (SELECT r.id FROM remote_items r
        WHERE r.source_id = s.id AND r.local_cover IS NOT NULL AND ${scope}
        ORDER BY COALESCE(r.fav_time, r.pub_time, r.last_seen_at) DESC, r.id DESC
        LIMIT 1) AS cover_item_id,
      (SELECT r.cover_url FROM remote_items r
        WHERE r.source_id = s.id AND r.cover_url IS NOT NULL AND r.cover_url <> '' AND ${scope}
        ORDER BY COALESCE(r.fav_time, r.pub_time, r.last_seen_at) DESC, r.id DESC
        LIMIT 1) AS remote_cover
    FROM sources s
    ORDER BY s.id ASC`);

  return rows.map((row) => {
    const target = parseStoredTarget(row.kind, row.remote_id);
    return {
      id: row.id,
      kind: row.kind,
      remoteId: row.remote_id,
      title: row.title,
      cover:
        row.cover ?? (row.cover_item_id ? `bilishelf://cover/${row.cover_item_id}` : row.remote_cover ?? null),
      ownerMid: row.owner_mid,
      note: row.note,
      itemCount: row.item_count,
      downloadedCount: row.downloaded_count,
      unavailableCount: row.unavailable_count,
      paidCount: row.paid_count ?? 0,
      lastAdded: lastAddedOf(row.last_stats_json),
      collectionType:
        target && (target.kind === 'season' || target.kind === 'series' || target.kind === 'medialist')
          ? target.kind
          : null,
      lastSyncedAt: row.last_synced_at,
      syncEnabled: row.sync_enabled === 1,
      autoDownload: row.auto_download === 1,
      minDuration: row.min_duration ?? null,
      maxDuration: row.max_duration ?? null
    };
  });
}

export function getSource(id: number): SourceRow | undefined {
  return one<SourceRow>('SELECT * FROM sources WHERE id = ?', [id]);
}

export function addSource(input: {
  kind: SourceKind;
  remoteId: string;
  title: string;
  cover?: string | null;
  ownerMid?: number | null;
  autoDownload?: boolean;
  minDuration?: number | null;
  maxDuration?: number | null;
}): number {
  const existing = one<{ id: number }>('SELECT id FROM sources WHERE kind = ? AND remote_id = ?', [
    input.kind,
    input.remoteId
  ]);
  if (existing) return existing.id;
  // 时长区间只对 UP 主投稿有意义，其它类型不落库，避免以后误判
  const range =
    input.kind === 'space' ? normalizeRange(input.minDuration, input.maxDuration) : { min: null, max: null };
  const result = run(
    'INSERT INTO sources (kind, remote_id, title, cover, owner_mid, sync_enabled, auto_download, min_duration, max_duration, created_at) VALUES (?,?,?,?,?,1,?,?,?,?)',
    [
      input.kind,
      input.remoteId,
      input.title,
      input.cover ?? null,
      input.ownerMid ?? null,
      input.autoDownload ? 1 : 0,
      range.min,
      range.max,
      now()
    ]
  );
  return Number(result.lastInsertRowid);
}

/** 新增条目后回填标题/封面（添加时只拿到名字，同步后才拿到封面）。 */
export function updateSourceMeta(id: number, patch: { title?: string; cover?: string | null }): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push('title = ?');
    params.push(patch.title);
  }
  if (patch.cover !== undefined) {
    sets.push('cover = ?');
    params.push(patch.cover);
  }
  if (sets.length === 0) return;
  params.push(id);
  run(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`, params);
}

export function removeSource(id: number): void {
  run('DELETE FROM sources WHERE id = ?', [id]);
}

/**
 * 把「B 站已不可播放、但本地其实有副本」的清单条目修回来。
 * 返回修复条数。`rescued` 状态不会被每轮同步的失效扫描覆盖。
 */
export function repairRescuedItems(sourceId?: number | null): number {
  const params: unknown[] = [];
  let scope = '';
  if (sourceId != null) {
    scope = ' AND r.source_id = ?';
    params.push(sourceId);
  }
  const result = run(
    `UPDATE remote_items AS r SET state = 'rescued'
      WHERE r.state = 'unavailable'
        ${scope}
        AND EXISTS (
          SELECT 1 FROM videos v
           WHERE v.bvid = r.bvid AND v.page = r.page
             AND v.status IN ('present', 'trashed')
        )`,
    params
  );
  return result.changes;
}

/** 应用内「失效清单」：跨来源列出所有失效 / 已补档条目。 */
export function listRescueItems(): RescueListItem[] {
  return all<{
    id: number;
    source_id: number;
    source_title: string;
    bvid: string;
    page: number;
    title: string;
    up_name: string | null;
    duration: number | null;
    state: RemoteState;
    last_seen_at: string | null;
    local_video_id: number | null;
  }>(
    `SELECT r.id, r.source_id, s.title AS source_title, r.bvid, r.page, r.title,
            r.up_name, r.duration, r.state, r.last_seen_at,
            (SELECT v.id FROM videos v
              WHERE v.bvid = r.bvid AND v.page = r.page AND v.status IN ('present','trashed')
              ORDER BY CASE v.status WHEN 'present' THEN 0 ELSE 1 END LIMIT 1) AS local_video_id
       FROM remote_items r JOIN sources s ON s.id = r.source_id
      WHERE r.state IN ('unavailable', 'rescued')
      ORDER BY CASE r.state WHEN 'unavailable' THEN 0 ELSE 1 END, r.id DESC
      LIMIT 2000`
  ).map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    sourceTitle: row.source_title,
    bvid: row.bvid,
    page: row.page,
    title: row.title,
    upName: row.up_name,
    duration: row.duration,
    state: row.state,
    lastSeenAt: row.last_seen_at,
    localVideoId: row.local_video_id
  }));
}

export function updateSource(
  id: number,
  patch: {
    syncEnabled?: boolean;
    autoDownload?: boolean;
    minDuration?: number | null;
    maxDuration?: number | null;
    note?: string | null;
  }
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.syncEnabled !== undefined) {
    sets.push('sync_enabled = ?');
    params.push(patch.syncEnabled ? 1 : 0);
  }
  if (patch.autoDownload !== undefined) {
    sets.push('auto_download = ?');
    params.push(patch.autoDownload ? 1 : 0);
  }
  if (patch.minDuration !== undefined || patch.maxDuration !== undefined) {
    // 只改一端时与库里的另一端合并，再统一规整，避免出现 min > max
    const current = one<{ min_duration: number | null; max_duration: number | null; kind: SourceKind }>(
      'SELECT min_duration, max_duration, kind FROM sources WHERE id = ?',
      [id]
    );
    const range =
      current?.kind === 'space'
        ? normalizeRange(
            patch.minDuration !== undefined ? patch.minDuration : current?.min_duration,
            patch.maxDuration !== undefined ? patch.maxDuration : current?.max_duration
          )
        : { min: null, max: null };
    sets.push('min_duration = ?', 'max_duration = ?');
    params.push(range.min, range.max);
  }
  if (patch.note !== undefined) {
    sets.push('note = ?');
    const note = patch.note?.trim() ?? '';
    params.push(note ? note : null);
  }
  if (sets.length === 0) return;
  params.push(id);
  run(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`, params);
}

export function touchSourceSync(id: number): void {
  run('UPDATE sources SET last_synced_at = ? WHERE id = ?', [now(), id]);
}

export interface RemoteSeed {
  bvid: string;
  cid?: number | null;
  page?: number;
  title: string;
  coverUrl?: string | null;
  duration?: number | null;
  upName?: string | null;
  upMid?: number | null;
  pubTime?: string | null;
  favTime?: string | null;
  tags?: string[];
  state?: RemoteState;
}

export { remoteItemKey };

/**
 * 一次同步的写入流程：
 * 1) 先把已有条目标记为 stale；
 * 2) upsert 本轮见到的条目为 available；
 * 3) stale 的条目变 unavailable（不删除，便于用户保留本地文件/看到失效）。
 */
export function applyRemoteItems(
  sourceId: number,
  items: RemoteSeed[],
  options: { trustPaid?: boolean; keepOutOfRange?: DurationRange } = {}
): { added: number; updated: number; unavailable: number; newIds: number[] } {
  // 收藏夹/稍后再看的接口不带付费标记，此时下载失败写回的「充电专属」不能被每轮同步清掉
  const preservePaid = options.trustPaid === false ? 1 : 0;
  // 被时长区间挡在外面的条目根本没进 seeds，不能把它们当成本轮「没见到」而标失效
  const keepRange = durationRangeClause(options.keepOutOfRange ?? { min: null, max: null });
  return tx(() => {
    const timestamp = now();
    const before = one<{ c: number }>('SELECT COUNT(*) AS c FROM remote_items WHERE source_id = ?', [sourceId])?.c ?? 0;
    const beforeKeys = new Set(
      all<{ item_key: string }>('SELECT item_key FROM remote_items WHERE source_id = ?', [sourceId]).map(
        (row) => row.item_key
      )
    );
    const newIds: number[] = [];

    run(
      // 只重置「可下载」，充电专属是下载失败时记录下来的结论，接口不会每次都给，不能每轮清掉
      `UPDATE remote_items SET state = 'unknown' WHERE source_id = ? AND state = 'available'${keepRange}`,
      [sourceId]
    );

    const upsert = () => {
      for (const item of items) {
        const page = item.page ?? 1;
        const key = remoteItemKey(item.bvid, item.cid, page);
        const isNew = !beforeKeys.has(key);
        const result = run(
          `INSERT INTO remote_items (
            source_id, item_key, bvid, cid, page, title, cover_url, duration, up_name, up_mid,
            pub_time, fav_time, tags_json, state, first_seen_at, last_seen_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(source_id, item_key) DO UPDATE SET
            title = excluded.title,
            cover_url = COALESCE(excluded.cover_url, remote_items.cover_url),
            duration = COALESCE(excluded.duration, remote_items.duration),
            up_name = COALESCE(excluded.up_name, remote_items.up_name),
            up_mid = COALESCE(excluded.up_mid, remote_items.up_mid),
            pub_time = COALESCE(excluded.pub_time, remote_items.pub_time),
            fav_time = COALESCE(excluded.fav_time, remote_items.fav_time),
            tags_json = COALESCE(excluded.tags_json, remote_items.tags_json),
            state = CASE
              WHEN ? = 1 AND remote_items.state = 'paid' AND excluded.state = 'available' THEN 'paid'
              ELSE excluded.state
            END,
            last_seen_at = excluded.last_seen_at`,
          [
            sourceId,
            key,
            item.bvid,
            item.cid ?? null,
            page,
            item.title,
            item.coverUrl ?? null,
            item.duration ?? null,
            item.upName ?? null,
            item.upMid ?? null,
            item.pubTime ?? null,
            item.favTime ?? null,
            item.tags?.length ? JSON.stringify(item.tags) : null,
            item.state ?? 'available',
            timestamp,
            timestamp,
            preservePaid
          ]
        );
        if (isNew) {
          beforeKeys.add(key);
          newIds.push(Number(result.lastInsertRowid));
        }
      }
    };
    upsert();

    run(
      `UPDATE remote_items SET state = 'unavailable' WHERE source_id = ? AND state = 'unknown'${keepRange}`,
      [sourceId]
    );

    const after = one<{ c: number }>('SELECT COUNT(*) AS c FROM remote_items WHERE source_id = ?', [sourceId])?.c ?? 0;
    const unavailable =
      one<{ c: number }>("SELECT COUNT(*) AS c FROM remote_items WHERE source_id = ? AND state = 'unavailable'", [
        sourceId
      ])?.c ?? 0;

    const added = Math.max(0, after - before);
    return { added, updated: Math.max(0, items.length - added), unavailable, newIds };
  });
}

interface RemoteRow {
  id: number;
  source_id: number;
  bvid: string;
  cid: number | null;
  page: number;
  title: string;
  cover_url: string | null;
  local_cover: string | null;
  duration: number | null;
  up_name: string | null;
  up_mid: number | null;
  pub_time: string | null;
  fav_time: string | null;
  tags_json: string | null;
  state: RemoteState;
  downloaded_video_id: number | null;
  downloaded_source_id?: number | null;
  job_status: JobStatus | null;
  width?: number | null;
  height?: number | null;
  vcodec?: string | null;
  file_size?: number | null;
  quality_label?: string | null;
}

export type { RemoteRow };

export function queryRemoteItems(query: RemoteItemsQuery): RemoteItemsResult {
  const where: string[] = ['r.source_id = ?', durationScopeSql('s', 'r')];
  const params: unknown[] = [query.sourceId];

  if (query.onlyUnavailable) {
    where.push("r.state = 'unavailable'");
  }
  if (query.onlyUndownloaded) {
    where.push(`NOT EXISTS (
      SELECT 1 FROM videos v WHERE v.bvid = r.bvid AND v.page = r.page
        AND (r.cid IS NULL OR v.cid = r.cid) AND v.status IN ('present', 'trashed')
    )`);
  }
  const search = query.search?.trim();
  if (search) {
    where.push('(r.title LIKE ? OR COALESCE(r.up_name, \'\') LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const limit = Math.min(Math.max(query.limit ?? 200, 1), 1000);
  const offset = Math.max(query.offset ?? 0, 0);

  const total =
    one<{ c: number }>(
      `SELECT COUNT(*) AS c FROM remote_items r JOIN sources s ON s.id = r.source_id WHERE ${where.join(' AND ')}`,
      params
    )?.c ?? 0;

  const rows = all<RemoteRow>(
    `SELECT r.*, dv.id AS downloaded_video_id, dv.source_id AS downloaded_source_id,
       dv.width, dv.height, dv.vcodec, dv.file_size, dv.quality_label,
       (SELECT j.status FROM download_jobs j
          WHERE j.bvid = r.bvid AND j.page = r.page AND (r.cid IS NULL OR j.cid = r.cid)
          ORDER BY j.id DESC LIMIT 1) AS job_status
     FROM remote_items r
     JOIN sources s ON s.id = r.source_id
     LEFT JOIN videos dv ON dv.id = (
       SELECT v.id FROM videos v
        WHERE v.bvid = r.bvid AND v.page = r.page AND (r.cid IS NULL OR v.cid = r.cid)
          AND v.status IN ('present', 'trashed')
        ORDER BY CASE v.status WHEN 'present' THEN 0 ELSE 1 END
        LIMIT 1
     )
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(r.fav_time, r.pub_time, r.last_seen_at) DESC, r.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    items: rows.map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      bvid: row.bvid,
      cid: row.cid,
      page: row.page,
      title: row.title,
      coverUrl: row.local_cover ? `bilishelf://cover/${row.id}` : row.cover_url,
      duration: row.duration,
      upName: row.up_name,
      upMid: row.up_mid,
      pubTime: row.pub_time,
      favTime: row.fav_time,
      state: row.state,
      tags: parseTags(row.tags_json),
      downloadedVideoId: row.downloaded_video_id,
      downloadedElsewhere:
        row.downloaded_video_id != null &&
        row.downloaded_source_id != null &&
        row.downloaded_source_id !== row.source_id,
      jobStatus: row.job_status,
      width: row.width ?? null,
      height: row.height ?? null,
      vcodec: row.vcodec ?? null,
      fileSize: row.file_size ?? null,
      qualityLabel: row.quality_label ?? null
    })),
    total
  };
}

export function getRemoteItem(id: number): RemoteRow | undefined {
  return one<RemoteRow>(
    `SELECT r.*,
       (SELECT v.id FROM videos v
          WHERE v.bvid = r.bvid AND v.page = r.page AND (r.cid IS NULL OR v.cid = r.cid)
            AND v.status = 'present' LIMIT 1) AS downloaded_video_id,
       NULL AS job_status
     FROM remote_items r WHERE r.id = ?`,
    [id]
  );
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/* ------------------------------- sync runs -------------------------------- */

/** 应用异常退出后，把遗留的 running 记录收尾，避免统计里一直显示“进行中”。 */
export function recoverInterruptedSyncRuns(): number {
  return run(
    "UPDATE sync_runs SET status = 'failed', error = COALESCE(error, 'interrupted'), finished_at = ? WHERE status = 'running'",
    [now()]
  ).changes;
}

export function startSyncRun(sourceId: number): number {
  const result = run('INSERT INTO sync_runs (source_id, status, started_at) VALUES (?,?,?)', [
    sourceId,
    'running',
    now()
  ]);
  return Number(result.lastInsertRowid);
}

export function finishSyncRun(
  runId: number,
  status: 'ok' | 'failed' | 'partial',
  stats: Record<string, unknown>,
  error?: string
): void {
  try {
    run('UPDATE sync_runs SET status = ?, stats_json = ?, error = ?, finished_at = ? WHERE id = ?', [
      status,
      JSON.stringify(stats),
      error ?? null,
      now(),
      runId
    ]);
  } catch (cause) {
    log.warn('[sources] finish sync run failed', cause);
  }
}
