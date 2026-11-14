import { app } from 'electron';
import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';
import type { EngineStatus, ToolKind, ToolStatus } from '@shared/types';
import { getSettings } from '../store';

const CACHE_MS = 60_000;

let cache: EngineStatus | null = null;
let cachedAt = 0;
let inflight: Promise<EngineStatus> | null = null;

const TOOL_NAMES: Record<ToolKind, string[]> = {
  ytdlp: ['yt-dlp.exe', 'yt-dlp'],
  ffmpeg: ['ffmpeg.exe', 'ffmpeg'],
  ffprobe: ['ffprobe.exe', 'ffprobe']
};

const TOOL_KINDS: ToolKind[] = ['ytdlp', 'ffmpeg', 'ffprobe'];

interface Candidate {
  file: string;
  origin: ToolStatus['origin'];
}

function bundledDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(app.getAppPath(), 'resources', 'bin');
}

/** 自定义路径 + 内置目录：这些不需要查 PATH，先探测。 */
function directCandidates(kind: ToolKind): Candidate[] {
  const settings = getSettings();
  const list: Candidate[] = [];

  if (kind === 'ytdlp' && settings.ytdlpPath) {
    list.push({ file: settings.ytdlpPath, origin: 'custom' });
  }
  if ((kind === 'ffmpeg' || kind === 'ffprobe') && settings.ffmpegPath) {
    const configured = settings.ffmpegPath;
    let isDir: boolean;
    try {
      isDir = fs.existsSync(configured) && fs.statSync(configured).isDirectory();
    } catch {
      isDir = false;
    }
    const dir = isDir ? configured : path.dirname(configured);
    for (const name of TOOL_NAMES[kind]) list.push({ file: path.join(dir, name), origin: 'custom' });
  }

  for (const name of TOOL_NAMES[kind]) {
    list.push({ file: path.join(bundledDir(), name), origin: 'bundled' });
  }
  return list;
}

function parseVersion(kind: ToolKind, text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const firstLine = trimmed.split(/\r?\n/)[0] ?? '';
  if (kind === 'ytdlp') return firstLine.trim();
  const match = firstLine.match(/version\s+([^\s]+)/i);
  return match?.[1] ?? firstLine.slice(0, 60);
}

function versionArgs(kind: ToolKind): string[] {
  return kind === 'ytdlp' ? ['--version'] : ['-version'];
}

function exists(file: string): boolean {
  try {
    return Boolean(file) && fs.existsSync(file);
  } catch {
    return false;
  }
}

function execFileText(file: string, args: string[], timeout: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf8', timeout, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(`${stdout ?? ''}\n${stderr ?? ''}`);
    });
  });
}

async function readVersionAsync(kind: ToolKind, file: string): Promise<string | null> {
  const text = await execFileText(file, versionArgs(kind), 6000);
  return text ? parseVersion(kind, text) : null;
}

function readVersionSync(kind: ToolKind, file: string): string | null {
  try {
    const result = spawnSync(file, versionArgs(kind), { encoding: 'utf8', timeout: 6000, windowsHide: true });
    if (result.error || result.status !== 0) return null;
    return parseVersion(kind, `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  } catch {
    return null;
  }
}

function whichSync(exe: string): string | null {
  const result = spawnSync('where', [exe], { encoding: 'utf8', timeout: 4000, windowsHide: true });
  if (result.status !== 0 || !result.stdout) return null;
  const first = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return first ?? null;
}

function whichAsync(exe: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('where', [exe], { encoding: 'utf8', timeout: 4000, windowsHide: true }, (error, stdout) => {
      if (error || !stdout) {
        resolve(null);
        return;
      }
      resolve(stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null);
    });
  });
}

async function probeToolAsync(kind: ToolKind): Promise<ToolStatus> {
  // 先看自定义/内置，避免为了「确认 PATH 里有没有」而多跑几次 where
  for (const candidate of directCandidates(kind)) {
    if (!exists(candidate.file)) continue;
    const version = await readVersionAsync(kind, candidate.file);
    if (version) return { kind, path: candidate.file, version, ok: true, origin: candidate.origin };
  }
  for (const name of TOOL_NAMES[kind]) {
    const found = await whichAsync(name);
    if (!found) continue;
    const version = await readVersionAsync(kind, found);
    if (version) return { kind, path: found, version, ok: true, origin: 'path' };
  }
  return { kind, path: null, version: null, ok: false, origin: 'missing' };
}

function probeToolSync(kind: ToolKind): ToolStatus {
  for (const candidate of directCandidates(kind)) {
    if (!exists(candidate.file)) continue;
    const version = readVersionSync(kind, candidate.file);
    if (version) return { kind, path: candidate.file, version, ok: true, origin: candidate.origin };
  }
  for (const name of TOOL_NAMES[kind]) {
    const found = whichSync(name);
    if (!found) continue;
    const version = readVersionSync(kind, found);
    if (version) return { kind, path: found, version, ok: true, origin: 'path' };
  }
  return { kind, path: null, version: null, ok: false, origin: 'missing' };
}

function logStatus(status: EngineStatus): EngineStatus {
  log.info(
    '[engine] status',
    status.tools.map((tool) => `${tool.kind}=${tool.ok ? tool.version : 'missing'}`).join(', ')
  );
  return status;
}

/** 异步探测：窗口启动、设置页刷新都走这里，避免 spawnSync 卡住主进程。 */
export function engineStatusAsync(force = false): Promise<EngineStatus> {
  if (!force && cache && Date.now() - cachedAt < CACHE_MS) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = (async () => {
    const tools = await Promise.all(TOOL_KINDS.map((kind) => probeToolAsync(kind)));
    cache = logStatus({ tools, ready: tools.every((tool) => tool.ok) });
    cachedAt = Date.now();
    return cache;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** 同步探测：只给「即将 spawn 引擎」的路径用；有缓存时直接返回，避免阻塞。 */
export function engineStatus(force = false): EngineStatus {
  if (!force && cache) return cache;
  const tools = TOOL_KINDS.map((kind) => probeToolSync(kind));
  cache = logStatus({ tools, ready: tools.every((tool) => tool.ok) });
  cachedAt = Date.now();
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
