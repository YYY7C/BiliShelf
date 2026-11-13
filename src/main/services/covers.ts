import { net } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import log from 'electron-log/main';
import { all, one, run } from '../db/index';
import { ensureLibraryDirs, fromLibraryRelative, libraryPaths, toLibraryRelative } from '../paths';

const CONCURRENCY = 4;
const MAX_PER_RUN = 200;

interface CoverRow {
  id: number;
  bvid: string;
  cover_url: string;
}

function extensionFor(contentType: string | null, url: string): string {
  const type = (contentType ?? '').toLowerCase();
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (type.includes('avif')) return '.avif';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp', '.avif'].includes(ext) ? ext : '.jpg';
}

async function fetchCover(row: CoverRow, dir: string, root: string): Promise<boolean> {
  try {
    const response = await net.fetch(row.cover_url, {
      headers: { Referer: 'https://www.bilibili.com/' }
    });
    if (!response.ok) return false;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength < 512) return false;

    const file = path.join(dir, `${row.bvid || `item-${row.id}`}${extensionFor(response.headers.get('content-type'), row.cover_url)}`);
    await fsp.writeFile(file, buffer);
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

export function getRemoteCoverPath(id: number): string | null {
  const row = one<{ local_cover: string | null }>('SELECT local_cover FROM remote_items WHERE id = ?', [id]);
  if (!row?.local_cover) return null;
  const absolute = fromLibraryRelative(libraryPaths().root, row.local_cover);
  return fs.existsSync(absolute) ? absolute : null;
}
