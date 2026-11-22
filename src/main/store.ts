import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AppSettings, QualityPreset } from '@shared/types';

const FILE_NAME = 'config.json';

/** 启动目录：开发模式取当前工作目录（即项目目录），打包后取可执行文件所在目录。 */
function launchDir(): string {
  // portable 版会被解压到临时目录运行，PORTABLE_EXECUTABLE_DIR 才是用户双击的那个目录
  const portableDir = process.env['PORTABLE_EXECUTABLE_DIR'];
  if (portableDir && portableDir.trim()) return portableDir;
  try {
    return app.isPackaged ? path.dirname(app.getPath('exe')) : process.cwd();
  } catch {
    return process.cwd();
  }
}

function isWritable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 默认素材库 = 启动目录本身（媒体/数据库都放在程序旁边，方便整体搬运）。
 * 若启动目录不可写（例如装在 Program Files），退回 userData。
 */
export function defaultLibraryRoot(): string {
  const dir = launchDir();
  if (isWritable(dir)) return dir;
  try {
    return path.join(app.getPath('userData'), 'BiliShelf');
  } catch {
    return path.join(process.cwd(), 'BiliShelf');
  }
}

export function defaultSettings(): AppSettings {
  return {
    libraryRoot: defaultLibraryRoot(),
    defaultQuality: 'best' satisfies QualityPreset,
    concurrency: 2,
    writeNfo: false,
    autoTagSource: true,
    autoTagUp: true,
    autoTagZone: true,
    generatePreview: true,
    coverBackdrop: true,
    coverBackdropBlur: 6,
    coverBackdropOpacity: 82,
    coverBackdropDim: 55,
    sidebarTransparent: true,
    closeToTray: true,
    ytdlpPath: '',
    ffmpegPath: '',
    downloadProxy: 'direct',
    downloadAutoRetry: 2,
    requestDelayMs: 600,
    aiFrameCount: 3,
    aiFrameWidth: 768,
    aiIncludeCover: true,
    aiConcurrency: 2,
    aiRequestDelayMs: 300,
    aiTimeoutMs: 120000,
    aiMaxRetries: 2,
    aiAutoRetry: 2,
    aiMaxToolRounds: 3,
    aiCacheDays: 30
  };
}

/**
 * 设置放在 userData/config.json：
 * 1) libraryRoot 决定数据库位置，必须在打开数据库之前可读；
 * 2) 数据库损坏时设置仍可用于“重建/换库”。
 */
class SettingsStore {
  private cache: AppSettings | null = null;

  private get file(): string {
    return path.join(app.getPath('userData'), FILE_NAME);
  }

  read(): AppSettings {
    if (this.cache) return this.cache;
    const base = defaultSettings();
    try {
      // 用户可能用记事本/编辑器手改，Windows 工具常写入 BOM；不清掉会让 JSON.parse 直接抛错并回落默认值
      const raw = fs.readFileSync(this.file, 'utf8').replace(/^\uFEFF/, '');
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      this.cache = sanitize({ ...base, ...parsed });
    } catch {
      this.cache = base;
    }
    return this.cache;
  }

  write(patch: Partial<AppSettings>): AppSettings {
    const next = sanitize({ ...this.read(), ...patch });
    this.cache = next;
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
    return next;
  }
}

function sanitize(input: AppSettings): AppSettings {
  const qualities: QualityPreset[] = ['compat', '720', 'best', 'audio', 'custom'];
  const concurrency = Number.isFinite(input.concurrency)
    ? Math.min(4, Math.max(1, Math.round(input.concurrency)))
    : 2;
  const delay = Number.isFinite(input.requestDelayMs)
    ? Math.min(5000, Math.max(200, Math.round(input.requestDelayMs)))
    : 600;
  const aiFrameCount = Number.isFinite(input.aiFrameCount)
    ? Math.min(8, Math.max(0, Math.round(input.aiFrameCount)))
    : 3;
  const aiFrameWidth = Number.isFinite(input.aiFrameWidth)
    ? Math.min(1600, Math.max(256, Math.round(input.aiFrameWidth)))
    : 768;
  const aiConcurrency = Number.isFinite(input.aiConcurrency)
    ? Math.min(10, Math.max(1, Math.round(input.aiConcurrency)))
    : 2;
  const aiRequestDelayMs = Number.isFinite(input.aiRequestDelayMs)
    ? Math.min(5000, Math.max(0, Math.round(input.aiRequestDelayMs)))
    : 300;
  const aiTimeoutMs = Number.isFinite(input.aiTimeoutMs)
    ? Math.min(600_000, Math.max(15_000, Math.round(input.aiTimeoutMs)))
    : 120_000;
  const aiMaxRetries = Number.isFinite(input.aiMaxRetries)
    ? Math.min(5, Math.max(0, Math.round(input.aiMaxRetries)))
    : 2;
  const aiAutoRetry = Number.isFinite(input.aiAutoRetry)
    ? Math.min(5, Math.max(0, Math.round(input.aiAutoRetry)))
    : 2;
  const aiMaxToolRounds = Number.isFinite(input.aiMaxToolRounds)
    ? Math.min(5, Math.max(0, Math.round(input.aiMaxToolRounds)))
    : 3;
  const aiCacheDays = Number.isFinite(input.aiCacheDays)
    ? Math.min(365, Math.max(1, Math.round(input.aiCacheDays)))
    : 30;
  const downloadAutoRetry = Number.isFinite(input.downloadAutoRetry)
    ? Math.min(5, Math.max(0, Math.round(input.downloadAutoRetry)))
    : 2;
  return {
    libraryRoot: String(input.libraryRoot || defaultLibraryRoot()).trim(),
    defaultQuality: qualities.includes(input.defaultQuality) ? input.defaultQuality : 'compat',
    concurrency,
    writeNfo: Boolean(input.writeNfo),
    autoTagSource: input.autoTagSource !== false,
    autoTagUp: input.autoTagUp !== false,
    autoTagZone: input.autoTagZone !== false,
    generatePreview: input.generatePreview !== false,
    coverBackdrop: input.coverBackdrop !== false,
    coverBackdropBlur: Number.isFinite(input.coverBackdropBlur)
      ? Math.min(30, Math.max(0, Math.round(input.coverBackdropBlur)))
      : 6,
    coverBackdropOpacity: Number.isFinite(input.coverBackdropOpacity)
      ? Math.min(100, Math.max(20, Math.round(input.coverBackdropOpacity)))
      : 82,
    coverBackdropDim: Number.isFinite(input.coverBackdropDim)
      ? Math.min(100, Math.max(0, Math.round(input.coverBackdropDim)))
      : 55,
    sidebarTransparent: input.sidebarTransparent !== false,
    closeToTray: input.closeToTray !== false,
    ytdlpPath: String(input.ytdlpPath || '').trim(),
    ffmpegPath: String(input.ffmpegPath || '').trim(),
    downloadProxy: input.downloadProxy === 'system' ? 'system' : 'direct',
    downloadAutoRetry,
    requestDelayMs: delay,
    aiFrameCount,
    aiFrameWidth,
    aiIncludeCover: input.aiIncludeCover !== false,
    aiConcurrency,
    aiRequestDelayMs,
    aiTimeoutMs,
    aiMaxRetries,
    aiAutoRetry,
    aiMaxToolRounds,
    aiCacheDays
  };
}

export const settingsStore = new SettingsStore();
export const getSettings = (): AppSettings => settingsStore.read();
export const updateSettings = (patch: Partial<AppSettings>): AppSettings => settingsStore.write(patch);
