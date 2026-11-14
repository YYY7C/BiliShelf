import log from 'electron-log/main';
import { remoteItemKey } from '@shared/media';
import type {
  JobStatus,
  RemoteItemsQuery,
  RemoteItemsResult,
  RemoteState,
  SourceKind,
  SourceSummary
} from '@shared/types';
import { all, one, run, tx } from './index';

function now(): string {
  return new Date().toISOString();
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
  item_count: number;
  downloaded_count: number;
  unavailable_count: number;
  cover_item_id?: number | null;
  remote_cover?: string | null;
}

export type { SourceRow };

export function listSources(): SourceSummary[] {
  const rows = all<SourceRow>(`SELECT s.*,
      (SELECT COUNT(*) FROM remote_items r WHERE r.source_id = s.id) AS item_count,
      (SELECT COUNT(*) FROM remote_items r JOIN videos v
        ON v.bvid = r.bvid AND v.page = r.page AND (r.cid IS NULL OR v.cid = r.cid)
        WHERE r.source_id = s.id AND v.status = 'present') AS downloaded_count,
      (SELECT COUNT(*) FROM remote_items r WHERE r.source_id = s.id AND r.state = 'unavailable') AS unavailable_count,
      (SELECT r.id FROM remote_items r
        WHERE r.source_id = s.id AND r.local_cover IS NOT NULL
        ORDER BY COALESCE(r.fav_time, r.pub_time, r.last_seen_at) DESC, r.id DESC
        LIMIT 1) AS cover_item_id,
      (SELECT r.cover_url FROM remote_items r
        WHERE r.source_id = s.id AND r.cover_url IS NOT NULL AND r.cover_url <> ''
        ORDER BY COALESCE(r.fav_time, r.pub_time, r.last_seen_at) DESC, r.id DESC
        LIMIT 1) AS remote_cover
    FROM sources s
    ORDER BY s.id ASC`);

  return rows.map((row) => ({
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
    lastSyncedAt: row.last_synced_at,
    syncEnabled: row.sync_enabled === 1
  }));
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
}): number {
  const existing = one<{ id: number }>('SELECT id FROM sources WHERE kind = ? AND remote_id = ?', [
    input.kind,
    input.remoteId
  ]);
  if (existing) return existing.id;
  const result = run(
    'INSERT INTO sources (kind, remote_id, title, cover, owner_mid, sync_enabled, created_at) VALUES (?,?,?,?,?,1,?)',
    [input.kind, input.remoteId, input.title, input.cover ?? null, input.ownerMid ?? null, now()]
  );
  return Number(result.lastInsertRowid);
}

export function removeSource(id: number): void {
  run('DELETE FROM sources WHERE id = ?', [id]);
}

export function updateSource(id: number, patch: { syncEnabled?: boolean; note?: string | null }): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.syncEnabled !== undefined) {
    sets.push('sync_enabled = ?');
    params.push(patch.syncEnabled ? 1 : 0);
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
  items: RemoteSeed[]
): { added: number; updated: number; unavailable: number } {
  return tx(() => {
    const timestamp = now();
    const before = one<{ c: number }>('SELECT COUNT(*) AS c FROM remote_items WHERE source_id = ?', [sourceId])?.c ?? 0;

    run("UPDATE remote_items SET state = 'unknown' WHERE source_id = ? AND state = 'available'", [sourceId]);

    const upsert = () => {
      for (const item of items) {
        const page = item.page ?? 1;
        const key = remoteItemKey(item.bvid, item.cid, page);
        run(
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
            state = excluded.state,
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
            timestamp
          ]
        );
      }
    };
    upsert();

    run("UPDATE remote_items SET state = 'unavailable' WHERE source_id = ? AND state = 'unknown'", [sourceId]);

    const after = one<{ c: number }>('SELECT COUNT(*) AS c FROM remote_items WHERE source_id = ?', [sourceId])?.c ?? 0;
    const unavailable =
      one<{ c: number }>("SELECT COUNT(*) AS c FROM remote_items WHERE source_id = ? AND state = 'unavailable'", [
        sourceId
      ])?.c ?? 0;

    const added = Math.max(0, after - before);
    return { added, updated: Math.max(0, items.length - added), unavailable };
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
  job_status: JobStatus | null;
  width?: number | null;
  height?: number | null;
  vcodec?: string | null;
  file_size?: number | null;
  quality_label?: string | null;
}

export type { RemoteRow };

export function queryRemoteItems(query: RemoteItemsQuery): RemoteItemsResult {
  const where: string[] = ['r.source_id = ?'];
  const params: unknown[] = [query.sourceId];

  if (query.onlyUnavailable) {
    where.push("r.state = 'unavailable'");
  }
  if (query.onlyUndownloaded) {
    where.push(`NOT EXISTS (
      SELECT 1 FROM videos v WHERE v.bvid = r.bvid AND v.page = r.page
        AND (r.cid IS NULL OR v.cid = r.cid) AND v.status = 'present'
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
    one<{ c: number }>(`SELECT COUNT(*) AS c FROM remote_items r WHERE ${where.join(' AND ')}`, params)?.c ?? 0;

  const rows = all<RemoteRow>(
    `SELECT r.*, dv.id AS downloaded_video_id, dv.width, dv.height, dv.vcodec, dv.file_size, dv.quality_label,
       (SELECT j.status FROM download_jobs j
          WHERE j.bvid = r.bvid AND j.page = r.page AND (r.cid IS NULL OR j.cid = r.cid)
          ORDER BY j.id DESC LIMIT 1) AS job_status
     FROM remote_items r
     LEFT JOIN videos dv ON dv.id = (
       SELECT v.id FROM videos v
        WHERE v.bvid = r.bvid AND v.page = r.page AND (r.cid IS NULL OR v.cid = r.cid)
          AND v.status = 'present'
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
