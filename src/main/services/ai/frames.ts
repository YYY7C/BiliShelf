import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import log from 'electron-log/main';
import type { MaintenanceResult } from '@shared/types';
import { planFrameTimes } from '@shared/aiFrame';
import { audioExtractArgs } from './audioArgs';
import { all, run } from '../../db/index';
import { getAsset, getVideoRow } from '../../db/videos';
import { requireTool } from '../../engine/tools';
import { ensureLibraryDirs, fromLibraryRelative, libraryPaths, toLibraryRelative } from '../../paths';
import { probeMedia } from '../media';

export interface StoredAiFrame {
  index: number;
  time: number;
  path: string;
  width?: number;
  height?: number;
}

export interface PrepareFrameOptions {
  count: number;
  width: number;
  includeCover: boolean;
}

export type AudioPosition = 'start' | 'middle' | 'end';

function runFfmpeg(args: string[], timeout = 90_000): Promise<boolean> {
  return new Promise((resolve) => {
    let ffmpeg: string;
    try {
      const tool = requireTool('ffmpeg');
      if (!tool.path) {
        resolve(false);
        return;
      }
      ffmpeg = tool.path;
    } catch {
      resolve(false);
      return;
    }
    execFile(
      ffmpeg,
      args,
      { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          log.warn('[ai-frames] ffmpeg failed', error.message, String(stderr ?? '').slice(-2000));
        }
        resolve(!error);
      }
    );
  });
}

function absoluteVideoPath(
  videoId: number
): { absolute: string; relative: string; duration: number | null } | null {
  const row = getVideoRow(videoId);
  if (!row?.file_path) return null;
  const paths = libraryPaths();
  const absolute = fromLibraryRelative(paths.root, row.file_path);
  if (!fs.existsSync(absolute)) return null;
  return { absolute, relative: row.file_path, duration: row.duration };
}

function cacheHash(absolute: string, options: PrepareFrameOptions): string {
  const stat = fs.statSync(absolute);
  return crypto
    .createHash('sha1')
    .update(`${stat.size}:${stat.mtimeMs}:${options.count}:${options.width}:${options.includeCover ? 1 : 0}`)
    .digest('hex')
    .slice(0, 16);
}

async function imageToJpeg(input: string, output: string, width: number): Promise<boolean> {
  if (fs.existsSync(output)) return true;
  const ok = await runFfmpeg([
    '-i',
    input,
    '-frames:v',
    '1',
    '-vf',
    `scale=${width}:${width}:force_original_aspect_ratio=decrease`,
    '-q:v',
    '3',
    '-y',
    output
  ]);
  if (ok && fs.existsSync(output)) return true;
  // ffmpeg 不可用时，至少复制原始 jpg，避免整个流程失败
  if (/\.jpe?g$/i.test(input)) {
    try {
      await fsp.copyFile(input, output);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

async function extractFrame(video: string, output: string, time: number, width: number): Promise<boolean> {
  if (fs.existsSync(output)) return true;
  return runFfmpeg([
    '-ss',
    String(time),
    '-i',
    video,
    '-frames:v',
    '1',
    '-vf',
    `scale=${width}:${width}:force_original_aspect_ratio=decrease`,
    '-q:v',
    '3',
    '-y',
    output
  ]);
}

export async function prepareFrames(videoId: number, options: PrepareFrameOptions): Promise<StoredAiFrame[]> {
  const video = absoluteVideoPath(videoId);
  if (!video) throw new Error('视频文件不存在，无法抽帧');
  const paths = ensureLibraryDirs(libraryPaths());
  const hash = cacheHash(video.absolute, options);
  const dir = path.join(paths.aiCache, String(videoId), hash);
  await fsp.mkdir(dir, { recursive: true });

  let duration = video.duration;
  if (!duration || !Number.isFinite(duration) || duration <= 0) {
    const probe = await probeMedia(video.absolute);
    duration = probe?.duration ?? null;
  }

  const frames: StoredAiFrame[] = [];
  const coverAsset = getAsset(videoId, 'cover');
  const coverSource = coverAsset ? fromLibraryRelative(paths.root, coverAsset.path) : null;

  if (options.includeCover) {
    const coverOutput = path.join(dir, 'cover.jpg');
    let ok = false;
    if (coverSource && fs.existsSync(coverSource)) {
      ok = await imageToJpeg(coverSource, coverOutput, options.width);
    }
    if (!ok) {
      const fallbackTime = duration ? Math.min(Math.max(1, duration * 0.1), Math.max(1, duration - 1)) : 1;
      ok = await extractFrame(video.absolute, coverOutput, fallbackTime, options.width);
    }
    if (ok) {
      frames.push({
        index: -1,
        time: 0,
        path: toLibraryRelative(paths.root, coverOutput)
      });
    }
  }

  const times = planFrameTimes(duration, options.count);
  for (let index = 0; index < times.length; index += 1) {
    const time = times[index]!;
    const output = path.join(dir, `frame-${index}-${Math.round(time * 10)}.jpg`);
    const ok = await extractFrame(video.absolute, output, time, options.width);
    if (ok) {
      frames.push({
        index,
        time,
        path: toLibraryRelative(paths.root, output)
      });
    }
  }

  if (frames.length === 0) throw new Error('抽帧失败，请检查 ffmpeg 是否可用');
  return frames;
}

export interface ExtractedAudio {
  absolute: string;
  hash: string;
  time: number;
}

export async function extractAudio(
  videoId: number,
  position: AudioPosition,
  options: PrepareFrameOptions
): Promise<ExtractedAudio> {
  const video = absoluteVideoPath(videoId);
  if (!video) throw new Error('视频文件不存在，无法抽取音频');
  const paths = ensureLibraryDirs(libraryPaths());
  const hash = cacheHash(video.absolute, options);
  const dir = path.join(paths.aiCache, String(videoId), hash);
  await fsp.mkdir(dir, { recursive: true });

  let duration = video.duration;
  if (!duration || !Number.isFinite(duration) || duration <= 0) {
    const probe = await probeMedia(video.absolute);
    duration = probe?.duration ?? null;
  }
  const ratio = position === 'start' ? 0.15 : position === 'end' ? 0.85 : 0.5;
  const time = duration ? Math.min(Math.max(1, duration * ratio), Math.max(1, duration - 16)) : 1;
  const output = path.join(dir, `audio-${position}.mp3`);
  if (!fs.existsSync(output)) {
    const ok = await runFfmpeg(audioExtractArgs(video.absolute, time, output));
    if (!ok || !fs.existsSync(output)) throw new Error('音频抽取失败，请检查 ffmpeg 是否可用');
  }
  const bytes = await fsp.readFile(output);
  return {
    absolute: output,
    hash: crypto.createHash('sha1').update(bytes).digest('hex'),
    time
  };
}

/** 删除超过保留期的 AI 抽帧/音频缓存；待审核运行会保护自己的缓存。 */
export function cleanupAiCache(days: number): MaintenanceResult {
  const paths = libraryPaths();
  const root = paths.aiCache;
  const result: MaintenanceResult = { total: 0, updated: 0, failed: 0, bytesFreed: 0, details: '' };
  if (!fs.existsSync(root)) {
    result.details = '没有 AI 缓存';
    return result;
  }
  const cutoff = Date.now() - Math.max(1, days) * 86_400_000;
  const pending = all<{ frames_json: string }>(
    "SELECT frames_json FROM ai_runs WHERE review_status = 'pending'"
  ).map((row) => row.frames_json);
  const videoDirs = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const entry of videoDirs) {
    const videoDir = path.join(root, entry.name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(videoDir);
    } catch {
      continue;
    }
    if (stat.mtimeMs >= cutoff) continue;
    const relDir = toLibraryRelative(paths.root, videoDir);
    if (pending.some((json) => json.includes(relDir))) continue;
    let bytes = 0;
    const walk = (dir: string): void => {
      for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, child.name);
        if (child.isDirectory()) walk(full);
        else {
          try {
            bytes += fs.statSync(full).size;
          } catch {
            // ignore
          }
        }
      }
    };
    try {
      walk(videoDir);
      fs.rmSync(videoDir, { recursive: true, force: true });
      result.bytesFreed += bytes;
      result.updated += 1;
      run("UPDATE ai_runs SET frames_json = '[]' WHERE frames_json LIKE ?", [`%${relDir}%`]);
    } catch (error) {
      result.failed += 1;
      log.warn('[ai] cleanup cache failed', videoDir, (error as Error).message);
    }
  }
  result.total = videoDirs.length;
  result.details = `清理 ${result.updated} 个 AI 缓存目录`;
  return result;
}
