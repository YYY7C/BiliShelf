import { protocol } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import log from 'electron-log/main';
import { fromLibraryRelative, isInside, libraryPaths } from './paths';
import { getAsset, getVideoRow } from './db/videos';
import { getRemoteCoverPath } from './services/covers';

export const APP_SCHEME = 'bilishelf';

/** 必须在 app ready 之前调用一次。 */
export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ]);
}

const MIME: Record<string, string> = {  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.flv': 'video/x-flv',
  '.mov': 'video/quicktime',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.ass': 'text/plain; charset=utf-8',
  '.ssa': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.nfo': 'application/xml; charset=utf-8'
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'range, content-type'
};

function mimeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  let start: number;
  let end: number;
  if (!rawStart && rawEnd) {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0) start = 0;
  if (end >= size) end = size - 1;
  if (start > end) return null;
  return { start, end };
}

async function serveFile(request: Request, filePath: string): Promise<Response> {
  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    return new Response('Not found', { status: 404 });
  }

  const type = mimeFor(filePath);
  const range = parseRange(request.headers.get('range'), stat.size);

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: {
        'content-type': type,
        'content-length': String(stat.size),
        'accept-ranges': 'bytes',
        'cache-control': 'no-cache',
        ...CORS
      }
    });
  }

  if (!range) {
    const stream = fs.createReadStream(filePath);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        'content-type': type,
        'content-length': String(stat.size),
        'accept-ranges': 'bytes',
        'cache-control': 'no-cache',
        ...CORS
      }
    });
  }

  const { start, end } = range;
  const stream = fs.createReadStream(filePath, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 206,
    headers: {
      'content-type': type,
      'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${stat.size}`,
      'accept-ranges': 'bytes',
      'cache-control': 'no-cache',
      ...CORS
    }
  });
}

function resolveVideoFile(id: number): string | null {
  const row = getVideoRow(id);
  if (!row?.file_path) return null;
  const root = libraryPaths().root;
  const absolute = fromLibraryRelative(root, row.file_path);
  if (!isInside(root, absolute)) {
    log.warn('[protocol] blocked path escape', id);
    return null;
  }
  return absolute;
}

function resolveAssetFile(id: number, type: string): string | null {
  const asset = getAsset(id, type);
  if (!asset) return null;
  const root = libraryPaths().root;
  const absolute = fromLibraryRelative(root, asset.path);
  if (!isInside(root, absolute)) {
    log.warn('[protocol] blocked asset escape', id, type);
    return null;
  }
  return absolute;
}

/**
 * bilishelf://media/<videoId>          -> 主视频（支持 Range）
 * bilishelf://asset/<videoId>/<type>   -> 封面/缩略图/字幕/弹幕等
 */
export function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS });
      }
      const url = new URL(request.url);
      const parts = url.pathname.split('/').filter(Boolean);

      if (url.hostname === 'media') {
        const id = Number(parts[0]);
        if (!Number.isFinite(id)) return new Response('Bad id', { status: 400 });
        const file = resolveVideoFile(id);
        if (!file) return new Response('Not found', { status: 404 });
        return await serveFile(request, file);
      }

      if (url.hostname === 'asset') {
        const id = Number(parts[0]);
        const type = parts[1] ?? '';
        if (!Number.isFinite(id) || !type) return new Response('Bad request', { status: 400 });
        const file = resolveAssetFile(id, type);
        if (!file) return new Response('Not found', { status: 404 });
        return await serveFile(request, file);
      }

      if (url.hostname === 'cover') {
        const id = Number(parts[0]);
        if (!Number.isFinite(id)) return new Response('Bad id', { status: 400 });
        const file = getRemoteCoverPath(id);
        if (!file) return new Response('Not found', { status: 404 });
        return await serveFile(request, file);
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      log.error('[protocol] handler error', error);
      return new Response('Internal error', { status: 500 });
    }
  });
  log.info('[protocol] registered', APP_SCHEME);
}
