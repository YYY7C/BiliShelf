import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { z } from 'zod';
import log from 'electron-log/main';
import type {
  AppSettings,
  BulkAction,
  EnqueueInput,
  LibraryQuery,
  RemoteItemsQuery,
  SourcePatch,
  ToolKind,
  UpdateVideoPatch
} from '@shared/types';
import { IPC } from '@shared/ipc';
import { appInfo } from './appInfo';
import { backupDatabase, openDatabase } from './db/index';
import {
  assignFolderByName,
  assignTagByName,
  bulkAction,
  getVideo,
  queryVideos,
  recordPlayback,
  rebuildFts,
  removeFolderByName,
  removeTagByName,
  stats as libraryStats,
  updateVideo
} from './db/videos';
import { jobTotalCount, listJobs } from './db/jobs';
import { listSources, queryRemoteItems, updateSource } from './db/sources';
import {
  createFolder,
  createTag,
  deleteFolder,
  deleteSmartCollection,
  deleteTag,
  listFolders,
  listSmartCollections,
  listTags,
  mergeTag,
  renameFolder,
  renameTag,
  saveSmartCollection
} from './db/taxonomy';
import { engineStatusAsync, invalidateEngineCache } from './engine/tools';
import { ensureLibraryDirs, libraryPaths } from './paths';
import { downloadManager } from './services/downloads';
import {
  addSources,
  cancelSync,
  countEnqueueCandidates,
  enqueueAllRemoteItems,
  enqueueRemoteItems,
  removeSources,
  syncAllSources,
  syncSource
} from './services/sources';
import { enqueueQualityUpgrades, scanQualityUpgrades } from './services/quality';
import {
  backfillMetadata,
  cleanupRedundantFiles,
  compressCoverCache,
  generateMissingPreviews,
  rebuildCoverThumbnails
} from './services/maintenance';
import { importFiles, rebuildFromDisk, videoAbsolutePath, writeSidecar } from './services/library';
import { getAuthStatus, logout, openLoginWindow } from './services/auth';
import { cacheRemoteCovers } from './services/covers';
import { relocateLibrary } from './services/relocate';
import { getSettings, updateSettings, defaultLibraryRoot } from './store';

type WindowGetter = () => BrowserWindow | null;

let getWindow: WindowGetter = () => null;

function send(channel: string, payload?: unknown): void {
  const win = getWindow();
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

export function broadcastLibrary(): void {
  send(IPC.eventLibrary);
}
export function broadcastSources(): void {
  send(IPC.eventSources);
}

let libraryBroadcastTimer: NodeJS.Timeout | null = null;

/** 下载完成可能连续触发，合并成 400ms 一次，避免 4000 条任务时事件风暴。 */
function scheduleLibraryBroadcast(): void {
  if (libraryBroadcastTimer) return;
  libraryBroadcastTimer = setTimeout(() => {
    libraryBroadcastTimer = null;
    broadcastLibrary();
    broadcastSources();
  }, 400);
}
export function toast(kind: 'info' | 'success' | 'warn' | 'error', message: string): void {
  send(IPC.eventToast, { kind, message });
}

function wrap<T>(fn: () => Promise<T> | T): Promise<T> {
  return Promise.resolve()
    .then(fn)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      log.warn('[ipc] error', message);
      throw new Error(message);
    });
}

function showOpen(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  const win = getWindow();
  return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
}

const idSchema = z.number().int().positive();
const idsSchema = z.array(idSchema).max(5000);
const toolSchema = z.enum(['ytdlp', 'ffmpeg', 'ffprobe']);

const libraryQuerySchema = z.object({
  search: z.string().max(200).optional(),
  tag: z.string().max(120).optional(),
  folder: z.string().max(120).optional(),
  status: z.enum(['present', 'missing', 'unavailable', 'trashed', 'importing', 'all']).optional(),
  sourceId: z.number().int().optional(),
  sort: z.enum(['added', 'recent', 'title', 'duration', 'size', 'rating']).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  offset: z.number().int().min(0).optional()
});

const remoteQuerySchema = z.object({
  sourceId: idSchema,
  search: z.string().max(200).optional(),
  onlyUndownloaded: z.boolean().optional(),
  onlyUnavailable: z.boolean().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  offset: z.number().int().min(0).optional()
});

const qualitySchema = z.enum(['compat', '720', 'best', 'audio', 'custom']);

const updatePatchSchema = z.object({
  title: z.string().max(300).optional(),
  rating: z.number().min(0).max(5).optional(),
  note: z.string().max(5000).optional(),
  status: z.enum(['present', 'missing', 'unavailable', 'trashed', 'importing']).optional()
});

const bulkSchema = z.object({
  ids: idsSchema,
  action: z.enum(['trash', 'restore', 'delete', 'retag', 'refolder', 'rate', 'redownload']),
  tag: z.string().max(120).optional(),
  folder: z.string().max(120).optional(),
  rating: z.number().min(0).max(5).optional()
});

export function registerIpc(windowGetter: WindowGetter): void {
  getWindow = windowGetter;

  downloadManager.onChange((snapshot) => send(IPC.eventJobs, snapshot));
  downloadManager.onLibraryChanged(scheduleLibraryBroadcast);

  /* ---------------------------------- app -------------------------------- */
  ipcMain.handle(IPC.appInfo, () => wrap(() => appInfo()));
  ipcMain.handle(IPC.appOpenExternal, (_e, url: string) =>
    wrap(async () => {
      const parsed = new URL(String(url));
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅支持 http/https 链接');
      await shell.openExternal(parsed.toString());
    })
  );
  ipcMain.handle(IPC.appShowInFolder, (_e, fullPath: string) =>
    wrap(() => {
      if (fullPath) shell.showItemInFolder(String(fullPath));
    })
  );
  ipcMain.handle(IPC.appOpenLogs, () =>
    wrap(async () => {
      const paths = ensureLibraryDirs(libraryPaths());
      await shell.openPath(paths.logs);
    })
  );

  /* -------------------------------- settings ----------------------------- */
  ipcMain.handle(IPC.settingsGet, () => wrap(() => getSettings()));
  ipcMain.handle(IPC.settingsUpdate, (_e, patch: Partial<AppSettings>) =>
    wrap(() => {
      // libraryRoot 只能通过「迁移到…」修改，直接改会打开空库并把原素材库“丢”在旧目录。
      if (patch && Object.prototype.hasOwnProperty.call(patch, 'libraryRoot')) {
        throw new Error('请使用「迁移到…」修改素材库目录');
      }
      const before = getSettings();
      const next = updateSettings(patch ?? {});
      if (before.libraryRoot !== next.libraryRoot) {
        openDatabase(next.libraryRoot);
        broadcastLibrary();
        broadcastSources();
      }
      return next;
    })
  );
  ipcMain.handle(IPC.settingsChooseRoot, () =>
    wrap(async () => {
      const result = await showOpen({
        title: '选择素材库目录',
        properties: ['openDirectory', 'createDirectory']
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0] ?? null;
    })
  );
  ipcMain.handle(IPC.settingsRelocate, (_e, target?: string) =>
    wrap(async () => {
      const destination = target && String(target).trim() ? String(target) : defaultLibraryRoot();
      const root = await relocateLibrary(destination);
      broadcastLibrary();
      broadcastSources();
      return root;
    })
  );

  /* -------------------------------- library ------------------------------ */
  ipcMain.handle(IPC.libraryQuery, (_e, query: LibraryQuery) =>
    wrap(() => queryVideos(libraryQuerySchema.parse(query ?? {}) as LibraryQuery))
  );
  ipcMain.handle(IPC.libraryGet, (_e, id: number) => wrap(() => getVideo(idSchema.parse(id))));
  ipcMain.handle(IPC.libraryStats, () => wrap(() => libraryStats()));

  ipcMain.handle(IPC.libraryUpdate, (_e, id: number, patch: UpdateVideoPatch) =>
    wrap(async () => {
      const result = updateVideo(idSchema.parse(id), updatePatchSchema.parse(patch ?? {}) as UpdateVideoPatch);
      if (result) await writeSidecar(result.id);
      broadcastLibrary();
      return result;
    })
  );

  ipcMain.handle(IPC.libraryBulk, (_e, action: BulkAction) =>
    wrap(() => {
      const parsed = bulkSchema.parse(action ?? {}) as BulkAction;
      if (parsed.action === 'redownload') {
        const inputs: EnqueueInput[] = [];
        for (const id of parsed.ids) {
          const video = getVideo(id);
          if (video?.bvid) {
            inputs.push({
              bvid: video.bvid,
              cid: video.cid,
              page: video.page,
              title: video.title,
              sourceId: video.sourceId,
              quality: getSettings().defaultQuality
            });
          }
        }
        return downloadManager.enqueue(inputs);
      }
      const affected = bulkAction(parsed);
      broadcastLibrary();
      return { affected };
    })
  );

  ipcMain.handle(IPC.libraryImportFiles, () =>
    wrap(async () => {
      const result = await showOpen({
        title: '导入视频文件',
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: '视频/音频',
            extensions: ['mp4', 'mkv', 'webm', 'mov', 'flv', 'm4v', 'avi', 'ts', 'm4a', 'mp3', 'flac', 'wav', 'ogg']
          }
        ]
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      const imported = await importFiles(result.filePaths, (done, total, current) =>
        send(IPC.eventImportProgress, { done, total, current })
      );
      broadcastLibrary();
      return imported;
    })
  );

  ipcMain.handle(IPC.libraryImportFolder, () =>
    wrap(async () => {
      const result = await showOpen({
        title: '导入文件夹（递归扫描视频）',
        properties: ['openDirectory']
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      const imported = await importFiles(result.filePaths, (done, total, current) =>
        send(IPC.eventImportProgress, { done, total, current })
      );
      broadcastLibrary();
      return imported;
    })
  );

  ipcMain.handle(IPC.libraryRebuild, () =>
    wrap(async () => {
      const result = await rebuildFromDisk();
      rebuildFts();
      broadcastLibrary();
      return result;
    })
  );

  ipcMain.handle(IPC.libraryBackup, () =>
    wrap(() => {
      const target = backupDatabase('manual');
      if (!target) throw new Error('备份失败，请查看日志');
      return target;
    })
  );

  ipcMain.handle(IPC.libraryReveal, (_e, id: number) =>
    wrap(() => {
      const absolute = videoAbsolutePath(idSchema.parse(id));
      if (!absolute) throw new Error('该条目没有本地文件');
      shell.showItemInFolder(absolute);
    })
  );

  ipcMain.handle(IPC.libraryPlayUrl, (_e, id: number) =>
    wrap(() => {
      const video = getVideo(idSchema.parse(id));
      return video?.videoUrl ?? null;
    })
  );

  ipcMain.handle(IPC.librarySetTag, (_e, id: number, tag: string, add: boolean) =>
    wrap(async () => {
      const videoId = idSchema.parse(id);
      const value = z.string().min(1).max(120).parse(tag);
      if (add) assignTagByName(videoId, value, 'manual');
      else removeTagByName(videoId, value);
      await writeSidecar(videoId);
      broadcastLibrary();
      return getVideo(videoId);
    })
  );

  ipcMain.handle(IPC.librarySetFolder, (_e, id: number, folder: string, add: boolean) =>
    wrap(async () => {
      const videoId = idSchema.parse(id);
      const value = z.string().min(1).max(120).parse(folder);
      if (add) assignFolderByName(videoId, value);
      else removeFolderByName(videoId, value);
      await writeSidecar(videoId);
      broadcastLibrary();
      return getVideo(videoId);
    })
  );

  /* --------------------------------- tags -------------------------------- */
  ipcMain.handle(IPC.tagsList, () => wrap(() => listTags()));
  ipcMain.handle(IPC.tagsCreate, (_e, name: string, parentId?: number | null) =>
    wrap(() => {
      const result = createTag(String(name ?? ''), parentId ?? null);
      broadcastLibrary();
      return result;
    })
  );
  ipcMain.handle(IPC.tagsRename, (_e, id: number, name: string) =>
    wrap(() => {
      const result = renameTag(idSchema.parse(id), String(name ?? ''));
      broadcastLibrary();
      return result;
    })
  );
  ipcMain.handle(IPC.tagsDelete, (_e, id: number) =>
    wrap(() => {
      const result = deleteTag(idSchema.parse(id));
      broadcastLibrary();
      return result;
    })
  );
  ipcMain.handle(IPC.tagsMerge, (_e, sourceId: number, targetId: number) =>
    wrap(() => {
      const result = mergeTag(idSchema.parse(sourceId), idSchema.parse(targetId));
      broadcastLibrary();
      return result;
    })
  );

  ipcMain.handle(IPC.foldersList, () => wrap(() => listFolders()));
  ipcMain.handle(IPC.foldersCreate, (_e, name: string, parentId?: number | null) =>
    wrap(() => {
      const result = createFolder(String(name ?? ''), parentId ?? null);
      broadcastLibrary();
      return result;
    })
  );
  ipcMain.handle(IPC.foldersRename, (_e, id: number, name: string) =>
    wrap(() => {
      const result = renameFolder(idSchema.parse(id), String(name ?? ''));
      broadcastLibrary();
      return result;
    })
  );
  ipcMain.handle(IPC.foldersDelete, (_e, id: number) =>
    wrap(() => {
      const result = deleteFolder(idSchema.parse(id));
      broadcastLibrary();
      return result;
    })
  );

  ipcMain.handle(IPC.smartList, () => wrap(() => listSmartCollections()));
  ipcMain.handle(
    IPC.smartSave,
    (_e, input: { id?: number; name: string; query: LibraryQuery; icon?: string | null }) =>
      wrap(() => {
        const parsed = z
          .object({
            id: z.number().int().optional(),
            name: z.string().min(1).max(80),
            query: libraryQuerySchema,
            icon: z.string().max(40).nullable().optional()
          })
          .parse(input ?? {});
        return saveSmartCollection({
          id: parsed.id,
          name: parsed.name,
          query: parsed.query as LibraryQuery,
          icon: parsed.icon ?? null
        });
      })
  );
  ipcMain.handle(IPC.smartDelete, (_e, id: number) => wrap(() => deleteSmartCollection(idSchema.parse(id))));

  /* -------------------------------- sources ------------------------------ */
  ipcMain.handle(IPC.sourcesList, () => wrap(() => listSources()));
  ipcMain.handle(
    IPC.sourcesAdd,
    (_e, input: { kind: string; url?: string; remoteId?: string; title?: string }) =>
      wrap(async () => {
        const parsed = z
          .object({
            kind: z.enum(['favorite', 'watch_later', 'space', 'collection']),
            url: z.string().max(500).optional(),
            remoteId: z.string().max(500).optional(),
            title: z.string().max(200).optional()
          })
          .parse(input ?? {});
        const result = await addSources(parsed);
        broadcastSources();
        return result;
      })
  );
  ipcMain.handle(IPC.sourcesUpdate, (_e, id: number, patch: SourcePatch) =>
    wrap(() => {
      const parsed = z
        .object({
          syncEnabled: z.boolean().optional(),
          note: z.string().max(500).nullable().optional()
        })
        .parse(patch ?? {});
      updateSource(idSchema.parse(id), parsed);
      const result = listSources();
      broadcastSources();
      return result;
    })
  );
  ipcMain.handle(IPC.sourcesRemove, (_e, id: number) =>
    wrap(async () => {
      const result = await removeSources(idSchema.parse(id));
      broadcastSources();
      broadcastLibrary();
      return result;
    })
  );
  ipcMain.handle(IPC.sourcesSync, (_e, id: number) =>
    wrap(async () => {
      const sourceId = idSchema.parse(id);
      const result = await syncSource(sourceId, {
        onProgress: (progress) => send(IPC.eventSyncProgress, progress)
      });
      broadcastSources();
      void cacheRemoteCovers(sourceId)
        .then((count) => {
          if (count > 0) broadcastSources();
        })
        .catch(() => undefined);
      return result;
    })
  );
  ipcMain.handle(IPC.sourcesSyncAll, () =>
    wrap(async () => {
      const result = await syncAllSources({
        onProgress: (progress) => send(IPC.eventSyncProgress, progress)
      });
      broadcastSources();
      void cacheRemoteCovers()
        .then((count) => {
          if (count > 0) broadcastSources();
        })
        .catch(() => undefined);
      return result;
    })
  );
  ipcMain.handle(IPC.sourcesItems, (_e, query: RemoteItemsQuery) =>
    wrap(() => queryRemoteItems(remoteQuerySchema.parse(query ?? {}) as RemoteItemsQuery))
  );
  ipcMain.handle(IPC.sourcesEnqueue, (_e, ids: number[], quality?: string) =>
    wrap(() =>
      enqueueRemoteItems(idsSchema.parse(ids ?? []), quality ? qualitySchema.parse(quality) : undefined)
    )
  );
  ipcMain.handle(IPC.sourcesEnqueueAll, (_e, input: { sourceId?: number | null; quality?: string }) =>
    wrap(() => {
      const parsed = z
        .object({
          sourceId: idSchema.nullable().optional(),
          quality: qualitySchema.optional()
        })
        .parse(input ?? {});
      return enqueueAllRemoteItems({ sourceId: parsed.sourceId ?? null, quality: parsed.quality });
    })
  );
  ipcMain.handle(IPC.sourcesEnqueuePreview, (_e, input: { sourceId?: number | null }) =>
    wrap(() => {
      const parsed = z.object({ sourceId: idSchema.nullable().optional() }).parse(input ?? {});
      return countEnqueueCandidates({ sourceId: parsed.sourceId ?? null });
    })
  );
  ipcMain.handle(IPC.sourcesCancelSync, () =>
    wrap(() => {
      cancelSync();
    })
  );

  /* --------------------------------- jobs -------------------------------- */
  ipcMain.handle(IPC.jobsList, () => wrap(() => ({ items: listJobs(), total: jobTotalCount() })));
  ipcMain.handle(IPC.jobsPause, (_e, id: number) => wrap(() => downloadManager.pause(idSchema.parse(id))));
  ipcMain.handle(IPC.jobsResume, (_e, id: number) => wrap(() => downloadManager.resume(idSchema.parse(id))));
  ipcMain.handle(IPC.jobsCancel, (_e, id: number) => wrap(() => downloadManager.cancel(idSchema.parse(id))));
  ipcMain.handle(IPC.jobsRetry, (_e, id: number) => wrap(() => downloadManager.retry(idSchema.parse(id))));
  ipcMain.handle(IPC.jobsClear, () => wrap(() => downloadManager.clearFinished()));

  /* ------------------------------- quality ------------------------------- */
  ipcMain.handle(IPC.qualityScan, () =>
    wrap(() =>
      scanQualityUpgrades({
        onProgress: (progress) => windowGetter()?.webContents.send(IPC.qualityProgress, progress)
      })
    )
  );
  ipcMain.handle(IPC.qualityEnqueue, (_e, ids: number[]) =>
    wrap(() => enqueueQualityUpgrades(idsSchema.parse(ids ?? [])))
  );

  /* ------------------------------ maintenance ---------------------------- */
  ipcMain.handle(IPC.maintenanceBackfill, () =>
    wrap(() => backfillMetadata({ onProgress: (progress) => send(IPC.eventMaintenance, progress) }))
  );
  ipcMain.handle(IPC.maintenancePreviews, () =>
    wrap(() => generateMissingPreviews({ onProgress: (progress) => send(IPC.eventMaintenance, progress) }))
  );
  ipcMain.handle(IPC.maintenanceCovers, () =>
    wrap(() => compressCoverCache({ onProgress: (progress) => send(IPC.eventMaintenance, progress) }))
  );
  ipcMain.handle(IPC.maintenanceThumbs, () =>
    wrap(() => rebuildCoverThumbnails({ onProgress: (progress) => send(IPC.eventMaintenance, progress) }))
  );
  ipcMain.handle(IPC.maintenanceCleanup, () =>
    wrap(() => cleanupRedundantFiles({ onProgress: (progress) => send(IPC.eventMaintenance, progress) }))
  );

  /* -------------------------------- engine ------------------------------- */
  ipcMain.handle(IPC.engineStatus, () => wrap(() => engineStatusAsync()));
  ipcMain.handle(IPC.engineRefresh, () => wrap(() => engineStatusAsync(true)));
  ipcMain.handle(IPC.engineSetPath, (_e, kind: ToolKind, toolPath: string) =>
    wrap(async () => {
      const value = toolSchema.parse(kind);
      const target = String(toolPath ?? '').trim();
      if (value === 'ytdlp') updateSettings({ ytdlpPath: target });
      else updateSettings({ ffmpegPath: target });
      invalidateEngineCache();
      return engineStatusAsync(true);
    })
  );
  ipcMain.handle(IPC.enginePick, (_e, kind: ToolKind) =>
    wrap(async () => {
      const value = toolSchema.parse(kind);
      const result = await showOpen({
        title: `选择 ${value} 可执行文件`,
        properties: ['openFile'],
        filters: [{ name: '可执行文件', extensions: ['exe'] }]
      });
      if (result.canceled || result.filePaths.length === 0) return engineStatusAsync();
      const target = result.filePaths[0]!;
      if (value === 'ytdlp') updateSettings({ ytdlpPath: target });
      else updateSettings({ ffmpegPath: target });
      invalidateEngineCache();
      return engineStatusAsync(true);
    })
  );

  /* --------------------------------- auth -------------------------------- */
  ipcMain.handle(IPC.authStatus, () => wrap(() => getAuthStatus()));
  ipcMain.handle(IPC.authLogin, () =>
    wrap(async () => {
      const status = await openLoginWindow(getWindow());
      send(IPC.eventAuth, status);
      broadcastSources();
      return status;
    })
  );
  ipcMain.handle(IPC.authLogout, () =>
    wrap(async () => {
      const status = await logout();
      send(IPC.eventAuth, status);
      return status;
    })
  );

  ipcMain.handle(IPC.playerProgress, (_e, id: number, position: number) =>
    wrap(() => recordPlayback(idSchema.parse(id), Number(position) || 0))
  );

  log.info('[ipc] registered');
}
