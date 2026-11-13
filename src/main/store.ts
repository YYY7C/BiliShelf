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
    ytdlpPath: '',
    ffmpegPath: '',
    requestDelayMs: 600
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
      const raw = fs.readFileSync(this.file, 'utf8');
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
  return {
    libraryRoot: String(input.libraryRoot || defaultLibraryRoot()).trim(),
    defaultQuality: qualities.includes(input.defaultQuality) ? input.defaultQuality : 'compat',
    concurrency,
    writeNfo: Boolean(input.writeNfo),
    autoTagSource: input.autoTagSource !== false,
    autoTagUp: input.autoTagUp !== false,
    autoTagZone: input.autoTagZone !== false,
    ytdlpPath: String(input.ytdlpPath || '').trim(),
    ffmpegPath: String(input.ffmpegPath || '').trim(),
    requestDelayMs: delay
  };
}

export const settingsStore = new SettingsStore();
export const getSettings = (): AppSettings => settingsStore.read();
export const updateSettings = (patch: Partial<AppSettings>): AppSettings => settingsStore.write(patch);
