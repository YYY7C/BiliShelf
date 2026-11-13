import fs from 'node:fs';
import path from 'node:path';
import { getSettings } from './store';

export interface LibraryPaths {
  root: string;
  db: string;
  media: string;
  cache: string;
  thumbs: string;
  sprites: string;
  temp: string;
  backups: string;
  logs: string;
}

export function libraryPaths(rootOverride?: string): LibraryPaths {
  const root = path.resolve(rootOverride ?? getSettings().libraryRoot);
  return {
    root,
    db: path.join(root, 'library.db'),
    media: path.join(root, 'media'),
    cache: path.join(root, 'cache'),
    thumbs: path.join(root, 'cache', 'thumbnails'),
    sprites: path.join(root, 'cache', 'sprites'),
    temp: path.join(root, 'cache', 'temp'),
    backups: path.join(root, 'backups'),
    logs: path.join(root, 'logs')
  };
}

export function ensureLibraryDirs(paths = libraryPaths()): LibraryPaths {
  for (const dir of [paths.root, paths.media, paths.cache, paths.thumbs, paths.sprites, paths.temp, paths.backups, paths.logs]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return paths;
}

/** 把任意绝对路径转成库内相对路径（统一用 / 分隔，便于跨机搬库）。 */
export function toLibraryRelative(root: string, absolute: string): string {
  const rel = path.relative(root, absolute);
  return rel.split(path.sep).join('/');
}

export function fromLibraryRelative(root: string, relative: string): string {
  return path.join(root, relative.split('/').join(path.sep));
}

/** 校验目标路径确实位于库根目录内，防路径穿越。 */
export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Windows 安全文件名：清洗非法字符、保留名、结尾空格与点，并限制长度。 */
export function safeSegment(input: string, fallback = 'untitled', maxLength = 80): string {
  let name = String(input ?? '')
    .normalize('NFC')
    .replace(ILLEGAL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (!name) name = fallback;
  if (RESERVED.test(name)) name = `_${name}`;
  if (name.length > maxLength) name = name.slice(0, maxLength).trim();
  return name || fallback;
}

export function uniquePath(dir: string, base: string, ext: string): string {
  let candidate = path.join(dir, `${base}${ext}`);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}_${index}${ext}`);
    index += 1;
    if (index > 9999) break;
  }
  return candidate;
}
