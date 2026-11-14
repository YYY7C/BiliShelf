import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';
import { formatSelector } from '@shared/ytdlp';
import type { QualityPreset } from '@shared/types';
import { requireTool } from './tools';

export { formatSelector };

export interface DownloadProgress {
  downloaded: number;
  total: number;
  speed: number;
  eta: number;
}

export interface DownloadOptions {
  url: string;
  outputDir: string;
  quality: QualityPreset;
  preferHighestBitrate?: boolean;
  cookiesFile?: string | null;
  onProgress?: (progress: DownloadProgress) => void;
  onLog?: (line: string) => void;
}

export interface DownloadOutcome {
  code: number;
  stderr: string;
  canceled: boolean;
}

const PROGRESS_PREFIX = 'BS_PROGRESS|';

/**
 * 部分 CDN 边缘节点会拒绝非浏览器 UA，并对「单次长连接整文件下载」返回 567；
 * 实测浏览器 UA + 1M 分块请求可稳定下载，且进度上报正常。
 */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

export interface FormatProbe {
  height: number | null;
  width: number | null;
  tbr: number | null;
  vcodec: string | null;
  fps: number | null;
}

/** 只解析元数据，不下载；用于画质升级检查。 */
export function probeFormats(url: string, cookiesFile?: string | null): Promise<FormatProbe[]> {
  const tool = requireTool('ytdlp');
  const args = [
    '--no-warnings',
    '--no-playlist',
    '--skip-download',
    '--dump-single-json',
    '--user-agent',
    BROWSER_UA
  ];
  if (cookiesFile) args.push('--cookies', cookiesFile);
  args.push('--', url);

  return new Promise((resolve, reject) => {
    const child = spawn(tool.path!, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('画质探测超时'));
    }, 30000);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.split(/\r?\n/).filter(Boolean).slice(-2).join(' ') || `yt-dlp 退出码 ${code}`));
        return;
      }
      try {
        const json = JSON.parse(stdout.replace(/^\uFEFF/, '')) as { formats?: Array<Record<string, unknown>> };
        const formats = (json.formats ?? [])
          .map((format) => ({
            height: typeof format.height === 'number' ? format.height : null,
            width: typeof format.width === 'number' ? format.width : null,
            tbr:
              typeof format.tbr === 'number'
                ? format.tbr
                : typeof format.vbr === 'number'
                  ? format.vbr
                  : null,
            vcodec: typeof format.vcodec === 'string' ? format.vcodec : null,
            fps: typeof format.fps === 'number' ? format.fps : null
          }))
          .filter((format) => format.vcodec && format.vcodec !== 'none' && (format.height ?? 0) > 0);
        resolve(formats);
      } catch {
        reject(new Error('解析 yt-dlp 输出失败'));
      }
    });
  });
}

function buildArgs(options: DownloadOptions): string[] {
  const args: string[] = [
    '--no-playlist',
    '--newline',
    '--no-warnings',
    '--user-agent',
    BROWSER_UA,
    '--http-chunk-size',
    '1M',
    '--retries',
    '3',
    '--fragment-retries',
    '3',
    '--socket-timeout',
    '20',
    '--no-mtime',
    '--write-info-json',
    '--write-thumbnail',
    '--convert-thumbnails',
    'jpg',
    '--write-subs',
    '--sub-langs',
    'zh-Hans,zh-CN,zh,ai-zh',
    '--convert-subs',
    'srt',
    '--progress-template',
    `download:${PROGRESS_PREFIX}%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s`,
    '-f',
    formatSelector(options.quality),
    '-o',
    path.join(options.outputDir, '%(title).80s.%(ext)s')
  ];

  if (options.quality === 'audio') {
    args.push('-x', '--audio-format', 'm4a');
  } else {
    args.push('--merge-output-format', 'mp4/mkv');
  }

  // 最高画质：先按分辨率/帧率取最高；普通下载同规格优先 H.264，画质升级则取最高码率
  if (options.quality === 'best') {
    args.push('-S', options.preferHighestBitrate ? 'res,fps,br' : 'res,fps,vcodec:h264,br');
  }

  if (options.cookiesFile) {
    args.push('--cookies', options.cookiesFile);
  }

  args.push('--', options.url);
  return args;
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function downloadVideo(options: DownloadOptions): { child: ChildProcess; done: Promise<DownloadOutcome> } {
  const tool = requireTool('ytdlp');
  const args = buildArgs(options);
  log.info('[ytdlp] start', path.basename(options.outputDir), options.quality);

  const child = spawn(tool.path!, args, { windowsHide: true });
  let stderr = '';
  let canceled = false;

  const handleLine = (line: string) => {
    const text = line.trim();
    if (!text) return;
    if (text.startsWith(PROGRESS_PREFIX)) {
      const [downloaded, total, totalEstimate, speed, eta] = text.slice(PROGRESS_PREFIX.length).split('|');
      options.onProgress?.({
        downloaded: toNumber(downloaded ?? ''),
        total: toNumber(total ?? '') || toNumber(totalEstimate ?? ''),
        speed: toNumber(speed ?? ''),
        eta: toNumber(eta ?? '')
      });
      return;
    }
    if (text.startsWith('ERROR') || text.includes('ERROR:')) {
      stderr += `${text}\n`;
    }
    options.onLog?.(text);
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    String(chunk)
      .split(/\r?\n|\r/)
      .forEach(handleLine);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = String(chunk);
    stderr += text;
    text.split(/\r?\n|\r/).forEach(handleLine);
  });

  const done = new Promise<DownloadOutcome>((resolve) => {
    child.on('error', (error) => {
      resolve({ code: -1, stderr: error.message, canceled });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? -1, stderr: stderr.trim().slice(-2000), canceled });
    });
  });

  const originalKill = child.kill.bind(child);
  child.kill = ((signal?: NodeJS.Signals) => {
    canceled = true;
    if (child.pid) {
      try {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      } catch {
        originalKill(signal ?? 'SIGTERM');
      }
    } else {
      originalKill(signal ?? 'SIGTERM');
    }
    return true;
  }) as typeof child.kill;

  return { child, done };
}

/* --------------------------- listing via yt-dlp --------------------------- */

export interface YtEntry {
  id: string;
  title: string;
  url?: string;
  duration?: number | null;
  uploader?: string | null;
  uploader_id?: string | null;
  thumbnail?: string | null;
  timestamp?: number | null;
  cid?: number | null;
}

export async function listFlatPlaylist(url: string, cookiesFile?: string | null): Promise<YtEntry[]> {
  const tool = requireTool('ytdlp');
  const args = [
    '-J',
    '--flat-playlist',
    '--no-warnings',
    '--ignore-errors',
    '--socket-timeout',
    '20',
    '--user-agent',
    BROWSER_UA,
    '--http-chunk-size',
    '1M'
  ];
  if (cookiesFile) args.push('--cookies', cookiesFile);
  args.push('--', url);

  return new Promise((resolve, reject) => {
    const child = spawn(tool.path!, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      reject(new Error('列取超时'));
    }, 120_000);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(stderr.trim().slice(-400) || `yt-dlp 退出码 ${code}`));
        return;
      }
      try {
        const data = JSON.parse(stdout) as { entries?: YtEntry[] } & YtEntry;
        const entries = data.entries ?? [data];
        resolve(entries.filter((entry) => entry && entry.id));
      } catch (error) {
        reject(new Error(`解析 yt-dlp 输出失败: ${(error as Error).message}`));
      }
    });
  });
}

/** 从目录中找出下载完成的主视频文件（排除预览/临时文件）。 */
export function findDownloadedVideo(dir: string): string | null {
  const extensions = ['.mp4', '.mkv', '.webm', '.flv', '.m4a', '.mp3', '.mov'];
  const found: Array<{ file: string; size: number }> = [];
  const walk = (current: string, depth = 0) => {
    if (depth > 3) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!extensions.includes(ext)) continue;
      if (entry.name.includes('-preview')) continue;
      const stat = fs.statSync(full);
      if (!stat.isFile() || stat.size < 1024) continue;
      found.push({ file: full, size: stat.size });
    }
  };
  try {
    walk(dir);
  } catch {
    return null;
  }
  found.sort((a, b) => b.size - a.size);
  return found[0]?.file ?? null;
}

export function findSidecarFiles(dir: string): {
  infoJson: string | null;
  thumbnail: string | null;
  subtitles: string[];
} {
  const result: { infoJson: string | null; thumbnail: string | null; subtitles: string[] } = {
    infoJson: null,
    thumbnail: null,
    subtitles: []
  };
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile());
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.name.endsWith('.info.json')) result.infoJson = full;
    else if (/\.(jpg|jpeg|png|webp)$/i.test(entry.name) && !result.thumbnail) result.thumbnail = full;
    else if (/\.(srt|vtt|ass)$/i.test(entry.name)) result.subtitles.push(full);
  }
  return result;
}
