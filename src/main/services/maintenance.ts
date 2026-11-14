import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import log from 'electron-log/main';
import type { MaintenanceProgress, MaintenanceResult } from '@shared/types';
import { all, run } from '../db/index';
import { getAsset, getVideoRow, setAsset } from '../db/videos';
import { ensureLibraryDirs, fromLibraryRelative, libraryPaths, toLibraryRelative } from '../paths';
import { qualityLabelText } from '@shared/format';
import { fetchDanmakuXml, fetchVideoMeta } from './biliApi';
import { recompressCovers } from './covers';
import { generatePreview, writeSidecar } from './library';
import { probeMedia, makeCoverThumbnail } from './media';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BackfillRow {
  id: number;
  bvid: string;
  cid: number | null;
  page: number;
  title: string;
  file_path: string | null;
}

/**
 * 回填 cid（弹幕与分 P 去重需要）并用 ffprobe 重新读取视频流码率。
 * 旧版本下载的视频 cid 全是 NULL，弹幕也因此从未落盘。
 */
export async function backfillMetadata(options: {
  onProgress?: (progress: MaintenanceProgress) => void;
} = {}): Promise<MaintenanceResult> {
  const rows = all<BackfillRow>(
    `SELECT id, bvid, cid, page, title, file_path
       FROM videos
      WHERE status <> 'trashed' AND bvid <> ''
      ORDER BY id ASC`
  );
  let updated = 0;
  let failed = 0;
  let danmakuAdded = 0;
  const paths = ensureLibraryDirs(libraryPaths());

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    options.onProgress?.({ phase: 'metadata', done: index + 1, total: rows.length, title: row.title });
    try {
      let cid = row.cid;
      if (!cid) {
        const meta = await fetchVideoMeta(row.bvid, row.page);
        if (meta?.cid) {
          cid = meta.cid;
          run(
            `UPDATE videos SET cid = ?, up_mid = COALESCE(up_mid, ?), description = COALESCE(description, ?),
               cover_url = COALESCE(cover_url, ?), updated_at = ? WHERE id = ?`,
            [meta.cid, meta.upMid, meta.description, meta.coverUrl, new Date().toISOString(), row.id]
          );
          updated += 1;
        }
        await wait(250);
      }

      if (row.file_path) {
        const absolute = fromLibraryRelative(paths.root, row.file_path);
        if (fs.existsSync(absolute)) {
          const probe = await probeMedia(absolute);
          if (probe) {
            run(
              `UPDATE videos SET bitrate = COALESCE(?, bitrate), width = COALESCE(?, width),
                 height = COALESCE(?, height), vcodec = COALESCE(?, vcodec), acodec = COALESCE(?, acodec),
                 quality_label = COALESCE(?, quality_label), quality_checked_at = NULL, updated_at = ?
               WHERE id = ?`,
              [
                probe.bitrate,
                probe.width,
                probe.height,
                probe.vcodec,
                probe.acodec,
                qualityLabelText(probe.width, probe.height),
                new Date().toISOString(),
                row.id
              ]
            );
          }
        }
      }

      if (cid && !getAsset(row.id, 'danmaku')) {
        const xml = await fetchDanmakuXml(cid);
        if (xml) {
          const video = getVideoRow(row.id);
          if (video?.file_path) {
            const dir = path.dirname(fromLibraryRelative(paths.root, video.file_path));
            const target = path.join(dir, 'danmaku.xml');
            await fsp.writeFile(target, xml, 'utf8');
            setAsset(row.id, 'danmaku', toLibraryRelative(paths.root, target), Buffer.byteLength(xml), 'application/xml');
            danmakuAdded += 1;
          }
        }
      }

      await writeSidecar(row.id);
    } catch (error) {
      failed += 1;
      log.warn('[maintenance] backfill failed', row.id, (error as Error).message);
    }
  }

  return {
    total: rows.length,
    updated,
    failed,
    bytesFreed: 0,
    details: `补全 ${updated} 条 cid，新增 ${danmakuAdded} 个弹幕`
  };
}

/** 为已有视频补生成 4 秒悬停预览。 */
export async function generateMissingPreviews(options: {
  onProgress?: (progress: MaintenanceProgress) => void;
} = {}): Promise<MaintenanceResult> {
  const rows = all<{ id: number; title: string }>(
    `SELECT v.id, v.title FROM videos v
      WHERE v.status = 'present' AND v.file_path IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.video_id = v.id AND a.type = 'preview')
      ORDER BY v.id ASC`
  );
  let updated = 0;
  let failed = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    options.onProgress?.({ phase: 'previews', done: index + 1, total: rows.length, title: row.title });
    try {
      if (await generatePreview(row.id)) updated += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      log.warn('[maintenance] preview failed', row.id, (error as Error).message);
    }
  }

  return {
    total: rows.length,
    updated,
    failed,
    bytesFreed: 0,
    details: `生成 ${updated} 个预览片`
  };
}

/** 旧版本的缩略图是视频抽帧，这里统一换成封面原图的 640px 版本。 */
export async function rebuildCoverThumbnails(options: {
  onProgress?: (progress: MaintenanceProgress) => void;
} = {}): Promise<MaintenanceResult> {
  const rows = all<{ id: number; title: string; cover_path: string }>(
    `SELECT v.id, v.title, c.path AS cover_path
       FROM videos v
       JOIN assets c ON c.video_id = v.id AND c.type = 'cover'
      WHERE v.status <> 'trashed'
      ORDER BY v.id ASC`
  );
  const paths = ensureLibraryDirs(libraryPaths());
  let updated = 0;
  let failed = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    options.onProgress?.({ phase: 'thumbs', done: index + 1, total: rows.length, title: row.title });
    const cover = fromLibraryRelative(paths.root, row.cover_path);
    const target = path.join(paths.thumbs, `v${row.id}.webp`);
    const jpg = target.replace(/\.webp$/i, '.jpg');
    try {
      if (!fs.existsSync(cover)) {
        failed += 1;
        continue;
      }
      if (!(await makeCoverThumbnail(cover, target))) {
        failed += 1;
        continue;
      }
      const finalPath = fs.existsSync(target) ? target : jpg;
      if (!fs.existsSync(finalPath)) {
        failed += 1;
        continue;
      }
      setAsset(row.id, 'thumb', toLibraryRelative(paths.root, finalPath), fs.statSync(finalPath).size, 'image/webp');
      await fsp.rm(finalPath === target ? jpg : target, { force: true }).catch(() => undefined);
      updated += 1;
    } catch (error) {
      failed += 1;
      log.warn('[maintenance] cover thumb failed', row.id, (error as Error).message);
    }
  }

  return {
    total: rows.length,
    updated,
    failed,
    bytesFreed: 0,
    details: `重建 ${updated} 张封面缩略图`
  };
}

/** 把旧的原图封面缓存压成 640px JPEG。 */
export async function compressCoverCache(options: {
  onProgress?: (progress: MaintenanceProgress) => void;
} = {}): Promise<MaintenanceResult> {
  const result = await recompressCovers((done, total) =>
    options.onProgress?.({ phase: 'covers', done, total, title: '封面缓存' })
  );
  return {
    total: result.total,
    updated: result.compressed,
    failed: 0,
    bytesFreed: result.savedBytes,
    details: `压缩 ${result.compressed} 张封面`
  };
}

/**
 * 清理下载目录里的冗余文件：
 * - yt-dlp 的 .info.json（元数据已经在 sidecar / 数据库）
 * - 与 cover.jpg 完全同尺寸的原始缩略图副本
 * - cache/temp 下遗留的 cookies 与下载暂存目录
 */
export async function cleanupRedundantFiles(options: {
  onProgress?: (progress: MaintenanceProgress) => void;
} = {}): Promise<MaintenanceResult> {
  const paths = ensureLibraryDirs(libraryPaths());
  const dirs: string[] = [];
  const collect = async (dir: string, depth = 0): Promise<void> => {
    if (depth > 5) return;
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) await collect(path.join(dir, entry.name), depth + 1);
      else if (entry.isFile()) dirs.push(dir);
    }
  };
  await collect(paths.media);

  const uniqueDirs = Array.from(new Set(dirs));
  let filesRemoved = 0;
  let bytesFreed = 0;
  let failed = 0;

  for (let index = 0; index < uniqueDirs.length; index += 1) {
    const dir = uniqueDirs[index]!;
    options.onProgress?.({ phase: 'cleanup', done: index + 1, total: uniqueDirs.length, title: path.basename(dir) });
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      const cover = entries.find((entry) => entry.isFile() && entry.name === 'cover.jpg');
      let coverSize = 0;
      if (cover) {
        const stat = await fsp.stat(path.join(dir, cover.name));
        coverSize = stat.size;
      }
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const full = path.join(dir, entry.name);
        const lower = entry.name.toLowerCase();
        const isInfo = lower.endsWith('.info.json');
        const isImage = /\.(jpg|jpeg|png|webp|avif)$/.test(lower);
        const keep = lower === 'cover.jpg' || lower === 'poster.jpg';
        if (!isInfo && (!isImage || keep)) continue;
        if (isImage && !keep) {
          const stat = await fsp.stat(full);
          if (!coverSize || stat.size !== coverSize) continue;
        }
        const size = (await fsp.stat(full)).size;
        await fsp.rm(full, { force: true });
        filesRemoved += 1;
        bytesFreed += size;
      }
    } catch (error) {
      failed += 1;
      log.debug('[maintenance] cleanup failed', dir, (error as Error).message);
    }
  }

  // 临时目录：cookies 与已完成任务的暂存目录
  for (const name of fs.existsSync(paths.temp) ? fs.readdirSync(paths.temp) : []) {
    if (!/^cookies-.*\.txt$/i.test(name)) continue;
    const full = path.join(paths.temp, name);
    try {
      bytesFreed += fs.statSync(full).size;
      fs.rmSync(full, { force: true });
      filesRemoved += 1;
    } catch {
      // ignore
    }
  }
  const stagingRoot = path.join(paths.temp, 'downloads');
  if (fs.existsSync(stagingRoot)) {
    for (const name of fs.readdirSync(stagingRoot)) {
      const full = path.join(stagingRoot, name);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          fs.rmSync(full, { recursive: true, force: true });
          filesRemoved += 1;
        }
      } catch {
        // ignore
      }
    }
  }

  return {
    total: uniqueDirs.length,
    updated: filesRemoved,
    failed,
    bytesFreed,
    details: `清理 ${filesRemoved} 个冗余文件`
  };
}
