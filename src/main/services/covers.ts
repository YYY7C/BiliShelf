import { nativeImage, net } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import log from 'electron-log/main';
import { all, one, run } from '../db/index';
import { ensureLibraryDirs, fromLibraryRelative, libraryPaths, toLibraryRelative } from '../paths';

const CONCURRENCY = 4;
const MAX_PER_RUN = 200;
const COVER_WIDTH = 640;
const COVER_QUALITY = 82;

interface CoverRow {
  id: number;
  bvid: string;
  cover_url: string;
}

/** 清单页最大只显示 ~96px，缓存 640px 已经足够；原图会额外占用数倍磁盘。 */
function toThumbnail(buffer: Buffer): Buffer {
  try {
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) return buffer;
    const { width } = image.getSize();
    const resized = width > COVER_WIDTH ? image.resize({ width: COVER_WIDTH, quality: 'good' }) : image;
    return resized.toJPEG(COVER_QUALITY);
  } catch {
    return buffer;
  }
}

async function fetchCover(row: CoverRow, dir: string, root: string): Promise<boolean> {
  try {
    const response = await net.fetch(row.cover_url, { headers: { Referer: 'https://www.bilibili.com/' } });
    if (!response.ok) return false;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength < 512) return false;

    const file = path.join(dir, `${row.bvid || `item-${row.id}`}.jpg`);
    await fsp.writeFile(file, toThumbnail(buffer));
    run('UPDATE remote_items SET local_cover = ? WHERE id = ?', [toLibraryRelative(root, file), row.id]);
    return true;
  } catch (error) {
    log.debug('[covers] fetch failed', row.bvid, (error as Error).message);
    return false;
  }
}

/**
 * 把远端封面缓存到本地：清单页不再依赖网络，也避免 CDN 抖动导致一片空白。
 * 返回成功缓存的数量。
 */
export async function cacheRemoteCovers(sourceId?: number): Promise<number> {
  const params: unknown[] = [];
  let where = 'local_cover IS NULL AND cover_url IS NOT NULL AND cover_url <> \'\'';
  if (sourceId) {
    where += ' AND source_id = ?';
    params.push(sourceId);
  }
  params.push(MAX_PER_RUN);

  const rows = all<CoverRow>(
    `SELECT id, bvid, cover_url FROM remote_items WHERE ${where} ORDER BY last_seen_at DESC LIMIT ?`,
    params
  );
  if (rows.length === 0) return 0;

  const paths = ensureLibraryDirs(libraryPaths());
  const dir = path.join(paths.cache, 'covers');
  fs.mkdirSync(dir, { recursive: true });

  let done = 0;
  for (let index = 0; index < rows.length; index += CONCURRENCY) {
    const batch = rows.slice(index, index + CONCURRENCY);
    const results = await Promise.all(batch.map((row) => fetchCover(row, dir, paths.root)));
    done += results.filter(Boolean).length;
  }

  if (done > 0) log.info('[covers] cached', done, 'of', rows.length);
  return done;
}

/**
 * 把已有封面重新压成 640px JPEG，并修正扩展名。
 * 用于升级前的旧缓存（原图平均 ~600KB）。
 */
export async function recompressCovers(
  onProgress?: (done: number, total: number) => void
): Promise<{ total: number; compressed: number; savedBytes: number }> {
  const paths = ensureLibraryDirs(libraryPaths());
  const rows = all<{ id: number; local_cover: string }>(
    'SELECT id, local_cover FROM remote_items WHERE local_cover IS NOT NULL'
  );
  // 同一 bvid 在多个收藏夹里会共用同一张封面文件，按文件去重后再更新所有引用行
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const ids = groups.get(row.local_cover) ?? [];
    ids.push(row.id);
    groups.set(row.local_cover, ids);
  }

  let compressed = 0;
  let savedBytes = 0;
  let index = 0;
  for (const [relative, ids] of groups) {
    index += 1;
    onProgress?.(index, groups.size);
    const absolute = fromLibraryRelative(paths.root, relative);
    try {
      if (!fs.existsSync(absolute)) continue;
      const before = fs.statSync(absolute).size;
      const buffer = await fsp.readFile(absolute);
      const next = toThumbnail(buffer);
      const target = absolute.replace(/\.[^.]+$/, '') + '.jpg';
      if (target === absolute && next.length >= before) continue;
      await fsp.writeFile(target, next);
      if (target !== absolute) await fsp.rm(absolute, { force: true }).catch(() => undefined);
      const after = fs.statSync(target).size;
      if (target !== absolute) {
        const nextRelative = toLibraryRelative(paths.root, target);
        run('UPDATE remote_items SET local_cover = ? WHERE local_cover = ?', [nextRelative, relative]);
      }
      compressed += ids.length;
      savedBytes += Math.max(0, before - after);
    } catch (error) {
      log.debug('[covers] recompress failed', relative, (error as Error).message);
    }
  }

  if (compressed > 0) log.info('[covers] recompressed', compressed, 'saved', savedBytes);
  return { total: rows.length, compressed, savedBytes };
}

export function getRemoteCoverPath(id: number): string | null {
  const row = one<{ local_cover: string | null }>('SELECT local_cover FROM remote_items WHERE id = ?', [id]);
  if (!row?.local_cover) return null;
  const absolute = fromLibraryRelative(libraryPaths().root, row.local_cover);
  return fs.existsSync(absolute) ? absolute : null;
}
