import fs from 'node:fs';
import path from 'node:path';
import type { VideoItem } from '@shared/types';
import { fromLibraryRelative, libraryPaths, toLibraryRelative } from '../paths';
import { getAsset, getVideo, getVideoRow, setAsset } from '../db/videos';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 生成 Emby/Jellyfin 可识别的 movie.nfo + poster.jpg。默认关闭，失败不影响主流程。 */
export function writeNfo(videoId: number): boolean {
  const video = getVideo(videoId);
  const row = getVideoRow(videoId);
  if (!video || !row?.file_path) return false;

  const paths = libraryPaths();
  const videoAbs = fromLibraryRelative(paths.root, row.file_path);
  const dir = path.dirname(videoAbs);

  const genre = video.tags.map((tag) => `  <genre>${escapeXml(tag)}</genre>`).join('\n');
  const uniqueId = video.bvid ? `  <uniqueid type="bilibili" default="true">${escapeXml(video.bvid)}</uniqueid>` : '';
  const premiered = video.downloadedAt ? video.downloadedAt.slice(0, 10) : '';
  const actor = video.upName
    ? `  <actor>\n    <name>${escapeXml(video.upName)}</name>\n    <role>UP主</role>\n  </actor>`
    : '';

  const nfo = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<movie>
  <title>${escapeXml(video.title)}</title>
  <originaltitle>${escapeXml(video.title)}</originaltitle>
  <plot>${escapeXml(video.description ?? '')}</plot>
${uniqueId}
${genre}
${actor}
${premiered ? `  <premiered>${premiered}</premiered>` : ''}
  <thumb>poster.jpg</thumb>
  <fileinfo>
    <streamdetails>
      <video>
        <codec>${escapeXml(video.vcodec ?? '')}</codec>
        <width>${video.width ?? 0}</width>
        <height>${video.height ?? 0}</height>
      </video>
      <audio>
        <codec>${escapeXml(video.acodec ?? '')}</codec>
      </audio>
    </streamdetails>
  </fileinfo>
</movie>
`;

  try {
    const nfoPath = path.join(dir, 'movie.nfo');
    fs.writeFileSync(nfoPath, nfo, 'utf8');
    setAsset(videoId, 'nfo', toLibraryRelative(paths.root, nfoPath), fs.statSync(nfoPath).size, 'application/xml');

    const cover = getAsset(videoId, 'cover') ?? getAsset(videoId, 'thumb');
    if (cover) {
      const coverAbs = fromLibraryRelative(paths.root, cover.path);
      if (fs.existsSync(coverAbs)) {
        const posterPath = path.join(dir, 'poster.jpg');
        if (!fs.existsSync(posterPath)) fs.copyFileSync(coverAbs, posterPath);
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function describeVideoForNfo(video: VideoItem | null): string {
  return video?.title ?? '';
}
