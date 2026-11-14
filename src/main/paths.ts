import fs from 'node:fs';
import path from 'node:path';
import { fromLibraryRelative, isInside, safeSegment, toLibraryRelative } from './pathUtils';
import { getSettings } from './store';

export { fromLibraryRelative, isInside, safeSegment, toLibraryRelative };

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
