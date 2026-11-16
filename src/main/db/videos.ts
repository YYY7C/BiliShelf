import log from 'electron-log/main';
import type {
  AiTagRef,
  BulkAction,
  LibraryQuery,
  LibraryResult,
  LibraryStats,
  UpdateVideoPatch,
  VideoItem,
  VideoStatus
} from '@shared/types';
import { videoKeyFor } from '@shared/media';
import { all, getDb, one, run, tx } from './index';

export { videoKeyFor };

interface VideoRow {
  id: number;
  video_key: string;
  origin: string;
  bvid: string;
  cid: number | null;
  page: number;
  title: string;
  up_name: string | null;
  up_mid: number | null;
  description: string | null;
  cover_url: string | null;
  source_id: number | null;
  remote_item_id: number | null;
  file_path: string | null;
  file_size: number | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  vcodec: string | null;
  acodec: string | null;
  bitrate: number | null;
  quality_label: string | null;
  status: VideoStatus;
  rating: number;
  note: string;
  play_position: number;
  played_at: string | null;
  downloaded_at: string | null;
  created_at: string;
  source_name?: string | null;
}

interface AssetRow {
  video_id: number;
  type: string;
}

const SELECT_BASE = `
  SELECT v.*, s.title AS source_name
  FROM videos v
  LEFT JOIN sources s ON s.id = v.source_id
`;

function now(): string {
  return new Date().toISOString();
}

/** 一行视频 + 关联 assets/tags/folders -> 渲染层投影 */
function decorate(rows: VideoRow[]): VideoItem[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');

  const assets = all<AssetRow>(`SELECT video_id, type FROM assets WHERE video_id IN (${placeholders})`, ids);
  const assetMap = new Map<number, Set<string>>();
  for (const asset of assets) {
    if (!assetMap.has(asset.video_id)) assetMap.set(asset.video_id, new Set());
    assetMap.get(asset.video_id)!.add(asset.type);
  }

  const tagRows = all<{ video_id: number; name: string }>(
    `SELECT vt.video_id, t.name FROM video_tags vt
     JOIN tags t ON t.id = vt.tag_id
     WHERE vt.video_id IN (${placeholders})
     ORDER BY t.name COLLATE NOCASE`,
    ids
  );
  const tagMap = new Map<number, string[]>();
  for (const row of tagRows) {
    if (!tagMap.has(row.video_id)) tagMap.set(row.video_id, []);
    tagMap.get(row.video_id)!.push(row.name);
  }

  const folderRows = all<{ video_id: number; name: string }>(
    `SELECT vf.video_id, f.name FROM video_folders vf
     JOIN folders f ON f.id = vf.folder_id
     WHERE vf.video_id IN (${placeholders})
     ORDER BY f.name COLLATE NOCASE`,
    ids
  );
  const folderMap = new Map<number, string[]>();
  for (const row of folderRows) {
    if (!folderMap.has(row.video_id)) folderMap.set(row.video_id, []);
    folderMap.get(row.video_id)!.push(row.name);
  }

  const aiTagRows = all<{
    video_id: number;
    name: string;
    category: string;
    confidence: number;
    source: AiTagRef['source'];
  }>(
    `SELECT vat.video_id, at.name, at.category, vat.confidence, vat.source
       FROM video_ai_tags vat
       JOIN ai_tags at ON at.id = vat.ai_tag_id
      WHERE vat.video_id IN (${placeholders})
      ORDER BY at.category COLLATE NOCASE, vat.confidence DESC, at.name COLLATE NOCASE`,
    ids
  );
  const aiTagMap = new Map<number, AiTagRef[]>();
  for (const row of aiTagRows) {
    if (!aiTagMap.has(row.video_id)) aiTagMap.set(row.video_id, []);
    aiTagMap.get(row.video_id)!.push({
      name: row.name,
      category: row.category,
      confidence: row.confidence,
      source: row.source
    });
  }

  const aiPendingRows = all<{ video_id: number; c: number }>(
    `SELECT video_id, COUNT(*) AS c FROM ai_run_tags
      WHERE status = 'pending' AND video_id IN (${placeholders})
      GROUP BY video_id`,
    ids
  );
  const aiPendingMap = new Map(aiPendingRows.map((row) => [row.video_id, row.c]));

  const aiSummaryRows = all<{ video_id: number; result_json: string | null; created_at: string }>(
    `SELECT video_id, result_json, created_at FROM (
       SELECT video_id, result_json, created_at,
              ROW_NUMBER() OVER (PARTITION BY video_id ORDER BY created_at DESC, id DESC) AS rn
         FROM ai_runs
        WHERE status = 'done' AND video_id IN (${placeholders})
     ) WHERE rn = 1`,
    ids
  );
  const aiSummaryMap = new Map<number, { summary: string | null; lastRunAt: string }>();
  for (const row of aiSummaryRows) {
    let summary: string | null;
    try {
      summary = (JSON.parse(row.result_json ?? '{}') as { summary?: string }).summary ?? null;
    } catch {
      summary = null;
    }
    aiSummaryMap.set(row.video_id, { summary, lastRunAt: row.created_at });
  }

  return rows.map((row) => {
    const types = assetMap.get(row.id);
    const hasVideo = Boolean(row.file_path);
    return {
      id: row.id,
      bvid: row.bvid,
      cid: row.cid,
      page: row.page,
      title: row.title,
      upName: row.up_name,
      upMid: row.up_mid,
      description: row.description,
      coverUrl: row.cover_url,
      thumbUrl: types?.has('thumb')
        ? `bilishelf://asset/${row.id}/thumb`
        : types?.has('cover')
          ? `bilishelf://asset/${row.id}/cover`
          : null,
      localCoverUrl: types?.has('cover') ? `bilishelf://asset/${row.id}/cover` : null,
      videoUrl: hasVideo ? `bilishelf://media/${row.id}` : null,
      previewUrl: types?.has('preview') ? `bilishelf://asset/${row.id}/preview` : null,
      subtitleUrl: types?.has('subtitle') ? `bilishelf://asset/${row.id}/subtitle` : null,
      danmakuUrl: types?.has('danmaku') ? `bilishelf://asset/${row.id}/danmaku` : null,
      duration: row.duration,
      width: row.width,
      height: row.height,
      vcodec: row.vcodec,
      acodec: row.acodec,
      fileSize: row.file_size,
      qualityLabel: row.quality_label,
      status: row.status,
      rating: row.rating ?? 0,
      note: row.note ?? '',
      tags: tagMap.get(row.id) ?? [],
      folders: folderMap.get(row.id) ?? [],
      playPosition: row.play_position ?? 0,
      playedAt: row.played_at,
      downloadedAt: row.downloaded_at,
      createdAt: row.created_at,
      sourceId: row.source_id,
      sourceName: row.source_name ?? null,
      hasDanmaku: types?.has('danmaku') ?? false,
      hasSubtitle: types?.has('subtitle') ?? false,
      aiTags: aiTagMap.get(row.id) ?? [],
      aiPendingCount: aiPendingMap.get(row.id) ?? 0,
      aiSummary: aiSummaryMap.get(row.id)?.summary ?? null,
      aiLastRunAt: aiSummaryMap.get(row.id)?.lastRunAt ?? null
    };
  });
}

function buildWhere(query: LibraryQuery): { clause: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.status && query.status !== 'all') {
    where.push('v.status = ?');
    params.push(query.status);
  } else {
    where.push("v.status <> 'trashed'");
  }

  if (query.sourceId) {
    where.push('v.source_id = ?');
    params.push(query.sourceId);
  }

  if (query.tag) {
    where.push(`EXISTS (
      SELECT 1 FROM video_tags vt JOIN tags t ON t.id = vt.tag_id
      WHERE vt.video_id = v.id AND t.name = ?
    )`);
    params.push(query.tag);
  }

  if (query.aiTag) {
    where.push(`EXISTS (
      SELECT 1 FROM video_ai_tags vat JOIN ai_tags at ON at.id = vat.ai_tag_id
      WHERE vat.video_id = v.id AND at.name = ?
    )`);
    params.push(query.aiTag);
  }

  if (query.folder) {
    where.push(`EXISTS (
      SELECT 1 FROM video_folders vf JOIN folders f ON f.id = vf.folder_id
      WHERE vf.video_id = v.id AND f.name = ?
    )`);
    params.push(query.folder);
  }

  const search = query.search?.trim();
  if (search) {
    if (search.length >= 3) {
      where.push('v.id IN (SELECT rowid FROM videos_fts WHERE videos_fts MATCH ?)');
      params.push(`"${search.replace(/"/g, '""')}"`);
    } else {
      where.push(`(
        v.title LIKE ? OR COALESCE(v.up_name,'') LIKE ? OR v.note LIKE ?
        OR EXISTS (
          SELECT 1 FROM video_tags vt JOIN tags t ON t.id = vt.tag_id
          WHERE vt.video_id = v.id AND t.name LIKE ?
        )
        OR EXISTS (
          SELECT 1 FROM video_ai_tags vat JOIN ai_tags at ON at.id = vat.ai_tag_id
          WHERE vat.video_id = v.id AND at.name LIKE ?
        )
      )`);
      const like = `%${search}%`;
      params.push(like, like, like, like, like);
    }
  }

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function orderBy(sort: LibraryQuery['sort']): string {
  switch (sort) {
    case 'title':
      return 'ORDER BY v.title COLLATE NOCASE ASC';
    case 'duration':
      return 'ORDER BY v.duration DESC NULLS LAST, v.created_at DESC';
    case 'size':
      return 'ORDER BY v.file_size DESC NULLS LAST, v.created_at DESC';
    case 'rating':
      return 'ORDER BY v.rating DESC, v.created_at DESC';
    case 'recent':
      return 'ORDER BY COALESCE(v.downloaded_at, v.created_at) DESC';
    case 'added':
    default:
      return 'ORDER BY v.created_at DESC';
  }
}

export function queryVideos(query: LibraryQuery): LibraryResult {
  const { clause, params } = buildWhere(query);
  const limit = Math.min(Math.max(query.limit ?? 120, 1), 1000);
  const offset = Math.max(query.offset ?? 0, 0);

  const total = one<{ c: number }>(`SELECT COUNT(*) AS c FROM videos v ${clause}`, params)?.c ?? 0;
  const rows = all<VideoRow>(`${SELECT_BASE} ${clause} ${orderBy(query.sort)} LIMIT ? OFFSET ?`, [
    ...params,
    limit,
    offset
  ]);

  return { items: decorate(rows), total };
}

export function queryVideoIds(query: LibraryQuery): number[] {
  const { clause, params } = buildWhere(query);
  return all<{ id: number }>(`SELECT v.id FROM videos v ${clause} ${orderBy(query.sort)}`, params).map(
    (r) => r.id
  );
}

export function getVideo(id: number): VideoItem | null {
  const row = one<VideoRow>(`${SELECT_BASE} WHERE v.id = ?`, [id]);
  if (!row) return null;
  return decorate([row])[0] ?? null;
}

export function getVideoRow(id: number): VideoRow | undefined {
  return one<VideoRow>(`${SELECT_BASE} WHERE v.id = ?`, [id]);
}

export function stats(): LibraryStats {
  const row = one<{
    total: number;
    present: number;
    missing: number;
    unavailable: number;
    with_tags: number;
    with_ai_tags: number;
    total_bytes: number;
  }>(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present,
      SUM(CASE WHEN status = 'missing' THEN 1 ELSE 0 END) AS missing,
      SUM(CASE WHEN status = 'unavailable' THEN 1 ELSE 0 END) AS unavailable,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM video_tags vt WHERE vt.video_id = videos.id) THEN 1 ELSE 0 END) AS with_tags,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM video_ai_tags vat WHERE vat.video_id = videos.id) THEN 1 ELSE 0 END) AS with_ai_tags,
      COALESCE(SUM(file_size), 0) AS total_bytes
    FROM videos WHERE status <> 'trashed'`);

  const trashed = one<{ c: number }>("SELECT COUNT(*) AS c FROM videos WHERE status = 'trashed'")?.c ?? 0;

  return {
    total: row?.total ?? 0,
    present: row?.present ?? 0,
    missing: row?.missing ?? 0,
    unavailable: row?.unavailable ?? 0,
    trashed,
    withTags: row?.with_tags ?? 0,
    withAiTags: row?.with_ai_tags ?? 0,
    totalBytes: row?.total_bytes ?? 0
  };
}

export interface InsertVideoInput {
  videoKey: string;
  origin?: 'bilibili' | 'local';
  bvid?: string;
  cid?: number | null;
  page?: number;
  title: string;
  upName?: string | null;
  upMid?: number | null;
  description?: string | null;
  coverUrl?: string | null;
  sourceId?: number | null;
  remoteItemId?: number | null;
  filePath?: string | null;
  fileSize?: number | null;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  vcodec?: string | null;
  acodec?: string | null;
  bitrate?: number | null;
  container?: string | null;
  hash?: string | null;
  qualityLabel?: string | null;
  status?: VideoStatus;
}

export function upsertVideo(input: InsertVideoInput): number {
  const timestamp = now();
  const existing = one<{ id: number }>('SELECT id FROM videos WHERE video_key = ?', [input.videoKey]);
  if (existing) {
    const downloadedAt = input.status === 'present' ? timestamp : null;
    run(
      `UPDATE videos SET
        title = ?,
        bvid = COALESCE(NULLIF(?, ''), bvid), cid = COALESCE(?, cid), page = ?,
        up_name = COALESCE(?, up_name), up_mid = COALESCE(?, up_mid),
        description = COALESCE(?, description), cover_url = COALESCE(?, cover_url),
        source_id = COALESCE(?, source_id), remote_item_id = COALESCE(?, remote_item_id),
        file_path = COALESCE(?, file_path), file_size = COALESCE(?, file_size),
        duration = COALESCE(?, duration), width = COALESCE(?, width), height = COALESCE(?, height),
        vcodec = COALESCE(?, vcodec), acodec = COALESCE(?, acodec), bitrate = COALESCE(?, bitrate),
        container = COALESCE(?, container), hash = COALESCE(?, hash),
        quality_label = COALESCE(?, quality_label),
        status = COALESCE(?, status),
        downloaded_at = CASE WHEN ? IS NOT NULL THEN ? ELSE downloaded_at END,
        updated_at = ?
      WHERE id = ?`,
      [
        input.title,
        input.bvid ?? '',
        input.cid ?? null,
        input.page ?? 1,
        input.upName ?? null,
        input.upMid ?? null,
        input.description ?? null,
        input.coverUrl ?? null,
        input.sourceId ?? null,
        input.remoteItemId ?? null,
        input.filePath ?? null,
        input.fileSize ?? null,
        input.duration ?? null,
        input.width ?? null,
        input.height ?? null,
        input.vcodec ?? null,
        input.acodec ?? null,
        input.bitrate ?? null,
        input.container ?? null,
        input.hash ?? null,
        input.qualityLabel ?? null,
        input.status ?? null,
        downloadedAt,
        downloadedAt,
        timestamp,
        existing.id
      ]
    );
    refreshVideoFts(existing.id);
    return existing.id;
  }

  const downloadedAt = input.status === 'present' ? timestamp : null;
  const result = run(
    `INSERT INTO videos (
      video_key, origin, bvid, cid, page, title, up_name, up_mid, description, cover_url,
      source_id, remote_item_id, file_path, file_size, duration, width, height, vcodec, acodec,
      bitrate, container, hash, quality_label, status, downloaded_at, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.videoKey,
      input.origin ?? 'bilibili',
      input.bvid ?? '',
      input.cid ?? null,
      input.page ?? 1,
      input.title,
      input.upName ?? null,
      input.upMid ?? null,
      input.description ?? null,
      input.coverUrl ?? null,
      input.sourceId ?? null,
      input.remoteItemId ?? null,
      input.filePath ?? null,
      input.fileSize ?? null,
      input.duration ?? null,
      input.width ?? null,
      input.height ?? null,
      input.vcodec ?? null,
      input.acodec ?? null,
      input.bitrate ?? null,
      input.container ?? null,
      input.hash ?? null,
      input.qualityLabel ?? null,
      input.status ?? 'present',
      downloadedAt,
      timestamp,
      timestamp
    ]
  );
  const id = Number(result.lastInsertRowid);
  refreshVideoFts(id);
  return id;
}

export function updateVideo(id: number, patch: UpdateVideoPatch): VideoItem | null {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push('title = ?');
    params.push(patch.title);
  }
  if (patch.rating !== undefined) {
    sets.push('rating = ?');
    params.push(Math.min(5, Math.max(0, Math.round(patch.rating))));
  }
  if (patch.note !== undefined) {
    sets.push('note = ?');
    params.push(patch.note);
  }
  if (patch.status !== undefined) {
    sets.push('status = ?');
    params.push(patch.status);
  }
  if (sets.length === 0) return getVideo(id);

  sets.push('updated_at = ?');
  params.push(now(), id);
  run(`UPDATE videos SET ${sets.join(', ')} WHERE id = ?`, params);
  refreshVideoFts(id);
  return getVideo(id);
}

export function setVideoMetadata(
  id: number,
  data: {
    filePath?: string;
    fileSize?: number | null;
    duration?: number | null;
    width?: number | null;
    height?: number | null;
    vcodec?: string | null;
    acodec?: string | null;
    bitrate?: number | null;
    container?: string | null;
    status?: VideoStatus;
    qualityLabel?: string | null;
    hash?: string | null;
  }
): void {
  const timestamp = now();
  run(
    `UPDATE videos SET
      file_path = COALESCE(?, file_path),
      file_size = COALESCE(?, file_size),
      duration = COALESCE(?, duration),
      width = COALESCE(?, width),
      height = COALESCE(?, height),
      vcodec = COALESCE(?, vcodec),
      acodec = COALESCE(?, acodec),
      bitrate = COALESCE(?, bitrate),
      container = COALESCE(?, container),
      quality_label = COALESCE(?, quality_label),
      hash = COALESCE(?, hash),
      status = COALESCE(?, status),
      downloaded_at = CASE WHEN ? = 'present' THEN ? ELSE downloaded_at END,
      updated_at = ?
    WHERE id = ?`,
    [
      data.filePath ?? null,
      data.fileSize ?? null,
      data.duration ?? null,
      data.width ?? null,
      data.height ?? null,
      data.vcodec ?? null,
      data.acodec ?? null,
      data.bitrate ?? null,
      data.container ?? null,
      data.qualityLabel ?? null,
      data.hash ?? null,
      data.status ?? null,
      data.status ?? null,
      timestamp,
      timestamp,
      id
    ]
  );
}

export function setAsset(
  videoId: number,
  type: string,
  relPath: string,
  size?: number | null,
  mime?: string | null
): void {
  run(
    `INSERT INTO assets (video_id, type, path, mime, size)
     VALUES (?,?,?,?,?)
     ON CONFLICT(video_id, type) DO UPDATE SET path = excluded.path, mime = excluded.mime, size = excluded.size`,
    [videoId, type, relPath, mime ?? null, size ?? null]
  );
}

export function getAsset(videoId: number, type: string): { path: string; mime: string | null } | null {
  const row = one<{ path: string; mime: string | null }>(
    'SELECT path, mime FROM assets WHERE video_id = ? AND type = ?',
    [videoId, type]
  );
  return row ?? null;
}

export function listAssets(videoId: number): Array<{ type: string; path: string }> {
  return all<{ type: string; path: string }>('SELECT type, path FROM assets WHERE video_id = ?', [videoId]);
}

export function recordPlayback(id: number, position: number): void {
  run('UPDATE videos SET play_position = ?, played_at = ?, updated_at = ? WHERE id = ?', [
    Math.max(0, position),
    now(),
    now(),
    id
  ]);
}

export function bulkAction(action: BulkAction): number {
  const ids = action.ids.filter((id) => Number.isFinite(id));
  if (ids.length === 0) return 0;

  return tx(() => {
    switch (action.action) {
      case 'trash':
        ids.forEach((id) =>
          run("UPDATE videos SET status = 'trashed', updated_at = ? WHERE id = ?", [now(), id])
        );
        return ids.length;
      case 'restore':
        ids.forEach((id) =>
          run("UPDATE videos SET status = 'present', updated_at = ? WHERE id = ?", [now(), id])
        );
        return ids.length;
      case 'delete':
        ids.forEach((id) => {
          run('DELETE FROM videos WHERE id = ?', [id]);
          // 视频行删除后，同步清掉 FTS 索引，避免残留
          refreshVideoFts(id);
        });
        return ids.length;
      case 'rate':
        ids.forEach((id) =>
          run('UPDATE videos SET rating = ?, updated_at = ? WHERE id = ?', [action.rating ?? 0, now(), id])
        );
        return ids.length;
      case 'retag': {
        if (!action.tag) return 0;
        ids.forEach((id) => assignTagByName(id, action.tag!, 'manual'));
        return ids.length;
      }
      case 'refolder': {
        if (!action.folder) return 0;
        ids.forEach((id) => assignFolderByName(id, action.folder!));
        return ids.length;
      }
      default:
        return 0;
    }
  });
}

/* ------------------------------- tags on video ------------------------------ */

function ensureTag(name: string): number {
  const normalized = name.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new Error('标签不能为空');
  const existing = one<{ id: number }>('SELECT id FROM tags WHERE name = ?', [normalized]);
  if (existing) return existing.id;
  const result = run('INSERT INTO tags (name, normalized_name, created_at) VALUES (?,?,?)', [
    normalized,
    normalized.toLocaleLowerCase(),
    now()
  ]);
  return Number(result.lastInsertRowid);
}

export function assignTagByName(videoId: number, name: string, source: 'manual' | 'auto' = 'manual'): void {
  const tagId = ensureTag(name);
  run(
    `INSERT INTO video_tags (video_id, tag_id, source) VALUES (?,?,?)
     ON CONFLICT(video_id, tag_id) DO UPDATE SET source = excluded.source`,
    [videoId, tagId, source]
  );
  refreshVideoFts(videoId);
}

export function removeTagByName(videoId: number, name: string): void {
  const tag = one<{ id: number }>('SELECT id FROM tags WHERE name = ?', [name.trim()]);
  if (!tag) return;
  run('DELETE FROM video_tags WHERE video_id = ? AND tag_id = ?', [videoId, tag.id]);
  refreshVideoFts(videoId);
}

export function assignFolderByName(videoId: number, name: string): void {
  const folderName = name.trim().replace(/\s+/g, ' ');
  if (!folderName) return;
  let folder = one<{ id: number }>('SELECT id FROM folders WHERE name = ? AND parent_id IS NULL', [
    folderName
  ]);
  if (!folder) {
    const result = run('INSERT INTO folders (name, created_at) VALUES (?,?)', [folderName, now()]);
    folder = { id: Number(result.lastInsertRowid) };
  }
  run('INSERT OR IGNORE INTO video_folders (video_id, folder_id) VALUES (?,?)', [videoId, folder.id]);
}

export function removeFolderByName(videoId: number, name: string): void {
  const folder = one<{ id: number }>('SELECT id FROM folders WHERE name = ?', [name.trim()]);
  if (!folder) return;
  run('DELETE FROM video_folders WHERE video_id = ? AND folder_id = ?', [videoId, folder.id]);
}

/* ---------------------------------- FTS ---------------------------------- */

export function refreshVideoFts(id: number): void {
  const row = one<{
    title: string;
    up_name: string | null;
    description: string | null;
    note: string | null;
    tags_text: string | null;
    ai_tags_text: string | null;
  }>(
    `SELECT v.title, v.up_name, v.description, v.note,
      (SELECT GROUP_CONCAT(t.name, ' ') FROM video_tags vt JOIN tags t ON t.id = vt.tag_id WHERE vt.video_id = v.id) AS tags_text,
      (SELECT GROUP_CONCAT(at.name, ' ') FROM video_ai_tags vat JOIN ai_tags at ON at.id = vat.ai_tag_id WHERE vat.video_id = v.id) AS ai_tags_text
     FROM videos v WHERE v.id = ?`,
    [id]
  );

  run('DELETE FROM videos_fts WHERE rowid = ?', [id]);
  if (row) {
    run('INSERT INTO videos_fts (rowid, title, up_name, description, tags_text, note) VALUES (?,?,?,?,?,?)', [
      id,
      row.title ?? '',
      row.up_name ?? '',
      row.description ?? '',
      [row.tags_text, row.ai_tags_text].filter(Boolean).join(' '),
      row.note ?? ''
    ]);
  }
}

export function rebuildFts(): number {
  const db = getDb();
  db.exec('DELETE FROM videos_fts');
  const rows = all<{ id: number }>('SELECT id FROM videos');
  rows.forEach((row) => refreshVideoFts(row.id));
  return rows.length;
}

/** 校验文件是否存在，把仍为 present 但文件消失的记录标成 missing。 */
export function reconcileFileStatus(exists: (relPath: string) => boolean): number {
  const rows = all<{ id: number; file_path: string }>(
    "SELECT id, file_path FROM videos WHERE status = 'present' AND file_path IS NOT NULL"
  );
  let changed = 0;
  tx(() => {
    for (const row of rows) {
      if (!exists(row.file_path)) {
        run("UPDATE videos SET status = 'missing', updated_at = ? WHERE id = ?", [now(), row.id]);
        changed += 1;
      }
    }
  });
  if (changed) log.info('[library] marked missing', changed);
  return changed;
}
