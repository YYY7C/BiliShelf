import log from 'electron-log/main';
import type { QualityCandidate, QualityScanProgress, QualityScanResult } from '@shared/types';
import { all, one, run } from '../db/index';
import { findActiveJob } from '../db/jobs';
import { getVideoRow, videoKeyFor } from '../db/videos';
import { probeFormats } from '../engine/ytdlp';
import { deleteCookiesFile, exportCookiesFile } from './auth';
import { downloadManager } from './downloads';

const SCAN_LIMIT = 200;
const PROBE_GAP_MS = 300;

interface QualityRow {
  id: number;
  bvid: string;
  cid: number | null;
  page: number;
  title: string;
  source_id: number | null;
  source_name: string | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
}

/** 竖屏用短边作为画质档位；横屏就是 height。 */
function shortSide(width: number | null | undefined, height: number | null | undefined): number {
  if (!height || !Number.isFinite(height)) return 0;
  if (!width || !Number.isFinite(width)) return Math.round(height);
  return Math.round(Math.min(width, height));
}

let activeScan: Promise<QualityScanResult> | null = null;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(bvid: string, page: number): string {
  return page > 1
    ? `https://www.bilibili.com/video/${bvid}?p=${page}`
    : `https://www.bilibili.com/video/${bvid}`;
}

/**
 * 逐个探测已下载视频的可选格式：
 * - 最高分辨率更高 -> 分辨率升级
 * - 分辨率相同但最高码率高出 10% -> 码率升级
 */
export function scanQualityUpgrades(options: {
  onProgress?: (progress: QualityScanProgress) => void;
} = {}): Promise<QualityScanResult> {
  if (activeScan) return activeScan;
  activeScan = runQualityScan(options).finally(() => {
    activeScan = null;
  });
  return activeScan;
}

async function runQualityScan(options: {
  onProgress?: (progress: QualityScanProgress) => void;
}): Promise<QualityScanResult> {
  let cookiesFile: string | null = null;
  try {
    const rows = all<QualityRow>(
      `SELECT v.id, v.bvid, v.cid, v.page, v.title, v.source_id, s.title AS source_name,
              v.width, v.height, v.bitrate
         FROM videos v
         LEFT JOIN sources s ON s.id = v.source_id
        WHERE v.status = 'present' AND v.bvid <> '' AND v.height IS NOT NULL
        ORDER BY CASE WHEN v.quality_checked_at IS NULL THEN 0 ELSE 1 END,
                 COALESCE(v.quality_checked_at, '') ASC,
                 v.id DESC
        LIMIT ?`,
      [SCAN_LIMIT]
    );

    const candidates: QualityCandidate[] = [];
    let scanned = 0;
    let failed = 0;
    cookiesFile = await exportCookiesFile();

    for (const row of rows) {
      scanned += 1;
      options.onProgress?.({ scanned, total: rows.length, title: row.title });

      try {
        const formats = await probeFormats(buildUrl(row.bvid, row.page), cookiesFile);
        const maxHeight = formats.reduce((max, format) => Math.max(max, shortSide(format.width, format.height)), 0);
        if (maxHeight <= 0) {
          run('UPDATE videos SET quality_checked_at = ? WHERE id = ?', [new Date().toISOString(), row.id]);
          continue;
        }

        const atMax = formats.filter((format) => shortSide(format.width, format.height) === maxHeight);
        const maxFps = atMax.reduce((max, format) => Math.max(max, format.fps ?? 0), 0);
        const atMaxFps = atMax.filter((format) => (format.fps ?? 0) === maxFps);
        const maxTbr = atMaxFps.reduce((max, format) => Math.max(max, format.tbr ?? 0), 0);
        const currentHeight = shortSide(row.width, row.height);
        const currentTbr = row.bitrate ? row.bitrate / 1000 : 0;

        let reason: QualityCandidate['reason'] | null = null;
        if (maxHeight > currentHeight) {
          reason = 'resolution';
        } else if (maxHeight === currentHeight && maxTbr > 0 && currentTbr > 0 && maxTbr > currentTbr * 1.1) {
          reason = 'bitrate';
        }

        if (reason) {
          candidates.push({
            videoId: row.id,
            bvid: row.bvid,
            title: row.title,
            sourceId: row.source_id,
            sourceName: row.source_name,
            currentHeight: currentHeight || null,
            currentBitrate: row.bitrate,
            availableHeight: maxHeight,
            availableBitrate: maxTbr > 0 ? Math.round(maxTbr * 1000) : null,
            reason
          });
        }
        // 探测成功才标记，失败项下次扫描还会重试
        run('UPDATE videos SET quality_checked_at = ? WHERE id = ?', [new Date().toISOString(), row.id]);
      } catch (error) {
        failed += 1;
        log.warn('[quality] probe failed', row.bvid, (error as Error).message);
      }

      await wait(PROBE_GAP_MS);
    }

    const remaining =
      one<{ c: number }>(
        "SELECT COUNT(*) AS c FROM videos WHERE status = 'present' AND bvid <> '' AND height IS NOT NULL AND quality_checked_at IS NULL"
      )?.c ?? 0;

    return { scanned, failed, remaining, candidates };
  } finally {
    await deleteCookiesFile(cookiesFile);
  }
}

/** 把选中的视频加入升级队列，用最高画质重新下载并替换旧文件。 */
export async function enqueueQualityUpgrades(videoIds: number[]): Promise<{ queued: number; skipped: number }> {
  let queued = 0;
  let skipped = 0;

  for (const id of videoIds) {
    const video = getVideoRow(id);
    if (!video || video.status !== 'present' || !video.bvid || !video.height) {
      skipped += 1;
      continue;
    }

    // 已有队列中的任务（含暂停）时跳过，避免把原任务恢复成非升级任务
    if (findActiveJob(videoKeyFor(video.bvid, video.page))) {
      skipped += 1;
      continue;
    }

    const result = downloadManager.enqueue([
      {
        bvid: video.bvid,
        cid: video.cid,
        page: video.page,
        title: video.title,
        sourceId: video.source_id,
        remoteItemId: video.remote_item_id,
        quality: 'best',
        upgradeVideoId: video.id
      }
    ]);
    queued += result.queued;
    skipped += result.skipped;
  }

  return { queued, skipped };
}
