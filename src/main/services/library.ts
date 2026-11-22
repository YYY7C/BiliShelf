import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import log from 'electron-log/main';
import type { AiTagRef, ImportResult } from '@shared/types';
import {
  ensureLibraryDirs,
  fromLibraryRelative,
  libraryPaths,
  safeSegment,
  toLibraryRelative,
  uniquePath
} from '../paths';
import {
  assignFolderByName,
  assignTagByName,
  getAsset,
  getVideo,
  getVideoRow,
  refreshVideoFts,
  setAsset,
  upsertVideo,
  updateVideo
} from '../db/videos';
import { getAiTaggedAt, getApprovedAiTags, restoreApprovedAiTag } from '../db/ai';
import { one } from '../db/index';
import { makeThumbnail, makePreview, probeMedia } from './media';

export const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.webm',
  '.mov',
  '.flv',
  '.m4v',
  '.avi',
  '.ts',
  '.m4a',
  '.mp3',
  '.flac',
  '.wav',
  '.ogg'
]);

export function isVideoFile(file: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase());
}

export async function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex').slice(0, 32)));
  });
}

async function walk(dir: string, out: string[], depth = 0): Promise<void> {
  if (depth > 6) return;
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out, depth + 1);
    } else if (entry.isFile() && isVideoFile(full)) {
      out.push(full);
    }
  }
}

export async function collectVideoFiles(inputs: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const input of inputs) {
    const stat = await fsp.stat(input).catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory()) {
      await walk(input, files);
    } else if (isVideoFile(input)) {
      files.push(input);
    }
  }
  return files;
}

/** 把文件放进库目录（已在库内则原地引用）。返回库内相对路径。 */
async function placeFile(source: string, preferredName: string): Promise<string> {
  const paths = ensureLibraryDirs(libraryPaths());
  const year = new Date().getFullYear().toString();
  const dir = path.join(paths.media, 'imported', year);
  await fsp.mkdir(dir, { recursive: true });

  const inside = source.startsWith(paths.root + path.sep);
  if (inside) {
    return toLibraryRelative(paths.root, source);
  }

  const ext = path.extname(source).toLowerCase();
  const target = uniquePath(dir, safeSegment(preferredName, 'imported'), ext);
  await fsp.copyFile(source, target);
  return toLibraryRelative(paths.root, target);
}

async function attachThumbnail(
  videoId: number,
  absoluteVideo: string,
  duration: number | null
): Promise<boolean> {
  const paths = ensureLibraryDirs(libraryPaths());
  const base = `v${videoId}`;
  const thumbWebp = path.join(paths.thumbs, `${base}.webp`);
  const ok = await makeThumbnail(absoluteVideo, thumbWebp, duration);
  if (!ok) return false;
  const finalPath = fs.existsSync(thumbWebp) ? thumbWebp : thumbWebp.replace(/\.webp$/i, '.jpg');
  if (!fs.existsSync(finalPath)) return false;
  const size = fs.statSync(finalPath).size;
  setAsset(videoId, 'thumb', toLibraryRelative(paths.root, finalPath), size, 'image/webp');
  return true;
}

export async function generatePreview(videoId: number): Promise<boolean> {
  const row = getVideoRow(videoId);
  if (!row?.file_path) return false;
  const paths = ensureLibraryDirs(libraryPaths());
  const absolute = fromLibraryRelative(paths.root, row.file_path);
  if (!fs.existsSync(absolute)) return false;
  const out = path.join(paths.thumbs, `v${videoId}-preview.mp4`);
  const ok = await makePreview(absolute, out, row.duration);
  if (!ok) return false;
  setAsset(videoId, 'preview', toLibraryRelative(paths.root, out), fs.statSync(out).size, 'video/mp4');
  return true;
}

export interface ImportProgress {
  (done: number, total: number, current: string): void;
}

export async function importFiles(inputs: string[], onProgress?: ImportProgress): Promise<ImportResult> {
  const files = await collectVideoFiles(inputs);
  const result: ImportResult = { imported: 0, skipped: 0, failed: 0, errors: [] };
  const paths = ensureLibraryDirs(libraryPaths());

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    onProgress?.(index, files.length, path.basename(file));
    // 导入大量文件时让出事件循环，避免主进程长时间无响应
    await new Promise((resolve) => setImmediate(resolve));
    try {
      const hash = await hashFile(file);
      const videoKey = `local:${hash}`;
      const existing = one<{ id: number }>('SELECT id FROM videos WHERE video_key = ?', [videoKey]);
      if (existing) {
        result.skipped += 1;
        continue;
      }

      const stat = await fsp.stat(file);
      const probe = await probeMedia(file);
      const baseName = path.basename(file, path.extname(file));
      const relPath = await placeFile(file, baseName);
      const absolute = fromLibraryRelative(paths.root, relPath);

      const id = upsertVideo({
        videoKey,
        origin: 'local',
        bvid: '',
        page: 1,
        title: baseName,
        upName: null,
        filePath: relPath,
        fileSize: stat.size,
        duration: probe?.duration ?? null,
        width: probe?.width ?? null,
        height: probe?.height ?? null,
        vcodec: probe?.vcodec ?? null,
        acodec: probe?.acodec ?? null,
        bitrate: probe?.bitrate ?? null,
        container: probe?.container ?? null,
        hash,
        status: 'present',
        qualityLabel: probe?.height ? `${probe.height}P` : null
      });

      setAsset(id, 'video', relPath, stat.size, 'video/mp4');
      await attachThumbnail(id, absolute, probe?.duration ?? null);
      await writeSidecar(id);
      result.imported += 1;
    } catch (error) {
      result.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`${path.basename(file)}: ${message}`);
      log.warn('[library] import failed', file, message);
    }
  }

  onProgress?.(files.length, files.length, '');
  return result;
}

/* -------------------------------- sidecar -------------------------------- */

export interface SidecarFile {
  schema: 'bilishelf.item/1';
  videoKey: string;
  bvid: string;
  cid: number | null;
  page: number;
  title: string;
  up: { mid: number | null; name: string | null };
  description: string | null;
  source: { id: number | null; name: string | null };
  tags: string[];
  folders: string[];
  /** 审核通过的 AI 标签，独立于 tags */
  aiTags?: AiTagRef[];
  aiTaggedAt?: string | null;
  rating: number;
  note: string;
  files: Record<string, string | null>;
  media: {
    duration: number | null;
    width: number | null;
    height: number | null;
    vcodec: string | null;
    acodec: string | null;
    size: number | null;
  };
  webpageUrl: string | null;
  exportedAt: string;
}

export async function writeSidecar(videoId: number): Promise<void> {
  const video = getVideo(videoId);
  const row = getVideoRow(videoId);
  if (!video || !row?.file_path) return;

  const paths = libraryPaths();
  const absolute = fromLibraryRelative(paths.root, row.file_path);
  const dir = path.dirname(absolute);
  if (!fs.existsSync(dir)) return;

  const files: Record<string, string | null> = {
    video: path.basename(absolute),
    cover: null,
    thumb: null,
    preview: null,
    subtitle: null,
    danmaku: null,
    nfo: null
  };
  for (const type of Object.keys(files)) {
    const asset = getAsset(videoId, type);
    files[type] = asset ? path.basename(fromLibraryRelative(paths.root, asset.path)) : null;
  }

  const sidecar: SidecarFile = {
    schema: 'bilishelf.item/1',
    videoKey: row.video_key,
    bvid: video.bvid,
    cid: video.cid,
    page: video.page,
    title: video.title,
    up: { mid: video.upMid, name: video.upName },
    description: video.description,
    source: { id: video.sourceId, name: video.sourceName },
    tags: video.tags,
    folders: video.folders,
    aiTags: getApprovedAiTags(videoId),
    aiTaggedAt: getAiTaggedAt(videoId),
    rating: video.rating,
    note: video.note,
    files,
    media: {
      duration: video.duration,
      width: video.width,
      height: video.height,
      vcodec: video.vcodec,
      acodec: video.acodec,
      size: video.fileSize
    },
    webpageUrl: video.bvid ? `https://www.bilibili.com/video/${video.bvid}` : null,
    exportedAt: new Date().toISOString()
  };

  const target = path.join(dir, 'metadata.json');
  await fsp.writeFile(target, JSON.stringify(sidecar, null, 2), 'utf8');
}

/** 从 sidecar 重建数据库（库目录可整体搬迁/数据库丢失时使用）。 */
export async function rebuildFromDisk(): Promise<{ scanned: number; restored: number }> {
  const paths = ensureLibraryDirs(libraryPaths());
  const sidecars: string[] = [];

  const scan = async (dir: string, depth = 0): Promise<void> => {
    if (depth > 8) return;
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scan(full, depth + 1);
      } else if (entry.isFile() && entry.name === 'metadata.json') {
        sidecars.push(full);
      }
    }
  };
  await scan(paths.media);

  let restored = 0;
  for (const sidecarPath of sidecars) {
    try {
      const raw = await fsp.readFile(sidecarPath, 'utf8');
      const data = JSON.parse(raw) as SidecarFile;
      if (data.schema !== 'bilishelf.item/1' || !data.videoKey) continue;

      const dir = path.dirname(sidecarPath);
      const videoFile = data.files.video ? path.join(dir, data.files.video) : null;
      const exists = videoFile ? fs.existsSync(videoFile) : false;
      const stat = exists && videoFile ? await fsp.stat(videoFile) : null;
      const relPath = exists && videoFile ? toLibraryRelative(paths.root, videoFile) : null;

      const existing = one<{ id: number }>('SELECT id FROM videos WHERE video_key = ?', [data.videoKey]);
      const sourceId = data.source?.id
        ? (one<{ id: number }>('SELECT id FROM sources WHERE id = ?', [data.source.id])?.id ?? null)
        : null;
      const id = upsertVideo({
        videoKey: data.videoKey,
        origin: data.bvid ? 'bilibili' : 'local',
        bvid: data.bvid,
        cid: data.cid,
        page: data.page,
        title: data.title,
        upName: data.up?.name ?? null,
        upMid: data.up?.mid ?? null,
        description: data.description ?? null,
        sourceId,
        filePath: relPath,
        fileSize: stat?.size ?? data.media?.size ?? null,
        duration: data.media?.duration ?? null,
        width: data.media?.width ?? null,
        height: data.media?.height ?? null,
        vcodec: data.media?.vcodec ?? null,
        acodec: data.media?.acodec ?? null,
        status: exists ? 'present' : 'missing'
      });

      if (relPath) setAsset(id, 'video', relPath, stat?.size ?? null, 'video/mp4');
      for (const [type, fileName] of Object.entries(data.files)) {
        if (!fileName || type === 'video') continue;
        const abs = path.join(dir, fileName);
        if (fs.existsSync(abs)) {
          setAsset(id, type, toLibraryRelative(paths.root, abs), fs.statSync(abs).size, null);
        }
      }
      for (const tag of data.tags ?? []) assignTagByName(id, tag, 'manual');
      for (const folder of data.folders ?? []) assignFolderByName(id, folder);
      if (Array.isArray(data.aiTags) && data.aiTags.length > 0) {
        for (const tag of data.aiTags) {
          restoreApprovedAiTag(id, { ...tag, approvedAt: data.aiTaggedAt ?? undefined });
        }
        refreshVideoFts(id);
      }
      if (typeof data.rating === 'number' || data.note) {
        updateVideo(id, { rating: data.rating ?? 0, note: data.note ?? '' });
      }
      if (!existing) restored += 1;
    } catch (error) {
      log.warn('[library] sidecar restore failed', sidecarPath, error);
    }
  }

  return { scanned: sidecars.length, restored };
}

export function videoAbsolutePath(videoId: number): string | null {
  const row = getVideoRow(videoId);
  if (!row?.file_path) return null;
  return fromLibraryRelative(libraryPaths().root, row.file_path);
}

