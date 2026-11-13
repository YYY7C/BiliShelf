import { app } from 'electron';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';
import type { EngineStatus, ToolKind, ToolStatus } from '@shared/types';
import { getSettings } from '../store';

const CACHE_MS = 10_000;

let cache: EngineStatus | null = null;
let cachedAt = 0;

const TOOL_NAMES: Record<ToolKind, string[]> = {
  ytdlp: ['yt-dlp.exe', 'yt-dlp'],
  ffmpeg: ['ffmpeg.exe', 'ffmpeg'],
  ffprobe: ['ffprobe.exe', 'ffprobe']
};

function bundledDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(app.getAppPath(), 'resources', 'bin');
}

function which(exe: string): string | null {
  const result = spawnSync('where', [exe], { encoding: 'utf8', timeout: 4000, windowsHide: true });
  if (result.status !== 0 || !result.stdout) return null;
  const first = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return first ?? null;
}

function candidates(kind: ToolKind): Array<{ file: string; origin: ToolStatus['origin'] }> {
  const settings = getSettings();
  const list: Array<{ file: string; origin: ToolStatus['origin'] }> = [];

  if (kind === 'ytdlp' && settings.ytdlpPath) {
    list.push({ file: settings.ytdlpPath, origin: 'custom' });
  }
  if ((kind === 'ffmpeg' || kind === 'ffprobe') && settings.ffmpegPath) {
    const configured = settings.ffmpegPath;
    const isDir = fs.existsSync(configured) && fs.statSync(configured).isDirectory();
    const dir = isDir ? configured : path.dirname(configured);
    list.push({ file: path.join(dir, TOOL_NAMES[kind][0]), origin: 'custom' });
    list.push({ file: path.join(dir, TOOL_NAMES[kind][1]), origin: 'custom' });
  }

  for (const name of TOOL_NAMES[kind]) {
    list.push({ file: path.join(bundledDir(), name), origin: 'bundled' });
  }
  for (const name of TOOL_NAMES[kind]) {
    const found = which(name);
    if (found) list.push({ file: found, origin: 'path' });
  }
  return list;
}

function readVersion(kind: ToolKind, file: string): string | null {
  const args = kind === 'ytdlp' ? ['--version'] : ['-version'];
  try {
    const result = spawnSync(file, args, { encoding: 'utf8', timeout: 6000, windowsHide: true });
    if (result.error) return null;
    if (result.status !== 0) return null;
    const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    if (!text) return null;
    const firstLine = text.split(/\r?\n/)[0] ?? '';
    if (kind === 'ytdlp') return firstLine.trim();
    const match = firstLine.match(/version\s+([^\s]+)/i);
    return match?.[1] ?? firstLine.slice(0, 60);
  } catch {
    return null;
  }
}

export function probeTool(kind: ToolKind): ToolStatus {
  for (const candidate of candidates(kind)) {
    if (!candidate.file) continue;
    if (!fs.existsSync(candidate.file)) continue;
    const version = readVersion(kind, candidate.file);
    if (version) {
      return { kind, path: candidate.file, version, ok: true, origin: candidate.origin };
    }
  }
  return { kind, path: null, version: null, ok: false, origin: 'missing' };
}

export function engineStatus(force = false): EngineStatus {
  const fresh = Date.now() - cachedAt < CACHE_MS;
  if (!force && cache && fresh) return cache;
  const tools = (['ytdlp', 'ffmpeg', 'ffprobe'] as ToolKind[]).map((kind) => probeTool(kind));
  cache = { tools, ready: tools.every((tool) => tool.ok) };
  cachedAt = Date.now();
  log.info(
    '[engine] status',
    tools.map((tool) => `${tool.kind}=${tool.ok ? tool.version : 'missing'}`).join(', ')
  );
  return cache;
}

export function invalidateEngineCache(): void {
  cache = null;
  cachedAt = 0;
}

export function requireTool(kind: ToolKind): ToolStatus {
  const status = engineStatus().tools.find((tool) => tool.kind === kind);
  if (!status?.ok || !status.path) {
    throw new Error(`未找到 ${kind}，请在「设置 → 引擎」中指定可执行文件路径`);
  }
  return status;
}

/** 传入 ffmpeg 或 ffprobe 的路径，推导出另一者的路径（同目录同名不同后缀）。 */
export function siblingTool(kind: ToolKind, toolPath: string): string {
  const dir = path.dirname(toolPath);
  const wanted = kind === 'ffmpeg' ? TOOL_NAMES.ffmpeg[0] : TOOL_NAMES.ffprobe[0];
  const candidate = path.join(dir, wanted);
  return fs.existsSync(candidate) ? candidate : toolPath;
}
