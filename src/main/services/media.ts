import { execFile } from 'node:child_process';
import fs from 'node:fs';
import log from 'electron-log/main';
import type { ToolKind } from '@shared/types';
import { engineStatus, requireTool } from '../engine/tools';

export interface ProbeResult {
  duration: number | null;
  width: number | null;
  height: number | null;
  vcodec: string | null;
  acodec: string | null;
  bitrate: number | null;
  container: string | null;
  size: number | null;
}

function run(bin: string, args: string[], timeout = 120_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = typeof error?.code === 'number' ? error.code : error ? 1 : 0;
      resolve({ code, stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' });
    });
  });
}

function toolPath(kind: ToolKind): string | null {
  const status = engineStatus().tools.find((tool) => tool.kind === kind);
  return status?.ok ? status.path : null;
}

export async function probeMedia(file: string): Promise<ProbeResult | null> {
  let ffprobe: string | null;
  try {
    ffprobe = requireTool('ffprobe').path;
  } catch {
    ffprobe = toolPath('ffprobe');
  }
  if (!ffprobe) return null;

  const { code, stdout } = await run(
    ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    30_000
  );
  if (code !== 0 || !stdout) return null;

  try {
    const data = JSON.parse(stdout) as {
      format?: { duration?: string; bit_rate?: string; format_name?: string; size?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        duration?: string;
        bit_rate?: string;
      }>;
    };
    const video = data.streams?.find((stream) => stream.codec_type === 'video');
    const audio = data.streams?.find((stream) => stream.codec_type === 'audio');
    const durationRaw = data.format?.duration ?? video?.duration;
    // 画质升级要和 yt-dlp 的视频流 tbr 比较，这里优先取视频流码率而不是含音频的总码率
    const videoBitrate = video?.bit_rate ? Number(video.bit_rate) : null;
    return {
      duration: durationRaw ? Number(durationRaw) : null,
      width: video?.width ?? null,
      height: video?.height ?? null,
      vcodec: video?.codec_name ?? null,
      acodec: audio?.codec_name ?? null,
      bitrate:
        videoBitrate && Number.isFinite(videoBitrate)
          ? videoBitrate
          : data.format?.bit_rate
            ? Number(data.format.bit_rate)
            : null,
      container: data.format?.format_name ?? null,
      size: data.format?.size ? Number(data.format.size) : null
    };
  } catch (error) {
    log.warn('[media] probe parse failed', error);
    return null;
  }
}

/** 抽一帧作为缩略图（默认取 10% 处，至少 3 秒）。 */
export async function makeThumbnail(video: string, output: string, durationSec?: number | null): Promise<boolean> {
  const ffmpeg = toolPath('ffmpeg');
  if (!ffmpeg) return false;

  const duration = durationSec && Number.isFinite(durationSec) ? durationSec : 0;
  const at = duration > 0 ? Math.min(Math.max(3, duration * 0.1), Math.max(3, duration - 1)) : 3;

  const attempts: Array<{ args: string[]; out: string }> = [
    {
      out: output,
      args: ['-ss', String(at), '-i', video, '-frames:v', '1', '-vf', 'scale=640:-2', '-y', output]
    },
    {
      out: output.replace(/\.webp$/i, '.jpg'),
      args: [
        '-ss',
        String(at),
        '-i',
        video,
        '-frames:v',
        '1',
        '-vf',
        'scale=640:-2',
        '-q:v',
        '3',
        '-y',
        output.replace(/\.webp$/i, '.jpg')
      ]
    }
  ];

  for (const attempt of attempts) {
    const { code } = await run(ffmpeg, attempt.args, 60_000);
    if (code === 0 && fs.existsSync(attempt.out)) return true;
  }
  log.warn('[media] thumbnail failed', video);
  return false;
}

/** 生成 4 秒静音预览片，用于网格悬停；失败不阻塞主流程。 */
export async function makePreview(video: string, output: string, durationSec?: number | null): Promise<boolean> {
  const ffmpeg = toolPath('ffmpeg');
  if (!ffmpeg) return false;

  const duration = durationSec && Number.isFinite(durationSec) ? durationSec : 0;
  const start = duration > 8 ? Math.min(duration * 0.15, 60) : 0;

  const encoders = [
    ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '31'],
    ['-c:v', 'mpeg4', '-q:v', '8']
  ];

  for (const encoder of encoders) {
    const { code } = await run(
      ffmpeg,
      [
        '-ss',
        String(start),
        '-t',
        '4',
        '-i',
        video,
        '-an',
        '-vf',
        'scale=854:-2',
        ...encoder,
        '-movflags',
        '+faststart',
        '-y',
        output
      ],
      90_000
    );
    if (code === 0 && fs.existsSync(output)) return true;
  }
  return false;
}
