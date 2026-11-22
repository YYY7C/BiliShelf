import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';
import { closeDatabase, openDatabase } from '../db/index';
import { activeJobCount } from '../db/jobs';
import { ensureLibraryDirs, libraryPaths } from '../paths';
import { updateSettings } from '../store';

const ENTRIES = [
  'library.db',
  'library.db-wal',
  'library.db-shm',
  'media',
  'cache',
  'backups',
  'logs',
  'screenshots'
];

/**
 * 整体迁移素材库到新目录（同盘 rename，跨盘 copy+delete）。
 * 要求：没有进行中的下载；目标目录不能已有素材库。
 */
export async function relocateLibrary(target: string): Promise<string> {
  const from = ensureLibraryDirs(libraryPaths()).root;
  const to = path.resolve(target);

  if (from === to) return to;
  if (activeJobCount() > 0) throw new Error('还有下载任务在进行，请先暂停或等它完成再迁移');
  if (to.startsWith(from + path.sep)) throw new Error('目标目录不能是当前素材库的子目录');

  try {
    fs.mkdirSync(to, { recursive: true });
    fs.accessSync(to, fs.constants.W_OK);
  } catch {
    throw new Error('目标目录不可写，请换一个位置');
  }
  if (fs.existsSync(path.join(to, 'library.db'))) {
    throw new Error('目标目录已经存在素材库（library.db），请换一个空目录');
  }

  closeDatabase();
  const moved: string[] = [];
  try {
    for (const name of ENTRIES) {
      const source = path.join(from, name);
      if (!fs.existsSync(source)) continue;
      const destination = path.join(to, name);
      try {
        fs.renameSync(source, destination);
      } catch {
        fs.cpSync(source, destination, { recursive: true });
        fs.rmSync(source, { recursive: true, force: true });
      }
      moved.push(name);
    }
    updateSettings({ libraryRoot: to });
    openDatabase(to);
    log.info('[library] relocated', from, '->', to);
    return to;
  } catch (error) {
    // 尽力回滚已移动的条目，避免素材库被拆成两半
    for (const name of moved.reverse()) {
      const source = path.join(to, name);
      const destination = path.join(from, name);
      try {
        if (!fs.existsSync(source)) continue;
        try {
          fs.renameSync(source, destination);
        } catch {
          fs.cpSync(source, destination, { recursive: true });
          fs.rmSync(source, { recursive: true, force: true });
        }
      } catch (rollbackError) {
        log.error('[library] rollback failed', name, rollbackError);
      }
    }
    openDatabase();
    throw error;
  }
}
