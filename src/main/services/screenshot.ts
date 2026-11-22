import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import log from 'electron-log/main';
import type { ScreenshotInput, ScreenshotResult } from '@shared/types';
import { getVideoRow } from '../db/videos';
import { engineStatus } from '../engine/tools';
import { ensureLibraryDirs, fromLibraryRelative, isInside, libraryPaths, uniquePath } from '../paths';

/** 截图目录（相对素材库根目录） */
export const SCREENSHOT_DIR = 'screenshots';

/** 视频内时间 → `HH-MM-SS`，用于文件名，便于按时间排序 */
export function screenshotStamp(time: number): string {
  const safe = Number.isFinite(time) ? Math.max(0, Math.floor(time)) : 0;
  const hours = String(Math.floor(safe / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((safe % 3600) / 60)).padStart(2, '0');
  const seconds = String(safe % 60).padStart(2, '0');
  return `${hours}-${minutes}-${seconds}`;
}

/** 秒数 → ffmpeg 接受的十进制秒（保留毫秒精度） */
export function ffmpegTime(time: number): string {
  const safe = Number.isFinite(time) ? Math.max(0, time) : 0;
  return safe.toFixed(3);
}

/**
 * 截图文件名（不含扩展名）：`标题_00-15-03`。
 * 只去掉 Windows 不允许的字符，中文与 emoji 保留。
 */
export function screenshotBaseName(title: string, time: number): string {
  const cleaned = Array.from(String(title || ''))
    .map((char) => (char.charCodeAt(0) < 32 ? ' ' : char))
    .join('')
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80)
    .replace(/[.\s]+$/g, '');
  return `${cleaned || 'video'}_${screenshotStamp(time)}`;
}

/**
 * ffmpeg 参数：从源文件按时间点解出**一帧原始画面**。
 * 不缩放、不重采样、不加任何滤镜或水印，输出无损 PNG。
 */
export function screenshotArgs(input: string, output: string, time: number): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    ffmpegTime(time),
    '-i',
    input,
    '-map',
    '0:v:0',
    '-an',
    '-sn',
    '-dn',
    '-frames:v',
    '1',
    '-c:v',
    'png',
    '-y',
    output
  ];
}

/** 从 PNG 的 IHDR 块读宽高（不依赖第三方库，用于确认确实是原图分辨率） */
export function readPngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let index = 0; index < signature.length; index += 1) {
    if (buffer[index] !== signature[index]) return null;
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height) return null;
  return { width, height };
}

function ffmpegPath(): string | null {
  const status = engineStatus().tools.find((tool) => tool.kind === 'ffmpeg');
  return status?.ok ? status.path : null;
}

function runFfmpeg(bin: string, args: string[], timeout = 30_000): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        log.warn('[screenshot] ffmpeg failed', error.message, String(stderr ?? '').slice(-1200));
      }
      resolve(!error);
    });
  });
}

/** 截图保存目录（会确保存在） */
export async function screenshotDir(): Promise<string> {
  const dir = path.join(ensureLibraryDirs(libraryPaths()).root, SCREENSHOT_DIR);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * 把视频当前时间点导出为**原始分辨率**的 PNG。
 * 走 ffmpeg 直接解源文件，因此不受播放器画布/CORS/缩放影响。
 */
export async function captureScreenshot(input: ScreenshotInput): Promise<ScreenshotResult> {
  const row = getVideoRow(input.videoId);
  if (!row?.file_path) throw new Error('该条目没有本地视频文件');

  const paths = libraryPaths();
  const absolute = fromLibraryRelative(paths.root, row.file_path);
  if (!isInside(paths.root, absolute)) throw new Error('视频路径非法');
  if (!fs.existsSync(absolute)) throw new Error('本地视频文件不存在，请先重新下载或重建索引');

  const ffmpeg = ffmpegPath();
  if (!ffmpeg) throw new Error('未检测到 ffmpeg，无法导出原图');

  const time = Math.max(0, Number(input.time) || 0);
  if (row.duration && time > row.duration) throw new Error('截图时间超出视频时长');

  const dir = await screenshotDir();
  const base = screenshotBaseName(row.title ?? `video-${input.videoId}`, time);
  const output = uniquePath(dir, base, '.png');

  const ok = await runFfmpeg(ffmpeg, screenshotArgs(absolute, output, time));
  if (!ok || !fs.existsSync(output)) {
    throw new Error('截图失败：该时间点没有可用画面');
  }

  const buffer = await fsp.readFile(output);
  const size = readPngSize(buffer);
  const bytes = buffer.byteLength;
  if (!size) throw new Error('截图生成的文件无法解析，请重试');

  if (row.width && row.height && (size.width !== row.width || size.height !== row.height)) {
    log.warn('[screenshot] size mismatch', {
      videoId: input.videoId,
      expected: `${row.width}x${row.height}`,
      actual: `${size.width}x${size.height}`
    });
  }

  const name = path.basename(output);
  return {
    path: output,
    name,
    relativePath: path.posix.join(SCREENSHOT_DIR, name),
    width: size.width,
    height: size.height,
    bytes,
    time
  };
}
