import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { BilishelfApi } from '../shared/ipc';
import type {
  AppSettings,
  AuthStatus,
  BulkAction,
  FolderSummary,
  ImportProgress,
  JobsSnapshot,
  LibraryQuery,
  LibraryResult,
  LibraryStats,
  MaintenanceProgress,
  MaintenanceResult,
  QualityPreset,
  RemoteItemsQuery,
  RemoteItemsResult,
  SmartCollection,
  SourceKind,
  SourcePatch,
  SourceSummary,
  SyncProgress,
  TagSummary,
  ToastEvent,
  ToolKind,
  UpdateVideoPatch,
  VideoItem
} from '../shared/types';

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: BilishelfApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    openExternal: (url: string) => ipcRenderer.invoke(IPC.appOpenExternal, url),
    showInFolder: (fullPath: string) => ipcRenderer.invoke(IPC.appShowInFolder, fullPath),
    openLogs: () => ipcRenderer.invoke(IPC.appOpenLogs)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    chooseLibraryRoot: () => ipcRenderer.invoke(IPC.settingsChooseRoot),
    relocate: (target?: string) => ipcRenderer.invoke(IPC.settingsRelocate, target)
  },
  library: {
    query: (query: LibraryQuery): Promise<LibraryResult> => ipcRenderer.invoke(IPC.libraryQuery, query),
    get: (id: number): Promise<VideoItem | null> => ipcRenderer.invoke(IPC.libraryGet, id),
    stats: (): Promise<LibraryStats> => ipcRenderer.invoke(IPC.libraryStats),
    update: (id: number, patch: UpdateVideoPatch): Promise<VideoItem | null> =>
      ipcRenderer.invoke(IPC.libraryUpdate, id, patch),
    bulk: (action: BulkAction) => ipcRenderer.invoke(IPC.libraryBulk, action),
    importFiles: () => ipcRenderer.invoke(IPC.libraryImportFiles),
    importFolder: () => ipcRenderer.invoke(IPC.libraryImportFolder),
    rebuild: () => ipcRenderer.invoke(IPC.libraryRebuild),
    backup: () => ipcRenderer.invoke(IPC.libraryBackup),
    reveal: (id: number) => ipcRenderer.invoke(IPC.libraryReveal, id),
    playUrl: (id: number) => ipcRenderer.invoke(IPC.libraryPlayUrl, id),
    setTag: (id: number, tag: string, add: boolean) => ipcRenderer.invoke(IPC.librarySetTag, id, tag, add),
    setFolder: (id: number, folder: string, add: boolean) => ipcRenderer.invoke(IPC.librarySetFolder, id, folder, add)
  },
  tags: {
    list: (): Promise<TagSummary[]> => ipcRenderer.invoke(IPC.tagsList),
    create: (name: string, parentId?: number | null) => ipcRenderer.invoke(IPC.tagsCreate, name, parentId ?? null),
    rename: (id: number, name: string) => ipcRenderer.invoke(IPC.tagsRename, id, name),
    remove: (id: number) => ipcRenderer.invoke(IPC.tagsDelete, id),
    merge: (sourceId: number, targetId: number) => ipcRenderer.invoke(IPC.tagsMerge, sourceId, targetId)
  },
  folders: {
    list: (): Promise<FolderSummary[]> => ipcRenderer.invoke(IPC.foldersList),
    create: (name: string, parentId?: number | null) => ipcRenderer.invoke(IPC.foldersCreate, name, parentId ?? null),
    rename: (id: number, name: string) => ipcRenderer.invoke(IPC.foldersRename, id, name),
    remove: (id: number) => ipcRenderer.invoke(IPC.foldersDelete, id)
  },
  smart: {
    list: (): Promise<SmartCollection[]> => ipcRenderer.invoke(IPC.smartList),
    save: (input: { id?: number; name: string; query: LibraryQuery; icon?: string | null }) =>
      ipcRenderer.invoke(IPC.smartSave, input),
    remove: (id: number) => ipcRenderer.invoke(IPC.smartDelete, id)
  },
  sources: {
    list: (): Promise<SourceSummary[]> => ipcRenderer.invoke(IPC.sourcesList),
    add: (input: { kind: SourceKind; url?: string; remoteId?: string; title?: string }) =>
      ipcRenderer.invoke(IPC.sourcesAdd, input),
    update: (id: number, patch: SourcePatch) => ipcRenderer.invoke(IPC.sourcesUpdate, id, patch),
    remove: (id: number) => ipcRenderer.invoke(IPC.sourcesRemove, id),
    sync: (id: number) => ipcRenderer.invoke(IPC.sourcesSync, id),
    syncAll: () => ipcRenderer.invoke(IPC.sourcesSyncAll),
    items: (query: RemoteItemsQuery): Promise<RemoteItemsResult> => ipcRenderer.invoke(IPC.sourcesItems, query),
    enqueue: (remoteItemIds: number[], quality?: QualityPreset) =>
      ipcRenderer.invoke(IPC.sourcesEnqueue, remoteItemIds, quality),
    enqueueAll: (input: { sourceId?: number | null; quality?: QualityPreset }) =>
      ipcRenderer.invoke(IPC.sourcesEnqueueAll, input),
    enqueuePreview: (input: { sourceId?: number | null }) =>
      ipcRenderer.invoke(IPC.sourcesEnqueuePreview, input),
    cancelSync: () => ipcRenderer.invoke(IPC.sourcesCancelSync)
  },
  jobs: {
    list: (): Promise<JobsSnapshot> => ipcRenderer.invoke(IPC.jobsList),
    pause: (id: number) => ipcRenderer.invoke(IPC.jobsPause, id),
    resume: (id: number) => ipcRenderer.invoke(IPC.jobsResume, id),
    cancel: (id: number) => ipcRenderer.invoke(IPC.jobsCancel, id),
    retry: (id: number) => ipcRenderer.invoke(IPC.jobsRetry, id),
    clear: () => ipcRenderer.invoke(IPC.jobsClear)
  },
  quality: {
    scan: () => ipcRenderer.invoke(IPC.qualityScan),
    enqueue: (videoIds: number[]) => ipcRenderer.invoke(IPC.qualityEnqueue, videoIds),
    onProgress: (cb) => subscribe(IPC.qualityProgress, cb)
  },
  maintenance: {
    backfill: (): Promise<MaintenanceResult> => ipcRenderer.invoke(IPC.maintenanceBackfill),
    previews: (): Promise<MaintenanceResult> => ipcRenderer.invoke(IPC.maintenancePreviews),
    covers: (): Promise<MaintenanceResult> => ipcRenderer.invoke(IPC.maintenanceCovers),
    cleanup: (): Promise<MaintenanceResult> => ipcRenderer.invoke(IPC.maintenanceCleanup),
    onProgress: (cb: (progress: MaintenanceProgress) => void) => subscribe(IPC.eventMaintenance, cb)
  },
  engine: {
    status: () => ipcRenderer.invoke(IPC.engineStatus),
    setPath: (kind: ToolKind, toolPath: string) => ipcRenderer.invoke(IPC.engineSetPath, kind, toolPath),
    pick: (kind: ToolKind) => ipcRenderer.invoke(IPC.enginePick, kind),
    refresh: () => ipcRenderer.invoke(IPC.engineRefresh)
  },
  auth: {
    status: (): Promise<AuthStatus> => ipcRenderer.invoke(IPC.authStatus),
    login: (): Promise<AuthStatus> => ipcRenderer.invoke(IPC.authLogin),
    logout: (): Promise<AuthStatus> => ipcRenderer.invoke(IPC.authLogout)
  },
  player: {
    progress: (id: number, position: number) => ipcRenderer.invoke(IPC.playerProgress, id, position)
  },
  events: {
    onJobs: (cb: (snapshot: JobsSnapshot) => void) => subscribe(IPC.eventJobs, cb),
    onLibrary: (cb: () => void) => subscribe(IPC.eventLibrary, cb),
    onSources: (cb: () => void) => subscribe(IPC.eventSources, cb),
    onToast: (cb: (toast: ToastEvent) => void) => subscribe(IPC.eventToast, cb),
    onAuth: (cb: (status: AuthStatus) => void) => subscribe(IPC.eventAuth, cb),
    onImportProgress: (cb: (progress: ImportProgress) => void) => subscribe(IPC.eventImportProgress, cb),
    onSyncProgress: (cb: (progress: SyncProgress) => void) => subscribe(IPC.eventSyncProgress, cb)
  }
};

contextBridge.exposeInMainWorld('bilishelf', api);
